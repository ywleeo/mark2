/**
 * markdown-it plugin: CJK emphasis fix
 *
 * 修复 CJK 文本中强调标记与 Unicode 标点组合时无法正确解析的问题。
 *
 * CommonMark 的 flanking delimiter run 规则在 CJK 上下文中过于严格，
 * 导致以下场景不被识别为粗体/斜体：
 *   - **"情绪洗钱"**（CJK + Unicode 引号）
 *   - **目标受众：**25（CJK 全角标点 + 数字）
 *
 * 修复方式：在 flanking 检测中，将 CJK 字符（含全角标点）视为"边界字符"，
 * 对称地放宽 left_flanking 和 right_flanking 的判定条件。
 */

function isCJK(code) {
    return (code >= 0x3000 && code <= 0x303F)      // CJK Symbols and Punctuation（、。「」《》等）
        || (code >= 0x4E00 && code <= 0x9FFF)      // CJK Unified Ideographs
        || (code >= 0x3400 && code <= 0x4DBF)      // CJK Extension A
        || (code >= 0x20000 && code <= 0x2A6DF)    // CJK Extension B
        || (code >= 0xF900 && code <= 0xFAFF)      // CJK Compatibility Ideographs
        || (code >= 0x3040 && code <= 0x309F)      // Hiragana
        || (code >= 0x30A0 && code <= 0x30FF)      // Katakana
        || (code >= 0xAC00 && code <= 0xD7AF)      // Hangul Syllables
        || (code >= 0xFE30 && code <= 0xFE4F)      // CJK Compatibility Forms
        || (code >= 0xFF00 && code <= 0xFFEF);     // Halfwidth and Fullwidth Forms（：、！等全角）
}

export function markdownItCjkEmphasis(md) {
    const { isWhiteSpace, isPunctChar, isMdAsciiPunct } = md.utils;

    md.inline.State.prototype.scanDelims = function (start, canSplitWord) {
        const max = this.posMax;
        const marker = this.src.charCodeAt(start);

        // treat beginning of the line as a whitespace
        const lastChar = start > 0 ? this.src.charCodeAt(start - 1) : 0x20;

        let pos = start;
        while (pos < max && this.src.charCodeAt(pos) === marker) { pos++; }
        const count = pos - start;

        // treat end of the line as a whitespace
        const nextChar = pos < max ? this.src.charCodeAt(pos) : 0x20;

        const isLastPunctChar = isMdAsciiPunct(lastChar) || isPunctChar(String.fromCharCode(lastChar));
        const isNextPunctChar = isMdAsciiPunct(nextChar) || isPunctChar(String.fromCharCode(nextChar));

        const isLastWhiteSpace = isWhiteSpace(lastChar);
        const isNextWhiteSpace = isWhiteSpace(nextChar);

        // CJK fix: treat CJK as boundary characters for flanking check
        const isLastCJK = isCJK(lastChar);
        const isNextCJK = isCJK(nextChar);

        // 对称放宽：只要 delimiter 任一侧是 CJK 字符（含全角标点），就不受 punct 限制
        const left_flanking =
            !isNextWhiteSpace && (!isNextPunctChar || isLastWhiteSpace || isLastPunctChar || isLastCJK || isNextCJK);
        const right_flanking =
            !isLastWhiteSpace && (!isLastPunctChar || isNextWhiteSpace || isNextPunctChar || isNextCJK || isLastCJK);

        const can_open  = left_flanking  && (canSplitWord || !right_flanking || isLastPunctChar);
        const can_close = right_flanking && (canSplitWord || !left_flanking  || isNextPunctChar);

        return { can_open, can_close, length: count };
    };
}
