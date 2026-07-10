const BEFORE_LIMIT = 6000;
const AFTER_LIMIT = 1600;
const OUTLINE_LIMIT = 1600;

/**
 * 从长 Markdown 尾部保留靠近光标的完整块。
 * @param {string} text - 光标前 Markdown
 * @param {number} limit - 最大字符数
 * @returns {string} 裁剪后的 Markdown
 */
function clampMarkdownEnd(text, limit) {
    const value = String(text || '');
    if (value.length <= limit) return value;
    const sliced = value.slice(-limit);
    const blockBoundary = sliced.indexOf('\n\n');
    return (blockBoundary >= 0 ? sliced.slice(blockBoundary + 2) : sliced).trimStart();
}

/**
 * 从长 Markdown 开头保留靠近光标的完整块。
 * @param {string} text - 光标后 Markdown
 * @param {number} limit - 最大字符数
 * @returns {string} 裁剪后的 Markdown
 */
function clampMarkdownStart(text, limit) {
    const value = String(text || '');
    if (value.length <= limit) return value;
    const sliced = value.slice(0, limit);
    const blockBoundary = sliced.lastIndexOf('\n\n');
    return (blockBoundary > 0 ? sliced.slice(0, blockBoundary) : sliced).trimEnd();
}

/**
 * 提取文档标题结构，给续写提供章节级语境。
 * @param {string} markdown - 完整 Markdown
 * @returns {string} 标题大纲
 */
function extractOutline(markdown) {
    const outline = String(markdown || '')
        .split('\n')
        .filter(line => /^#{1,6}\s+\S/.test(line.trim()))
        .map(line => line.trim())
        .join('\n');
    return outline.length > OUTLINE_LIMIT ? outline.slice(0, OUTLINE_LIMIT).trimEnd() : outline;
}

/**
 * 获取光标前最近一行非空文本。
 * @param {string} beforeCursor - 光标前 Markdown
 * @returns {string} 最近非空行
 */
function getPreviousNonEmptyLine(beforeCursor) {
    const lines = String(beforeCursor || '').split('\n');
    for (let index = lines.length - 1; index >= 0; index -= 1) {
        const line = lines[index]?.trimEnd();
        if (line?.trim()) return line;
    }
    return '';
}

/**
 * 获取光标位置的 ProseMirror 祖先节点。
 * @param {import('@tiptap/pm/state').EditorState} state - 编辑器状态
 * @returns {{names: string[], attrs: Record<string, unknown>[]}} 节点信息
 */
function getSelectionAncestors(state) {
    const { $from } = state.selection;
    const names = [];
    const attrs = [];
    for (let depth = 0; depth <= $from.depth; depth += 1) {
        const node = $from.node(depth);
        names.push(node.type?.name || '');
        attrs.push(node.attrs || {});
    }
    return { names, attrs };
}

/**
 * 序列化一个带临时光标标记的文档，从而获得保留真实 Markdown 结构的前后文。
 * 该过程只创建临时 transaction，不会修改编辑器内容或历史。
 * @param {import('@tiptap/pm/state').EditorState} state - 编辑器状态
 * @param {{serialize: Function}|null} serializer - Markdown serializer
 * @param {string} sourceMarkdown - 当前完整 Markdown
 * @returns {{before: string, after: string}|null} 光标两侧 Markdown
 */
function serializeAroundCursor(state, serializer, sourceMarkdown) {
    if (!state?.schema?.text || !serializer?.serialize) return null;

    let marker = 'MARK2CURSORPOINT';
    while (String(sourceMarkdown || '').includes(marker)) marker += 'X';

    try {
        const pos = state.selection.from;
        const markerNode = state.schema.text(marker);
        const markedDoc = state.tr.replaceWith(pos, pos, markerNode).doc;
        const serialized = serializer.serialize(markedDoc);
        const markerIndex = serialized.indexOf(marker);
        if (markerIndex < 0) return null;
        return {
            before: serialized.slice(0, markerIndex),
            after: serialized.slice(markerIndex + marker.length),
        };
    } catch {
        return null;
    }
}

/**
 * 推断当前插入位置需要遵守的结构合同。
 * @param {import('@tiptap/pm/state').EditorState} state - 编辑器状态
 * @param {string} beforeCursor - 光标前 Markdown
 * @returns {{mode:string,insertionMode:string,blockType:string,listType:string,beforeInBlock:string,afterInBlock:string,previousNonEmptyLine:string,insideContainer:boolean,instruction:string}}
 */
function inferCurrentFormat(state, beforeCursor) {
    const { $from } = state.selection;
    const parent = $from.parent;
    const beforeInBlock = parent.textBetween(0, $from.parentOffset, '\n', '\n');
    const afterInBlock = parent.textBetween($from.parentOffset, parent.content.size, '\n', '\n');
    const { names, attrs } = getSelectionAncestors(state);
    const listType = names.find(name => /^(bulletList|orderedList|taskList)$/i.test(name)) || '';
    const quoteType = names.find(name => /^(blockquote|blockQuote)$/i.test(name)) || '';
    const headingIndex = names.findIndex(name => name === 'heading');
    const blockType = parent.type?.name || '';
    const previousNonEmptyLine = getPreviousNonEmptyLine(beforeCursor);
    const base = {
        blockType,
        listType,
        beforeInBlock,
        afterInBlock,
        previousNonEmptyLine,
    };

    if (listType) {
        return {
            ...base,
            mode: 'list-item',
            insertionMode: 'inline',
            insideContainer: true,
            instruction: `光标位于 ${listType} 的列表项内部。只续写当前列表项的正文，不要输出列表编号、bullet、checkbox 或缩进。`,
        };
    }

    if (quoteType) {
        return {
            ...base,
            mode: 'quote',
            insertionMode: 'inline',
            insideContainer: true,
            instruction: '光标位于引用块内部。只续写引用正文，不要输出 > 或创建新的引用外壳。',
        };
    }

    if (blockType === 'codeBlock') {
        return {
            ...base,
            mode: 'code',
            insertionMode: 'inline',
            insideContainer: true,
            instruction: '光标位于代码块内部。只输出需要接在光标后的代码，不要输出 Markdown 围栏。',
        };
    }

    if (headingIndex >= 0 || blockType === 'heading') {
        const level = attrs[headingIndex]?.level || parent.attrs?.level || '';
        return {
            ...base,
            mode: 'heading',
            insertionMode: 'inline',
            insideContainer: true,
            instruction: `光标位于${level ? `${level} 级` : ''}标题内部。只补全标题文字，不要输出 #，也不要在这次补全中生成标题后的正文。`,
        };
    }

    const isEmptyBlock = !beforeInBlock && !afterInBlock;
    const followsLeadIn = isEmptyBlock && /[:：]\s*$/.test(previousNonEmptyLine);
    if (followsLeadIn) {
        return {
            ...base,
            mode: 'after-lead-in',
            insertionMode: 'block',
            insideContainer: false,
            instruction: '光标位于引导句后的空段落。根据相邻 Markdown 块决定使用正文或列表，不要默认创建编号外壳或嵌套列表。',
        };
    }

    return {
        ...base,
        mode: isEmptyBlock ? 'empty-paragraph' : 'paragraph',
        insertionMode: isEmptyBlock ? 'block' : 'inline',
        insideContainer: false,
        instruction: isEmptyBlock
            ? '光标位于空段落。延续相邻段落的结构和文体。'
            : '光标位于普通正文段落。自然接着当前句子或段落续写，不要无依据地切换成标题、列表、表格或引用。',
    };
}

/**
 * 从文档信号推断续写场景，避免所有文本都套用小说提示词。
 * @param {string} markdown - 完整 Markdown
 * @param {{mode:string}} format - 当前格式
 * @returns {'technical'|'structured'|'auto'} 写作场景
 */
function inferWritingMode(markdown, format) {
    const value = String(markdown || '');
    if (format.mode === 'code' || /```[\s\S]*?```/.test(value)) return 'technical';
    const contentLines = value.split('\n').filter(line => line.trim());
    const structuredLines = contentLines.filter(line => /^\s*(?:[-*+] |\d+[.)]\s+|>\s+)/.test(line));
    if (contentLines.length >= 4 && structuredLines.length / contentLines.length >= 0.35) return 'structured';
    return 'auto';
}

/**
 * 构建统一的 AI 续写上下文。
 * @param {import('@tiptap/pm/state').EditorState} state - 编辑器状态
 * @param {string} markdown - 当前完整 Markdown
 * @param {{serialize: Function}|null} serializer - Markdown serializer
 * @returns {{beforeCursor:string,afterCursor:string,outline:string,currentFormat:ReturnType<typeof inferCurrentFormat>,writingMode:string}}
 */
export function buildInlineCompletionContext(state, markdown, serializer = null) {
    const serialized = serializeAroundCursor(state, serializer, markdown);
    const { from } = state.selection;
    const before = serialized?.before ?? state.doc.textBetween(0, from, '\n', '\n');
    const after = serialized?.after ?? state.doc.textBetween(from, state.doc.content.size, '\n', '\n');
    const currentFormat = inferCurrentFormat(state, before);

    return {
        beforeCursor: clampMarkdownEnd(before, BEFORE_LIMIT),
        afterCursor: clampMarkdownStart(after, AFTER_LIMIT),
        outline: extractOutline(markdown),
        currentFormat,
        writingMode: inferWritingMode(markdown, currentFormat),
    };
}
