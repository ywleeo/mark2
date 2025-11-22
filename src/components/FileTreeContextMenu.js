import { addClickHandler } from '../utils/PointerHelper.js';

export class FileTreeContextMenu {
    constructor(options = {}) {
        const {
            container,
            onRename,
            onMove,
            onReveal,
            onDelete,
            getTargetPath,
        } = options;

        this.container = container;
        this.onRename = onRename;
        this.onMove = onMove;
        this.onReveal = onReveal;
        this.onDelete = onDelete;
        this.getTargetPath = getTargetPath;

        this.element = null;
        this.targetItem = null;
        this.targetPath = null;
        this.targetType = null; // 'file' | 'folder'

        this._onContextMenu = null;
        this._onGlobalClose = null;
        this._onKeydown = null;
        this._onScroll = null;
        this._cleanupMenuClick = null;

        this.init();
    }

    init() {
        const menu = document.createElement('div');
        menu.className = 'file-tree-context-menu hidden';
        menu.innerHTML = `
            <button type="button" class="file-tree-context-menu__item" data-action="rename">Rename</button>
            <button type="button" class="file-tree-context-menu__item" data-action="move">Move To...</button>
            <button type="button" class="file-tree-context-menu__item" data-action="reveal">Find in Finder</button>
            <button type="button" class="file-tree-context-menu__item danger" data-action="delete">Delete</button>
        `;

        this.element = menu;
        document.body.appendChild(menu);

        this._onContextMenu = (event) => this.handleContextMenu(event);
        this._onGlobalClose = (event) => {
            if (this.element && event?.target && this.element.contains(event.target)) {
                return;
            }
            this.hideMenu();
        };
        this._onKeydown = (event) => {
            if (event.key === 'Escape') {
                this.hideMenu();
            }
        };
        this._onScroll = () => this.hideMenu();

        this.container?.addEventListener('contextmenu', this._onContextMenu);
        window.addEventListener('click', this._onGlobalClose, true);
        window.addEventListener('blur', this._onGlobalClose);
        window.addEventListener('resize', this._onGlobalClose);
        window.addEventListener('keydown', this._onKeydown, true);
        window.addEventListener('scroll', this._onScroll, true);

        // 使用 PointerHelper 处理菜单点击，避免触控板轻点导致的点击失效或重复触发
        this._cleanupMenuClick = addClickHandler(menu, (event) => {
            const action = event.target?.dataset?.action || '';
            if (!action) return;
            this.handleAction(action);
        }, {
            shouldHandle: (event) => Boolean(event.target?.dataset?.action),
            preventDefault: true,
        });
    }

    handleContextMenu(event) {
        if (!this.container) {
            return;
        }

        const fileItem = event.target.closest?.('.tree-file');
        const folderHeader = event.target.closest?.('.tree-folder-header');

        let targetElement = null;
        let targetType = null;

        if (fileItem && this.container.contains(fileItem)) {
            targetElement = fileItem;
            targetType = 'file';
        } else if (folderHeader) {
            const folderItem = folderHeader.closest?.('.tree-folder');
            if (folderItem && this.container.contains(folderItem)) {
                targetElement = folderItem;
                targetType = 'folder';
            }
        }

        if (!targetElement) {
            this.hideMenu();
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        const path = this.getTargetPath?.(targetElement);
        if (!path) {
            this.hideMenu();
            return;
        }

        this.targetPath = path;
        this.targetType = targetType;
        this.markTarget(targetElement);
        this.showMenu(event.clientX, event.clientY);
    }

    markTarget(item) {
        if (this.targetItem && this.targetItem !== item) {
            this.targetItem.classList.remove('context-menu-target');
        }
        this.targetItem = item;
        this.targetItem.classList.add('context-menu-target');
    }

    clearTarget() {
        if (this.targetItem) {
            this.targetItem.classList.remove('context-menu-target');
        }
        this.targetItem = null;
        this.targetPath = null;
    }

    showMenu(x, y) {
        if (!this.element) return;
        this.element.classList.remove('hidden');

        const rect = this.element.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const offset = 4;

        let left = x + offset;
        let top = y + offset;

        if (left + rect.width > viewportWidth) {
            left = Math.max(offset, viewportWidth - rect.width - offset);
        }
        if (top + rect.height > viewportHeight) {
            top = Math.max(offset, viewportHeight - rect.height - offset);
        }

        this.element.style.left = `${left}px`;
        this.element.style.top = `${top}px`;
    }

    hideMenu() {
        if (this.element) {
            this.element.classList.add('hidden');
        }
        this.clearTarget();
    }

    async handleAction(action) {
        const targetPath = this.targetPath;
        const targetType = this.targetType || 'file';
        this.hideMenu();

        const meta = { targetType };

        switch (action) {
            case 'rename':
                // 延迟到下一轮事件循环再触发重命名，避免与当前点击/焦点变更产生竞争，导致编辑框瞬间消失
                setTimeout(() => {
                    this.onRename?.(targetPath, meta);
                }, 0);
                break;
            case 'move':
                await this.onMove?.(targetPath, meta);
                break;
            case 'reveal':
                await this.onReveal?.(targetPath, meta);
                break;
            case 'delete':
                await this.onDelete?.(targetPath, meta);
                break;
            default:
                break;
        }
    }

    dispose() {
        this.container?.removeEventListener('contextmenu', this._onContextMenu);
        window.removeEventListener('click', this._onGlobalClose, true);
        window.removeEventListener('blur', this._onGlobalClose);
        window.removeEventListener('resize', this._onGlobalClose);
        window.removeEventListener('keydown', this._onKeydown, true);
        window.removeEventListener('scroll', this._onScroll, true);

        if (typeof this._cleanupMenuClick === 'function') {
            this._cleanupMenuClick();
            this._cleanupMenuClick = null;
        }

        if (this.element?.parentElement) {
            this.element.parentElement.removeChild(this.element);
        }
        this.element = null;
        this.targetItem = null;
        this.targetPath = null;
    }
}
