import { rememberSecurityScopes } from '../../services/securityScopeService.js';
import { t } from '../../i18n/index.js';

export class FileActions {
    constructor(options = {}) {
        const {
            normalizePath,
            getFileService,
            refreshFolder,
            handleMoveSuccess,
            stopWatchingFile,
            stopWatchingFolder,
            closeFile,
            clearSelection,
            isInOpenList,
            getCurrentFile,
            getOpenFilePaths,
            getDocumentOpenPaths,
            onFileSelect,
            onCloseFileRequest,
        } = options;

        this.normalizePath = normalizePath;
        this.getFileService = getFileService;
        this.refreshFolder = refreshFolder;
        this.handleMoveSuccess = handleMoveSuccess;
        this.stopWatchingFile = stopWatchingFile;
        this.stopWatchingFolder = stopWatchingFolder;
        this.closeFile = closeFile;
        this.clearSelection = clearSelection;
        this.isInOpenList = isInOpenList;
        this.getCurrentFile = getCurrentFile;
        this.getOpenFilePaths = getOpenFilePaths;
        this.getDocumentOpenPaths = getDocumentOpenPaths;
        this.onFileSelect = onFileSelect;
        this.onCloseFileRequest = onCloseFileRequest;
    }

    async promptMoveTo(sourcePath, meta = {}) {
        const normalizedSource = this.normalizePath(sourcePath);
        if (!normalizedSource) return;

        const isDirectory = meta?.isDirectory === true || meta?.targetType === 'folder';
        try {
            const pathModule = await import('@tauri-apps/api/path');
            const fileService = this.getFileService();
            const selections = await fileService.pick({
                directory: true,
                multiple: false,
                allowFiles: false,
            });
            const selectionEntries = Array.isArray(selections) ? selections.filter(Boolean) : [];
            if (selectionEntries.length === 0) return;
            try {
                await rememberSecurityScopes(selectionEntries, { persist: false });
            } catch (error) {
                console.warn('[fileTree] 申请目标文件夹权限失败', error);
            }
            const targetDirectory = selectionEntries[0]?.path;
            const normalizedTargetDir = this.normalizePath(targetDirectory);
            if (!normalizedTargetDir) return;

            const fileName = await pathModule.basename(normalizedSource);
            const destinationPath = await pathModule.join(normalizedTargetDir, fileName);
            const normalizedDestination = this.normalizePath(destinationPath);
            if (normalizedDestination && normalizedDestination === normalizedSource) return;

            await fileService.move(normalizedSource, normalizedDestination);

            const sourceParent = await pathModule.dirname(normalizedSource);
            const destinationParent = await pathModule.dirname(normalizedDestination);
            const refreshTasks = [];
            if (sourceParent) refreshTasks.push(this.refreshFolder(sourceParent));
            if (destinationParent && destinationParent !== sourceParent) {
                refreshTasks.push(this.refreshFolder(destinationParent));
            }
            await Promise.all(refreshTasks);
            await this.handleMoveSuccess(normalizedSource, normalizedDestination, { isDirectory });
        } catch (error) {
            console.error('移动文件失败:', error);
            try {
                const { message } = await import('@tauri-apps/plugin-dialog');
                await message(t('fileMenu.moveFile.failMessage', { error: error.message || error }), { title: t('fileMenu.moveFile.failTitle'), kind: 'error' });
            } catch {}
        }
    }

    async revealInFinder(path) {
        const normalized = this.normalizePath(path);
        if (!normalized) return;
        try {
            const fileService = this.getFileService();
            await fileService.reveal(normalized);
        } catch (error) {
            console.error('打开 Finder 失败:', error);
            try {
                const { message } = await import('@tauri-apps/plugin-dialog');
                await message(t('fileMenu.reveal.failMessage', { error: error.message || error }), { title: t('fileMenu.reveal.failTitle'), kind: 'error' });
            } catch {}
        }
    }

    async confirmAndDelete(path) {
        const normalized = this.normalizePath(path);
        if (!normalized) return;
        try {
            const [{ confirm, message }, pathModule] = await Promise.all([
                import('@tauri-apps/plugin-dialog'),
                import('@tauri-apps/api/path'),
            ]);
            const fileName = await pathModule.basename(normalized);
            const shouldDelete = await confirm(t('fileMenu.deleteFile.confirm', { name: fileName }), {
                title: t('fileMenu.deleteFile.title'),
                kind: 'warning',
                okLabel: t('fileMenu.deleteFile.ok'),
                cancelLabel: t('common.cancel'),
            });
            if (!shouldDelete) return;

            const fileService = this.getFileService();

            // 删除前先判断是否文件夹：是的话，关闭文件夹内所有打开的 tab + 停止 watcher，
            // 否则 trash 之后残留的 watcher 会去读已不存在的文件，刷出 path-not-found 错误。
            let isDir = false;
            try {
                isDir = await fileService.isDirectory(normalized);
            } catch {}

            const sep = normalized.includes('\\') ? '\\' : '/';
            const folderPrefix = `${normalized}${sep}`;
            const isWithinDeletedFolder = (p) => {
                if (!isDir || !p) return false;
                return p === normalized || p.startsWith(folderPrefix);
            };

            if (isDir) {
                // 合并三个来源：fileTab 真源（DocumentManager）、侧边栏 openFiles、active currentFile。
                // 缺一不可：sharedTab 预览模式打开的文件不进前两者，只通过 currentFile 暴露。
                const allOpenPaths = new Set();
                const addPaths = (paths) => {
                    if (!Array.isArray(paths)) return;
                    for (const p of paths) {
                        const np = this.normalizePath(p);
                        if (np) allOpenPaths.add(np);
                    }
                };
                addPaths(typeof this.getDocumentOpenPaths === 'function' ? this.getDocumentOpenPaths() : []);
                addPaths(typeof this.getOpenFilePaths === 'function' ? this.getOpenFilePaths() : []);
                const activeFile = this.normalizePath(this.getCurrentFile?.());
                if (activeFile) allOpenPaths.add(activeFile);

                for (const openPath of allOpenPaths) {
                    if (!isWithinDeletedFolder(openPath)) continue;
                    this.stopWatchingFile(openPath);
                    // onCloseFileRequest 走 handleTabClose 统一入口，能正确关闭 fileTab/sharedTab
                    // 并清掉 appState.currentFile，避免 watcher 后续读已删除文件。
                    if (typeof this.onCloseFileRequest === 'function') {
                        try {
                            await this.onCloseFileRequest(openPath);
                        } catch (err) {
                            console.warn('关闭文件夹下打开的 tab 失败:', openPath, err);
                        }
                    }
                }
                if (typeof this.stopWatchingFolder === 'function') {
                    this.stopWatchingFolder(normalized);
                }
            }

            const postDeleteCleanup = async () => {
                this.stopWatchingFile(normalized);
                const currentFile = this.normalizePath(this.getCurrentFile?.());
                const isCurrentFile = currentFile === normalized;
                if (this.isInOpenList(normalized)) {
                    this.closeFile(normalized, { suppressActivate: true });
                } else if (isCurrentFile && typeof this.onCloseFileRequest === 'function') {
                    this.onCloseFileRequest(normalized);
                }
                if (isCurrentFile || isWithinDeletedFolder(currentFile)) {
                    this.clearSelection();
                    this.onFileSelect?.(null);
                }
                const parentDir = await pathModule.dirname(normalized);
                const normalizedParent = this.normalizePath(parentDir);
                if (normalizedParent) await this.refreshFolder(normalizedParent);
            };

            try {
                await fileService.remove(normalized);
                await postDeleteCleanup();
            } catch (trashError) {
                const raw = String(trashError?.message ?? trashError ?? '');
                // Rust 端在 trash 失败时加 trash_unsupported: 前缀，标记此位置不支持回收站（WSL / 网络盘等）
                if (!raw.startsWith('trash_unsupported:')) throw trashError;

                const { confirm: confirm2 } = await import('@tauri-apps/plugin-dialog');
                const goPermanent = await confirm2(
                    t('fileMenu.deleteFile.permanentConfirmMessage', { name: fileName }),
                    {
                        title: t('fileMenu.deleteFile.permanentConfirmTitle'),
                        kind: 'warning',
                        okLabel: t('fileMenu.deleteFile.permanentConfirmOk'),
                        cancelLabel: t('common.cancel'),
                    },
                );
                if (!goPermanent) return;

                await fileService.removePermanent(normalized);
                await postDeleteCleanup();
            }
        } catch (error) {
            console.error('删除文件失败:', error);
            try {
                const { message } = await import('@tauri-apps/plugin-dialog');
                await message(t('fileMenu.deleteFile.failMessage', { error: error.message || error }), { title: t('fileMenu.deleteFile.failTitle'), kind: 'error' });
            } catch {}
        }
    }
}
