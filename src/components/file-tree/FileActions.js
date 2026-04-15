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
            closeFile,
            clearSelection,
            isInOpenList,
            getCurrentFile,
            onFileSelect,
            onCloseFileRequest,
        } = options;

        this.normalizePath = normalizePath;
        this.getFileService = getFileService;
        this.refreshFolder = refreshFolder;
        this.handleMoveSuccess = handleMoveSuccess;
        this.stopWatchingFile = stopWatchingFile;
        this.closeFile = closeFile;
        this.clearSelection = clearSelection;
        this.isInOpenList = isInOpenList;
        this.getCurrentFile = getCurrentFile;
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
            await fileService.remove(normalized);

            this.stopWatchingFile(normalized);
            const currentFile = this.normalizePath(this.getCurrentFile?.());
            const isCurrentFile = currentFile === normalized;
            if (this.isInOpenList(normalized)) {
                this.closeFile(normalized, { suppressActivate: true });
            } else if (isCurrentFile && typeof this.onCloseFileRequest === 'function') {
                this.onCloseFileRequest(normalized);
            }
            if (isCurrentFile) {
                this.clearSelection();
                this.onFileSelect?.(null);
            }

            const parentDir = await pathModule.dirname(normalized);
            const normalizedParent = this.normalizePath(parentDir);
            if (normalizedParent) await this.refreshFolder(normalizedParent);
        } catch (error) {
            console.error('删除文件失败:', error);
            try {
                const { message } = await import('@tauri-apps/plugin-dialog');
                await message(t('fileMenu.deleteFile.failMessage', { error: error.message || error }), { title: t('fileMenu.deleteFile.failTitle'), kind: 'error' });
            } catch {}
        }
    }
}
