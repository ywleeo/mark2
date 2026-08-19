const DETAILS_OPEN_RE = /^<details(?:\s[^>]*)?>\s*$/i;
const DETAILS_CLOSE_RE = /^<\/details>\s*$/i;
const SUMMARY_OPEN_RE = /^<summary(?:\s[^>]*)?>/i;
const SUMMARY_BLOCK_RE = /^<summary(?:\s[^>]*)?>([\s\S]*?)<\/summary>\s*$/i;

/**
 * 读取 MarkdownIt 指定行去掉当前块缩进后的原始文本。
 * @param {object} state - MarkdownIt StateBlock
 * @param {number} line - 零基行号
 * @returns {string}
 */
function getLineText(state, line) {
    const start = state.bMarks[line] + state.tShift[line];
    return state.src.slice(start, state.eMarks[line]);
}

/**
 * 从 HTML 开始标签中读取一个基础属性值。
 * @param {string} openingTag - HTML 开始标签
 * @param {string} name - 属性名
 * @returns {string|null}
 */
function readHtmlAttribute(openingTag, name) {
    const pattern = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
    const match = openingTag.match(pattern);
    return match ? (match[1] ?? match[2] ?? match[3] ?? '') : null;
}

/**
 * 从 details 开始标签中提取需要往返保存的基础属性。
 * @param {string} openingTag - 完整 details 开始标签
 * @returns {{open:boolean,id:string|null,class:string|null,style:string|null}}
 */
function parseDetailsAttributes(openingTag) {
    return {
        open: /(?:^|\s)open(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?(?=\s|>)/i.test(openingTag),
        id: readHtmlAttribute(openingTag, 'id'),
        class: readHtmlAttribute(openingTag, 'class'),
        style: readHtmlAttribute(openingTag, 'style'),
    };
}

/**
 * 查找与开始行配对的 details 结束行，支持独立成行的嵌套 details。
 * @param {object} state - MarkdownIt StateBlock
 * @param {number} startLine - details 开始行
 * @param {number} endLine - 当前块解析上界
 * @returns {number}
 */
function findDetailsCloseLine(state, startLine, endLine) {
    let depth = 1;
    for (let line = startLine + 1; line < endLine; line += 1) {
        const text = getLineText(state, line).trim();
        if (DETAILS_OPEN_RE.test(text)) depth += 1;
        if (!DETAILS_CLOSE_RE.test(text)) continue;
        depth -= 1;
        if (depth === 0) return line;
    }
    return -1;
}

/**
 * 读取 details 的 summary，允许 summary 内容跨越多行。
 * @param {object} state - MarkdownIt StateBlock
 * @param {number} startLine - details 开始行
 * @param {number} closeLine - details 结束行
 * @returns {{content:string,startLine:number,endLine:number}|null}
 */
function readDetailsSummary(state, startLine, closeLine) {
    let summaryStart = startLine + 1;
    while (summaryStart < closeLine && state.isEmpty(summaryStart)) summaryStart += 1;
    if (summaryStart >= closeLine || !SUMMARY_OPEN_RE.test(getLineText(state, summaryStart).trim())) {
        return null;
    }

    for (let line = summaryStart; line < closeLine; line += 1) {
        const source = state.getLines(summaryStart, line + 1, state.blkIndent, true).trim();
        const match = source.match(SUMMARY_BLOCK_RE);
        if (match) {
            return {
                content: match[1].trim(),
                startLine: summaryStart,
                endLine: line + 1,
            };
        }
    }
    return null;
}

/**
 * 注册 details 专用块规则，让跨多个 Markdown block 的折叠内容保持正确嵌套。
 * @param {import('markdown-it')} md - MarkdownIt 实例
 */
export function addDetailsBlockMarkdownRule(md) {
    md.block.ruler.before('html_block', 'details_block', (state, startLine, endLine, silent) => {
        if (state.sCount[startLine] - state.blkIndent >= 4) return false;

        const openingTag = getLineText(state, startLine).trim();
        if (!DETAILS_OPEN_RE.test(openingTag)) return false;

        const closeLine = findDetailsCloseLine(state, startLine, endLine);
        if (closeLine < 0) return false;

        const summary = readDetailsSummary(state, startLine, closeLine);
        if (!summary) return false;
        if (silent) return true;

        const detailsOpen = state.push('details_open', 'details', 1);
        detailsOpen.map = [startLine, closeLine + 1];
        detailsOpen.meta = { attrs: parseDetailsAttributes(openingTag) };

        const summaryOpen = state.push('details_summary_open', 'summary', 1);
        summaryOpen.map = [summary.startLine, summary.endLine];

        const inline = state.push('inline', '', 0);
        inline.content = summary.content;
        inline.map = [summary.startLine, summary.endLine];
        inline.children = [];

        state.push('details_summary_close', 'summary', -1);

        const bodyStartLine = summary.endLine;
        if (bodyStartLine < closeLine) {
            state.md.block.tokenize(state, bodyStartLine, closeLine);
        }

        state.push('details_close', 'details', -1);
        state.line = closeLine + 1;
        return true;
    }, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
}
