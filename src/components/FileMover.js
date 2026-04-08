import { basename } from '../utils/pathUtils.js';
import { setInternalDrag, isInternalDrag } from '../utils/dragState.js';

export class FileMover {
    constructor(options = {}) {
        const {
            container,
            normalizePath,
            getFileService,
            refreshFolder,
            onMove,
        } = options;

        this.container = container;
        this.normalizePath = normalizePath;
        this.getFileService = getFileService;
        this.refreshFolder = refreshFolder;
        this.onMove = onMove;

        this._dragState = null;
        this._dragGhost = null;
        this._onInternalMouseMove = null;
        this._onInternalMouseUp = null;
        this.cancelNativeDragState = null;
    }

    // 拦截原生 dragstart（用于 macOS 三指拖动），转为自定义拖拽
    interceptNativeDragStart(event, sourcePath, options = {}) {
        try {
            event.preventDefault();
            event.stopPropagation();
        } catch {}
        const clientX = event.clientX ?? (event.touches && event.touches[0]?.clientX) ?? 0;
        const clientY = event.clientY ?? (event.touches && event.touches[0]?.clientY) ?? 0;
        const fakeMouseEvent = { button: 0, clientX, clientY, preventDefault() {} };
        this.beginInternalDrag(fakeMouseEvent, sourcePath, options);
        this.cancelNativeDragState = () => {
            this._nativeDragIntercepting = false;
        };
    }

    // ========== 自定义鼠标拖拽实现，绕过 HTML5 DnD ==========
    beginInternalDrag(event, sourcePath, options = {}) {
        if (!event || event.button !== 0) return;
        event.preventDefault();
        this._dragState = {
            sourcePath,
            startX: event.clientX,
            startY: event.clientY,
            active: false,
            hoverHeader: null,
            isDirectory: options.isDirectory ?? false,
        };
        this._onInternalMouseMove = (e) => this.onInternalDragMove(e);
        this._onInternalMouseUp = (e) => this.endInternalDrag(e);
        window.addEventListener('mousemove', this._onInternalMouseMove, true);
        window.addEventListener('mouseup', this._onInternalMouseUp, true);
    }

    onInternalDragMove(event) {
        if (!this._dragState) return;
        const { startX, startY, active } = this._dragState;
        const dx = Math.abs(event.clientX - startX);
        const dy = Math.abs(event.clientY - startY);
        const threshold = 3;
        if (!active && (dx > threshold || dy > threshold)) {
            this._dragState.active = true;
            document.body.classList.add('is-internal-drag');
            setInternalDrag(true);
            const name = (this._dragState.sourcePath || '').split(/[\\/]/).pop() || '';
            const sourceEl = this.container?.querySelector(`.tree-file[data-path="${this._dragState.sourcePath}"]`)
                || this.container?.querySelector(`.tree-folder[data-path="${this._dragState.sourcePath}"] .tree-folder-header`);
            const rect = sourceEl ? sourceEl.getBoundingClientRect() : null;
            const nodeWidth = rect ? rect.width : null;
            this.createDragGhost(
                name,
                event.clientX,
                event.clientY,
                nodeWidth,
                this._dragState.isDirectory
            );
        }
        if (!this._dragState.active) return;

        this.updateDragGhost(event.clientX, event.clientY);

        const header = this.findHeaderAtPoint(event.clientX, event.clientY);
        if (header !== this._dragState.hoverHeader) {
            this.clearAllDragOverHighlights();
            if (header) header.classList.add('drag-over');
            this._dragState.hoverHeader = header;
        }
    }

    async endInternalDrag() {
        if (!this._dragState) return;
        window.removeEventListener('mousemove', this._onInternalMouseMove, true);
        window.removeEventListener('mouseup', this._onInternalMouseUp, true);

        const { sourcePath, active, hoverHeader } = this._dragState;
        this._dragState = null;
        const targetHeader = hoverHeader;

        this.clearAllDragOverHighlights();
        this.removeDragGhost();
        document.body.classList.remove('is-internal-drag');
        setInternalDrag(false);

        if (!active) return;

        const targetFolderPath = targetHeader?.parentElement?.dataset?.path;
        if (!targetFolderPath || !sourcePath) return;
        await this.performMove(sourcePath, targetFolderPath);
    }

    shouldBlockInteraction() {
        return this._dragState?.active ?? false;
    }

    clearAllDragOverHighlights() {
        this.container?.querySelectorAll('.drag-over').forEach(el => {
            el.classList.remove('drag-over');
        });
    }

    findHeaderAtPoint(clientX, clientY) {
        const el = document.elementFromPoint(clientX, clientY);
        if (!el) return null;
        const folder = el.closest?.('.tree-folder');
        if (!folder) return null;
        return folder.querySelector('.tree-folder-header') || null;
    }

    handleTreeDragOver(event) {
        if (!isInternalDrag()) return;
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }

        const header = this.findHeaderAtPoint(event.clientX, event.clientY);
        if (!header) {
            this.clearAllDragOverHighlights();
            return;
        }

        if (!header.classList.contains('drag-over')) {
            this.clearAllDragOverHighlights();
            header.classList.add('drag-over');
        }
        if (event?.dataTransfer) {
            event.dataTransfer.dropEffect = 'move';
        }
    }

    handleTreeDragLeave(event) {
        if (!isInternalDrag()) return;
        const related = event?.relatedTarget;
        if (!related || !this.container?.contains(related)) {
            this.clearAllDragOverHighlights();
        }
    }

    async handleTreeDrop(event) {
        if (!isInternalDrag()) return;
        event.preventDefault();
        event.stopPropagation();

        const header = this.findHeaderAtPoint(event.clientX, event.clientY);
        this.clearAllDragOverHighlights();
        if (!header) {
            return;
        }

        const targetFolderPath = header?.parentElement?.dataset?.path;
        const sourcePath = event.dataTransfer.getData('application/x-mark2-file')
            || event.dataTransfer.getData('text/plain');

        if (!sourcePath || !targetFolderPath) {
            return;
        }
        await this.performMove(sourcePath, targetFolderPath, {
            isDirectory: this._dragState?.isDirectory,
        });
    }

    handleDragEnter(event, element) {
        event.preventDefault();
        event.stopPropagation();

        const types = event?.dataTransfer?.types || [];
        const hasInternalType = Array.from(types).includes('application/x-mark2-file');
        const isInternal = hasInternalType || isInternalDrag();

        if (!isInternal) {
            return;
        }

        this.container?.querySelectorAll('.drag-over').forEach(el => {
            if (el !== element) {
                el.classList.remove('drag-over');
            }
        });

        element.classList.add('drag-over');
    }

    handleDragOver(event, element) {
        event.preventDefault();
        event.stopPropagation();

        const types = event?.dataTransfer?.types || [];
        const hasInternalType = Array.from(types).includes('application/x-mark2-file');
        const isInternal = hasInternalType || isInternalDrag();

        if (!isInternal) {
            return;
        }

        if (!element.classList.contains('drag-over')) {
            this.container?.querySelectorAll('.drag-over').forEach(el => {
                el.classList.remove('drag-over');
            });
            element.classList.add('drag-over');
        }

        if (event?.dataTransfer) {
            event.dataTransfer.dropEffect = 'move';
        }
    }

    handleDragLeave(event, element) {
        event.preventDefault();
        event.stopPropagation();

        if (!element.contains(event.relatedTarget)) {
            element.classList.remove('drag-over');
        }
    }

    async handleDrop(event, targetFolderPath, element) {
        event.preventDefault();
        event.stopPropagation();
        element.classList.remove('drag-over');

        const sourcePath = event.dataTransfer.getData('application/x-mark2-file')
            || event.dataTransfer.getData('text/plain');
        if (!sourcePath) {
            return;
        }
        await this.performMove(sourcePath, targetFolderPath, {
            isDirectory: this._dragState?.isDirectory,
        });
    }

    createDragGhost(label, x, y, nodeWidth = null, isDirectory = false) {
        this.removeDragGhost();
        const ghost = document.createElement('div');
        ghost.className = 'drag-ghost';
        ghost.style.position = 'fixed';
        ghost.style.left = '0px';
        ghost.style.top = '0px';
        ghost.style.transform = 'translate(-9999px, -9999px)';
        ghost.style.zIndex = '99999';
        ghost.style.pointerEvents = 'none';
        ghost.style.whiteSpace = 'nowrap';
        ghost.style.textOverflow = 'ellipsis';
        ghost.style.overflow = 'hidden';
        ghost.style.boxSizing = 'border-box';

        if (nodeWidth && Number.isFinite(nodeWidth)) {
            const w = Math.max(80, Math.round(nodeWidth));
            ghost.style.width = `${w}px`;
            ghost.style.maxWidth = `${w}px`;
        } else {
            ghost.style.maxWidth = '240px';
        }

        const computedStyle = getComputedStyle(document.body);
        const selectedBg = computedStyle.getPropertyValue('--file-selected-bg').trim();
        const selectedBorder = computedStyle.getPropertyValue('--file-selected-border').trim();
        const textColor = computedStyle.getPropertyValue('--text-color').trim();
        const fileIconColor = computedStyle.getPropertyValue('--file-icon-color').trim();

        let effectiveBg = selectedBg;
        const m = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([0-9.]+)\s*\)$/i.exec(selectedBg);
        if (m) {
            const alpha = parseFloat(m[4]);
            const targetAlpha = Math.max(alpha, 0.55);
            effectiveBg = `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${targetAlpha})`;
        }

        ghost.style.background = effectiveBg;
        ghost.style.fontSize = '12px';
        ghost.style.fontWeight = '500';
        ghost.style.color = textColor;
        ghost.style.padding = '2px 16px 2px 20px';
        ghost.style.borderRight = `2px solid ${selectedBorder}`;
        ghost.style.borderRadius = '0';
        ghost.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';
        ghost.style.opacity = '1';
        ghost.style.display = 'flex';
        ghost.style.alignItems = 'center';

        const icon = document.createElement('svg');
        icon.style.marginRight = '6px';
        icon.style.width = '14px';
        icon.style.height = '14px';
        icon.style.flexShrink = '0';
        icon.style.color = fileIconColor;
        icon.innerHTML = isDirectory
            ? `
                <path d="M1 2.5v10c0 .28.22.5.5.5h13c.28 0 .5-.22.5-.5V5c0-.28-.22-.5-.5-.5H7L5.5 3H1.5c-.28 0-.5.22-.5.5z" fill="currentColor" opacity="0.9"/>
            `
            : `
                <path d="M2 1.5v13c0 .28.22.5.5.5h11c.28 0 .5-.22.5-.5V4.5L10.5 1H2.5c-.28 0-.5.22-.5.5z" fill="none" stroke="currentColor" stroke-width="1"/>
                <path d="M10.5 1v3.5H14" fill="none" stroke="currentColor" stroke-width="1"/>
            `;

        const labelSpan = document.createElement('span');
        labelSpan.style.flex = '1';
        labelSpan.style.overflow = 'hidden';
        labelSpan.style.textOverflow = 'ellipsis';
        labelSpan.style.whiteSpace = 'nowrap';
        labelSpan.textContent = label || '';

        ghost.appendChild(icon);
        ghost.appendChild(labelSpan);

        document.body.appendChild(ghost);
        this._dragGhost = ghost;
        this.updateDragGhost(x, y);
    }

    updateDragGhost(x, y) {
        if (!this._dragGhost) return;
        const offsetX = 12;
        const offsetY = 16;
        this._dragGhost.style.transform = `translate(${Math.max(0, x + offsetX)}px, ${Math.max(0, y + offsetY)}px)`;
    }

    removeDragGhost() {
        if (this._dragGhost && this._dragGhost.parentElement) {
            this._dragGhost.parentElement.removeChild(this._dragGhost);
        }
        this._dragGhost = null;
    }

    async performMove(sourcePath, targetFolderPath, options = {}) {
        const normalizedSource = this.normalizePath?.(sourcePath);
        const normalizedTarget = this.normalizePath?.(targetFolderPath);
        const fileService = this.getFileService?.();

        if (!normalizedSource || !normalizedTarget || !fileService) {
            console.warn('Invalid move request:', { normalizedSource, normalizedTarget });
            return;
        }

        let isDirectory = options.isDirectory;
        if (isDirectory === undefined) {
            try {
                isDirectory = await fileService.isDirectory(normalizedSource);
            } catch (_error) {
                isDirectory = false;
            }
        }

        if (this._isSameOrDescendant(normalizedTarget, normalizedSource)) {
            try {
                const { message } = await import('@tauri-apps/plugin-dialog');
                await message('无法将文件或文件夹移动到自身或子目录下。', { title: '移动失败', kind: 'error' });
            } catch {}
            return;
        }

        const fileName = basename(normalizedSource);
        const separator = '/';
        const cleanTarget = normalizedTarget.endsWith(separator)
            ? normalizedTarget.slice(0, -1)
            : normalizedTarget;
        const destinationPath = `${cleanTarget}${separator}${fileName}`;

        if (normalizedSource === destinationPath) {
            return;
        }

        try {
            await fileService.move(normalizedSource, destinationPath);
            const sourceParentPath = normalizedSource.substring(0, normalizedSource.lastIndexOf(separator));
            const tasks = [this.refreshFolder?.(cleanTarget)];
            if (sourceParentPath && sourceParentPath !== cleanTarget) {
                tasks.push(this.refreshFolder?.(sourceParentPath));
            }
            await Promise.all(tasks.filter(Boolean));
            if (typeof this.onMove === 'function') {
                try {
                    await this.onMove(normalizedSource, destinationPath, { isDirectory: !!isDirectory });
                } catch (callbackError) {
                    console.warn('onMove 回调失败:', callbackError);
                }
            }
        } catch (error) {
            console.error('Move failed:', error);
            try {
                const { message } = await import('@tauri-apps/plugin-dialog');
                await message(`无法移动文件:\n${error.message || error}`, { title: '移动失败', kind: 'error' });
            } catch {}
        }
    }

    _isSameOrDescendant(targetPath, sourcePath) {
        if (!targetPath || !sourcePath) return false;
        const normalizedTarget = targetPath.replace(/\\/g, '/');
        const normalizedSource = sourcePath.replace(/\\/g, '/');
        if (normalizedTarget === normalizedSource) return true;
        const prefix = normalizedSource.endsWith('/') ? normalizedSource : `${normalizedSource}/`;
        return normalizedTarget.startsWith(prefix);
    }

    dispose() {
        this.clearAllDragOverHighlights();
        this.removeDragGhost();
        if (this._onInternalMouseMove) {
            window.removeEventListener('mousemove', this._onInternalMouseMove, true);
        }
        if (this._onInternalMouseUp) {
            window.removeEventListener('mouseup', this._onInternalMouseUp, true);
        }
        this._dragState = null;
        this._onInternalMouseMove = null;
        this._onInternalMouseUp = null;
        this.cancelNativeDragState = null;
        document.body.classList.remove('is-internal-drag');
        setInternalDrag(false);
    }
}
