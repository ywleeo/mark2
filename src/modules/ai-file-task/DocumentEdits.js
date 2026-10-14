/** AI 修改清单协议：精确定位原文，整批校验后才生成新正文。 */
const MAX_EDITS = 32;
const MAX_EDIT_CHARS = 200_000;

/** 清理并限制修改清单；空原文禁止隐式全局插入，空新文允许删除。 */
export function normalizeDocumentEdits(edits) {
    if (!Array.isArray(edits) || !edits.length || edits.length > MAX_EDITS) throw new Error('invalid');
    let chars = 0;
    return edits.map(edit => {
        if (typeof edit?.old_text !== 'string' || !edit.old_text.length || typeof edit.new_text !== 'string') throw new Error('invalid');
        chars += edit.old_text.length + edit.new_text.length;
        if (chars > MAX_EDIT_CHARS) throw new Error('invalid');
        if (edit.from !== undefined && (!Number.isSafeInteger(edit.from) || edit.from < 0)) throw new Error('invalid');
        return { old_text: edit.old_text, new_text: edit.new_text, ...(edit.from !== undefined ? { from: edit.from } : {}) };
    });
}

/** 仅为合法的历史回复恢复修改清单；不信任持久层额外的工具或角色字段。 */
export function restoreDocumentEdits(edits) {
    try { return normalizeDocumentEdits(edits); } catch { return []; }
}

/**
 * 在同一份当前源码中定位全部修改，拒绝缺失、重复或重叠原文。
 * 匹配失败不返回部分内容；原文之外的字符逐字保留。
 */
export function applyDocumentEdits(source, edits) {
    const text = String(source ?? '');
    const ranges = normalizeDocumentEdits(edits).map(edit => {
        // 已读取的原文引用有精确锚点，可区分重复段落；应用时仍逐字核对源码。
        const anchored = edit.from !== undefined;
        const from = anchored ? edit.from : text.indexOf(edit.old_text);
        if (from < 0 || text.slice(from, from + edit.old_text.length) !== edit.old_text) throw new Error('missing');
        if (!anchored && text.indexOf(edit.old_text, from + 1) >= 0) throw new Error('ambiguous');
        return { from, to: from + edit.old_text.length, insert: edit.new_text };
    }).sort((a, b) => a.from - b.from);
    for (let index = 1; index < ranges.length; index += 1) {
        if (ranges[index].from < ranges[index - 1].to) throw new Error('overlap');
    }
    let content = text;
    for (const range of [...ranges].reverse()) content = content.slice(0, range.from) + range.insert + content.slice(range.to);
    return { content, ranges };
}

/**
 * 合并尚未应用的提案：保留互不相交的修改，新提案更新覆盖同一范围的旧稿。
 * 重复调用不会累积重复替换；新一批内部仍必须精确匹配且互不重叠。
 */
export function mergeDocumentEdits(source, previous, next) {
    const incoming = normalizeDocumentEdits(next);
    const incomingRanges = applyDocumentEdits(source, incoming).ranges;
    const retained = restoreDocumentEdits(previous).filter(edit => {
        const range = applyDocumentEdits(source, [edit]).ranges[0];
        return !incomingRanges.some(incoming => incoming.from < range.to && range.from < incoming.to);
    });
    const merged = normalizeDocumentEdits([...retained, ...incoming]);
    applyDocumentEdits(source, merged);
    return merged;
}

/** 创建当前焦点文档的应用入口，源路径和生命周期不匹配时拒绝修改。 */
export function createDocumentEditApplier({ getTarget }) {
    return ({ path, documentId = '', edits, replacement }) => {
        const target = getTarget();
        if (!target || target.path !== path || (documentId && target.documentId !== documentId)) throw new Error('differentDocument');
        if (typeof replacement === 'string' && !replacement.trim()) throw new Error('invalid');
        const original = target.getContent();
        const content = typeof replacement === 'string' ? replacement : applyDocumentEdits(original, edits).content;
        if (content === original) return false;
        if (!target.replace(content, original)) throw new Error('unavailable');
        return true;
    };
}
