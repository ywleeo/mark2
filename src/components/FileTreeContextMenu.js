import { addClickHandler } from '../utils/PointerHelper.js';
import { isFeatureEnabled } from '../config/features.js';
import { COMMAND_IDS } from '../core/commands/commandIds.js';
import { isWindows, isMac } from '../utils/platform.js';

export class FileTreeContextMenu {
    constructor(options = {}) {
        const {
            container,
            executeCommand,
            onRename,
            onMove,
            onReveal,
            onDelete,
            onCreateFile,
            onCreateFolder,
            onRun,
            getTargetPath,
        } = options;

        this.container = container;
        this.executeCommand = executeCommand;
        this.onRename = onRename;
        this.onMove = onMove;
        this.onReveal = onReveal;
        this.onDelete = onDelete;
        this.onCreateFile = onCreateFile;
        this.onCreateFolder = onCreateFolder;
        this.onRun = onRun;
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
        const revealLabel = this.getRevealMenuLabel();
        const menu = document.createElement('div');
        menu.className = 'file-tree-context-menu hidden';
        menu.innerHTML = `
            <div class="file-tree-context-menu__group">
                ${this.renderMenuItem('run', 'Run', this.getMenuIcon('run'), 'runnable-only')}
                ${this.renderMenuItem('create-file', 'New File', this.getMenuIcon('create-file'), 'folder-only')}
                ${this.renderMenuItem('create-folder', 'New Folder', this.getMenuIcon('create-folder'), 'folder-only')}
            </div>
            <div class="file-tree-context-menu__separator" aria-hidden="true"></div>
            <div class="file-tree-context-menu__group">
                ${this.renderMenuItem('rename', 'Rename', this.getMenuIcon('rename'))}
                ${this.renderMenuItem('move', 'Move To...', this.getMenuIcon('move'))}
                ${this.renderMenuItem('copy-path', 'Copy Path', this.getMenuIcon('copy-path'))}
                ${this.renderMenuItem('reveal', revealLabel, this.getMenuIcon('reveal'))}
            </div>
            <div class="file-tree-context-menu__separator" aria-hidden="true"></div>
            <div class="file-tree-context-menu__group">
                ${this.renderMenuItem('delete', 'Delete', this.getMenuIcon('delete'), 'danger')}
            </div>
        `;

        this.element = menu;
        document.body.appendChild(menu);

        this._onContextMenu = (event) => this.handleContextMenu(event);
        this._onGlobalClose = (event) => {
            if (this.element && event?.target instanceof Node && this.element.contains(event.target)) {
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
            const action = event.target?.closest?.('[data-action]')?.dataset?.action || '';
            if (!action) return;
            this.handleAction(action);
        }, {
            shouldHandle: (event) => Boolean(event.target?.closest?.('[data-action]')),
            preventDefault: true,
        });
    }

    /**
     * 渲染菜单项 HTML。
     */
    renderMenuItem(action, label, icon, extraClasses = '') {
        const className = ['file-tree-context-menu__item', extraClasses].filter(Boolean).join(' ');
        return `
            <button type="button" class="${className}" data-action="${action}">
                <span class="file-tree-context-menu__item-icon" aria-hidden="true">${icon}</span>
                <span class="file-tree-context-menu__item-label">${label}</span>
            </button>
        `;
    }

    /**
     * 返回菜单项线条图标。
     */
    getMenuIcon(action) {
        const icons = {
            run: `
                <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                    <path d="M5 3.5v9l7-4.5z"/>
                </svg>
            `,
            'create-file': `
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M9.5 1.5H4A1.5 1.5 0 0 0 2.5 3v10A1.5 1.5 0 0 0 4 14.5h8A1.5 1.5 0 0 0 13.5 13V5.5z"/>
                    <path d="M9.5 1.5v4h4"/>
                    <path d="M8 7v4"/>
                    <path d="M6 9h4"/>
                </svg>
            `,
            'create-folder': `
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M1.5 4A1.5 1.5 0 0 1 3 2.5h2.6l1.2 1.4H13A1.5 1.5 0 0 1 14.5 5.4V6H1.5z"/>
                    <path d="M1.5 6h13l-1 6.2A1.5 1.5 0 0 1 12 13.5H4A1.5 1.5 0 0 1 2.5 12.2z"/>
                    <path d="M8 7.8v3.4"/>
                    <path d="M6.3 9.5h3.4"/>
                </svg>
            `,
            rename: `
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="m11.8 2.2 2 2a1 1 0 0 1 0 1.4l-7.9 7.9-3.4.6.6-3.4 7.9-7.9a1 1 0 0 1 1.4 0Z"/>
                    <path d="m10.5 3.5 2 2"/>
                </svg>
            `,
            move: `
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M3 5.5h7"/>
                    <path d="m8 2.5 3 3-3 3"/>
                    <path d="M13 10.5H6"/>
                    <path d="m8 7.5-3 3 3 3"/>
                </svg>
            `,
            'copy-path': `
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="5" y="3" width="8" height="10" rx="1.2"/>
                    <path d="M3.5 11.5H3A1.5 1.5 0 0 1 1.5 10V3A1.5 1.5 0 0 1 3 1.5h5A1.5 1.5 0 0 1 9.5 3v.5"/>
                </svg>
            `,
            reveal: `
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M1.5 8s2.4-3.5 6.5-3.5S14.5 8 14.5 8s-2.4 3.5-6.5 3.5S1.5 8 1.5 8Z"/>
                    <circle cx="8" cy="8" r="1.8"/>
                </svg>
            `,
            delete: `
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M2.5 4.5h11"/>
                    <path d="M6.2 1.8h3.6"/>
                    <path d="M4 4.5 4.8 13A1.5 1.5 0 0 0 6.3 14.5h3.4A1.5 1.5 0 0 0 11.2 13l.8-8.5"/>
                    <path d="M6.5 7v4"/>
                    <path d="M9.5 7v4"/>
                </svg>
            `,
        };

        return icons[action] || '';
    }

    /**
     * 返回当前平台对应的“在文件管理器中显示”菜单文案。
     */
    getRevealMenuLabel() {
        if (isWindows) return 'Show in Explorer';
        if (isMac) return 'Find in Finder';
        return 'Reveal in File Manager';
    }

    handleContextMenu(event) {
        if (!this.container) {
            return;
        }

        const fileItem = event.target.closest?.('.tree-file');
        const folderHeader = event.target.closest?.('.tree-folder-header');
        const openFileItem = event.target.closest?.('.open-file-item');

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
        } else if (openFileItem && this.container.contains(openFileItem)) {
            targetElement = openFileItem;
            targetType = 'file';
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

    isRunnableFile(path) {
        if (!path || typeof path !== 'string') return false;
        const lowerPath = path.toLowerCase();
        return lowerPath.endsWith('.sh') || lowerPath.endsWith('.py');
    }

    showMenu(x, y) {
        if (!this.element) return;

        // 根据目标类型显示/隐藏菜单项
        const folderOnlyItems = this.element.querySelectorAll('.folder-only');
        const isFolder = this.targetType === 'folder';
        folderOnlyItems.forEach(item => {
            item.style.display = isFolder ? '' : 'none';
        });

        // 根据文件类型显示/隐藏 Run 菜单项（MAS 版本禁用）
        const runnableOnlyItems = this.element.querySelectorAll('.runnable-only');
        const isRunnable = !isFolder && this.isRunnableFile(this.targetPath) && isFeatureEnabled('runScript');
        runnableOnlyItems.forEach(item => {
            item.style.display = isRunnable ? '' : 'none';
        });

        this.syncSeparators();

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

    /**
     * 根据当前可见菜单项同步分隔线显示，避免出现空分组。
     */
    syncSeparators() {
        if (!this.element) return;

        const groups = Array.from(this.element.querySelectorAll('.file-tree-context-menu__group'));
        groups.forEach((group) => {
            const hasVisibleItems = Array.from(group.querySelectorAll('.file-tree-context-menu__item'))
                .some((item) => item.style.display !== 'none');
            group.style.display = hasVisibleItems ? '' : 'none';
        });

        const separators = Array.from(this.element.querySelectorAll('.file-tree-context-menu__separator'));
        separators.forEach((separator, index) => {
            const prevGroup = groups[index];
            const nextGroup = groups[index + 1];
            const prevVisible = prevGroup && prevGroup.style.display !== 'none';
            const nextVisible = nextGroup && nextGroup.style.display !== 'none';
            separator.style.display = prevVisible && nextVisible ? '' : 'none';
        });
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
        const payload = { path: targetPath, targetType };
        const commandId = this.resolveCommandId(action);

        if (commandId && typeof this.executeCommand === 'function') {
            if (action === 'rename') {
                setTimeout(() => {
                    void this.executeCommand(commandId, payload, {
                        source: 'file-tree-context-menu',
                        action,
                    });
                }, 0);
                return;
            }

            await this.executeCommand(commandId, payload, {
                source: 'file-tree-context-menu',
                action,
            });
            return;
        }

        switch (action) {
            case 'run':
                await this.onRun?.(targetPath, meta);
                break;
            case 'create-file':
                await this.onCreateFile?.(targetPath, meta);
                break;
            case 'create-folder':
                await this.onCreateFolder?.(targetPath, meta);
                break;
            case 'rename':
                // 延迟到下一轮事件循环再触发重命名，避免与当前点击/焦点变更产生竞争，导致编辑框瞬间消失
                setTimeout(() => {
                    this.onRename?.(targetPath, meta);
                }, 0);
                break;
            case 'move':
                await this.onMove?.(targetPath, meta);
                break;
            case 'copy-path':
                if (targetPath) {
                    await navigator.clipboard.writeText(targetPath);
                }
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

    /**
     * 将上下文菜单动作映射到统一命令 ID。
     * @param {string} action - 上下文菜单动作
     * @returns {string|null}
     */
    resolveCommandId(action) {
        const commandMap = {
            run: COMMAND_IDS.WORKSPACE_RUN_ENTRY,
            'create-file': COMMAND_IDS.WORKSPACE_CREATE_FILE,
            'create-folder': COMMAND_IDS.WORKSPACE_CREATE_FOLDER,
            rename: COMMAND_IDS.WORKSPACE_RENAME_ENTRY,
            move: COMMAND_IDS.WORKSPACE_MOVE_ENTRY,
            'copy-path': COMMAND_IDS.WORKSPACE_COPY_PATH,
            reveal: COMMAND_IDS.WORKSPACE_REVEAL_IN_FINDER,
            delete: COMMAND_IDS.WORKSPACE_DELETE_ENTRY,
        };

        return commandMap[action] || null;
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
