import { basename } from '../utils/pathUtils.js';
import { createCompactFileNameElement, scheduleCompactFileNameRefresh } from '../utils/fileNameDisplay.js';

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
            documentSessions,
            onRenamingEnd,
        } = options;

        this.container = container;
        this.normalizePath = normalizePath;
        this.getFileService = getFileService;
        this.replaceOpenFilePath = replaceOpenFilePath;
        this.selectFile = selectFile;
        this.getCurrentFile = getCurrentFile;
        this.onPathRenamed = onPathRenamed;
        this.refreshFolder = refreshFolder;
        this.documentSessions = documentSessions;
        this.onRenamingEnd = onRenamingEnd;

        this.renamingPath = null;
        this._renameCleanup = null;
    }

    isRenaming() {
        return !!this.renamingPath;
    }

    getRenamingPath() {
        return this.renamingPath;
    }

    start(path) {
        const normalized = this.normalizePath?.(path);
        if (!normalized) {
            return;
        }
        if (this.renamingPath && this.renamingPath !== normalized) {
            this.cancel();
        }

        // 用遍历 + 严格相等替代 CSS 属性选择器，避免中文路径的 Unicode 编码问题
        const treeItem = Array.from(this.container?.querySelectorAll('.tree-file') || [])
            .find(el => el.dataset.path === normalized) || null;
        const openFileItem = Array.from(this.container?.querySelectorAll('.open-file-item') || [])
            .find(el => el.dataset.path === normalized) || null;
        // 优先使用 openFileItem，因为用户更可能从打开文件列表触发重命名
        const item = openFileItem || treeItem;
        if (!item) {
            return;
        }

        const useOpenFileItem = item === openFileItem;
        const nameSpan = useOpenFileItem
            ? item.querySelector('.open-file-name')
            : item.querySelector('.tree-item-name');
        if (!nameSpan) {
            return;
        }

        const fileName = nameSpan.dataset.fullName || basename(normalized);
        if (useOpenFileItem && !item.hasAttribute('tabindex')) {
            item.tabIndex = -1;
        }

        const input = document.createElement('input');
        input.type = 'text';
        input.className = useOpenFileItem
            ? 'tree-file-rename-input open-file-rename-input'
            : 'tree-file-rename-input';
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
                { input, item, nameClass: useOpenFileItem ? 'open-file-name' : 'tree-item-name' }
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
            nameClass: useOpenFileItem ? 'open-file-name' : 'tree-item-name',
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
        if (!this.renamingPath) {
            return;
        }
        const endedPath = this.renamingPath;
        if (this._renameCleanup) this._renameCleanup();
        if (input && item) {
            const fallbackName = originalName || (basename(this.renamingPath));
            const span = createCompactFileNameElement(nameClass, fallbackName);
            input.replaceWith(span);
            scheduleCompactFileNameRefresh(item);
            try {
                item.focus();
            } catch {}
        }
        this.renamingPath = null;
        if (typeof this.onRenamingEnd === 'function') {
            this.onRenamingEnd(endedPath);
        }
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
        const rawDestination = parentDir ? `${parentDir}${separator}${nextLabel}` : nextLabel;
        const normalizedDestination = this.normalizePath?.(rawDestination) || rawDestination;
        if (normalizedDestination === normalizedSource) {
            return;
        }
        this._markLocalWrite(normalizedSource);
        this._markLocalWrite(normalizedDestination);
        if (parentDir) {
            this._markLocalWrite(parentDir);
        }
        const destinationParent = normalizedDestination.substring(0, normalizedDestination.lastIndexOf(separator));
        if (destinationParent && destinationParent !== parentDir) {
            this._markLocalWrite(destinationParent);
        }
        await fileService.move(normalizedSource, normalizedDestination);

        this.replaceOpenFilePath?.(normalizedSource, normalizedDestination);

        const wasCurrent = this.normalizePath?.(this.getCurrentFile?.()) === normalizedSource;
        if (wasCurrent) {
            this.selectFile?.(normalizedDestination, { autoFocus: false });
        }

        try {
            this.onPathRenamed?.(normalizedSource, normalizedDestination, { suppressAutoFocus: true });
        } catch (error) {
            console.warn('onPathRenamed 回调失败:', error);
        }

        if (parentDir) {
            setTimeout(() => {
                this.refreshFolder?.(parentDir);
            }, 300);
        }

        setTimeout(() => {
            // 用遍历 + 严格相等替代 CSS 属性选择器，避免中文路径的 Unicode 编码问题
            const renamedItem = Array.from(this.container?.querySelectorAll('.tree-file') || [])
                .find(el => el.dataset.path === normalizedDestination)
                || Array.from(this.container?.querySelectorAll('.open-file-item') || [])
                    .find(el => el.dataset.path === normalizedDestination);
            if (renamedItem) {
                try {
                    renamedItem.focus();
                } catch {}
            }
        }, 100);
    }

    _markLocalWrite(path, options = {}) {
        if (!path || !this.documentSessions || typeof this.documentSessions.markLocalWrite !== 'function') {
            return;
        }
        const normalized = this.normalizePath?.(path) || path;
        if (!normalized) {
            return;
        }
        const suppressWatcherMs = Number.isFinite(options.durationMs)
            ? Math.max(0, options.durationMs)
            : 1200;
        this.documentSessions.markLocalWrite(normalized, { suppressWatcherMs });
    }
}
