import { addClickHandler } from '../../utils/PointerHelper.js';
import { BUTTON_CONFIG, DEFAULT_BUTTONS } from './toolbarConfig.js';
import { TocPanel } from '../TocPanel.js';
import { ToolbarTooltip } from './ToolbarTooltip.js';
import { ToolbarEmojiPicker } from './ToolbarEmojiPicker.js';
import { ToolbarPlainMarkdownHandlers } from './ToolbarPlainMarkdownHandlers.js';
import { ToolbarTipTapHandlers } from './ToolbarTipTapHandlers.js';
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
        this.options = {
            position: 'top', // 'top' 或 'bottom'
            theme: 'light', // 'light' 或 'dark'
            buttons: DEFAULT_BUTTONS,
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

        // 清理之前的事件监听器
        this.clickCleanups.forEach(cleanup => {
            if (typeof cleanup === 'function') {
                cleanup();
            }
        });
        this.clickCleanups = [];

        this.container = container;
        this.container.innerHTML = '';

        // 创建工具栏主容器
        const toolbar = document.createElement('div');
        toolbar.className = `markdown-toolbar markdown-toolbar--${this.options.position} markdown-toolbar--${this.options.theme}`;
        toolbar.style.display = this.isVisible ? 'flex' : 'none';

        // 创建按钮组
        this.options.buttons.forEach(buttonType => {
            if (buttonType === 'separator') {
                // 添加分隔符
                const separator = document.createElement('div');
                separator.className = 'toolbar-separator';
                toolbar.appendChild(separator);
            } else if (this.buttonConfig[buttonType]) {
                const button = this.createButton(buttonType, this.buttonConfig[buttonType]);
                toolbar.appendChild(button);
            }
        });

        this.container.appendChild(toolbar);

        // 绑定键盘快捷键
        this.bindShortcuts();

        // 恢复居中模式状态
        this.restoreCenterContentState();
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
        // toggleViewMode、copyMarkdown 和 toc 不需要编辑器实例，直接触发回调
        if (action === 'toggleViewMode' || action === 'copyMarkdown') {
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
            emoji: () => this.handleEmojiPicker()
        };

        const handler = actions[action];
        if (handler) {
            handler();
            this.emit('action', action);
        }
    }

    /**
     * 绑定键盘快捷键
     */
    bindShortcuts() {
        if (!this.editor) return;

        const shortcuts = {};

        // 构建快捷键映射
        this.options.buttons.forEach(buttonType => {
            if (buttonType === 'separator') return; // 跳过分隔符

            const config = this.buttonConfig[buttonType];
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
     * 显示工具栏
     */
    show() {
        this.isVisible = true;
        if (this.container) {
            const toolbar = this.container.querySelector('.markdown-toolbar');
            if (toolbar) {
                toolbar.style.display = 'flex';
            }
        }
        this.emit('visibility-change', true);
    }

    /**
     * 隐藏工具栏
     */
    hide() {
        this.isVisible = false;
        if (this.container) {
            const toolbar = this.container.querySelector('.markdown-toolbar');
            if (toolbar) {
                toolbar.style.display = 'none';
            }
        }
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
        // 清理 PointerHelper 事件监听器
        this.clickCleanups.forEach(cleanup => {
            if (typeof cleanup === 'function') {
                cleanup();
            }
        });
        this.clickCleanups = [];

        if (this.container) {
            this.container.innerHTML = '';
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
        const emojiButton = this.container?.querySelector('[data-action="emoji"]');
        if (!emojiButton) return false;
        this.emojiPicker?.toggle(emojiButton);
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
