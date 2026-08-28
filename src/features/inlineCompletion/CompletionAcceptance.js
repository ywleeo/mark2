import { TextSelection } from '@tiptap/pm/state';

/**
 * 接受内联续写，并根据生成上下文选择文本或 Markdown 块插入。
 *
 * 行内建议必须使用文本 transaction，避免 Markdown parser 把一句续写解析成
 * paragraph 节点并拆开当前段落；块级建议仍保留完整 Markdown 结构。
 * @param {object} options - 接受建议所需依赖
 * @param {import('@tiptap/pm/view').EditorView} options.view - ProseMirror 视图
 * @param {string} options.text - 待插入续写
 * @param {number|null} options.pos - 生成建议时的光标位置
 * @param {'inline'|'block'} options.insertionMode - 插入模式
 * @param {Function|null} options.insertInlineAtCursor - 行内内容插入器
 * @param {Function|null} options.insertMarkdownAtCursor - 块级 Markdown 插入器
 * @param {object|null} options.clearMetaKey - 清除 ghost text 使用的 plugin key
 * @returns {boolean} 是否完成插入
 */
export function acceptCompletion({
    view,
    text,
    pos,
    insertionMode = 'inline',
    insertInlineAtCursor = null,
    insertMarkdownAtCursor = null,
    clearMetaKey = null,
}) {
    if (!view || view.isDestroyed || !text) return false;

    const insertPos = Math.min(pos ?? view.state.selection.from, view.state.doc.content.size);
    let transaction = view.state.tr.setSelection(TextSelection.create(view.state.doc, insertPos));
    if (clearMetaKey) transaction = transaction.setMeta(clearMetaKey, { type: 'clear' });
    view.dispatch(transaction);

    if (insertionMode === 'inline' && typeof insertInlineAtCursor === 'function') {
        insertInlineAtCursor(text);
        return true;
    }
    if (typeof insertMarkdownAtCursor === 'function') {
        insertMarkdownAtCursor(text);
        return true;
    }

    const fallback = view.state.tr.insertText(text, insertPos);
    fallback.setSelection(TextSelection.create(fallback.doc, insertPos + text.length));
    view.dispatch(fallback);
    return true;
}
