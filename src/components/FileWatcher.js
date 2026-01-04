const WATCHER_VERIFICATION_COOLDOWN_MS = 5000;
const WATCHER_STALE_THRESHOLD_MS = 300000;

export class FileWatcher {
    constructor(options = {}) {
        const {
            normalizePath,
            getFileService,
            ensureFileService,
            onFolderChange,
            onFileChange,
            getRootPaths,
            isRootPath,
            loadFolder,
        } = options;

        this.normalizePath = normalizePath;
        this.getFileService = getFileService;
        this.ensureFileService = ensureFileService;
        this.onFolderChange = onFolderChange;
        this.onFileChange = onFileChange;
        this.getRootPaths = getRootPaths;
        this.isRootPath = isRootPath;
        this.loadFolder = loadFolder;

        this.folderWatchers = new Map();
        this.fileWatchers = new Map();
    }

    async watchFolder(path) {
        const normalizedPath = this.normalizePath?.(path);
        if (!normalizedPath || this.folderWatchers.has(normalizedPath)) {
            return;
        }

        try {
            const { watch } = await import('@tauri-apps/plugin-fs');
            const unwatch = await watch(normalizedPath, (event) => {
                this.onFolderChange?.(normalizedPath, event);
            }, { recursive: true, delayMs: 100 });
            this.folderWatchers.set(normalizedPath, unwatch);
        } catch (error) {
            console.error('目录监听失败:', error);
            this.folderWatchers.delete(normalizedPath);
        }
    }

    stopWatchingFolder(path = null) {
        if (path) {
            const normalizedPath = this.normalizePath?.(path);
            if (!normalizedPath) return;
            const unwatch = this.folderWatchers.get(normalizedPath);
            if (unwatch) {
                try {
                    unwatch();
                } catch (error) {
                    console.error('停止目录监听失败:', error);
                }
                this.folderWatchers.delete(normalizedPath);
            }
            return;
        }

        this.folderWatchers.forEach((unwatch, watchedPath) => {
            try {
                unwatch();
            } catch (error) {
                console.error('停止目录监听失败:', { watchedPath, error });
            }
        });
        this.folderWatchers.clear();
    }

    async watchFile(path, options = {}) {
        const normalizedPath = this.normalizePath?.(path);
        if (!normalizedPath) return;

        const existingState = this.fileWatchers.get(normalizedPath);
        if (existingState) {
            existingState.lastVerificationTimestamp = Date.now();
            return;
        }

        try {
            const { watch } = await import('@tauri-apps/plugin-fs');
            const unwatch = await watch(
                normalizedPath,
                (event) => {
                    const state = this.fileWatchers.get(normalizedPath);
                    if (state) {
                        state.lastEventTimestamp = Date.now();
                        state.hasReceivedEvent = true;
                        state.externallyModified = true;
                    }

                    requestAnimationFrame(() => {
                        this.onFileChange?.(normalizedPath, event);
                    });
                },
                { recursive: false, delayMs: 50 }
            );

            const watcherState = {
                unwatch,
                hasReceivedEvent: false,
                lastEventTimestamp: null,
                lastVerificationTimestamp: Date.now(),
                lastRebuildTimestamp: Date.now(),
                pendingVerification: null,
                externallyModified: false,
            };

            this.fileWatchers.set(normalizedPath, watcherState);
        } catch (error) {
            console.error('文件监听失败:', { path: normalizedPath, options, error });
            throw error;
        }
    }

    stopWatchingFile(path) {
        const normalizedPath = this.normalizePath?.(path);
        if (!normalizedPath) return;

        const watcherState = this.fileWatchers.get(normalizedPath);
        if (!watcherState) {
            return;
        }

        const { unwatch } = watcherState;
        if (typeof unwatch === 'function') {
            try {
                unwatch();
            } catch (error) {
                console.error('停止文件监听失败:', { path: normalizedPath, error });
            }
        }

        this.fileWatchers.delete(normalizedPath);
    }

    async ensureFileWatcherHealth(path, options = {}) {
        const normalizedPath = this.normalizePath?.(path);
        if (!normalizedPath) return;

        const state = this.fileWatchers.get(normalizedPath);
        if (!state) {
            await this.watchFile(normalizedPath, { reason: 'ensure-missing' });
            return;
        }

        const now = Date.now();
        if (!options.force) {
            const sinceLastVerify = now - (state.lastVerificationTimestamp ?? 0);
            if (sinceLastVerify < WATCHER_VERIFICATION_COOLDOWN_MS) {
                return;
            }
        }

        if (state.pendingVerification) {
            return;
        }

        const verificationPromise = (async () => {
            try {
                await this.ensureFileService?.().ipcHealthCheck?.();
                const verifiedAt = Date.now();
                state.lastVerificationTimestamp = verifiedAt;

                if (state.hasReceivedEvent) {
                    const lastEventAt = state.lastEventTimestamp ?? verifiedAt;
                    const timeSinceLastEvent = verifiedAt - lastEventAt;
                    if (timeSinceLastEvent > WATCHER_STALE_THRESHOLD_MS) {
                        await this.restartFileWatcher(normalizedPath, { reason: 'stale-event' });
                    }
                }
            } catch (error) {
                console.warn('IPC 健康检查失败，准备重建文件监听', { path: normalizedPath, error });
                await this.restartFileWatcher(normalizedPath, { reason: 'ipc-failed' });
            }
        })();

        state.pendingVerification = verificationPromise;

        try {
            await verificationPromise;
        } finally {
            const current = this.fileWatchers.get(normalizedPath);
            if (current) {
                current.pendingVerification = null;
            }
        }
    }

    async restartFileWatcher(path, options = {}) {
        const normalizedPath = this.normalizePath?.(path);
        if (!normalizedPath) return;

        const state = this.fileWatchers.get(normalizedPath);
        const now = Date.now();
        if (state && now - (state.lastRebuildTimestamp ?? 0) < WATCHER_VERIFICATION_COOLDOWN_MS) {
            return;
        }

        this.stopWatchingFile(normalizedPath);

        try {
            await this.watchFile(normalizedPath, { ...options, reason: options.reason ?? 'restart' });
        } catch (error) {
            console.error('重建文件监听失败:', { path: normalizedPath, error, options });
        }
    }

    consumeExternalModification(path) {
        const normalizedPath = this.normalizePath?.(path);
        if (!normalizedPath) return false;
        const state = this.fileWatchers.get(normalizedPath);
        if (!state) return false;
        const wasModified = Boolean(state.externallyModified);
        state.externallyModified = false;
        return wasModified;
    }

    clearExternalModification(path) {
        const normalizedPath = this.normalizePath?.(path);
        if (!normalizedPath) return;
        const state = this.fileWatchers.get(normalizedPath);
        if (state) {
            state.externallyModified = false;
        }
    }

    async refreshCurrentFolder(targetPath = null) {
        if (targetPath) {
            await this.refreshFolder(targetPath);
            return;
        }

        const rootPaths = typeof this.getRootPaths === 'function'
            ? this.getRootPaths()
            : [];
        const tasks = rootPaths.map((path) => this.refreshFolder(path));
        await Promise.all(tasks);
    }

    async refreshFolder(path) {
        const normalizedPath = this.normalizePath?.(path);
        if (!normalizedPath) {
            return;
        }

        const isRoot = typeof this.isRootPath === 'function'
            ? this.isRootPath(normalizedPath)
            : true;
        if (!isRoot) {
            return;
        }

        await this.loadFolder?.(normalizedPath);
    }

    dispose() {
        this.stopWatchingFolder();
        Array.from(this.fileWatchers.keys()).forEach((path) => {
            this.stopWatchingFile(path);
        });
        this.fileWatchers.clear();
    }
}
