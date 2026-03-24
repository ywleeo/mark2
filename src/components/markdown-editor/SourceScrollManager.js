/**
 * 源码位置与滚动管理器
 * 负责 sourcepos 属性的查询、光标定位以及滚动同步
 */
export class SourceScrollManager {
    /**
     * @param {() => import('@tiptap/core').Editor} getEditor
     * @param {() => Element} getScrollContainer
     */
    constructor(getEditor, getScrollContainer) {
        this._getEditor = getEditor;
        this._getScrollContainer = getScrollContainer;
    }

    get _editor() { return this._getEditor(); }

    // ─── 查询 ─────────────────────────────────────────────────────────────────

    getSelectionSourcepos() {
        if (!this._editor) return null;
        const { state } = this._editor;
        const { from, to } = state.selection;

        if (from === to) {
            const $pos = state.doc.resolve(from);
            for (let depth = $pos.depth; depth >= 0; depth--) {
                const node = $pos.node(depth);
                const sp = node?.attrs?.sourcepos;
                if (typeof sp === 'string') {
                    const [start, end] = sp.split(':').map(Number);
                    if (Number.isFinite(start) && Number.isFinite(end)) {
                        return { startLine: start, endLine: end, sourcepos: sp };
                    }
                }
            }
            return null;
        }

        let startLine = null;
        let endLine = null;
        state.doc.nodesBetween(from, to, node => {
            const sp = node?.attrs?.sourcepos;
            if (typeof sp !== 'string') return;
            const [start, end] = sp.split(':').map(Number);
            if (!Number.isFinite(start) || !Number.isFinite(end)) return;
            if (startLine === null || start < startLine) startLine = start;
            if (endLine === null || end > endLine) endLine = end;
        });

        if (startLine === null || endLine === null) return null;
        return { startLine, endLine, sourcepos: `${startLine}:${endLine}` };
    }

    getCurrentSourceLine() {
        return this.getSelectionSourcepos()?.startLine ?? null;
    }

    getCurrentSourcePosition() {
        if (!this._editor) return null;
        const { state } = this._editor;
        const { from } = state.selection;
        const $pos = state.doc.resolve(from);

        let sourceposNode = null;
        let sourceposNodeStart = 0;
        for (let depth = $pos.depth; depth >= 0; depth--) {
            const node = $pos.node(depth);
            const sp = node?.attrs?.sourcepos;
            if (typeof sp === 'string') {
                const [start] = sp.split(':').map(Number);
                if (Number.isFinite(start)) {
                    sourceposNode = node;
                    sourceposNodeStart = $pos.start(depth);
                    break;
                }
            }
        }

        if (!sourceposNode) return null;

        const [startLine] = sourceposNode.attrs.sourcepos.split(':').map(Number);
        const offsetInNode = from - sourceposNodeStart;
        const textBefore = sourceposNode.textBetween(
            0,
            Math.min(offsetInNode, sourceposNode.content.size),
            '\n',
            (node) => (node.type.name === 'hardBreak' ? '\n' : '')
        );
        const lines = textBefore.split('\n');
        return {
            lineNumber: startLine + lines.length - 1,
            column: lines[lines.length - 1].length + 1,
        };
    }

    getVisibleCenterSourceLine() {
        if (!this._editor?.view) return null;

        const scrollContainer = this._getScrollContainer();
        if (!scrollContainer) return null;

        const { view } = this._editor;
        const editorRect = view.dom.getBoundingClientRect();
        const containerRect = scrollContainer.getBoundingClientRect();

        const coords = view.posAtCoords({
            left: editorRect.left + editorRect.width / 2,
            top: containerRect.top + scrollContainer.clientHeight / 2,
        });
        if (!coords) return null;

        const $pos = this._editor.state.doc.resolve(coords.pos);
        for (let depth = $pos.depth; depth >= 0; depth--) {
            const node = $pos.node(depth);
            const sp = node?.attrs?.sourcepos;
            if (typeof sp === 'string') {
                const [start, end] = sp.split(':').map(Number);
                if (Number.isFinite(start) && Number.isFinite(end)) {
                    const nodeStart = $pos.start(depth);
                    const textBefore = node.textBetween(0, Math.min(coords.pos - nodeStart, node.content.size), '\n');
                    const lineOffset = (textBefore.match(/\n/g) || []).length;
                    return Math.min(start + lineOffset, end);
                }
            }
        }
        return null;
    }

    // ─── 定位 ─────────────────────────────────────────────────────────────────

    scrollToSourceLine(lineNumber) {
        this.scrollToSourcePosition(lineNumber, 1);
    }

    setSourcePositionOnly(lineNumber, column = 1) {
        if (!this._editor || !Number.isFinite(lineNumber)) return;
        const { state, view } = this._editor;
        if (!state || !view) return;

        let bestMatch = null;
        state.doc.descendants((node, pos) => {
            const sp = node.attrs?.sourcepos;
            if (typeof sp !== 'string') return true;
            const [start, end] = sp.split(':').map(Number);
            if (!Number.isFinite(start) || !Number.isFinite(end)) return true;
            if (lineNumber < start || lineNumber > end) return false;
            bestMatch = { start, end, pos, node };
            return true;
        });

        if (!bestMatch) return;

        const { start, pos, node } = bestMatch;
        const lineOffset = lineNumber - start;
        const safeColumn = Math.max(1, column);
        let targetPos = pos + 1;

        if (node.isTextblock && node.content.size > 0) {
            const text = node.textBetween(0, node.content.size, '\n', (n) => (n.type.name === 'hardBreak' ? '\n' : ''));
            const lines = text.split('\n');
            let textOffset = 0;
            for (let i = 0; i < lineOffset && i < lines.length; i++) {
                textOffset += lines[i].length + 1;
            }
            textOffset += Math.min(safeColumn - 1, lines[lineOffset]?.length ?? 0);

            let nodeOffset = 0;
            let charCount = 0;
            node.content.forEach((child, offset) => {
                if (charCount >= textOffset) return;
                if (child.type.name === 'hardBreak') {
                    charCount += 1;
                    nodeOffset = offset + child.nodeSize;
                } else if (child.isText) {
                    const remaining = textOffset - charCount;
                    if (remaining <= child.text.length) {
                        nodeOffset = offset + remaining;
                        charCount = textOffset;
                    } else {
                        charCount += child.text.length;
                        nodeOffset = offset + child.nodeSize;
                    }
                } else {
                    nodeOffset = offset + child.nodeSize;
                }
            });
            targetPos = pos + 1 + Math.min(nodeOffset, node.content.size);
        }

        const tr = state.tr.setSelection(
            this._editor.state.selection.constructor.near(state.doc.resolve(targetPos))
        );
        view.dispatch(tr);
    }

    scrollToSourcePosition(lineNumber, column = 1) {
        if (!this._editor || !Number.isFinite(lineNumber)) return;
        const { state, view } = this._editor;
        if (!state || !view) return;

        let bestMatch = null;
        state.doc.descendants((node, pos) => {
            const sp = node.attrs?.sourcepos;
            if (typeof sp !== 'string') return true;
            const [start, end] = sp.split(':').map(Number);
            if (!Number.isFinite(start) || !Number.isFinite(end)) return true;
            if (lineNumber >= start && lineNumber <= end) {
                if (!bestMatch || (end - start) < (bestMatch.end - bestMatch.start)) {
                    bestMatch = { start, end, pos, node };
                }
            }
            return true;
        });

        if (!bestMatch) return;

        const { start, pos, node } = bestMatch;
        const lineOffset = lineNumber - start;
        const safeColumn = Math.max(1, column);

        let textOffset = 0;
        if (node.isTextblock && node.content.size > 0) {
            const lines = node.textContent.split('\n');
            for (let i = 0; i < lineOffset && i < lines.length; i++) {
                textOffset += lines[i].length + 1;
            }
            textOffset += Math.min(safeColumn - 1, lines[lineOffset]?.length ?? 0);
        }

        const targetPos = pos + 1 + Math.min(textOffset, node.content.size);
        const tr = state.tr.setSelection(
            this._editor.state.selection.constructor.near(state.doc.resolve(targetPos))
        );
        view.dispatch(tr);
        view.focus();

        requestAnimationFrame(() => {
            const coords = view.coordsAtPos(targetPos);
            if (!coords) return;
            const scrollContainer = view.dom.closest('.markdown-content') || view.dom.parentElement;
            if (scrollContainer) {
                const editorRect = view.dom.getBoundingClientRect();
                const targetY = coords.top - editorRect.top + scrollContainer.scrollTop - scrollContainer.clientHeight / 2;
                scrollContainer.scrollTop = Math.max(0, targetY);
            }
        });
    }

    scrollToSourceLineInCenter(lineNumber) {
        if (!this._editor || !Number.isFinite(lineNumber)) return;
        const { state, view } = this._editor;
        if (!state || !view) return;

        let bestMatch = null;
        state.doc.descendants((node, pos) => {
            const sp = node.attrs?.sourcepos;
            if (typeof sp !== 'string') return true;
            const [start, end] = sp.split(':').map(Number);
            if (!Number.isFinite(start) || !Number.isFinite(end)) return true;
            if (lineNumber >= start && lineNumber <= end) {
                if (!bestMatch || (end - start) < (bestMatch.end - bestMatch.start)) {
                    bestMatch = { start, end, pos, node };
                }
            }
            return true;
        });

        if (!bestMatch) return;

        const { start, pos, node } = bestMatch;
        const lineOffset = lineNumber - start;
        let textOffset = 0;
        if (node.isTextblock && node.content.size > 0) {
            const lines = node.textContent.split('\n');
            for (let i = 0; i < lineOffset && i < lines.length; i++) {
                textOffset += lines[i].length + 1;
            }
        }

        const targetPos = pos + 1 + Math.min(textOffset, node.content.size);
        requestAnimationFrame(() => {
            const coords = view.coordsAtPos(targetPos);
            if (!coords) return;
            const scrollContainer = this._getScrollContainer();
            if (scrollContainer) {
                const containerRect = scrollContainer.getBoundingClientRect();
                const targetY = coords.top - containerRect.top + scrollContainer.scrollTop - scrollContainer.clientHeight / 2;
                scrollContainer.scrollTop = Math.max(0, targetY);
            }
        });
    }
}
