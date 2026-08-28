/**
 * 查找选区或光标所在的 Markdown 围栏代码块。
 * @param {string} text - Markdown 源码
 * @param {number} start - 选区起点
 * @param {number} end - 选区终点
 * @returns {{start:number,end:number,contentStart:number,contentEnd:number}|null}
 */
function findEnclosingCodeFence(text, start, end) {
    const lines = text.split('\n');
    let offset = 0;
    let opening = null;

    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (!opening) {
            const match = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
            if (match) {
                opening = {
                    start: offset,
                    marker: match[1][0],
                    markerLength: match[1].length,
                    contentStart: offset + line.length + (index < lines.length - 1 ? 1 : 0),
                };
            }
        } else {
            const closingMarker = line.trim();
            const isClosing = closingMarker.length >= opening.markerLength
                && [...closingMarker].every(character => character === opening.marker);
            if (isClosing) {
                const block = {
                    start: opening.start,
                    end: offset + line.length,
                    contentStart: opening.contentStart,
                    contentEnd: offset,
                };
                if (start >= block.start && end <= block.end) {
                    return block;
                }
                opening = null;
            }
        }

        offset += line.length + (index < lines.length - 1 ? 1 : 0);
    }

    return null;
}

/**
 * 创建不会与代码内容冲突的反引号围栏。
 * @param {string} code - 待包裹的代码内容
 * @returns {string}
 */
function createCodeFenceMarker(code) {
    const longestRun = [...code.matchAll(/`+/g)]
        .reduce((maximum, match) => Math.max(maximum, match[0].length), 0);
    return '`'.repeat(Math.max(3, longestRun + 1));
}

/**
 * 解析一行 Markdown 的列表标记、缩进和正文。
 * @param {string} line - Markdown 行
 * @returns {{type:'task'|'unordered'|'ordered'|null,indentation:string,content:string}}
 */
function parseListLine(line) {
    const markerMatch = line.match(/^(\s*)(?:([-+*]\s+\[[ xX]\]\s+)|([-+*]\s+)|(\d+[.)]\s+))/);
    const indentation = markerMatch?.[1] || line.match(/^\s*/)?.[0] || '';
    const type = markerMatch?.[2]
        ? 'task'
        : markerMatch?.[3]
            ? 'unordered'
            : markerMatch?.[4]
                ? 'ordered'
                : null;
    return {
        type,
        indentation,
        content: markerMatch ? line.slice(markerMatch[0].length) : line.slice(indentation.length),
    };
}

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

    /**
     * 调整源码模式下当前行的标题级别。
     * @param {'increase'|'decrease'} direction - 调整方向
     * @returns {boolean}
     */
    adjustHeadingLevel(direction) {
        const { selection, line } = this.getSelectedText();
        const match = line.match(/^(#{1,6})\s/);
        const currentLevel = match ? match[1].length : 0;
        let nextLevel = currentLevel;

        if (direction === 'increase') {
            nextLevel = currentLevel === 0 ? 6 : Math.max(1, currentLevel - 1);
        } else if (currentLevel >= 6) {
            nextLevel = 0;
        } else if (currentLevel > 0) {
            nextLevel = currentLevel + 1;
        } else {
            return false;
        }

        const stripped = line.replace(/^#{1,6}\s/, '');
        this.replaceLine(nextLevel ? `${'#'.repeat(nextLevel)} ${stripped}` : stripped, selection);
        return true;
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

    /**
     * 切换当前行的列表类型；同类型取消列表，不同类型直接转换。
     * @param {'unordered'|'ordered'} listType - 目标列表类型
     * @returns {boolean}
     */
    toggleList(listType) {
        const { selection, line } = this.getSelectedText();
        const lines = line.split('\n');
        const parsedLines = lines.map(parseListLine);
        const nonEmptyLines = parsedLines.filter(parsed => parsed.content.trim() || parsed.type);
        const shouldRemove = nonEmptyLines.length > 0
            && nonEmptyLines.every(parsed => parsed.type === listType);
        const marker = listType === 'ordered' ? '1. ' : '- ';
        const updated = lines.map((sourceLine, index) => {
            if (!sourceLine.trim()) return sourceLine;
            const parsed = parsedLines[index];
            return shouldRemove
                ? `${parsed.indentation}${parsed.content}`
                : `${parsed.indentation}${marker}${parsed.content}`;
        }).join('\n');

        this.replaceLine(updated, selection);
        return true;
    }

    /**
     * 调整源码模式下选中行或当前行的四空格缩进。
     * @param {'indent'|'outdent'} direction - 调整方向
     * @returns {boolean}
     */
    adjustIndent(direction) {
        const editor = this.editor;
        if (!editor || typeof editor.value !== 'string' || typeof editor.setRangeText !== 'function') {
            return false;
        }

        const start = editor.selectionStart ?? 0;
        const end = editor.selectionEnd ?? start;
        const lineStart = editor.value.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
        const nextNewline = editor.value.indexOf('\n', end);
        const lineEnd = nextNewline === -1 ? editor.value.length : nextNewline;
        const selectedLines = editor.value.slice(lineStart, lineEnd);
        const updated = direction === 'indent'
            ? selectedLines.split('\n').map(line => `    ${line}`).join('\n')
            : selectedLines.split('\n').map(line => line.replace(/^(?: {1,4}|\t)/, '')).join('\n');

        if (updated === selectedLines) return false;
        editor.focus?.();
        editor.setRangeText(updated, lineStart, lineEnd, 'select');
        editor.dispatchEvent?.(new Event('input', { bubbles: true }));
        return true;
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

    /**
     * 在普通文本与围栏代码块之间切换，支持光标位于已有围栏内部的场景。
     * @returns {boolean}
     */
    toggleCodeBlock() {
        const editor = this.editor;
        if (!editor || typeof editor.value !== 'string' || typeof editor.setRangeText !== 'function') {
            return false;
        }

        const selectionInfo = this.getSelectedText();
        const { selectedText, selection, line } = selectionInfo;
        const enclosingFence = findEnclosingCodeFence(editor.value, selection.start, selection.end);
        let rangeStart;
        let rangeEnd;
        let replacement;

        if (enclosingFence) {
            rangeStart = enclosingFence.start;
            rangeEnd = enclosingFence.end;
            replacement = editor.value.slice(enclosingFence.contentStart, enclosingFence.contentEnd);
            // 去掉围栏闭合行前必需的一个换行，保留正文自身的额外空行。
            if (replacement.endsWith('\n')) replacement = replacement.slice(0, -1);
        } else {
            rangeStart = selectedText ? selection.start : selection.lineStart;
            rangeEnd = selectedText ? selection.end : selection.lineEnd;
            const code = selectedText || line || '代码内容';
            const fence = createCodeFenceMarker(code);
            replacement = `${fence}\n${code}\n${fence}`;
        }

        editor.focus?.();
        editor.setRangeText(replacement, rangeStart, rangeEnd, 'select');
        editor.dispatchEvent?.(new Event('input', { bubbles: true }));
        return true;
    }

    /** 打开公式输入框，并在源码模式插入数学块。 */
    insertMathBlock() {
        void this._runMathBlockDialog();
    }

    /** 执行源码模式数学块输入流程。 */
    async _runMathBlockDialog() {
        const { showMathBlockDialog } = await import('./InsertDialogs.js');
        const result = await showMathBlockDialog();
        if (!result?.latex) return;
        this.insertTextAtCursor(`\n$$\n${result.latex}\n$$\n`);
        this.editor?.focus?.();
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
                const nextLineBreak = editor.value.indexOf('\n', end);
                const lineEnd = nextLineBreak === -1 ? editor.value.length : nextLineBreak;
                const line = editor.value.substring(lineStart, lineEnd);

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
