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
 * 判断重叠前缀是否足以证明模型复述了已有内容。
 * 中文短语信息密度高，两个连续汉字即可确认；拉丁文本使用更保守的四字符阈值。
 *
 * @param {string} overlap - 候选重叠文本。
 * @param {boolean} isWholeCurrentBlock - 是否完整覆盖当前光标前的段落文本。
 * @returns {boolean} 是否应删除该重叠。
 */
function isMeaningfulDuplicate(overlap, isWholeCurrentBlock) {
    const visible = overlap.trim();
    if (!visible) return false;
    if (isWholeCurrentBlock) return true;
    const cjkCount = (visible.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) || []).length;
    return cjkCount >= 2 || visible.length >= 4;
}

/**
 * 删除模型输出开头与光标前内容的最长精确重叠，只保留真正新增的续写。
 *
 * @param {string} completion - 模型输出。
 * @param {object} context - 当前续写上下文。
 * @returns {string} 去重结果。
 */
function removeDuplicatePrefix(completion, context) {
    const value = String(completion || '');
    const currentBlock = String(context.currentFormat?.beforeInBlock || '');
    const sources = [
        { text: currentBlock, isCurrentBlock: true },
        { text: String(context.beforeCursor || ''), isCurrentBlock: false },
    ].filter(source => source.text);
    const longestSource = Math.max(0, ...sources.map(source => source.text.length));
    const maxOverlap = Math.min(800, value.length, longestSource);

    for (let length = maxOverlap; length >= 1; length -= 1) {
        const overlap = value.slice(0, length);
        const duplicated = sources.some(source => (
            source.text.endsWith(overlap)
            && isMeaningfulDuplicate(overlap, source.isCurrentBlock && source.text.length === length)
        ));
        if (duplicated) return value.slice(length).trimStart();
    }
    return value;
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
 * 清理模型协议包装和与光标前内容重复的输出前缀。这里刻意不重写 Markdown 结构。
 * @param {string} raw - 模型原始文本
 * @param {object} context - 续写上下文
 * @param {number} maxChars - 最大字符数
 * @returns {{text:string,reason:'ok'|'empty-response'|'duplicate-only'}} 清理结果和空结果原因
 */
export function sanitizeCompletionWithMeta(raw, context, maxChars) {
    const unwrapped = stripProtocolWrappers(raw);
    if (!unwrapped) return { text: '', reason: 'empty-response' };
    const deduped = removeDuplicatePrefix(unwrapped, context);
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
