/**
 * 应用菜单组件 - Windows 标题栏下拉菜单
 * 使用 CSS hover 实现子菜单展开
 */
import { COMMAND_IDS } from '../core/commands/commandIds.js';
import { addClickHandler } from '../utils/PointerHelper.js';
import { t } from '../i18n/index.js';

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
                label: t('menu.file'),
                submenu: [
                    { id: 'new', label: t('menu.newFile'), shortcut: 'Ctrl+N', command: COMMAND_IDS.DOCUMENT_NEW_FILE },
                    { id: 'open-file', label: t('menu.openFile'), shortcut: 'Ctrl+O', command: COMMAND_IDS.APP_OPEN_FILE },
                    { id: 'open-folder', label: t('menu.openFolder'), command: COMMAND_IDS.APP_OPEN_FOLDER },
                    { id: 'sep1', separator: true },
                    { id: 'save', label: t('menu.save'), shortcut: 'Ctrl+S', command: COMMAND_IDS.DOCUMENT_SAVE },
                    { id: 'sep2', separator: true },
                    { id: 'export-image', label: t('menu.exportImage'), command: COMMAND_IDS.EXPORT_IMAGE },
                    { id: 'export-pdf', label: t('menu.exportPdf'), command: COMMAND_IDS.EXPORT_PDF },
                    { id: 'sep3', separator: true },
                    { id: 'rename', label: t('menu.rename'), shortcut: 'F2', command: COMMAND_IDS.DOCUMENT_RENAME },
                    { id: 'move', label: t('menu.moveTo'), command: COMMAND_IDS.DOCUMENT_MOVE },
                    { id: 'delete', label: t('menu.delete'), shortcut: 'Delete', command: COMMAND_IDS.DOCUMENT_DELETE, danger: true },
                ]
            },
            {
                id: 'edit',
                label: t('menu.edit'),
                submenu: [
                    { id: 'undo', label: t('menu.undo'), shortcut: 'Ctrl+Z', command: COMMAND_IDS.EDITOR_UNDO },
                    { id: 'redo', label: t('menu.redo'), shortcut: 'Ctrl+Shift+Z', command: COMMAND_IDS.EDITOR_REDO },
                    { id: 'sep1', separator: true },
                    { id: 'cut', label: t('menu.cut'), shortcut: 'Ctrl+X', command: COMMAND_IDS.EDITOR_CUT },
                    { id: 'copy', label: t('menu.copy'), shortcut: 'Ctrl+C', command: COMMAND_IDS.EDITOR_COPY },
                    { id: 'paste', label: t('menu.paste'), shortcut: 'Ctrl+V', command: COMMAND_IDS.EDITOR_PASTE },
                    { id: 'select-all', label: t('menu.selectAll'), shortcut: 'Ctrl+A', command: COMMAND_IDS.EDITOR_SELECT_ALL },
                    { id: 'sep2', separator: true },
                    { id: 'settings', label: t('menu.settings'), shortcut: 'Ctrl+,', command: COMMAND_IDS.APP_SETTINGS },
                ]
            },
            {
                id: 'view',
                label: t('menu.view'),
                submenu: [
                    { id: 'toggle-sidebar', label: t('menu.toggleSidebar'), shortcut: 'Ctrl+B', command: COMMAND_IDS.VIEW_TOGGLE_SIDEBAR },
                    { id: 'toggle-status-bar', label: t('menu.toggleStatusBar'), command: COMMAND_IDS.VIEW_TOGGLE_STATUS_BAR },
                    { id: 'toggle-toolbar', label: t('menu.toggleToolbar'), command: COMMAND_IDS.TOOLBAR_TOGGLE_MARKDOWN },
                    { id: 'sep1', separator: true },
                    { id: 'toggle-terminal', label: t('menu.toggleTerminal'), shortcut: 'Ctrl+`', command: COMMAND_IDS.FEATURE_TERMINAL_TOGGLE },
                    { id: 'toggle-ai', label: t('menu.toggleAi'), shortcut: 'Ctrl+Shift+A', command: COMMAND_IDS.FEATURE_AI_TOGGLE },
                    { id: 'sep2', separator: true },
                    { id: 'toggle-theme', label: t('menu.toggleTheme'), command: COMMAND_IDS.THEME_TOGGLE },
                ]
            },
            {
                id: 'help',
                label: t('menu.help'),
                submenu: [
                    { id: 'about', label: t('menu.about'), command: COMMAND_IDS.APP_ABOUT },
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
            if (command && this.executeCommand) {
                try {
                    this.executeCommand(command, {}, { source: 'menu' });
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
