import { addClickHandler } from '../utils/PointerHelper.js';

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
        this.tooltipElement = null;
        this.boundScrollHandler = null;
        this.options = {
            position: 'top', // 'top' 或 'bottom'
            theme: 'light', // 'light' 或 'dark'
            buttons: [
                'bold',
                'italic',
                'strikethrough',
                'heading1',
                'heading2',
                'heading3',
                'code',
                'quote',
                'unorderedList',
                'orderedList',
                'taskList',
                'link',
                'image',
                'table',
                'horizontalRule',
                'codeBlock'
            ],
            ...options
        };

        // 按钮配置
        this.buttonConfig = {
            bold: {
                icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M13.5,15.5H10V12.5H13.5A1.5,1.5 0 0,1 15,14A1.5,1.5 0 0,1 13.5,15.5M10,6.5H13A1.5,1.5 0 0,1 14.5,8A1.5,1.5 0 0,1 13,9.5H10M15.6,10.79C16.57,10.11 17.25,9 17.25,8C17.25,5.74 15.5,4 13.25,4H7V18H14.04C16.14,18 17.75,16.3 17.75,14.21C17.75,12.69 16.89,11.39 15.6,10.79Z" />
                </svg>`,
                title: '加粗 (Ctrl+B)',
                shortcut: 'Ctrl+B'
            },
            italic: {
                icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M10,4V7H12.21L8.79,15H6V18H14V15H11.79L15.21,7H18V4H10Z" />
                </svg>`,
                title: '斜体 (Ctrl+I)',
                shortcut: 'Ctrl+I'
            },
            strikethrough: {
                icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M23,12V14H18.61C19.61,16.14 19.56,22 12.38,22C4.05,22.05 4.37,15.5 4.37,15.5L8.34,15.55C8.34,15.55 8.14,18.82 11.5,18.82C14.86,18.82 15.12,16.5 14.5,14H1V12H23M3.41,10H20.59C20.59,10 20.59,8 19,8H17.92C17.91,7.56 17.78,4 11.83,4C4.46,4 4.82,10 4.82,10M9.03,8C9.03,8 9.03,6 11.5,6C13.97,6 13.97,8 13.97,8H9.03Z" />
                </svg>`,
                title: '删除线',
                shortcut: 'Ctrl+Shift+S'
            },
            heading1: {
                icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M4,7V4H10V7H8V19H10V22H4V19H6V7H4M18,4H22V7H20V17H22V20H18V17H16V7H18V4M14,7V4H10V7H12V19H10V22H14V19H12V7H14Z" />
                </svg>`,
                title: '一级标题',
                shortcut: 'Ctrl+1'
            },
            heading2: {
                icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M3,4H7V7H5V19H7V22H3V19H5V7H3V4M15,4H19V7H17V19H19V22H15V19H17V7H15V4M11,7V4H15V7H13V19H15V22H11V19H13V7H11Z" />
                </svg>`,
                title: '二级标题',
                shortcut: 'Ctrl+2'
            },
            heading3: {
                icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M3,4H7V7H5V17H7V20H3V17H5V7H3V4M13,4H17V7H15V17H17V20H13V17H15V7H13V4M21,4V7H19V17H21V20H17V17H19V7H17V4H21Z" />
                </svg>`,
                title: '三级标题',
                shortcut: 'Ctrl+3'
            },
            code: {
                icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M9.4,16.6L4.8,12L9.4,7.4L8,6L2,12L8,18L9.4,16.6M14.6,16.6L19.2,12L14.6,7.4L16,6L22,12L16,18L14.6,16.6Z" />
                </svg>`,
                title: '行内代码',
                shortcut: 'Ctrl+`'
            },
            quote: {
                icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M14,17H17L19,13V7H13V13H16M6,17H9L11,13V7H5V13H8L6,17Z" />
                </svg>`,
                title: '引用',
                shortcut: 'Ctrl+Shift+>'
            },
            unorderedList: {
                icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M7,5H21V7H7V5M7,13V11H21V13H7M4,4.5A1.5,1.5 0 0,1 5.5,6A1.5,1.5 0 0,1 4,7.5A1.5,1.5 0 0,1 2.5,6A1.5,1.5 0 0,1 4,4.5M4,10.5A1.5,1.5 0 0,1 5.5,12A1.5,1.5 0 0,1 4,13.5A1.5,1.5 0 0,1 2.5,12A1.5,1.5 0 0,1 4,10.5M7,19V17H21V19H7M4,16.5A1.5,1.5 0 0,1 5.5,18A1.5,1.5 0 0,1 4,19.5A1.5,1.5 0 0,1 2.5,18A1.5,1.5 0 0,1 4,16.5Z" />
                </svg>`,
                title: '无序列表',
                shortcut: 'Ctrl+Shift+8'
            },
            orderedList: {
                icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M7,13V11H21V13H7M7,19V17H21V19H7M7,7V5H21V7H7M3,8V5H2V4H4V8H3M2,17V16H5V20H2V19H4V18.5H3V17.5H4V17H2M4.25,10A0.75,0.75 0 0,1 5,10.75C5,10.95 4.92,11.14 4.79,11.27L3.12,13H5V14H2V13.08L4,11H2V10H4.25Z" />
                </svg>`,
                title: '有序列表',
                shortcut: 'Ctrl+Shift+7'
            },
            taskList: {
                icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="4" width="4" height="4" rx="0.8" />
                    <rect x="3" y="10" width="4" height="4" rx="0.8" />
                    <rect x="3" y="16" width="4" height="4" rx="0.8" />
                    <path d="M9 6h12M9 12h12M9 18h12" />
                    <path d="M3.2 6.4l1.3 1.3 1.8-2.3" />
                </svg>`,
                title: '任务列表',
                shortcut: 'Ctrl+Shift+9'
            },
            link: {
                icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M10.59,13.41C11,13.8 11,14.44 10.59,14.83C10.2,15.22 9.56,15.22 9.17,14.83C7.22,12.88 7.22,9.71 9.17,7.76V7.76L12.71,4.22C14.66,2.27 17.83,2.27 19.78,4.22C21.73,6.17 21.73,9.34 19.78,11.29L18.29,12.78C18.3,11.96 18.17,11.14 17.89,10.36L18.36,9.88C19.54,8.71 19.54,6.81 18.36,5.64C17.19,4.46 15.29,4.46 14.12,5.64L10.59,9.17C9.41,10.34 9.41,12.24 10.59,13.41M13.41,9.17C13.8,8.78 14.44,8.78 14.83,9.17C16.78,11.12 16.78,14.29 14.83,16.24V16.24L11.29,19.78C9.34,21.73 6.17,21.73 4.22,19.78C2.27,17.83 2.27,14.66 4.22,12.71L5.71,11.22C5.7,12.04 5.83,12.86 6.11,13.65L5.64,14.12C4.46,15.29 4.46,17.19 5.64,18.36C6.81,19.54 8.71,19.54 9.88,18.36L13.41,14.83C14.59,13.66 14.59,11.76 13.41,10.59C13,10.2 13,9.56 13.41,9.17Z" />
                </svg>`,
                title: '链接',
                shortcut: 'Ctrl+K'
            },
            image: {
                icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M21,17H7V3H21M21,1H7A2,2 0 0,0 5,3V17A2,2 0 0,0 7,19H21A2,2 0 0,0 23,17V3A2,2 0 0,0 21,1M3,5H1V21A2,2 0 0,0 3,23H19V21H3M15.96,10.29L13.21,13.83L11.25,11.47L8.5,15H19.5L15.96,10.29Z" />
                </svg>`,
                title: '图片',
                shortcut: 'Ctrl+Shift+I'
            },
            table: {
                icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M5,4H19A2,2 0 0,1 21,6V18A2,2 0 0,1 19,20H5A2,2 0 0,1 3,18V6A2,2 0 0,1 5,4M5,8V12H11V8H5M13,8V12H19V8H13M5,14V18H11V14H5M13,14V18H19V14H13Z" />
                </svg>`,
                title: '表格',
                shortcut: 'Ctrl+Shift+T'
            },
            horizontalRule: {
                icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M3,13H21V11H3M3,19H21V18H3M3,6H21V5H3V6Z" />
                </svg>`,
                title: '分割线',
                shortcut: 'Ctrl+Shift+-'
            },
            codeBlock: {
                icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8,3A2,2 0 0,0 6,5V9A2,2 0 0,1 4,11H3V13H4A2,2 0 0,1 6,15V19A2,2 0 0,0 8,21H10V19H8V14A2,2 0 0,0 6,12A2,2 0 0,0 8,10V5H10V3M16,3A2,2 0 0,1 18,5V9A2,2 0 0,0 20,11H21V13H20A2,2 0 0,0 18,15V19A2,2 0 0,1 16,21H14V19H16V14A2,2 0 0,1 18,12A2,2 0 0,1 16,10V5H14V3H16Z" />
                </svg>`,
                title: '代码块',
                shortcut: 'Ctrl+Shift+C'
            }
        };

        // 监听系统主题变化
        if (window.matchMedia) {
            const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
            mediaQuery.addEventListener('change', () => {
                const theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
                this.setTheme(theme);
            });
        }

        this.initTooltip();
    }

    /**
     * 设置编辑器实例
     * @param {Object} editor - 编辑器实例
     */
    setEditor(editor) {
        this.editor = editor;
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
            button.addEventListener('mouseenter', () => this.showTooltip(button, config.title));
            button.addEventListener('mouseleave', () => this.hideTooltip());
            button.addEventListener('focus', () => this.showTooltip(button, config.title));
            button.addEventListener('blur', () => this.hideTooltip());
        }

        return button;
    }

    isTipTapEditor() {
        return Boolean(
            this.editor &&
            typeof this.editor.chain === 'function' &&
            this.editor.state &&
            this.editor.view
        );
    }

    runTipTapCommand(callback, options = {}) {
        if (!this.isTipTapEditor()) {
            return false;
        }
        const blockedNodes = Array.isArray(options?.blockedNodes) ? options.blockedNodes : null;
        if (blockedNodes && this.isSelectionInsideNode(blockedNodes)) {
            return 'blocked';
        }
        const chain = this.editor.chain().focus();
        const result = callback(chain);
        if (result === false) {
            return false;
        }
        return chain.run();
    }

    handleTipTapAction(action) {
        switch (action) {
            case 'bold':
                return this.runTipTapCommand(chain => chain.toggleBold());
            case 'italic':
                return this.runTipTapCommand(chain => chain.toggleItalic());
            case 'strikethrough':
                return this.runTipTapCommand(chain => chain.toggleStrike());
            case 'code':
                return this.runTipTapCommand(chain => chain.toggleCode());
            case 'heading1':
                return this.runTipTapCommand(chain => chain.toggleHeading({ level: 1 }), { blockedNodes: ['mermaidBlock'] });
            case 'heading2':
                return this.runTipTapCommand(chain => chain.toggleHeading({ level: 2 }), { blockedNodes: ['mermaidBlock'] });
            case 'heading3':
                return this.runTipTapCommand(chain => chain.toggleHeading({ level: 3 }), { blockedNodes: ['mermaidBlock'] });
            case 'quote':
                return this.runTipTapCommand(chain => chain.toggleBlockquote(), { blockedNodes: ['mermaidBlock'] });
            case 'unorderedList':
                return this.runTipTapCommand(chain => chain.toggleBulletList(), { blockedNodes: ['mermaidBlock'] });
            case 'orderedList':
                return this.runTipTapCommand(chain => chain.toggleOrderedList(), { blockedNodes: ['mermaidBlock'] });
            case 'taskList':
                if (typeof this.editor.commands?.toggleTaskList === 'function') {
                    return this.runTipTapCommand(chain => chain.toggleTaskList(), { blockedNodes: ['mermaidBlock'] });
                }
                return false;
            case 'link':
                return this.handleTipTapLink();
            case 'image':
                return this.handleTipTapImage();
            case 'table':
                return this.handleTipTapTable();
            case 'horizontalRule':
                return this.runTipTapCommand(chain => chain.setHorizontalRule(), { blockedNodes: ['mermaidBlock'] });
            case 'codeBlock':
                return this.runTipTapCommand(chain => chain.toggleCodeBlock(), { blockedNodes: ['mermaidBlock'] });
            default:
                return false;
        }
    }

    handleTipTapLink() {
        if (!this.isTipTapEditor()) {
            return false;
        }
        const currentHref = this.editor.getAttributes?.('link')?.href || '';
        const url = window.prompt('请输入链接地址', currentHref || 'https://');
        if (url === null) {
            return false;
        }
        const trimmed = url.trim();
        if (!trimmed) {
            this.editor.chain().focus().extendMarkRange('link').unsetLink().run();
            return true;
        }
        this.editor.chain().focus().extendMarkRange('link').setLink({ href: trimmed }).run();
        return true;
    }

    handleTipTapImage() {
        if (!this.isTipTapEditor() || typeof this.editor.commands?.setImage !== 'function') {
            return false;
        }
        const src = window.prompt('请输入图片地址', 'https://');
        if (!src) {
            return false;
        }
        const alt = window.prompt('请输入图片描述', '图片描述') || '';
        this.editor.chain().focus().setImage({
            src: src.trim(),
            alt: alt.trim(),
            title: alt.trim()
        }).run();
        return true;
    }

    handleTipTapTable() {
        if (!this.isTipTapEditor()) {
            return false;
        }
        if (this.isSelectionInsideNode(['mermaidBlock'])) {
            return 'blocked';
        }

        if (typeof this.editor.commands?.insertContent === 'function') {
            const createCellNode = (type, text) => ({
                type,
                content: [
                    {
                        type: 'paragraph',
                        content: text
                            ? [
                                {
                                    type: 'text',
                                    text
                                }
                            ]
                            : []
                    }
                ]
            });
            const sampleContent = [
                ['列1', '列2', '列3'],
                ['内容1', '内容2', '内容3'],
                ['内容4', '内容5', '内容6']
            ];
            const tableNode = {
                type: 'table',
                content: sampleContent.map((row, rowIndex) => ({
                    type: 'tableRow',
                    content: row.map(cellText => createCellNode(
                        rowIndex === 0 ? 'tableHeader' : 'tableCell',
                        cellText
                    ))
                }))
            };

            const inserted = this.editor
                .chain()
                .focus()
                .insertContent(tableNode)
                .run();

            if (inserted) {
                return true;
            }
        }

        if (typeof this.editor.commands?.insertTable === 'function') {
            const inserted = this.editor.chain().focus().insertTable({
                rows: 3,
                cols: 3,
                withHeaderRow: true
            }).run();
            if (inserted) {
                return true;
            }
        }

        if (typeof this.editor.commands?.insertContent !== 'function') {
            return false;
        }

        // 退回到插入 Markdown 文本（例如旧编辑器或 table 扩展不可用时）
        const markdownTable = `| 列1 | 列2 | 列3 |
| --- | --- | --- |
| 内容1 | 内容2 | 内容3 |
| 内容4 | 内容5 | 内容6 |

`;

        this.editor
            .chain()
            .focus()
            .insertContent(markdownTable)
            .run();

        return true;
    }

    /**
     * 处理按钮动作
     * @param {string} action - 动作类型
     */
    handleAction(action) {
        if (!this.editor) {
            console.warn('No editor instance set');
            return;
        }

        if (this.isTipTapEditor()) {
            const handled = this.handleTipTapAction(action);
            if (handled === 'blocked') {
                return;
            }
            if (handled) {
                this.emit('action', action);
                return;
            }
        }

        const actions = {
            bold: () => this.toggleFormat('**', '**'),
            italic: () => this.toggleFormat('*', '*'),
            strikethrough: () => this.toggleFormat('~~', '~~'),
            code: () => this.toggleFormat('`', '`'),
            heading1: () => this.toggleHeading(1),
            heading2: () => this.toggleHeading(2),
            heading3: () => this.toggleHeading(3),
            quote: () => this.togglePrefix('> '),
            unorderedList: () => this.togglePrefix('- '),
            orderedList: () => this.togglePrefix('1. '),
            taskList: () => this.insertTaskListFallback(),
            link: () => this.insertLink(),
            image: () => this.insertImage(),
            table: () => this.insertTable(),
            horizontalRule: () => this.insertHorizontalRule(),
            codeBlock: () => this.insertCodeBlock()
        };

        const handler = actions[action];
        if (handler) {
            handler();
            this.emit('action', action);
        }
    }

    /**
     * 切换格式（包围选中内容）
     * @param {string} before - 前缀
     * @param {string} after - 后缀
     */
    toggleFormat(before, after) {
        const { selectedText, selection } = this.getSelectedText();

        if (selectedText) {
            // 检查是否已经被格式包围
            const isFormatted = selectedText.startsWith(before) && selectedText.endsWith(after);

            if (isFormatted) {
                // 移除格式
                const newText = selectedText.slice(before.length, -after.length);
                this.replaceSelection(newText, selection);
            } else {
                // 添加格式
                const newText = `${before}${selectedText}${after}`;
                this.replaceSelection(newText, selection);
            }
        } else {
            // 没有选中内容，插入格式符号
            this.insertTextAtCursor(`${before}${after}`);
            this.setCursorPosition(before.length);
        }
    }

    /**
     * 切换标题
     * @param {number} level - 标题级别
     */
    toggleHeading(level) {
        const { selectedText, selection, line } = this.getSelectedText();
        const prefix = '#'.repeat(level) + ' ';

        // 检查当前行是否已经是标题
        const headingMatch = line.match(/^(#{1,6})\s/);

        if (headingMatch) {
            // 切换或移除标题
            const currentLevel = headingMatch[1].length;

            if (currentLevel === level) {
                // 移除标题
                const newLine = line.replace(/^#{1,6}\s/, '');
                this.replaceLine(newLine, selection);
            } else {
                // 更改标题级别
                const newLine = line.replace(/^#{1,6}\s/, prefix);
                this.replaceLine(newLine, selection);
            }
        } else {
            // 添加标题
            const newLine = prefix + line;
            this.replaceLine(newLine, selection);
        }
    }

    /**
     * 切换行前缀
     * @param {string} prefix - 前缀
     */
    togglePrefix(prefix) {
        const { selectedText, selection, line } = this.getSelectedText();

        // 检查当前行是否已经有前缀
        if (line.startsWith(prefix)) {
            // 移除前缀
            const newLine = line.replace(prefix, '');
            this.replaceLine(newLine, selection);
        } else {
            // 添加前缀
            const newLine = prefix + line;
            this.replaceLine(newLine, selection);
        }
    }

    /**
     * 插入链接
     */
    insertLink() {
        const { selectedText, selection } = this.getSelectedText();
        const text = selectedText || '链接文本';
        const link = `[${text}](url)`;

        if (selectedText) {
            this.replaceSelection(link, selection);
        } else {
            this.insertTextAtCursor(link);
            // 选中URL部分
            this.selectUrl();
        }
    }

    /**
     * 插入图片
     */
    insertImage() {
        const { selectedText, selection } = this.getSelectedText();
        const alt = selectedText || '图片描述';
        const image = `![${alt}](image-url)`;

        if (selectedText) {
            this.replaceSelection(image, selection);
        } else {
            this.insertTextAtCursor(image);
            // 选中URL部分
            this.selectImageUrl();
        }
    }

    /**
     * 插入表格
     */
    insertTable() {
        const table = '\n| 列1 | 列2 | 列3 |\n|-----|-----|-----|\n| 数据1 | 数据2 | 数据3 |\n';
        this.insertTextAtCursor(table);
    }

    /**
     * 插入分割线
     */
    insertHorizontalRule() {
        this.insertTextAtCursor('\n---\n');
    }

    /**
     * 插入代码块
     */
    insertCodeBlock() {
        const { selectedText } = this.getSelectedText();
        const code = selectedText || '代码内容';
        const codeBlock = `\n\`\`\`\n${code}\n\`\`\`\n`;

        if (selectedText) {
            const { selection } = this.getSelectedText();
            this.replaceSelection(codeBlock, selection);
        } else {
            this.insertTextAtCursor(codeBlock);
        }
    }

    /**
     * 获取选中文本及相关信息
     * @returns {Object}
     */
    getSelectedText() {
        // 根据编辑器类型实现
        if (this.editor) {
            // 如果是 TipTap 编辑器
            if (typeof this.editor.state !== 'undefined') {
                const { state } = this.editor;
                const { from, to } = state.selection;
                const selectedText = state.doc.textBetween(from, to);

                // 获取整行文本
                const lineStart = state.doc.resolve(from).start();
                const lineEnd = state.doc.resolve(to).end();
                const line = state.doc.textBetween(lineStart, lineEnd);

                return {
                    selectedText,
                    selection: { from, to },
                    line,
                    lineStart,
                    lineEnd
                };
            }

            // 如果是普通的 textarea 或 input
            if (this.editor.setSelectionRange) {
                const start = this.editor.selectionStart;
                const end = this.editor.selectionEnd;
                const selectedText = this.editor.value.substring(start, end);

                // 获取整行文本
                const lineStart = this.editor.value.lastIndexOf('\n', start) + 1;
                const lineEnd = this.editor.value.indexOf('\n', end);
                const line = this.editor.value.substring(
                    lineStart,
                    lineEnd === -1 ? this.editor.value.length : lineEnd
                );

                return {
                    selectedText,
                    selection: { start, end },
                    line,
                    lineStart,
                    lineEnd
                };
            }
        }

        return {
            selectedText: '',
            selection: { start: 0, end: 0 },
            line: '',
            lineStart: 0,
            lineEnd: 0
        };
    }

    /**
     * 替换选中的文本
     * @param {string} text - 新文本
     * @param {Object} selection - 选中范围
     */
    replaceSelection(text, selection) {
        if (!this.editor) return;

        // TipTap 编辑器
        if (typeof this.editor.chain !== 'undefined') {
            this.editor
                .chain()
                .focus()
                .deleteSelection()
                .insertContent(text)
                .run();
        }
        // 普通 textarea
        else if (this.editor.setRangeText) {
            this.editor.focus();
            this.editor.setRangeText(text);
            this.editor.setSelectionRange(
                selection.from + text.length,
                selection.from + text.length
            );

            // 触发 input 事件
            this.editor.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }

    /**
     * 替换整行
     * @param {string} newLine - 新行内容
     * @param {Object} selection - 选中范围
     */
    replaceLine(newLine, selection) {
        if (!this.editor) return;

        // TipTap 编辑器
        if (typeof this.editor.chain !== 'undefined') {
            const { state } = this.editor;
            const { from } = selection;
            const $pos = state.doc.resolve(from);
            const lineStart = $pos.start();
            const lineEnd = $pos.end();

            this.editor
                .chain()
                .focus()
                .setTextSelection({ from: lineStart, to: lineEnd })
                .deleteSelection()
                .insertContent(newLine)
                .run();
        }
        // 普通 textarea
        else if (this.editor.setRangeText) {
            this.editor.focus();
            this.editor.setRangeText(newLine, selection.lineStart, selection.lineEnd);

            // 设置光标位置
            const newCursorPos = selection.lineStart + newLine.length;
            this.editor.setSelectionRange(newCursorPos, newCursorPos);

            // 触发 input 事件
            this.editor.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }

    /**
     * 在光标处插入文本
     * @param {string} text - 文本内容
     */
    insertTextAtCursor(text) {
        const { selection } = this.getSelectedText();
        this.replaceSelection(text, selection);
    }

    /**
     * 设置光标位置
     * @param {number} offset - 偏移量
     */
    setCursorPosition(offset) {
        if (!this.editor) return;

        // TipTap 编辑器
        if (typeof this.editor.commands !== 'undefined') {
            const { state } = this.editor;
            const { from } = state.selection;
            this.editor.commands.setTextSelection({
                from: from + offset,
                to: from + offset
            });
        }
        // 普通 textarea
        else if (this.editor.setSelectionRange) {
            const pos = this.editor.selectionStart + offset;
            this.editor.setSelectionRange(pos, pos);
        }
    }

    /**
     * 选中链接URL部分
     */
    selectUrl() {
        setTimeout(() => {
            const { selection } = this.getSelectedText();
            const from = selection.from + this.editor.state.doc.textBetween(selection.from, selection.to).indexOf('(') + 1;
            const to = selection.from + this.editor.state.doc.textBetween(selection.from, selection.to).indexOf(')');

            if (typeof this.editor.commands !== 'undefined') {
                this.editor.commands.setTextSelection({ from, to });
            }
        }, 0);
    }

    /**
     * 选中图片URL部分
     */
    selectImageUrl() {
        setTimeout(() => {
            const { selection } = this.getSelectedText();
            const text = this.editor.state.doc.textBetween(selection.from, selection.to);
            const from = selection.from + text.indexOf('[') + text.indexOf('](') + 2;
            const to = selection.from + text.indexOf(')');

            if (typeof this.editor.commands !== 'undefined') {
                this.editor.commands.setTextSelection({ from, to });
            }
        }, 0);
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
        this.destroyTooltip();
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

    initTooltip() {
        if (typeof document === 'undefined') {
            return;
        }
        this.tooltipElement = document.createElement('div');
        this.tooltipElement.className = 'markdown-toolbar-tooltip';
        this.tooltipElement.setAttribute('role', 'tooltip');
        document.body.appendChild(this.tooltipElement);
        this.hideTooltip();

        if (typeof window !== 'undefined') {
            this.boundScrollHandler = () => this.hideTooltip();
            window.addEventListener('scroll', this.boundScrollHandler, true);
        }
    }

    destroyTooltip() {
        if (this.tooltipElement?.parentNode) {
            this.tooltipElement.parentNode.removeChild(this.tooltipElement);
        }
        this.tooltipElement = null;
        if (this.boundScrollHandler && typeof window !== 'undefined') {
            window.removeEventListener('scroll', this.boundScrollHandler, true);
            this.boundScrollHandler = null;
        }
    }

    showTooltip(button, text) {
        if (!this.tooltipElement || !text || typeof window === 'undefined') {
            return;
        }

        this.tooltipElement.textContent = text;
        this.tooltipElement.style.left = '0px';
        this.tooltipElement.style.top = '0px';
        this.tooltipElement.classList.add('is-visible', 'is-measuring');

        const buttonRect = button.getBoundingClientRect();
        const tooltipRect = this.tooltipElement.getBoundingClientRect();
        const spacing = 12;
        const viewportPadding = 12;

        let left = buttonRect.left + (buttonRect.width / 2) - (tooltipRect.width / 2);
        const maxLeft = window.innerWidth - tooltipRect.width - viewportPadding;
        left = Math.min(Math.max(left, viewportPadding), Math.max(maxLeft, viewportPadding));

        const availableBelow = window.innerHeight - buttonRect.bottom - viewportPadding;
        const availableAbove = buttonRect.top - viewportPadding;
        let top;
        if (tooltipRect.height > availableBelow && availableAbove > availableBelow) {
            top = Math.max(viewportPadding, buttonRect.top - tooltipRect.height - spacing);
        } else {
            top = buttonRect.bottom + spacing;
            const maxTop = window.innerHeight - tooltipRect.height - viewportPadding;
            top = Math.min(Math.max(top, viewportPadding), Math.max(maxTop, viewportPadding));
        }

        this.tooltipElement.style.left = `${left}px`;
        this.tooltipElement.style.top = `${top}px`;
        this.tooltipElement.classList.remove('is-measuring');
    }

    hideTooltip() {
        if (this.tooltipElement) {
            this.tooltipElement.classList.remove('is-visible', 'is-measuring');
        }
    }

    isSelectionInsideNode(nodeNames = []) {
        if (!this.isTipTapEditor() || !nodeNames?.length) {
            return false;
        }
        const { state } = this.editor;
        if (!state) {
            return false;
        }

        const selectionNode = state.selection?.node;
        if (selectionNode && nodeNames.includes(selectionNode.type?.name)) {
            return true;
        }

        const $from = state.selection?.$from;
        if ($from) {
            for (let depth = $from.depth; depth >= 0; depth -= 1) {
                const node = $from.node(depth);
                if (node && nodeNames.includes(node.type?.name)) {
                    return true;
                }
            }
        }

        return false;
    }

    insertTaskListFallback() {
        const { selection, line } = this.getSelectedText();
        const prefix = '- [ ] ';

        if (line.startsWith(prefix)) {
            const newLine = line.replace(prefix, '');
            this.replaceLine(newLine, selection);
            return true;
        }

        const newLine = prefix + line;
        this.replaceLine(newLine, selection);
        return true;
    }
}
