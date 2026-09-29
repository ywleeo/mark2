/**
 * 将译文转换为 Markdown 引用块源码。
 * 每一行都显式带 quote 标记，保证多段译文仍属于同一个引用块。
 * @param {string} translation - AI 返回的译文。
 * @returns {string} 可交给 Markdown parser 的引用块源码。
 */
export function buildTranslationQuoteMarkdown(translation) {
    const text = String(translation || '').trim();
    if (!text) return '';
    return text
        .split(/\r?\n/)
        .map(line => line ? `> ${line}` : '>')
        .join('\n');
}

/**
 * 找到选区末端所属顶层块之后的位置。
 * 译文应落在完整段落、列表或表格之后，不能从句子中间劈开原文结构。
 * @param {import('@tiptap/pm/model').Node} doc - 当前 ProseMirror 文档。
 * @param {number} position - 选区末端位置。
 * @returns {number} 可插入顶层 block 的安全位置。
 */
export function resolveTranslationInsertionPosition(doc, position) {
    if (!doc?.resolve) return 0;
    const clamped = Math.max(0, Math.min(Number(position) || 0, doc.content.size));
    const resolved = doc.resolve(clamped);
    for (let depth = resolved.depth; depth > 0; depth -= 1) {
        if (resolved.node(depth - 1).type.name === 'doc') {
            return resolved.after(depth);
        }
    }
    return clamped;
}
