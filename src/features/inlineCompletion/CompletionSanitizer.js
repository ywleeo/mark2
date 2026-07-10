/**
 * 去掉模型协议层包装，不修改编号、列表或正文语义。
 * @param {string} text - 模型输出
 * @returns {string} 去包装文本
 */
function stripProtocolWrappers(text) {
    let value = String(text || '').trim();
    const fence = value.match(/^```(?:markdown|md|text)?\s*([\s\S]*?)\s*```$/i);
    if (fence) value = fence[1].trim();
    return value
        .replace(/^(好的|可以|当然|以下是|下面是)[，,:：\s]*/u, '')
        .replace(/^Here(?:'| i)s (?:a|the)?\s*(?:continuation|completion)[:,\s]*/i, '')
        .trim();
}

/**
 * 只删除与光标前文本完全相同的输出前缀，避免模糊匹配误伤正文。
 * @param {string} completion - 模型输出
 * @param {string} beforeCursor - 光标前 Markdown
 * @returns {string} 去重结果
 */
function removeExactDuplicatePrefix(completion, beforeCursor) {
    const before = String(beforeCursor || '');
    let value = String(completion || '');
    const maxOverlap = Math.min(800, before.length, value.length);

    for (let length = maxOverlap; length >= 8; length -= 1) {
        if (before.endsWith(value.slice(0, length))) {
            value = value.slice(length);
            break;
        }
    }
    return value.trimStart();
}

/**
 * 在配置长度附近按完整句子或段落裁剪，避免截断到半个英文单词。
 * @param {string} text - 续写文本
 * @param {number} maxChars - 最大字符数
 * @returns {string} 裁剪结果
 */
function clampCompletionLength(text, maxChars) {
    const value = String(text || '');
    if (value.length <= maxChars) return value.trimEnd();

    const sliced = value.slice(0, maxChars);
    const boundaries = ['\n\n', '。', '！', '？', '.', '!', '?'];
    const lastBoundary = Math.max(...boundaries.map(boundary => sliced.lastIndexOf(boundary)));
    if (lastBoundary >= Math.floor(maxChars * 0.6)) {
        const boundaryLength = sliced.startsWith('\n\n', lastBoundary) ? 2 : 1;
        return sliced.slice(0, lastBoundary + boundaryLength).trimEnd();
    }

    const lastSpace = sliced.lastIndexOf(' ');
    return (lastSpace >= Math.floor(maxChars * 0.7) ? sliced.slice(0, lastSpace) : sliced).trimEnd();
}

/**
 * 为英文行内续写补齐必要空格，中文和块级续写不受影响。
 * @param {string} text - 已清理续写
 * @param {object} context - 续写上下文
 * @returns {string} 可插入文本
 */
function ensureInlineBoundary(text, context) {
    if (context.currentFormat?.insertionMode !== 'inline') return text;
    const before = String(context.beforeCursor || '');
    if (/[A-Za-z0-9]$/.test(before) && /^[A-Za-z0-9]/.test(text)) return ` ${text}`;
    return text;
}

/**
 * 清理模型协议包装和完全重复前缀。这里刻意不重写 Markdown 结构。
 * @param {string} raw - 模型原始文本
 * @param {object} context - 续写上下文
 * @param {number} maxChars - 最大字符数
 * @returns {{text:string,reason:'ok'|'empty-response'|'duplicate-only'}} 清理结果和空结果原因
 */
export function sanitizeCompletionWithMeta(raw, context, maxChars) {
    const unwrapped = stripProtocolWrappers(raw);
    if (!unwrapped) return { text: '', reason: 'empty-response' };
    const deduped = removeExactDuplicatePrefix(unwrapped, context.beforeCursor);
    if (!deduped) return { text: '', reason: 'duplicate-only' };
    return {
        text: ensureInlineBoundary(clampCompletionLength(deduped, maxChars), context),
        reason: 'ok',
    };
}

/**
 * 兼容只需要文本的调用方。
 * @param {string} raw - 模型原始文本
 * @param {object} context - 续写上下文
 * @param {number} maxChars - 最大字符数
 * @returns {string} 可插入续写
 */
export function sanitizeCompletion(raw, context, maxChars) {
    return sanitizeCompletionWithMeta(raw, context, maxChars).text;
}
