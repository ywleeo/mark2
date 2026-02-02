import { addClickHandler } from '../../utils/PointerHelper.js';
import { liftTarget } from '@tiptap/pm/transform';
import { BUTTON_CONFIG, DEFAULT_BUTTONS } from './toolbarConfig.js';
import { EMOJI_LIST } from './emojiList.js';
import { TocPanel } from '../TocPanel.js';

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
        this.emojiPicker = null;
        this.emojiPickerVisible = false;
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

        this.initTooltip();
        this.initEmojiPicker();
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
                return this.handleTipTapCodeAsBlock();
            case 'clearFormatting':
                return this.clearTipTapFormatting();
            case 'emoji':
                return this.handleEmojiPicker();
            default:
                return false;
        }
    }

    handleTipTapCodeAsBlock() {
        if (!this.isTipTapEditor()) {
            return false;
        }
        if (this.isSelectionInsideNode(['mermaidBlock'])) {
            return 'blocked';
        }

        const { state } = this.editor;
        const { from, to } = state.selection;

        const $from = state.doc.resolve(from);
        for (let depth = $from.depth; depth >= 0; depth--) {
            if ($from.node(depth).type.name === 'codeBlock') {
                return this.runTipTapCommand(chain => chain.toggleCodeBlock());
            }
        }

        if (from === to) {
            return this.runTipTapCommand(chain => chain.toggleCodeBlock());
        }

        const selectedText = state.doc.textBetween(from, to, '\n\n', '\n');
        if (!selectedText || selectedText.trim() === '') {
            return this.runTipTapCommand(chain => chain.toggleCodeBlock());
        }

        this.editor
            .chain()
            .focus()
            .command(({ tr, state: cmdState }) => {
                const { schema } = cmdState;
                const codeBlockNode = schema.nodes.codeBlock.create(
                    { language: 'plaintext' },
                    schema.text(selectedText)
                );
                tr.replaceSelectionWith(codeBlockNode);
                return true;
            })
            .run();

        return true;
    }

    clearTipTapFormatting() {
        const blockedNodes = new Set(['mermaidBlock']);
        return this.runTipTapCommand(chain => {
            let next = chain.unsetAllMarks();
            next = next.command(({ state, tr }) => {
                this.clearTipTapBlockFormatting(state, tr, blockedNodes);
                return true;
            });
            return next;
        });
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
        // toggleViewMode、copyMarkdown 和 toc 不需要编辑器实例，直接触发回调
        if (action === 'toggleViewMode' || action === 'copyMarkdown' || action === 'cardExport') {
            this.emit('action', action);
            return;
        }

        // 处理 TOC 按钮
        if (action === 'toc') {
            this.handleToc();
            return;
        }

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
            codeBlock: () => this.insertCodeBlock(),
            clearFormatting: () => this.clearFormatting(),
            emoji: () => this.handleEmojiPicker()
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
        // 先确保编辑器有焦点，避免长时间等待后选区状态不准确
        if (this.editor?.focus && typeof this.editor.focus === 'function') {
            this.editor.focus();
        }

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

    clearFormatting() {
        const selectionInfo = this.getSelectedText();
        const { selectedText, selection, line } = selectionInfo;
        const target = selectedText || line;

        if (!target) {
            return;
        }

        const cleaned = this.stripMarkdownFormatting(target);

        if (selectedText) {
            this.replaceSelection(cleaned, selection);
        } else {
            this.replaceLine(cleaned, selectionInfo.selection);
        }
    }

    stripMarkdownFormatting(text) {
        if (!text) {
            return '';
        }

        let result = text;

        // 移除代码块围栏
        result = result.replace(/```(?:[\w-]+)?\n([\s\S]*?)```/g, '$1');
        result = result.replace(/~~~(?:[\w-]+)?\n([\s\S]*?)~~~/g, '$1');

        // 行级前缀（标题、列表、引用）
        result = result.replace(/^\s{0,3}(#{1,6})\s+/gm, '');
        result = result.replace(/^\s{0,3}>\s?/gm, '');
        result = result.replace(/^\s{0,3}[-*+]\s+\[[ xX]\]\s+/gm, '');
        result = result.replace(/^\s{0,3}(?:[-*+]|\d+[.)])\s+/gm, '');

        // 链接 / 图片
        result = result.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1');
        result = result.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

        // 强调与行内代码
        result = result.replace(/\*\*([\s\S]+?)\*\*/g, '$1');
        result = result.replace(/__([\s\S]+?)__/g, '$1');
        result = result.replace(/\*([\s\S]+?)\*/g, '$1');
        result = result.replace(/_([\s\S]+?)_/g, '$1');
        result = result.replace(/~~([\s\S]+?)~~/g, '$1');
        result = result.replace(/`([^`]+)`/g, '$1');

        // Inline HTML tags commonly used for 样式
        result = result.replace(/<\/?(?:strong|em|code|del|mark)[^>]*>/g, '');

        // 分隔线
        result = result.replace(/^\s{0,3}(?:[-*_]\s?){3,}$\n?/gm, '');

        return result.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n');
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
                    selection: { from, to, lineStart, lineEnd },
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
                    selection: {
                        start,
                        end,
                        from: start,
                        to: end,
                        lineStart,
                        lineEnd
                    },
                    line,
                    lineStart,
                    lineEnd
                };
            }
        }

        return {
            selectedText: '',
            selection: { start: 0, end: 0, from: 0, to: 0, lineStart: 0, lineEnd: 0 },
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

            // 传递 selectionMode='select' 来选中插入的文本
            // 不传 start/end，让 setRangeText 内部重新获取 focus() 后的选区
            this.editor.setRangeText(text, undefined, undefined, 'select');

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

        // 检测新行的前缀长度（标题、列表、引用等）
        const getPrefixLength = (line) => {
            // 标题：# ## ### 等
            const headingMatch = line.match(/^(#{1,6}\s+)/);
            if (headingMatch) return headingMatch[1].length;

            // 无序列表：- + *
            const unorderedMatch = line.match(/^([-+*]\s+)/);
            if (unorderedMatch) return unorderedMatch[1].length;

            // 有序列表：1. 2. 等
            const orderedMatch = line.match(/^(\d+\.\s+)/);
            if (orderedMatch) return orderedMatch[1].length;

            // 任务列表：- [ ] - [x]
            const taskMatch = line.match(/^(-\s+\[[x\s]\]\s+)/i);
            if (taskMatch) return taskMatch[1].length;

            // 引用：>
            const quoteMatch = line.match(/^(>\s+)/);
            if (quoteMatch) return quoteMatch[1].length;

            return 0;
        };

        const newPrefixLength = getPrefixLength(newLine);

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

            // 将光标放在内容起点（跳过前缀）
            const newCursorPos = lineStart + newPrefixLength;
            this.editor.commands.setTextSelection({ from: newCursorPos, to: newCursorPos });
        }
        // 普通 textarea
        else if (this.editor.setRangeText) {
            this.editor.focus();
            this.editor.setRangeText(newLine, selection.lineStart, selection.lineEnd);

            // 将光标放在内容起点（跳过前缀）
            const newCursorPos = selection.lineStart + newPrefixLength;
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
            if (!this.editor) return;

            // TipTap 编辑器
            if (typeof this.editor.state !== 'undefined' && typeof this.editor.commands !== 'undefined') {
                const { selection } = this.getSelectedText();
                const text = this.editor.state.doc.textBetween(selection.from, selection.to);
                const openParenIndex = text.indexOf('(');
                const closeParenIndex = text.indexOf(')');

                if (openParenIndex !== -1 && closeParenIndex !== -1) {
                    const from = selection.from + openParenIndex + 1;
                    const to = selection.from + closeParenIndex;
                    this.editor.commands.setTextSelection({ from, to });
                }
            }
            // Textarea 或 Monaco 编辑器代理
            else if (typeof this.editor.setSelectionRange === 'function') {
                const { selection } = this.getSelectedText();
                const text = this.editor.value.substring(selection.from, selection.to);
                const openParenIndex = text.indexOf('(');
                const closeParenIndex = text.indexOf(')');

                if (openParenIndex !== -1 && closeParenIndex !== -1) {
                    const from = selection.from + openParenIndex + 1;
                    const to = selection.from + closeParenIndex;
                    this.editor.setSelectionRange(from, to);
                }
            }
        }, 0);
    }

    /**
     * 选中图片URL部分
     */
    selectImageUrl() {
        setTimeout(() => {
            if (!this.editor) return;

            // TipTap 编辑器
            if (typeof this.editor.state !== 'undefined' && typeof this.editor.commands !== 'undefined') {
                const { selection } = this.getSelectedText();
                const text = this.editor.state.doc.textBetween(selection.from, selection.to);
                const bracketIndex = text.indexOf('[');
                const linkStartIndex = text.indexOf('](');
                const closeParenIndex = text.indexOf(')');

                if (bracketIndex !== -1 && linkStartIndex !== -1 && closeParenIndex !== -1) {
                    const from = selection.from + linkStartIndex + 2;
                    const to = selection.from + closeParenIndex;
                    this.editor.commands.setTextSelection({ from, to });
                }
            }
            // Textarea 或 Monaco 编辑器代理
            else if (typeof this.editor.setSelectionRange === 'function') {
                const { selection } = this.getSelectedText();
                const text = this.editor.value.substring(selection.from, selection.to);
                const bracketIndex = text.indexOf('[');
                const linkStartIndex = text.indexOf('](');
                const closeParenIndex = text.indexOf(')');

                if (bracketIndex !== -1 && linkStartIndex !== -1 && closeParenIndex !== -1) {
                    const from = selection.from + linkStartIndex + 2;
                    const to = selection.from + closeParenIndex;
                    this.editor.setSelectionRange(from, to);
                }
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

        const targetNames = new Set(nodeNames);

        const selectionNode = state.selection?.node;
        if (selectionNode && targetNames.has(selectionNode.type?.name)) {
            return true;
        }

        const checkPosition = ($pos) => {
            if (!$pos) {
                return false;
            }
            for (let depth = $pos.depth; depth >= 0; depth -= 1) {
                const node = $pos.node(depth);
                if (node && targetNames.has(node.type?.name)) {
                    return true;
                }
            }
            return false;
        };

        if (checkPosition(state.selection?.$from) || checkPosition(state.selection?.$to)) {
            return true;
        }

        let intersects = false;
        const { from, to } = state.selection || {};
        if (typeof from === 'number' && typeof to === 'number' && to > from) {
            state.doc.nodesBetween(from, to, (node) => {
                if (!node || intersects) {
                    return !intersects;
                }
                if (targetNames.has(node.type?.name)) {
                    intersects = true;
                    return false;
                }
                return true;
            });
        }

        return intersects;
    }

    clearTipTapBlockFormatting(state, tr, blockedNodes = new Set()) {
        if (!state || !tr || !state.selection) {
            return;
        }

        state.selection.ranges.forEach(range => {
            this.liftSelectionRange(range, tr, blockedNodes);
        });

        this.resetTextBlocksInSelection(state.selection, tr, state.schema, blockedNodes);
    }

    liftSelectionRange(range, tr, blockedNodes) {
        if (!range?.$from || !range.$to) {
            return;
        }
        const blockRange = range.$from.blockRange(range.$to);
        if (!blockRange) {
            return;
        }
        if (this.rangeContainsBlockedNodes(tr.doc, blockRange.start, blockRange.end, blockedNodes)) {
            return;
        }
        const target = liftTarget(blockRange);
        if (typeof target === 'number') {
            tr.lift(blockRange, target);
        }
    }

    resetTextBlocksInSelection(selection, tr, schema, blockedNodes) {
        if (!selection) {
            return;
        }
        const from = selection.from;
        const to = selection.to;
        tr.doc.nodesBetween(from, to, (node, pos) => {
            if (!node?.type?.isTextblock) {
                return true;
            }
            if (this.isBlockedNodeType(node.type, blockedNodes) || node.type.spec?.atom) {
                return false;
            }
            const safeType = this.getSafeBlockType(tr.doc.resolve(pos), node.type, schema, blockedNodes);
            if (safeType && safeType !== node.type) {
                tr.setNodeMarkup(pos, safeType, node.attrs);
            }
            return false;
        });
    }

    rangeContainsBlockedNodes(doc, from, to, blockedNodes) {
        if (!doc || !blockedNodes?.size) {
            return false;
        }
        let hasBlocked = false;
        doc.nodesBetween(from, to, (node) => {
            if (!node || hasBlocked) {
                return !hasBlocked;
            }
            if (this.isBlockedNodeType(node.type, blockedNodes)) {
                hasBlocked = true;
                return false;
            }
            if (node.type?.isTextblock) {
                return false;
            }
            return true;
        });
        return hasBlocked;
    }

    isBlockedNodeType(type, blockedNodes) {
        if (!type) {
            return false;
        }
        return Boolean(blockedNodes?.has(type.name));
    }

    getSafeBlockType($pos, currentType, schema, blockedNodes) {
        if (!$pos) {
            return currentType;
        }
        const parent = $pos.parent;
        const match = parent?.contentMatchAt($pos.index()) || null;
        let candidate = match?.defaultType || currentType;
        if (!candidate || this.isBlockedNodeType(candidate, blockedNodes) || candidate.spec?.atom) {
            const paragraph = schema?.nodes?.paragraph;
            candidate = (!this.isBlockedNodeType(paragraph, blockedNodes) && !paragraph?.spec?.atom)
                ? paragraph
                : currentType;
        }
        return candidate || currentType;
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

    /**
     * 初始化 emoji 选择器
     */
    initEmojiPicker() {
        this.emojiPicker = document.createElement('div');
        this.emojiPicker.className = 'markdown-toolbar-emoji-picker';

        this.emojiPicker.innerHTML = `
            <div class="markdown-toolbar-emoji-content">
                ${EMOJI_LIST.map(emoji => `<span class="markdown-toolbar-emoji-item">${emoji}</span>`).join('')}
            </div>
        `;

        document.body.appendChild(this.emojiPicker);

        // 绑定 emoji 点击事件
        this.emojiPicker.addEventListener('click', (e) => {
            const emojiItem = e.target.closest('.markdown-toolbar-emoji-item');
            if (emojiItem) {
                const emoji = emojiItem.textContent;
                this.insertEmoji(emoji);
                this.hideEmojiPicker();
            }
        });

        // 点击外部关闭
        document.addEventListener('mousedown', (e) => {
            if (this.emojiPickerVisible &&
                !this.emojiPicker.contains(e.target) &&
                !e.target.closest('[data-action="emoji"]')) {
                this.hideEmojiPicker();
            }
        }, true);
    }

    /**
     * 处理 emoji 选择器
     */
    handleEmojiPicker() {
        const emojiButton = this.container?.querySelector('[data-action="emoji"]');
        if (!emojiButton) return false;

        if (this.emojiPickerVisible) {
            this.hideEmojiPicker();
        } else {
            this.showEmojiPicker(emojiButton);
        }
        return true;
    }

    /**
     * 显示 emoji 选择器
     */
    showEmojiPicker(button) {
        if (!this.emojiPicker) return;

        this.emojiPickerVisible = true;
        this.emojiPicker.classList.add('is-visible');

        // 定位到按钮下方
        const rect = button.getBoundingClientRect();
        const pickerWidth = 320;
        const pickerHeight = 200;

        let left = rect.left - (pickerWidth - rect.width) / 2;
        let top = rect.bottom + 8;

        // 防止超出屏幕
        if (left < 10) {
            left = 10;
        }
        if (left + pickerWidth > window.innerWidth - 10) {
            left = window.innerWidth - pickerWidth - 10;
        }
        if (top + pickerHeight > window.innerHeight - 10) {
            top = rect.top - pickerHeight - 8;
        }

        this.emojiPicker.style.left = `${left}px`;
        this.emojiPicker.style.top = `${top}px`;
    }

    /**
     * 隐藏 emoji 选择器
     */
    hideEmojiPicker() {
        if (!this.emojiPicker) return;

        this.emojiPickerVisible = false;
        this.emojiPicker.classList.remove('is-visible');
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
        this.insertTextAtCursor(emoji);
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
}
