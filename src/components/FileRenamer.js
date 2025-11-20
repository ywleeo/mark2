export class FileRenamer {
    constructor(options = {}) {
        const {
            container,
            normalizePath,
            getFileService,
            replaceOpenFilePath,
            selectFile,
            getCurrentFile,
            onPathRenamed,
            refreshFolder,
        } = options;

        this.container = container;
        this.normalizePath = normalizePath;
        this.getFileService = getFileService;
        this.replaceOpenFilePath = replaceOpenFilePath;
        this.selectFile = selectFile;
        this.getCurrentFile = getCurrentFile;
        this.onPathRenamed = onPathRenamed;
        this.refreshFolder = refreshFolder;

        this.renamingPath = null;
        this._renameCleanup = null;
    }

    isRenaming() {
        return !!this.renamingPath;
    }

    start(path) {
        const normalized = this.normalizePath?.(path);
        if (!normalized) return;
        if (this.renamingPath && this.renamingPath !== normalized) {
            this.cancel();
        }

        const treeItem = this.container?.querySelector(`.tree-file[data-path="${normalized}"]`);
        const openFileItem = this.container?.querySelector(`.open-file-item[data-path="${normalized}"]`);
        const item = treeItem || openFileItem;
        if (!item) return;

        const nameSpan = treeItem
            ? item.querySelector('.tree-item-name')
            : item.querySelector('.open-file-name');
        if (!nameSpan) return;

        const fileName = nameSpan.textContent || normalized.split('/').pop();
        if (!treeItem && !item.hasAttribute('tabindex')) {
            item.tabIndex = -1;
        }

        const input = document.createElement('input');
        input.type = 'text';
        input.className = treeItem
            ? 'tree-file-rename-input'
            : 'tree-file-rename-input open-file-rename-input';
        input.value = fileName;
        nameSpan.replaceWith(input);
        this.renamingPath = normalized;

        let submitting = false;
        const submit = async () => {
            if (submitting) return;
            submitting = true;
            const nextLabel = (input.value || '').trim();
            const ok = await this.submitRenaming(
                normalized,
                fileName,
                nextLabel,
                { input, item, nameClass: treeItem ? 'tree-item-name' : 'open-file-name' }
            );
            if (!ok) {
                submitting = false;
                input.focus();
                input.select();
            }
        };
        const cancel = () => this.cancel({
            input,
            item,
            originalName: fileName,
            nameClass: treeItem ? 'tree-item-name' : 'open-file-name',
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
                cancel();
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
            input.focus();
            const { start, end } = this._calcNameSelectionRange(fileName);
            try {
                input.setSelectionRange(start, end);
            } catch {}
        }, 0);
    }

    cancel(ctx = {}) {
        const {
            input,
            item,
            originalName,
            nameClass = 'tree-item-name',
        } = ctx;
        if (!this.renamingPath) return;
        if (this._renameCleanup) this._renameCleanup();
        if (input && item) {
            const span = document.createElement('span');
            span.className = nameClass;
            const fallbackName = originalName || (this.renamingPath.split('/').pop());
            span.textContent = fallbackName;
            input.replaceWith(span);
            try {
                item.focus();
            } catch {}
        }
        this.renamingPath = null;
    }

    async submitRenaming(oldPath, currentLabel, nextLabel, ctx = {}) {
        if (!nextLabel) {
            return false;
        }
        if (nextLabel === currentLabel) {
            this.cancel(ctx);
            return true;
        }
        try {
            await this.performRename(oldPath, nextLabel);
            this.cancel(ctx);
            return true;
        } catch (error) {
            console.error('重命名失败:', error);
            try {
                const { message } = await import('@tauri-apps/plugin-dialog');
                await message(`重命名失败:\n${error.message || error}`, { title: '重命名失败', kind: 'error' });
            } catch {}
            return false;
        }
    }

    _calcNameSelectionRange(fileName) {
        const len = (fileName || '').length;
        if (len === 0) return { start: 0, end: 0 };
        const firstDot = fileName.indexOf('.');
        const lastDot = fileName.lastIndexOf('.');
        let end = len;
        if (lastDot > 0) {
            end = lastDot;
        } else if (firstDot === 0 && lastDot > 0) {
            end = lastDot;
        }
        if (end < 0) end = len;
        return { start: 0, end };
    }

    async performRename(sourcePath, nextLabel) {
        const normalizedSource = this.normalizePath?.(sourcePath);
        if (!normalizedSource) return;
        const fileService = this.getFileService?.();
        if (!fileService) {
            throw new Error('文件服务未就绪，无法重命名');
        }

        const separator = '/';
        const parentDir = normalizedSource.substring(0, normalizedSource.lastIndexOf(separator));
        const destinationPath = parentDir ? `${parentDir}${separator}${nextLabel}` : nextLabel;
        if (destinationPath === normalizedSource) {
            return;
        }
        await fileService.move(normalizedSource, destinationPath);

        this.replaceOpenFilePath?.(normalizedSource, destinationPath);

        const wasCurrent = this.normalizePath?.(this.getCurrentFile?.()) === normalizedSource;
        if (wasCurrent) {
            this.selectFile?.(destinationPath, { autoFocus: false });
        }

        try {
            this.onPathRenamed?.(normalizedSource, destinationPath, { suppressAutoFocus: true });
        } catch (error) {
            console.warn('onPathRenamed 回调失败:', error);
        }

        if (parentDir) {
            setTimeout(() => {
                this.refreshFolder?.(parentDir);
            }, 300);
        }

        setTimeout(() => {
            const renamedItem = this.container?.querySelector(`.tree-file[data-path="${destinationPath}"]`)
                || this.container?.querySelector(`.open-file-item[data-path="${destinationPath}"]`);
            if (renamedItem) {
                try {
                    renamedItem.focus();
                } catch {}
            }
        }, 100);
    }
}
