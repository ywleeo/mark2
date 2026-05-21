import { addClickHandler } from '../../utils/PointerHelper.js';
import { BUTTON_CONFIG, TOOLBAR_GROUPS, SELECT_CONFIGS } from './toolbarConfig.js';
import { TocPanel } from '../TocPanel.js';
import { ToolbarTooltip } from './ToolbarTooltip.js';
import { ToolbarEmojiPicker } from './ToolbarEmojiPicker.js';
import { ToolbarPlainMarkdownHandlers } from './ToolbarPlainMarkdownHandlers.js';
import { ToolbarTipTapHandlers } from './ToolbarTipTapHandlers.js';
import { ToolbarSelect } from './ToolbarSelect.js';
import { ToolbarOverflowMenu } from './ToolbarOverflowMenu.js';
import { navigationHistory } from '../../modules/navigationHistory.js';
import { createStore } from '../../services/storage.js';

const store = createStore('toolbar');

/**
 * Markdown工具栏类
 * 独立模块，提供Markdown编辑器的格式化功能
 */
export class MarkdownToolbar {
    constructor(options = {}) {
        // 事件监听器
        this.listeners = new Map();
        this.clickCleanups = [];
        this.editor = null;
        this.container = null;
        this.isVisible = true;
        this.tooltip = null;
        this.emojiPicker = null;
        this.tocPanel = null;
        this.selects = [];
        this.overflowMenu = null;
        this.resizeObserver = null;
        this._navUnsubscribe = null;
        this.options = {
            position: 'top', // 'top' 或 'bottom'
            theme: 'light', // 'light' 或 'dark'
            ...options
        };

        // 使用导入的按钮配置
        this.buttonConfig = BUTTON_CONFIG;

        // 监听系统主题变化
        if (window.matchMedia) {
            const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
            mediaQuery.addEventListener('change', () => {
                const theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
                this.setTheme(theme);
            });
        }

        this.tooltip = new ToolbarTooltip();
        this.emojiPicker = new ToolbarEmojiPicker((emoji) => this.insertEmoji(emoji));
        this.plainMarkdown = new ToolbarPlainMarkdownHandlers(this);
        this.tipTap = new ToolbarTipTapHandlers(this);
    }

    /**
     * 设置编辑器实例
     * @param {Object} editor - 编辑器实例
     */
    setEditor(editor) {
        this.editor = editor;

        // 同时设置 TocPanel 的编辑器
        if (this.tocPanel) {
            this.tocPanel.setEditor(editor);
        }
    }

    /**
     * 渲染工具栏
     * @param {HTMLElement} container - 容器元素
     */
    render(container) {
        if (!container) {
            throw new Error('Container is required');
        }

        // 清理上一次渲染的资源
        this._teardownRender();

        this.container = container;
        this.container.innerHTML = '';

        // 工具栏主体：左侧格式化区 + 右侧视图操作区
        const toolbar = document.createElement('div');
        toolbar.className = `markdown-toolbar markdown-toolbar--${this.options.theme}`;

        const left = document.createElement('div');
        left.className = 'markdown-toolbar__left';

        // 固定区：行内格式 + 标题下拉，始终可见
        const fixed = document.createElement('div');
        fixed.className = 'markdown-toolbar__fixed';
        this._renderGroups(fixed, TOOLBAR_GROUPS.fixed);

        // 固定区与流动区之间的分隔符（常驻，不参与溢出）
        const divider = document.createElement('div');
        divider.className = 'toolbar-separator';

        // 流动区：空间不足时按钮收进溢出菜单
        const flow = document.createElement('div');
        flow.className = 'markdown-toolbar__flow';
        this._renderGroups(flow, TOOLBAR_GROUPS.flow);

        // 溢出菜单 ⋯ 按钮
        this.overflowMenu = new ToolbarOverflowMenu({
            onAction: (action) => this.handleAction(action),
        });
        this.overflowMenu.setFlow(flow);

        left.append(fixed, divider, flow, this.overflowMenu.getElement());

        // 右侧视图操作区：切换视图模式 / 复制 / 居中，始终可见
        const right = document.createElement('div');
        right.className = 'markdown-toolbar__right';
        TOOLBAR_GROUPS.right.forEach(type => this._appendItem(right, type));

        toolbar.append(left, right);
        this.container.appendChild(toolbar);
        this.container.classList.toggle('is-visible', this.isVisible);

        // 宽度变化时动态收纳溢出按钮
        this.resizeObserver = new ResizeObserver(() => {
            this.overflowMenu?.recompute();
        });
        this.resizeObserver.observe(toolbar);

        // 绑定键盘快捷键
        this.bindShortcuts();

        // 恢复居中模式状态
        this.restoreCenterContentState();

        // 导航按钮初始状态 + 订阅历史变化
        this.updateNavButtons();
        this._navUnsubscribe = navigationHistory.onChange(() => this.updateNavButtons());

        // 首帧布局完成后算一次溢出
        requestAnimationFrame(() => this.overflowMenu?.recompute());
    }

    /**
     * 渲染按钮分组：每个内层数组是一组，组间插入分隔符；'heading' 渲染为标题下拉。
     * @param {HTMLElement} parent - 父容器
     * @param {Array<Array<string>>} groups - 分组定义
     */
    _renderGroups(parent, groups) {
        groups.forEach((group, groupIndex) => {
            if (groupIndex > 0) {
                const separator = document.createElement('div');
                separator.className = 'toolbar-separator';
                parent.appendChild(separator);
            }
            group.forEach(type => this._appendItem(parent, type));
        });
    }

    /**
     * 向容器追加一个工具栏项：下拉（SELECT_CONFIGS）或普通按钮
     */
    _appendItem(parent, type) {
        if (SELECT_CONFIGS[type]) {
            const select = new ToolbarSelect({
                ...SELECT_CONFIGS[type],
                onSelect: this._getSelectHandler(type),
            });
            this.selects.push(select);
            parent.appendChild(select.getElement());
        } else if (this.buttonConfig[type]) {
            parent.appendChild(this.createButton(type, this.buttonConfig[type]));
        }
    }

    /**
     * 返回下拉选择器选中项的处理器
     * @param {string} type - 下拉类型（heading / list ...）
     */
    _getSelectHandler(type) {
        if (type === 'heading') {
            return (level) => this.applyHeading(level);
        }
        // 列表等：下拉项的 value 即按钮 action，复用 handleAction
        return (action) => this.handleAction(action);
    }

    /**
     * 清理一次渲染产生的资源（重渲染或销毁前调用）
     */
    _teardownRender() {
        this.clickCleanups.forEach(cleanup => {
            if (typeof cleanup === 'function') cleanup();
        });
        this.clickCleanups = [];

        this.resizeObserver?.disconnect();
        this.resizeObserver = null;

        this._navUnsubscribe?.();
        this._navUnsubscribe = null;

        this.selects.forEach(select => select.destroy());
        this.selects = [];

        this.overflowMenu?.destroy();
        this.overflowMenu = null;
    }

    /**
     * 同步后退 / 前进按钮的可用状态
     */
    updateNavButtons() {
        const backBtn = this.container?.querySelector('[data-action="navBack"]');
        const forwardBtn = this.container?.querySelector('[data-action="navForward"]');
        if (backBtn) backBtn.disabled = !navigationHistory.canGoBack();
        if (forwardBtn) forwardBtn.disabled = !navigationHistory.canGoForward();
    }

    /**
     * 创建工具栏按钮
     * @param {string} type - 按钮类型
     * @param {Object} config - 按钮配置
     * @returns {HTMLElement}
     */
    createButton(type, config) {
        const button = document.createElement('button');
        button.className = 'toolbar-button';
        button.type = 'button';
        button.setAttribute('data-action', type);
        button.setAttribute('aria-label', config.title);
        button.innerHTML = `
            <span class="toolbar-button__icon">${config.icon}</span>
        `;

        // 使用 PointerHelper 处理点击事件，防止触控板重复触发
        const cleanup = addClickHandler(button, () => {
            this.handleAction(type);
        });

        if (cleanup) {
            this.clickCleanups.push(cleanup);
        }

        if (config.title) {
            button.addEventListener('mouseenter', () => this.tooltip?.show(button, config.title));
            button.addEventListener('mouseleave', () => this.tooltip?.hide());
            button.addEventListener('focus', () => this.tooltip?.show(button, config.title));
            button.addEventListener('blur', () => this.tooltip?.hide());
        }

        return button;
    }

    isTipTapEditor() {
        return this.tipTap.isEditor();
    }

    /**
     * 处理按钮动作
     * @param {string} action - 动作类型
     */
    handleAction(action) {
        // 导航：后退 / 前进，直接驱动文档历史
        if (action === 'navBack') {
            navigationHistory.goBack();
            return;
        }
        if (action === 'navForward') {
            navigationHistory.goForward();
            return;
        }
        // 视图操作 / 复制类不需要编辑器实例，直接触发回调
        if (action === 'toggleViewMode' || action === 'copy'
            || action === 'copyMarkdown' || action === 'copyPlainText') {
            this.emit('action', action);
            return;
        }

        // 处理 TOC 按钮
        if (action === 'toc') {
            this.handleToc();
            return;
        }

        // 处理居中排版按钮
        if (action === 'centerContent') {
            this.toggleCenterContent();
            return;
        }

        if (!this.editor) {
            console.warn('No editor instance set');
            return;
        }

        if (this.isTipTapEditor()) {
            const handled = this.tipTap.handleAction(action);
            if (handled === 'blocked') {
                return;
            }
            if (handled) {
                this.emit('action', action);
                return;
            }
        }

        const pm = this.plainMarkdown;
        const actions = {
            bold: () => pm.toggleFormat('**', '**'),
            italic: () => pm.toggleFormat('*', '*'),
            strikethrough: () => pm.toggleFormat('~~', '~~'),
            code: () => pm.toggleFormat('`', '`'),
            heading1: () => pm.toggleHeading(1),
            heading2: () => pm.toggleHeading(2),
            heading3: () => pm.toggleHeading(3),
            quote: () => pm.togglePrefix('> '),
            unorderedList: () => pm.togglePrefix('- '),
            orderedList: () => pm.togglePrefix('1. '),
            taskList: () => pm.insertTaskListFallback(),
            link: () => pm.insertLink(),
            image: () => pm.insertImage(),
            table: () => pm.insertTable(),
            horizontalRule: () => pm.insertHorizontalRule(),
            codeBlock: () => pm.insertCodeBlock(),
            clearFormatting: () => pm.clearFormatting(),
            emoji: () => this.handleEmojiPicker(),
            video: () => pm.insertVideo()
        };

        const handler = actions[action];
        if (handler) {
            handler();
            this.emit('action', action);
        }
    }

    /**
     * 应用标题级别（供标题下拉调用）
     * @param {number} level - 0 表示正文，1-3 表示标题级别
     */
    applyHeading(level) {
        if (!this.editor) {
            console.warn('No editor instance set');
            return;
        }
        if (this.isTipTapEditor()) {
            this.tipTap.applyHeading(level);
        } else {
            this.plainMarkdown.setHeading(level);
        }
        this.emit('action', 'heading');
    }

    /**
     * 绑定键盘快捷键
     */
    bindShortcuts() {
        if (!this.editor) return;

        const shortcuts = {};

        // 构建快捷键映射
        Object.entries(this.buttonConfig).forEach(([buttonType, config]) => {
            if (config && config.shortcut) {
                shortcuts[config.shortcut.toLowerCase()] = buttonType;
            }
        });

        // TipTap 编辑器快捷键绑定
        if (typeof this.editor.view !== 'undefined') {
            // TipTap 使用 ProseMirror 的快捷键系统
            // 这里只是示例，实际应该通过扩展添加
        }
        // 普通 textarea 快捷键绑定
        else if (this.editor.addEventListener) {
            this.editor.addEventListener('keydown', (e) => {
                const key = [];
                if (e.ctrlKey) key.push('ctrl');
                if (e.shiftKey) key.push('shift');
                if (e.altKey) key.push('alt');
                if (e.metaKey) key.push('meta');
                key.push(e.key.toLowerCase());

                const shortcut = key.join('+');
                const action = shortcuts[shortcut];

                if (action) {
                    e.preventDefault();
                    this.handleAction(action);
                }
            });
        }
    }

    /**
     * 显示工具栏（切换外层固定栏容器的可见性）
     */
    show() {
        this.isVisible = true;
        this.container?.classList.add('is-visible');
        requestAnimationFrame(() => this.overflowMenu?.recompute());
        this.emit('visibility-change', true);
    }

    /**
     * 隐藏工具栏
     */
    hide() {
        this.isVisible = false;
        this.container?.classList.remove('is-visible');
        this.emit('visibility-change', false);
    }

    /**
     * 切换工具栏显示状态
     */
    toggle() {
        if (this.isVisible) {
            this.hide();
        } else {
            this.show();
        }
    }

    /**
     * 设置主题
     * @param {string} theme - 'light' 或 'dark'
     */
    setTheme(theme) {
        this.options.theme = theme;
        if (this.container) {
            const toolbar = this.container.querySelector('.markdown-toolbar');
            if (toolbar) {
                toolbar.classList.remove('markdown-toolbar--light', 'markdown-toolbar--dark');
                toolbar.classList.add(`markdown-toolbar--${theme}`);
            }
        }
        this.emit('theme-change', theme);
    }

    /**
     * 销毁工具栏
     */
    destroy() {
        // 清理渲染期资源（事件监听、ResizeObserver、子组件）
        this._teardownRender();

        if (this.container) {
            this.container.innerHTML = '';
            this.container.classList.remove('is-visible');
            this.container = null;
        }
        this.editor = null;
        this.tooltip?.destroy();
        this.tooltip = null;
        this.emojiPicker?.destroy();
        this.emojiPicker = null;
        this.removeAllListeners();
      }

    /**
     * 添加事件监听器
     */
    on(event, handler) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event).add(handler);
    }

    /**
     * 移除所有监听器
     */
    removeAllListeners() {
        this.listeners.clear();
    }

    /**
     * 触发事件
     */
    emit(event, ...args) {
        const handlers = this.listeners.get(event);
        if (handlers) {
            for (const handler of handlers) {
                try {
                    handler(...args);
                } catch (error) {
                    console.error(`Error in event handler for ${event}:`, error);
                }
            }
        }
    }


    /**
     * 初始化 emoji 选择器
     */
    handleEmojiPicker() {
        // emoji 已收进「插入」下拉，没有独立按钮时锚定到下拉 trigger
        const anchor = this.container?.querySelector('[data-action="emoji"]')
            || this.container?.querySelector('[data-action="insert"]');
        if (!anchor) return false;
        this.emojiPicker?.toggle(anchor);
        return true;
    }

    /**
     * 插入 emoji
     */
    insertEmoji(emoji) {
        // TipTap 编辑器
        if (this.isTipTapEditor()) {
            const { from } = this.editor.state.selection;
            this.editor.chain().focus().insertContentAt(from, emoji).run();
            return;
        }

        // Fallback: 插入到光标位置
        this.plainMarkdown.insertTextAtCursor(emoji);
    }

    /**
     * 初始化目录面板
     */
    initTocPanel() {
        if (this.tocPanel) return;

        this.tocPanel = new TocPanel();

        // 查找 Markdown 面板容器
        const markdownPane = document.querySelector('.markdown-pane');
        if (markdownPane) {
            this.tocPanel.init(markdownPane);

            // 如果已经有编辑器，设置编辑器
            if (this.editor) {
                this.tocPanel.setEditor(this.editor);
            }
        }
    }

    /**
     * 处理 TOC 按钮点击
     */
    handleToc() {
        // 确保 TocPanel 已初始化
        if (!this.tocPanel) {
            this.initTocPanel();
        }

        if (this.tocPanel) {
            this.tocPanel.toggle();
        }

        return true;
    }

    /**
     * 切换内容居中模式
     */
    toggleCenterContent() {
        const markdownPane = document.querySelector('.view-pane.markdown-pane');
        if (!markdownPane) {
            return false;
        }

        const isCentered = markdownPane.classList.toggle('content-centered');

        // 更新按钮状态
        const button = this.container?.querySelector('[data-action="centerContent"]');
        if (button) {
            button.classList.toggle('toolbar-button--active', isCentered);
        }

        store.set('contentCentered', isCentered);

        return true;
    }

    /**
     * 恢复居中模式状态
     */
    restoreCenterContentState() {
        if (!store.get('contentCentered')) return;
        const markdownPane = document.querySelector('.view-pane.markdown-pane');
        if (markdownPane) {
            markdownPane.classList.add('content-centered');
        }
        const button = this.container?.querySelector('[data-action="centerContent"]');
        if (button) {
            button.classList.add('toolbar-button--active');
        }
    }
}
