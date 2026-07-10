const DEFAULT_TARGET_CHARS = 24000;

/**
 * 把超大单块按行切分；仅在单行本身超限时退化为字符切片。
 * @param {string} block - Markdown 内容块
 * @param {number} targetChars - 单块目标长度
 * @returns {string[]}
 */
function splitOversizedBlock(block, targetChars) {
    if (block.length <= targetChars) return [block];
    const segments = [];
    let current = '';
    const lines = block.match(/[^\n]*\n|[^\n]+$/g) || [block];

    for (const line of lines) {
        if (line.length > targetChars) {
            if (current) segments.push(current);
            current = '';
            for (let index = 0; index < line.length; index += targetChars) {
                segments.push(line.slice(index, index + targetChars));
            }
            continue;
        }
        if (current && current.length + line.length > targetChars) {
            segments.push(current);
            current = '';
        }
        current += line;
    }
    if (current) segments.push(current);
    return segments;
}

/**
 * 按 Markdown 段落和围栏边界生成内容块，避免优先从代码块中间断开。
 * @param {string} content - 完整 Markdown
 * @returns {string[]}
 */
function createMarkdownBlocks(content) {
    const lines = content.match(/[^\n]*\n|[^\n]+$/g) || [];
    const blocks = [];
    let current = '';
    let fence = null;

    for (const line of lines) {
        const trimmed = line.trimStart();
        if (!fence && current && /^#{1,6}\s/.test(trimmed)) {
            blocks.push(current);
            current = '';
        }
        current += line;
        const fenceMatch = trimmed.match(/^(`{3,}|~{3,})/);
        if (fenceMatch && !fence) {
            fence = { char: fenceMatch[1][0], length: fenceMatch[1].length };
        } else if (fenceMatch
            && fenceMatch[1][0] === fence?.char
            && fenceMatch[1].length >= fence.length) {
            fence = null;
        }
        if (!fence && /^\s*$/.test(line)) {
            blocks.push(current);
            current = '';
        }
    }
    if (current) blocks.push(current);
    return blocks;
}

/**
 * 构建覆盖全文的文档上下文。所有 chunk 顺序拼接后必须等于原文。
 * @param {string} content - 文档全文
 * @param {{targetChars?:number}} [options] - 分块配置
 * @returns {{chunks:string[],originalLength:number,chunked:boolean}}
 */
export function buildDocumentContext(content, { targetChars = DEFAULT_TARGET_CHARS } = {}) {
    const source = String(content || '');
    if (!source) return { chunks: [''], originalLength: 0, chunked: false };

    const blocks = createMarkdownBlocks(source)
        .flatMap(block => splitOversizedBlock(block, targetChars));
    const chunks = [];
    let current = '';
    for (const block of blocks) {
        if (current && current.length + block.length > targetChars) {
            chunks.push(current);
            current = '';
        }
        current += block;
    }
    if (current) chunks.push(current);

    return {
        chunks: chunks.length ? chunks : [source],
        originalLength: source.length,
        chunked: chunks.length > 1,
    };
}
