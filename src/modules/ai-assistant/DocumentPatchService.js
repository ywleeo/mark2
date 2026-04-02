/**
 * 文档 Patch 服务。
 *
 * 当前只提供两种稳定写入模式：
 * - rewrite_full: 整篇重写
 * - replace_range: 直接替换指定行区间
 */

/**
 * 将文档转换为行数组，同时保留是否以换行结束。
 * @param {string} content - 原始文档内容
 * @returns {{lines:string[], hasTrailingNewline:boolean}} 行数据
 */
function splitDocumentLines(content) {
    const source = typeof content === 'string' ? content : '';
    const hasTrailingNewline = source.endsWith('\n');
    const lines = hasTrailingNewline ? source.slice(0, -1).split('\n') : source.split('\n');
    return {
        lines: source.length === 0 ? [] : lines,
        hasTrailingNewline,
    };
}

/**
 * 归一化空白，降低搜索时因换行或连续空格不同导致的 miss。
 * @param {string} text - 原始文本
 * @returns {string} 归一化后的文本
 */
function normalizeWhitespace(text) {
    return (typeof text === 'string' ? text : '').replace(/\s+/g, ' ').trim();
}

/**
 * 把行数组重新拼回文档内容。
 * @param {string[]} lines - 行数组
 * @param {boolean} hasTrailingNewline - 是否保留末尾换行
 * @returns {string} 文档内容
 */
function joinDocumentLines(lines, hasTrailingNewline) {
    const normalizedLines = Array.isArray(lines) ? lines : [];
    const nextContent = normalizedLines.join('\n');
    if (!hasTrailingNewline) {
        return nextContent;
    }
    return normalizedLines.length > 0 ? `${nextContent}\n` : '';
}

/**
 * 计算文档版本指纹，用于应用前校验内容是否已变化。
 * @param {string} content - 文档内容
 * @returns {string} 简单版本指纹
 */
export function getDocumentVersion(content) {
    const source = typeof content === 'string' ? content : '';
    let hash = 2166136261;
    for (let index = 0; index < source.length; index++) {
        hash ^= source.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return `${source.length}:${(hash >>> 0).toString(16)}`;
}

/**
 * 整篇重写文档。
 * @param {string} oldContent - 原始内容
 * @param {string} newContent - 新的完整内容
 * @returns {{newContent:string, mode:'rewrite_full'}} 应用结果
 */
export function rewriteFullDocument(oldContent, newContent) {
    return {
        mode: 'rewrite_full',
        newContent: typeof newContent === 'string' ? newContent : '',
    };
}

/**
 * 按行区间替换文档。
 * @param {string} oldContent - 原始内容
 * @param {number} startLine - 起始行（从 1 开始）
 * @param {number} endLine - 结束行（含）
 * @param {string} replacementContent - 替换后的片段内容
 * @returns {{newContent:string, mode:'replace_range', patchPlan:Array<object>}} 应用结果
 */
export function replaceDocumentRange(oldContent, startLine, endLine, replacementContent) {
    const source = typeof oldContent === 'string' ? oldContent : '';
    const { lines, hasTrailingNewline } = splitDocumentLines(source);

    if (!Number.isInteger(startLine) || !Number.isInteger(endLine)) {
        throw new Error('replace_range 缺少合法的 start_line / end_line');
    }
    if (startLine < 1 || endLine < startLine) {
        throw new Error('replace_range 的行范围无效');
    }
    if (lines.length === 0 || startLine > lines.length) {
        throw new Error(`replace_range 起始行 ${startLine} 超出当前文档范围`);
    }

    const normalizedEndLine = Math.min(endLine, lines.length);
    const replacementLines = splitDocumentLines(typeof replacementContent === 'string' ? replacementContent : '').lines;
    const nextLines = [...lines];
    nextLines.splice(startLine - 1, normalizedEndLine - startLine + 1, ...replacementLines);

    return {
        mode: 'replace_range',
        patchPlan: [{
            type: 'replace_range',
            startLine,
            endLine: normalizedEndLine,
            replacementLineCount: replacementLines.length,
        }],
        newContent: joinDocumentLines(nextLines, hasTrailingNewline),
    };
}

/**
 * 用旧片段在最新文档里重新定位行区间。
 * @param {string} content - 最新文档内容
 * @param {string} sourceExcerpt - 旧片段原文
 * @returns {{startLine:number,endLine:number}} 重定位后的行区间
 */
export function relocateRangeByExcerpt(content, sourceExcerpt) {
    const source = typeof content === 'string' ? content : '';
    const excerpt = typeof sourceExcerpt === 'string' ? sourceExcerpt : '';
    if (!excerpt.trim()) {
        throw new Error('replace_range 缺少 source_excerpt，无法在最新文档中重定位');
    }

    const exactIndex = source.indexOf(excerpt);
    let matchStart = exactIndex;
    let matchEnd = exactIndex === -1 ? -1 : exactIndex + excerpt.length;

    if (exactIndex === -1) {
        const normalizedSource = normalizeWhitespace(source);
        const normalizedExcerpt = normalizeWhitespace(excerpt);
        const normalizedIndex = normalizedSource.indexOf(normalizedExcerpt);
        if (normalizedIndex === -1) {
            throw new Error('文档内容已变化，且无法根据原片段在最新文档中重定位');
        }

        // 归一化命中后退化为逐行窗口搜索，避免字符映射复杂化。
        const { lines } = splitDocumentLines(source);
        const targetNormalized = normalizedExcerpt;
        for (let start = 0; start < lines.length; start++) {
            let merged = '';
            for (let end = start; end < lines.length; end++) {
                merged = merged ? `${merged}\n${lines[end]}` : lines[end];
                if (normalizeWhitespace(merged) === targetNormalized) {
                    return { startLine: start + 1, endLine: end + 1 };
                }
            }
        }
        throw new Error('文档内容已变化，且无法根据原片段在最新文档中重定位');
    }

    const prefix = source.slice(0, matchStart);
    const matched = source.slice(matchStart, matchEnd);
    const startLine = prefix.length === 0 ? 1 : prefix.split('\n').length;
    const matchedLineCount = matched.split('\n').length;
    return {
        startLine,
        endLine: startLine + matchedLineCount - 1,
    };
}
