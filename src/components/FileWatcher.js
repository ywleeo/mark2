const WATCHER_VERIFICATION_COOLDOWN_MS = 5000;
const WATCHER_STALE_THRESHOLD_MS = 300000;
const FOLDER_POLL_MIN_INTERVAL_MS = 1500;
const FOLDER_POLL_MAX_INTERVAL_MS = 5000;
const FOLDER_POLL_RESUME_THRESHOLD_MS = 10000;

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
        this.getExpandedFolderPaths = options.getExpandedFolderPaths;

        this.folderWatchers = new Map();
        this.fileWatchers = new Map();
    }

    async watchFolder(path) {
        const normalizedPath = this.normalizePath?.(path);
        if (!normalizedPath || this.folderWatchers.has(normalizedPath)) {
            return;
        }

        const watcherState = {
            timer: null,
            signature: null,
            inFlight: false,
            lastTickAt: 0,
            nextDelay: FOLDER_POLL_MIN_INTERVAL_MS,
        };

        const scheduleNext = () => {
            if (watcherState.timer) {
                clearTimeout(watcherState.timer);
            }
            watcherState.timer = setTimeout(poll, watcherState.nextDelay);
        };

        const poll = async () => {
            const now = Date.now();
            const lastTick = watcherState.lastTickAt;
            watcherState.lastTickAt = now;
            if (watcherState.inFlight) return;
            watcherState.inFlight = true;
            try {
                const signature = await this.buildFolderSignature(normalizedPath);
                if (watcherState.signature === null) {
                    watcherState.signature = signature;
                    watcherState.nextDelay = FOLDER_POLL_MIN_INTERVAL_MS;
                    return;
                }
                if (signature !== watcherState.signature || (lastTick && now - lastTick > FOLDER_POLL_RESUME_THRESHOLD_MS)) {
                    watcherState.signature = signature;
                    this.onFolderChange?.(normalizedPath, { type: 'poll', paths: [normalizedPath] });
                    watcherState.nextDelay = FOLDER_POLL_MIN_INTERVAL_MS;
                } else {
                    watcherState.nextDelay = Math.min(
                        FOLDER_POLL_MAX_INTERVAL_MS,
                        Math.round(watcherState.nextDelay * 1.5)
                    );
                }
            } catch (error) {
                console.warn('目录轮询失败:', { path: normalizedPath, error });
                watcherState.nextDelay = FOLDER_POLL_MIN_INTERVAL_MS;
            } finally {
                watcherState.inFlight = false;
                if (document.hidden) {
                    watcherState.nextDelay = Math.max(watcherState.nextDelay, FOLDER_POLL_MAX_INTERVAL_MS);
                }
                scheduleNext();
            }
        };

        await poll();
        this.folderWatchers.set(normalizedPath, watcherState);
    }

    stopWatchingFolder(path = null) {
        if (path) {
            const normalizedPath = this.normalizePath?.(path);
            if (!normalizedPath) return;
            const state = this.folderWatchers.get(normalizedPath);
            if (state?.timer) {
                try {
                    clearTimeout(state.timer);
                } catch (error) {
                    console.error('停止目录监听失败:', error);
                }
                this.folderWatchers.delete(normalizedPath);
            }
            return;
        }

        this.folderWatchers.forEach((state, watchedPath) => {
            if (!state?.timer) {
                return;
            }
            try {
                clearTimeout(state.timer);
            } catch (error) {
                console.error('停止目录监听失败:', { watchedPath, error });
            }
        });
        this.folderWatchers.clear();
    }

    async watchFile(path, options = {}) {
        // 跳过 untitled 虚拟文件的监听
        if (typeof path === 'string' && path.startsWith('untitled://')) {
            return;
        }
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
        // 跳过 untitled 虚拟文件
        if (typeof path === 'string' && path.startsWith('untitled://')) {
            return;
        }
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

    async buildFolderSignature(rootPath) {
        const fileService = this.ensureFileService?.();
        if (!fileService || typeof fileService.list !== 'function') {
            return `${rootPath}|no-service`;
        }

        const expanded = typeof this.getExpandedFolderPaths === 'function'
            ? this.getExpandedFolderPaths()
            : [];

        const normalizedExpanded = expanded
            .map((path) => this.normalizePath?.(path) || path)
            .filter(Boolean);

        const watchedPaths = new Set([rootPath]);
        normalizedExpanded.forEach((path) => {
            if (path === rootPath || path.startsWith(`${rootPath}/`) || path.startsWith(`${rootPath}\\`)) {
                watchedPaths.add(path);
            }
        });

        const snapshots = [];
        for (const path of watchedPaths) {
            try {
                const { entries = [] } = await fileService.list(path);
                const normalizedEntries = entries
                    .map((entry) => `${entry.type || 'file'}:${entry.name || ''}`)
                    .sort()
                    .join(',');
                snapshots.push(`${path}|${normalizedEntries}`);
            } catch (error) {
                snapshots.push(`${path}|error`);
            }
        }

        return snapshots.sort().join('\n');
    }

    dispose() {
        this.stopWatchingFolder();
        Array.from(this.fileWatchers.keys()).forEach((path) => {
            this.stopWatchingFile(path);
        });
        this.fileWatchers.clear();
    }
}
