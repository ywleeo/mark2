/**
 * 源码位置与滚动管理器
 * 负责 sourcepos 属性的查询、光标定位以及滚动同步
 */

/**
 * 找到覆盖目标源码行的最精确节点；跨度相同时优先可直接映射文本的 textblock。
 * @param {import('@tiptap/pm/model').Node} doc - ProseMirror 文档。
 * @param {number} lineNumber - 一基源码行号。
 * @param {string} [matchText] - 可选命中文本，用于区分同一源码行里的表格单元格。
 * @returns {{start:number,end:number,pos:number,node:import('@tiptap/pm/model').Node}|null}
 */
function findSourceNode(doc, lineNumber, matchText = '') {
    let bestMatch = null;
    doc.descendants((node, pos) => {
        const sourcePosition = node.attrs?.sourcepos;
        if (typeof sourcePosition !== 'string') return true;
        const [start, end] = sourcePosition.split(':').map(Number);
        if (!Number.isFinite(start) || !Number.isFinite(end)) return true;
        if (lineNumber < start || lineNumber > end) return true;

        const span = end - start;
        const bestSpan = bestMatch ? bestMatch.end - bestMatch.start : Number.POSITIVE_INFINITY;
        const containsMatch = Boolean(matchText && node.textContent.includes(matchText));
        const bestContainsMatch = Boolean(matchText && bestMatch?.node?.textContent.includes(matchText));
        const isMoreSpecific = span === bestSpan
            && containsMatch === bestContainsMatch
            && node.content.size < (bestMatch?.node?.content.size ?? Number.POSITIVE_INFINITY);
        if (!bestMatch
            || span < bestSpan
            || (span === bestSpan && containsMatch && !bestContainsMatch)
            || isMoreSpecific) {
            bestMatch = { start, end, pos, node };
        }
        return true;
    });
    return bestMatch;
}

/**
 * 在一行渲染文本中选择最接近源码列的同名命中，处理同一行重复关键词。
 * @param {string} lineText - 编辑器里实际显示的行文本。
 * @param {string} matchText - 后端返回的精确命中文本。
 * @param {number} sourceColumn - 一基源码列号。
 * @returns {number} JavaScript 字符串下标，未找到时返回 -1。
 */
function findClosestTextMatch(lineText, matchText, sourceColumn) {
    if (!matchText) return -1;
    const candidates = [];
    let offset = lineText.indexOf(matchText);
    while (offset !== -1) {
        candidates.push(offset);
        offset = lineText.indexOf(matchText, offset + Math.max(1, matchText.length));
    }
    if (candidates.length === 0) return -1;
    const target = Math.max(0, (Number(sourceColumn) || 1) - 1);
    return candidates.reduce((best, current) => (
        Math.abs(current - target) < Math.abs(best - target) ? current : best
    ));
}

/**
 * 把 textblock 内的可见文本下标转换为 ProseMirror 文档位置。
 * @param {import('@tiptap/pm/model').Node} node - 文本块节点。
 * @param {number} nodePosition - 节点在文档中的起始位置。
 * @param {number} textOffset - textBetween 结果中的 UTF-16 下标。
 * @returns {number} ProseMirror 文档位置。
 */
function resolveTextOffset(node, nodePosition, textOffset) {
    const target = Math.max(0, textOffset);
    let resolvedOffset = 0;
    let characterCount = 0;
    let found = false;

    node.content.forEach((child, offset) => {
        if (found) return;
        const childLength = child.type.name === 'hardBreak'
            ? 1
            : (child.isText ? child.text.length : 0);
        if (target <= characterCount + childLength) {
            resolvedOffset = offset + Math.min(childLength, target - characterCount);
            found = true;
            return;
        }
        characterCount += childLength;
        resolvedOffset = offset + child.nodeSize;
    });

    return nodePosition + 1 + Math.min(resolvedOffset, node.content.size);
}

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

    /**
     * 定位到源码命中，并在 Markdown 渲染层高亮实际可见的命中文本。
     * Markdown 标记本身不可见时退化为普通行列定位。
     * @param {number} lineNumber - 一基源码行号。
     * @param {number} column - 一基源码列号。
     * @param {string} matchText - 后端返回的精确命中文本。
     * @returns {boolean} 是否成功创建了可见高亮。
     */
    highlightSourceMatch(lineNumber, column = 1, matchText = '') {
        if (!this._editor || !Number.isFinite(lineNumber)) return false;
        const { state, view } = this._editor;
        if (!state || !view) return false;

        const bestMatch = findSourceNode(state.doc, lineNumber, matchText);
        if (!bestMatch || !matchText) {
            this._editor.commands.clearNavigationHighlight?.();
            this.scrollToSourcePosition(lineNumber, column);
            return false;
        }

        let { pos, node } = bestMatch;
        if (!node.isTextblock) {
            let nestedTextblock = null;
            node.descendants((child, relativePosition) => {
                if (!nestedTextblock && child.isTextblock && child.textContent.includes(matchText)) {
                    nestedTextblock = {
                        node: child,
                        pos: pos + 1 + relativePosition,
                    };
                    return false;
                }
                return !nestedTextblock;
            });
            if (!nestedTextblock) {
                this._editor.commands.clearNavigationHighlight?.();
                this.scrollToSourcePosition(lineNumber, column);
                return false;
            }
            ({ pos, node } = nestedTextblock);
        }

        const { start } = bestMatch;
        const renderedText = node.textBetween(
            0,
            node.content.size,
            '\n',
            child => (child.type.name === 'hardBreak' ? '\n' : '')
        );
        const lines = renderedText.split('\n');
        const lineOffset = Math.max(0, lineNumber - start);
        const targetLine = lines[lineOffset] || '';
        const matchOffset = findClosestTextMatch(targetLine, matchText, column);
        if (matchOffset < 0) {
            this._editor.commands.clearNavigationHighlight?.();
            this.scrollToSourcePosition(lineNumber, column);
            return false;
        }

        let lineTextOffset = 0;
        for (let index = 0; index < lineOffset && index < lines.length; index += 1) {
            lineTextOffset += lines[index].length + 1;
        }
        const from = resolveTextOffset(node, pos, lineTextOffset + matchOffset);
        const to = resolveTextOffset(node, pos, lineTextOffset + matchOffset + matchText.length);
        if (from >= to || !this._editor.commands.setNavigationHighlight?.({ from, to })) {
            this.scrollToSourcePosition(lineNumber, column);
            return false;
        }

        const latestState = this._editor.state;
        const transaction = latestState.tr.setSelection(
            latestState.selection.constructor.near(latestState.doc.resolve(from))
        );
        view.dispatch(transaction);
        view.focus();
        requestAnimationFrame(() => {
            const dom = view.domAtPos(from)?.node;
            const element = dom?.nodeType === Node.ELEMENT_NODE ? dom : dom?.parentElement;
            element?.scrollIntoView?.({ block: 'center', inline: 'nearest' });
        });
        return true;
    }

    /** 清除由工作区搜索等外部导航创建的临时高亮。 */
    clearNavigationHighlight() {
        this._editor?.commands.clearNavigationHighlight?.();
    }

    /** 光标在 viewport 内的相对纵坐标（0=顶 1=底）。看不到/未就绪返回 null。 */
    getCursorViewportRatio() {
        if (!this._editor?.view) return null;
        const { view } = this._editor;
        const head = this._editor.state.selection.head;
        const coords = view.coordsAtPos(head);
        if (!coords) return null;
        const scrollContainer = this._getScrollContainer();
        if (!scrollContainer) return null;
        const rect = scrollContainer.getBoundingClientRect();
        if (rect.height <= 0) return null;
        return Math.min(1, Math.max(0, (coords.top - rect.top) / rect.height));
    }

    /** 设光标到 sourcepos line:column，并让该行出现在容器的 ratio 位置。 */
    setSourcePositionAtRatio(lineNumber, column = 1, ratio = 0.3) {
        this.setSourcePositionOnly(lineNumber, column);
        const r = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0.3;
        requestAnimationFrame(() => {
            if (!this._editor?.view) return;
            const { view } = this._editor;
            const head = this._editor.state.selection.head;
            const coords = view.coordsAtPos(head);
            if (!coords) return;
            const scrollContainer = this._getScrollContainer();
            if (!scrollContainer) return;
            const rect = scrollContainer.getBoundingClientRect();
            const desiredOffsetFromTop = r * rect.height;
            const currentOffsetFromTop = coords.top - rect.top;
            scrollContainer.scrollTop += currentOffsetFromTop - desiredOffsetFromTop;
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
