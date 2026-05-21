/**
 * 工具栏的"纯 Markdown 文本"处理器。
 * 作为非 TipTap 编辑器(如 textarea/CodeMirror)的 fallback,
 * 也作为 TipTap 不支持某个动作时的兜底(taskList fallback、普通文本操作)。
 *
 * 通过构造函数接收 toolbar 引用,从中读取 editor。
 */
export class ToolbarPlainMarkdownHandlers {
    constructor(toolbar) {
        this.toolbar = toolbar;
    }

    get editor() {
        return this.toolbar.editor;
    }

    // --- 格式切换 ---
    toggleFormat(before, after) {
        // 先确保编辑器有焦点,避免长时间等待后选区状态不准确
        if (this.editor?.focus && typeof this.editor.focus === 'function') {
            this.editor.focus();
        }

        const { selectedText, selection } = this.getSelectedText();

        if (selectedText) {
            const isFormatted = selectedText.startsWith(before) && selectedText.endsWith(after);
            if (isFormatted) {
                const newText = selectedText.slice(before.length, -after.length);
                this.replaceSelection(newText, selection);
            } else {
                const newText = `${before}${selectedText}${after}`;
                this.replaceSelection(newText, selection);
            }
        } else {
            this.insertTextAtCursor(`${before}${after}`);
            this.setCursorPosition(before.length);
        }
    }

    toggleHeading(level) {
        const { selection, line } = this.getSelectedText();
        const prefix = '#'.repeat(level) + ' ';
        const headingMatch = line.match(/^(#{1,6})\s/);

        if (headingMatch) {
            const currentLevel = headingMatch[1].length;
            if (currentLevel === level) {
                const newLine = line.replace(/^#{1,6}\s/, '');
                this.replaceLine(newLine, selection);
            } else {
                const newLine = line.replace(/^#{1,6}\s/, prefix);
                this.replaceLine(newLine, selection);
            }
        } else {
            const newLine = prefix + line;
            this.replaceLine(newLine, selection);
        }
    }

    /**
     * 设置标题级别（幂等，供工具栏标题下拉使用）
     * @param {number} level - 0 表示正文，1-6 表示标题级别
     */
    setHeading(level) {
        const { selection, line } = this.getSelectedText();
        const stripped = line.replace(/^#{1,6}\s/, '');
        const newLine = level ? '#'.repeat(level) + ' ' + stripped : stripped;
        this.replaceLine(newLine, selection);
    }

    togglePrefix(prefix) {
        const { selection, line } = this.getSelectedText();
        if (line.startsWith(prefix)) {
            const newLine = line.replace(prefix, '');
            this.replaceLine(newLine, selection);
        } else {
            const newLine = prefix + line;
            this.replaceLine(newLine, selection);
        }
    }

    // --- 插入 ---
    insertLink() {
        void this._runLinkDialog();
    }

    async _runLinkDialog() {
        const [{ showLinkDialog }, { getCurrentDirectory }] = await Promise.all([
            import('./InsertDialogs.js'),
            import('../../utils/imageResolver.js'),
        ]);
        const currentFile = this.toolbar?.options?.getCurrentFilePath?.() || null;
        const currentDir = currentFile ? getCurrentDirectory(currentFile) : null;
        const { selectedText, selection } = this.getSelectedText();
        const result = await showLinkDialog({ text: selectedText || '', currentDir });
        if (!result || !result.url) {
            return;
        }
        const link = `[${result.text || result.url}](${result.url})`;
        if (selectedText) {
            this.replaceSelection(link, selection);
        } else {
            this.insertTextAtCursor(link);
        }
        this.editor?.focus?.();
    }

    insertImage() {
        void this._runImageDialog();
    }

    async _runImageDialog() {
        const [{ showImageDialog }, { getCurrentDirectory }] = await Promise.all([
            import('./InsertDialogs.js'),
            import('../../utils/imageResolver.js'),
        ]);
        const currentFile = this.toolbar?.options?.getCurrentFilePath?.() || null;
        const currentDir = currentFile ? getCurrentDirectory(currentFile) : null;
        const { selectedText, selection } = this.getSelectedText();

        const result = await showImageDialog({ alt: selectedText || '', currentDir });
        if (!result || !result.url) {
            return;
        }
        const image = `![${result.alt || ''}](${result.url})`;
        if (selectedText) {
            this.replaceSelection(image, selection);
        } else {
            this.insertTextAtCursor(image);
        }
        this.editor?.focus?.();
    }

    insertVideo() {
        void this._runVideoDialog();
    }

    async _runVideoDialog() {
        const [{ showVideoDialog }, { getCurrentDirectory }] = await Promise.all([
            import('./InsertDialogs.js'),
            import('../../utils/imageResolver.js'),
        ]);
        const currentFile = this.toolbar?.options?.getCurrentFilePath?.() || null;
        const currentDir = currentFile ? getCurrentDirectory(currentFile) : null;
        const result = await showVideoDialog({ currentDir });
        if (!result || !result.url) {
            return;
        }
        this.insertTextAtCursor(`\n\`\`\`video\n${result.url}\n\`\`\`\n`);
        this.editor?.focus?.();
    }

    insertTable() {
        const table = '\n|  |  |  |\n|-----|-----|-----|\n|  |  |  |\n';
        this.insertTextAtCursor(table);
    }

    insertHorizontalRule() {
        this.insertTextAtCursor('\n---\n');
    }

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

    // --- 清除格式 ---
    clearFormatting() {
        const selectionInfo = this.getSelectedText();
        const { selectedText, selection, line } = selectionInfo;
        const target = selectedText || line;

        if (!target) return;

        const cleaned = this.stripMarkdownFormatting(target);

        if (selectedText) {
            this.replaceSelection(cleaned, selection);
        } else {
            this.replaceLine(cleaned, selectionInfo.selection);
        }
    }

    stripMarkdownFormatting(text) {
        if (!text) return '';

        let result = text;

        // 移除代码块围栏
        result = result.replace(/```(?:[\w-]+)?\n([\s\S]*?)```/g, '$1');
        result = result.replace(/~~~(?:[\w-]+)?\n([\s\S]*?)~~~/g, '$1');

        // 行级前缀(标题、列表、引用)
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

        // Inline HTML tags
        result = result.replace(/<\/?(?:strong|em|code|del|mark)[^>]*>/g, '');

        // 分隔线
        result = result.replace(/^\s{0,3}(?:[-*_]\s?){3,}$\n?/gm, '');

        return result.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n');
    }

    // --- 选区读写 ---
    getSelectedText() {
        const editor = this.editor;
        if (editor) {
            // TipTap 编辑器
            if (typeof editor.state !== 'undefined') {
                const { state } = editor;
                const { from, to } = state.selection;
                const selectedText = state.doc.textBetween(from, to);

                const lineStart = state.doc.resolve(from).start();
                const lineEnd = state.doc.resolve(to).end();
                const line = state.doc.textBetween(lineStart, lineEnd);

                return {
                    selectedText,
                    selection: { from, to, lineStart, lineEnd },
                    line,
                    lineStart,
                    lineEnd,
                };
            }

            // 普通 textarea 或 input
            if (editor.setSelectionRange) {
                const start = editor.selectionStart;
                const end = editor.selectionEnd;
                const selectedText = editor.value.substring(start, end);

                const lineStart = editor.value.lastIndexOf('\n', start) + 1;
                const lineEnd = editor.value.indexOf('\n', end);
                const line = editor.value.substring(
                    lineStart,
                    lineEnd === -1 ? editor.value.length : lineEnd
                );

                return {
                    selectedText,
                    selection: {
                        start,
                        end,
                        from: start,
                        to: end,
                        lineStart,
                        lineEnd,
                    },
                    line,
                    lineStart,
                    lineEnd,
                };
            }
        }

        return {
            selectedText: '',
            selection: { start: 0, end: 0, from: 0, to: 0, lineStart: 0, lineEnd: 0 },
            line: '',
            lineStart: 0,
            lineEnd: 0,
        };
    }

    replaceSelection(text, selection) {
        const editor = this.editor;
        if (!editor) return;

        if (typeof editor.chain !== 'undefined') {
            editor
                .chain()
                .focus()
                .deleteSelection()
                .insertContent(text)
                .run();
        } else if (editor.setRangeText) {
            editor.focus();
            // 传递 selectionMode='select' 来选中插入的文本
            // 不传 start/end,让 setRangeText 内部重新获取 focus() 后的选区
            editor.setRangeText(text, undefined, undefined, 'select');
            editor.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }

    replaceLine(newLine, selection) {
        const editor = this.editor;
        if (!editor) return;

        // 检测新行的前缀长度(标题、列表、引用等)
        const getPrefixLength = (line) => {
            const headingMatch = line.match(/^(#{1,6}\s+)/);
            if (headingMatch) return headingMatch[1].length;

            const unorderedMatch = line.match(/^([-+*]\s+)/);
            if (unorderedMatch) return unorderedMatch[1].length;

            const orderedMatch = line.match(/^(\d+\.\s+)/);
            if (orderedMatch) return orderedMatch[1].length;

            const taskMatch = line.match(/^(-\s+\[[x\s]\]\s+)/i);
            if (taskMatch) return taskMatch[1].length;

            const quoteMatch = line.match(/^(>\s+)/);
            if (quoteMatch) return quoteMatch[1].length;

            return 0;
        };

        const newPrefixLength = getPrefixLength(newLine);

        if (typeof editor.chain !== 'undefined') {
            const { state } = editor;
            const { from } = selection;
            const $pos = state.doc.resolve(from);
            const lineStart = $pos.start();
            const lineEnd = $pos.end();

            editor
                .chain()
                .focus()
                .setTextSelection({ from: lineStart, to: lineEnd })
                .deleteSelection()
                .insertContent(newLine)
                .run();

            const newCursorPos = lineStart + newPrefixLength;
            editor.commands.setTextSelection({ from: newCursorPos, to: newCursorPos });
        } else if (editor.setRangeText) {
            editor.focus();
            editor.setRangeText(newLine, selection.lineStart, selection.lineEnd);

            const newCursorPos = selection.lineStart + newPrefixLength;
            editor.setSelectionRange(newCursorPos, newCursorPos);

            editor.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }

    insertTextAtCursor(text) {
        const { selection } = this.getSelectedText();
        this.replaceSelection(text, selection);
    }

    setCursorPosition(offset) {
        const editor = this.editor;
        if (!editor) return;

        if (typeof editor.commands !== 'undefined') {
            const { state } = editor;
            const { from } = state.selection;
            editor.commands.setTextSelection({
                from: from + offset,
                to: from + offset,
            });
        } else if (editor.setSelectionRange) {
            const pos = editor.selectionStart + offset;
            editor.setSelectionRange(pos, pos);
        }
    }

}
