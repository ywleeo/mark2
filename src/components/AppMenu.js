/**
 * 应用菜单组件 - Windows 标题栏下拉菜单
 * 使用 CSS hover 实现子菜单展开
 */
import { COMMAND_IDS } from '../core/commands/commandIds.js';
import { addClickHandler } from '../utils/PointerHelper.js';

/** 浏览器原生编辑操作（不走命令系统，直接 execCommand） */
const NATIVE_EDIT_ACTIONS = {
    'native.cut': () => document.execCommand('cut'),
    'native.copy': () => document.execCommand('copy'),
    'native.paste': () => document.execCommand('paste'),
    'native.selectAll': () => document.execCommand('selectAll'),
};

export class AppMenu {
    constructor(options = {}) {
        this.executeCommand = options.executeCommand;
        this.element = null;
        this.cleanupFunctions = [];

        this.menuItems = this.buildMenuItems();
        this.init();
    }

    buildMenuItems() {
        return [
            {
                id: 'file',
                label: '文件',
                submenu: [
                    { id: 'new', label: '新建文件', shortcut: 'Ctrl+N', command: COMMAND_IDS.DOCUMENT_NEW_FILE },
                    { id: 'open-file', label: '打开文件...', shortcut: 'Ctrl+O', command: COMMAND_IDS.APP_OPEN_FILE },
                    { id: 'open-folder', label: '打开文件夹...', command: COMMAND_IDS.APP_OPEN_FOLDER },
                    { id: 'sep1', separator: true },
                    { id: 'save', label: '保存', shortcut: 'Ctrl+S', command: COMMAND_IDS.DOCUMENT_SAVE },
                    { id: 'sep2', separator: true },
                    { id: 'export-image', label: '导出为图片', command: COMMAND_IDS.EXPORT_IMAGE },
                    { id: 'export-pdf', label: '导出为 PDF', command: COMMAND_IDS.EXPORT_PDF },
                    { id: 'sep3', separator: true },
                    { id: 'rename', label: '重命名', shortcut: 'F2', command: COMMAND_IDS.DOCUMENT_RENAME },
                    { id: 'move', label: '移动到...', command: COMMAND_IDS.DOCUMENT_MOVE },
                    { id: 'delete', label: '删除', shortcut: 'Delete', command: COMMAND_IDS.DOCUMENT_DELETE, danger: true },
                ]
            },
            {
                id: 'edit',
                label: '编辑',
                submenu: [
                    { id: 'undo', label: '撤销', shortcut: 'Ctrl+Z', command: COMMAND_IDS.EDITOR_UNDO },
                    { id: 'redo', label: '重做', shortcut: 'Ctrl+Shift+Z', command: COMMAND_IDS.EDITOR_REDO },
                    { id: 'sep1', separator: true },
                    { id: 'cut', label: '剪切', shortcut: 'Ctrl+X', command: 'native.cut' },
                    { id: 'copy', label: '复制', shortcut: 'Ctrl+C', command: 'native.copy' },
                    { id: 'paste', label: '粘贴', shortcut: 'Ctrl+V', command: 'native.paste' },
                    { id: 'select-all', label: '全选', shortcut: 'Ctrl+A', command: 'native.selectAll' },
                    { id: 'sep2', separator: true },
                    { id: 'settings', label: '设置', shortcut: 'Ctrl+,', command: COMMAND_IDS.APP_SETTINGS },
                ]
            },
            {
                id: 'view',
                label: '视图',
                submenu: [
                    { id: 'toggle-sidebar', label: '切换侧边栏', shortcut: 'Ctrl+B', command: COMMAND_IDS.VIEW_TOGGLE_SIDEBAR },
                    { id: 'toggle-status-bar', label: '切换状态栏', command: COMMAND_IDS.VIEW_TOGGLE_STATUS_BAR },
                    { id: 'toggle-toolbar', label: '切换 Markdown 工具栏', command: COMMAND_IDS.TOOLBAR_TOGGLE_MARKDOWN },
                    { id: 'sep1', separator: true },
                    { id: 'toggle-terminal', label: '切换终端', shortcut: 'Ctrl+`', command: COMMAND_IDS.FEATURE_TERMINAL_TOGGLE },
                    { id: 'toggle-ai', label: '切换 AI 助手', shortcut: 'Ctrl+Shift+A', command: COMMAND_IDS.FEATURE_AI_TOGGLE },
                    { id: 'sep2', separator: true },
                    { id: 'toggle-theme', label: '切换深色/浅色主题', command: COMMAND_IDS.THEME_TOGGLE },
                ]
            },
            {
                id: 'help',
                label: '帮助',
                submenu: [
                    { id: 'about', label: '关于 Mark2', command: COMMAND_IDS.APP_ABOUT },
                ]
            }
        ];
    }

    init() {
        this.element = document.createElement('div');
        this.element.className = 'app-menu hidden';
        document.body.appendChild(this.element);

        this._render();
        this._setupEventListeners();
    }

    _renderMenuItem(item) {
        if (item.separator) {
            return '<div class="app-menu__separator"></div>';
        }

        const hasSubmenu = item.submenu && item.submenu.length > 0;
        const dangerClass = item.danger ? 'danger' : '';
        const arrow = hasSubmenu ? '<span class="app-menu__arrow">›</span>' : '';
        const shortcut = item.shortcut ? `<span class="app-menu__shortcut">${item.shortcut}</span>` : '';

        let submenuHtml = '';
        if (hasSubmenu) {
            submenuHtml = '<div class="app-menu__submenu">';
            for (const subItem of item.submenu) {
                submenuHtml += this._renderMenuItem(subItem);
            }
            submenuHtml += '</div>';
        }

        return `
            <div class="app-menu__item ${dangerClass} ${hasSubmenu ? 'has-submenu' : ''}" data-command="${item.command || ''}">
                <span class="app-menu__label">${item.label}</span>
                ${shortcut}
                ${arrow}
                ${submenuHtml}
            </div>
        `;
    }

    _render() {
        let html = '<div class="app-menu__content">';
        for (const item of this.menuItems) {
            html += this._renderMenuItem(item);
        }
        html += '</div>';
        this.element.innerHTML = html;
    }

    _executeMenuCommand(command) {
        const nativeAction = NATIVE_EDIT_ACTIONS[command];
        if (nativeAction) {
            nativeAction();
            return;
        }
        if (this.executeCommand) {
            this.executeCommand(command, {}, { source: 'menu' });
        }
    }

    _setupEventListeners() {
        const menuBtn = document.getElementById('titlebar-menu');
        if (menuBtn) {
            this.cleanupFunctions.push(addClickHandler(menuBtn, (e) => {
                e.stopPropagation();
                const isHidden = this.element.classList.toggle('hidden');
                if (!isHidden) {
                    const btnRect = menuBtn.getBoundingClientRect();
                    this.element.style.top = `${btnRect.bottom}px`;
                    this.element.style.left = `${btnRect.left}px`;
                }
            }));
        }

        // 点击菜单项执行命令
        this.cleanupFunctions.push(addClickHandler(this.element, (e) => {
            const item = e.target.closest('.app-menu__item');
            if (!item || item.querySelector('.app-menu__submenu')) return;

            const command = item.dataset.command;
            if (command) {
                try {
                    this._executeMenuCommand(command);
                } catch (err) {
                    console.warn('菜单命令执行失败:', command, err);
                }
            }
            this.element.classList.add('hidden');
        }, {
            shouldHandle: (e) => Boolean(e.target.closest('.app-menu__item')),
        }));

        // 点击外部关闭
        this._onGlobalClose = (e) => {
            if (!this.element.classList.contains('hidden') &&
                !this.element.contains(e.target) &&
                !e.target.closest('#titlebar-menu')) {
                this.element.classList.add('hidden');
            }
        };
        document.addEventListener('click', this._onGlobalClose, true);

        // ESC 关闭
        this._onKeydown = (e) => {
            if (e.key === 'Escape' && !this.element.classList.contains('hidden')) {
                this.element.classList.add('hidden');
            }
        };
        document.addEventListener('keydown', this._onKeydown, true);
    }

    destroy() {
        for (const cleanup of this.cleanupFunctions) {
            if (typeof cleanup === 'function') cleanup();
        }
        this.cleanupFunctions.length = 0;

        document.removeEventListener('click', this._onGlobalClose, true);
        document.removeEventListener('keydown', this._onKeydown, true);

        this.element?.remove();
        this.element = null;
    }
}
