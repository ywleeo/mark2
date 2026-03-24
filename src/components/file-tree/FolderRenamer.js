import { basename } from '../../utils/pathUtils.js';

export class FolderRenamer {
    constructor(options = {}) {
        const {
            container,
            normalizePath,
            getFileService,
            refreshFolder,
            handleMoveSuccess,
            watchFolder,
            stopWatchingFolder,
            isRootPath,
            replaceRootPath,
            onRenamingEnd,
        } = options;

        this.container = container;
        this.normalizePath = normalizePath;
        this.getFileService = getFileService;
        this.refreshFolder = refreshFolder;
        this.handleMoveSuccess = handleMoveSuccess;
        this.watchFolder = watchFolder;
        this.stopWatchingFolder = stopWatchingFolder;
        this.isRootPath = isRootPath;
        this.replaceRootPath = replaceRootPath;
        this.onRenamingEnd = onRenamingEnd;

        this.renamingPath = null;
        this._renameCleanup = null;
    }

    isRenaming() {
        return Boolean(this.renamingPath);
    }

    getRenamingPath() {
        return this.renamingPath;
    }

    start(path) {
        const normalized = this.normalizePath?.(path);
        if (!normalized) return;

        if (this.renamingPath && this.renamingPath !== normalized) {
            this.cancel();
        }

        const folderItem = this.container?.querySelector(`.tree-folder[data-path="${normalized}"]`);
        if (!folderItem) return;
        const header = folderItem.querySelector('.tree-folder-header');
        if (!header) return;
        const nameSpan = header.querySelector('.tree-item-name');
        if (!nameSpan) return;

        const folderName = nameSpan.textContent || basename(normalized);
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'tree-file-rename-input';
        input.value = folderName;
        nameSpan.replaceWith(input);
        this.renamingPath = normalized;

        let submitting = false;
        const submit = async () => {
            if (submitting) return;
            submitting = true;
            const nextLabel = (input.value || '').trim();
            const ok = await this._submit(
                normalized,
                folderName,
                nextLabel,
                { input, header, nameClass: 'tree-item-name' },
            );
            if (!ok) {
                submitting = false;
                try {
                    input.focus();
                    input.select();
                } catch {}
            }
        };
        const cancel = () => this.cancel({
            input,
            header,
            originalName: folderName,
            nameClass: 'tree-item-name',
        });

        const onKeyDown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                void submit();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                cancel();
            }
        };
        const onBlur = () => {
            if (!submitting) {
                void submit();
            }
        };
        input.addEventListener('keydown', onKeyDown);
        input.addEventListener('blur', onBlur);
        this._renameCleanup = () => {
            input.removeEventListener('keydown', onKeyDown);
            input.removeEventListener('blur', onBlur);
            this._renameCleanup = null;
        };

        setTimeout(() => {
            try {
                input.focus();
                input.setSelectionRange(0, folderName.length);
            } catch {}
        }, 0);
    }

    cancel(ctx = {}) {
        const {
            input,
            header,
            originalName,
            nameClass = 'tree-item-name',
        } = ctx;
        if (!this.renamingPath) return;

        if (this._renameCleanup) {
            this._renameCleanup();
        }

        if (input && header) {
            const span = document.createElement('span');
            span.className = nameClass;
            const fallbackName = originalName || basename(this.renamingPath);
            span.textContent = fallbackName;
            input.replaceWith(span);
            try {
                header.focus();
            } catch {}
        }

        this.renamingPath = null;
        this.onRenamingEnd?.();
    }

    async _submit(oldPath, currentLabel, nextLabel, ctx = {}) {
        if (!nextLabel) {
            return false;
        }
        if (nextLabel === currentLabel) {
            this.cancel(ctx);
            return true;
        }
        try {
            await this._perform(oldPath, nextLabel);
            this.cancel({ ...ctx, originalName: nextLabel });
            return true;
        } catch (error) {
            console.error('重命名文件夹失败:', error);
            try {
                const { message } = await import('@tauri-apps/plugin-dialog');
                await message(`重命名失败:\n${error.message || error}`, { title: '重命名失败', kind: 'error' });
            } catch {}
            return false;
        }
    }

    async _perform(sourcePath, nextLabel) {
        const normalizedSource = this.normalizePath?.(sourcePath);
        if (!normalizedSource) return;

        const fileService = this.getFileService?.();
        const separator = '/';
        const lastSlashIndex = normalizedSource.lastIndexOf(separator);
        const parentDir = lastSlashIndex >= 0 ? normalizedSource.substring(0, lastSlashIndex) : '';
        const destinationPath = parentDir ? `${parentDir}${separator}${nextLabel}` : nextLabel;
        const normalizedDestination = this.normalizePath?.(destinationPath);
        if (!normalizedDestination || normalizedDestination === normalizedSource) {
            return;
        }

        await fileService.move(normalizedSource, normalizedDestination);

        if (this.isRootPath?.(normalizedSource)) {
            this.replaceRootPath?.(normalizedSource, normalizedDestination);
            try {
                this.stopWatchingFolder?.(normalizedSource);
            } catch {}
            try {
                await this.watchFolder?.(normalizedDestination);
            } catch {}
        }

        if (parentDir) {
            setTimeout(() => {
                this.refreshFolder?.(parentDir);
            }, 300);
        }

        await this.handleMoveSuccess?.(normalizedSource, normalizedDestination, { isDirectory: true });

        setTimeout(() => {
            const folderHeader = this.container?.querySelector(
                `.tree-folder[data-path="${normalizedDestination}"] .tree-folder-header`,
            );
            if (folderHeader) {
                try {
                    folderHeader.focus();
                } catch {}
            }
        }, 100);
    }
}
