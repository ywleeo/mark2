import { getPathIdentityKey } from '../../utils/pathUtils.js';
import { getViewModeForPath } from '../../utils/fileTypeUtils.js';

export class OpenFileManager {
    constructor(options = {}) {
        const {
            normalizePath,
            state,
            getOpenFilesView,
            watchFile,
            stopWatchingFile,
            selectFile,
            clearSelection,
            onFileSelect,
            onOpenFilesChange,
            onPathRenamed,
        } = options;

        this.normalizePath = normalizePath;
        this.state = state;
        this.getOpenFilesView = getOpenFilesView;
        this.watchFile = watchFile;
        this.stopWatchingFile = stopWatchingFile;
        this.selectFile = selectFile;
        this.clearSelection = clearSelection;
        this.onFileSelect = onFileSelect;
        this.onOpenFilesChange = onOpenFilesChange;
        this.onPathRenamed = onPathRenamed;
    }

    getOpenFilePaths() {
        return [...this.state.openFiles];
    }

    add(path) {
        const normalized = this.normalizePath(path);
        if (!normalized) return;
        if (this.state.isInOpenList(normalized)) return;

        this.state.addOpenFile(normalized);
        this.render();
        const viewMode = getViewModeForPath(normalized);
        if (viewMode === 'markdown' || viewMode === 'code') {
            this.watchFile(normalized).catch(error => {
                console.error('监听文件失败:', error);
            });
        }
    }

    close(path, options = {}) {
        const normalizedTarget = this.normalizePath(path);
        const targetIdentity = getPathIdentityKey(normalizedTarget);
        const index = this.state.findOpenFileIndex(normalizedTarget);
        if (index === -1) return;

        const wasActive = Boolean(targetIdentity) && this.state.isCurrentFile(normalizedTarget);
        this.state.removeOpenFile(normalizedTarget);
        this.render();
        this.stopWatchingFile(normalizedTarget);

        if (wasActive) {
            const fallbackIndex = Math.min(index, this.state.openFiles.length - 1);
            const fallback = fallbackIndex >= 0 ? this.state.openFiles[fallbackIndex] : null;
            if (fallback && !options.suppressActivate) {
                this.selectFile(fallback);
            } else if (!fallback) {
                this.clearSelection();
                this.onFileSelect?.(null);
            }
        }
    }

    replacePath(oldPath, newPath) {
        const normalizedOld = this.normalizePath(oldPath);
        const normalizedNew = this.normalizePath(newPath);
        const oldIdentity = getPathIdentityKey(normalizedOld);
        const newIdentity = getPathIdentityKey(normalizedNew);

        if (!normalizedOld || !normalizedNew) return;
        if (!oldIdentity || !newIdentity || oldIdentity === newIdentity) return;

        const index = this.state.findOpenFileIndex(normalizedOld);
        this.stopWatchingFile(normalizedOld);

        if (index === -1) {
            if (this.state.isCurrentFile(normalizedOld)) {
                this.state.currentFile = normalizedNew;
            }
            this.watchFile(normalizedNew).catch(error => {
                console.error('监听文件失败:', error);
            });
            return;
        }

        const filtered = this.state.openFiles.filter(
            (path, idx) => getPathIdentityKey(path) !== oldIdentity
                && (getPathIdentityKey(path) !== newIdentity || idx === index)
        );
        const insertPosition = Math.min(index, filtered.length);
        filtered.splice(insertPosition, 0, normalizedNew);
        this.state.openFiles = filtered;

        if (this.state.isCurrentFile(normalizedOld)) {
            this.state.currentFile = normalizedNew;
        }

        this.render();
        this.watchFile(normalizedNew).catch(error => {
            console.error('监听文件失败:', error);
        });
        this.onOpenFilesChange?.([...this.state.openFiles]);
    }

    render(options = {}) {
        const { skipWatch = false } = options;
        this.getOpenFilesView?.()?.render(this.state.openFiles, {
            currentFile: this.state.currentFile,
            skipWatch,
        });
    }

    restore(paths = []) {
        const normalized = [];
        const seen = new Set();

        paths.forEach((path) => {
            const normalizedPath = this.normalizePath(path);
            const identityKey = getPathIdentityKey(normalizedPath);
            if (!normalizedPath || !identityKey || seen.has(identityKey)) return;
            seen.add(identityKey);
            normalized.push(normalizedPath);
        });

        this.state.openFiles.forEach((path) => {
            const existingPath = this.normalizePath(path);
            const existingIdentity = getPathIdentityKey(existingPath);
            if (existingPath && existingIdentity && !seen.has(existingIdentity)) {
                this.stopWatchingFile(existingPath);
            }
        });

        this.state.openFiles = normalized;
        const normalizedCurrent = this.normalizePath(this.state.currentFile);
        if (normalizedCurrent) {
            const currentIdentity = getPathIdentityKey(normalizedCurrent);
            const restoredCurrent = normalized.find((path) => getPathIdentityKey(path) === currentIdentity) || null;
            this.state.currentFile = restoredCurrent || normalizedCurrent;
        }
        this.render();
        this.onOpenFilesChange?.([...this.state.openFiles]);
    }

    reorder(paths = []) {
        if (!Array.isArray(paths) || paths.length === 0) return;

        const seen = new Set();
        const existing = new Set(this.state.openFiles.map((path) => getPathIdentityKey(path)).filter(Boolean));
        const normalized = [];

        paths.forEach((path) => {
            const normalizedPath = this.normalizePath(path);
            const identityKey = getPathIdentityKey(normalizedPath);
            if (!normalizedPath || !identityKey || seen.has(identityKey) || !existing.has(identityKey)) return;
            seen.add(identityKey);
            normalized.push(normalizedPath);
            existing.delete(identityKey);
        });

        if (normalized.length === 0) return;

        if (existing.size > 0) {
            this.state.openFiles.forEach((path) => {
                const identityKey = getPathIdentityKey(path);
                if (!identityKey || !seen.has(identityKey)) normalized.push(path);
            });
        }

        const isSameOrder = normalized.length === this.state.openFiles.length
            && normalized.every((path, index) => this.state.openFiles[index] === path);
        if (isSameOrder) return;

        this.state.openFiles = normalized;
        this.render({ skipWatch: true });
        this.onOpenFilesChange?.([...this.state.openFiles]);
    }

    handleMoveSuccess(sourcePath, destinationPath, meta = {}) {
        const normalizedSource = this.normalizePath(sourcePath);
        const normalizedDestination = this.normalizePath(destinationPath);
        if (!normalizedSource || !normalizedDestination) return;

        const isDirectory = meta?.isDirectory === true;
        if (!isDirectory) {
            try {
                this.replacePath(normalizedSource, normalizedDestination);
                this.onPathRenamed?.(normalizedSource, normalizedDestination, { suppressAutoFocus: true });
            } catch (error) {
                console.warn('处理文件移动回调失败:', error);
            }
            return;
        }

        const sourcePrefix = normalizedSource.endsWith('/') ? normalizedSource : `${normalizedSource}/`;
        const destinationPrefix = normalizedDestination.endsWith('/')
            ? normalizedDestination
            : `${normalizedDestination}/`;

        const affectedPaths = new Set(this.state.openFiles || []);
        if (this.state.currentFile) affectedPaths.add(this.state.currentFile);

        affectedPaths.forEach((path) => {
            if (!path) return;
            const normalized = this.normalizePath(path);
            if (!normalized || !normalized.startsWith(sourcePrefix)) return;
            const relative = normalized.slice(sourcePrefix.length);
            const nextPath = `${destinationPrefix}${relative}`;
            try {
                this.replacePath(normalized, nextPath);
                this.onPathRenamed?.(normalized, nextPath, { suppressAutoFocus: true });
            } catch (error) {
                console.warn('处理文件夹移动回调失败:', error);
            }
        });
    }
}
