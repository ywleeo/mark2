import MarkdownIt from 'markdown-it';
import markdownItTaskLists from 'markdown-it-task-lists';
import markdownItMultimdTable from 'markdown-it-multimd-table';
import texmath from 'markdown-it-texmath';
import katex from 'katex';
import { MarkdownParser, MarkdownSerializer, MarkdownSerializerState } from 'prosemirror-markdown';
import { DOMParser as PMDOMParser } from '@tiptap/pm/model';
import { markdownItCjkEmphasis } from '../utils/markdownItCjkEmphasis.js';

function listIsTight(tokens, i) {
    while (++i < tokens.length) {
        if (tokens[i].type !== 'list_item_open') {
            return Boolean(tokens[i].hidden);
        }
    }
    return false;
}

function withoutTrailingNewline(text) {
    if (!text) return '';
    return text.endsWith('\n') ? text.slice(0, -1) : text;
}

function getSourcepos(token) {
    if (!token || !Array.isArray(token.map)) {
        return null;
    }
    const [start, end] = token.map;
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
        return null;
    }
    return `${start + 1}:${end}`;
}

function createMarkdownTokenizer() {
    const md = new MarkdownIt({
        html: true,
        breaks: true,
        linkify: false,
    });

    md.use(markdownItMultimdTable, {
        multiline: true,
        rowspan: true,
        headerless: true,
        multibody: true,
        autolabel: true,
    });

    md.use(markdownItTaskLists, {
        enabled: true,
        label: true,
        labelAfter: true,
    });

    md.use(markdownItCjkEmphasis);

    md.use(texmath, {
        engine: katex,
        delimiters: 'dollars',
        katexOptions: { throwOnError: false },
    });

    return md;
}

function getTaskItemChecked(tokens, index) {
    for (let i = index + 1; i < tokens.length; i += 1) {
        const token = tokens[i];
        if (token.type === 'list_item_close') {
            break;
        }
        if (token.type === 'inline' && Array.isArray(token.children)) {
            const checkbox = token.children.find(child =>
                child.type === 'html_inline' &&
                child.content.includes('task-list-item-checkbox')
            );
            if (checkbox) {
                return checkbox.content.includes('checked');
            }
        }
    }
    return false;
}


function shouldSkipInlineHtml(content) {
    if (!content) return false;
    return content.includes('task-list-item-checkbox');
}

// 支持的行内 HTML 标签（与 HtmlSupport.js 中的 HtmlInline 保持一致）
const SUPPORTED_INLINE_TAGS = new Set([
    'span', 'kbd', 'small', 'mark', 'abbr', 'cite', 'time', 'var', 'samp', 'dfn', 'ins', 'del'
]);

// 解析 HTML 开始标签，返回 { tag, attrs } 或 null
function parseHtmlOpenTag(html) {
    const match = html.match(/^<([a-zA-Z][a-zA-Z0-9]*)\s*([^>]*)?\/?>/);
    if (!match) return null;
    const tag = match[1].toLowerCase();
    if (!SUPPORTED_INLINE_TAGS.has(tag)) return null;

    const attrsString = match[2] || '';
    const attrs = {};

    // 解析属性：style="..." class="..." id="..."
    const attrRegex = /(style|class|id)\s*=\s*["']([^"']*)["']/gi;
    let attrMatch;
    while ((attrMatch = attrRegex.exec(attrsString)) !== null) {
        attrs[attrMatch[1].toLowerCase()] = attrMatch[2];
    }

    return { tag, attrs };
}

// 解析 HTML 结束标签，返回标签名或 null
function parseHtmlCloseTag(html) {
    const match = html.match(/^<\/([a-zA-Z][a-zA-Z0-9]*)>/);
    if (!match) return null;
    const tag = match[1].toLowerCase();
    return SUPPORTED_INLINE_TAGS.has(tag) ? tag : null;
}

function parseHtmlFragment(schema, html, isBlock) {
    if (typeof document === 'undefined') {
        return null;
    }
    const wrapper = document.createElement(isBlock ? 'div' : 'span');
    wrapper.innerHTML = html;
    const parser = PMDOMParser.fromSchema(schema);
    return parser.parseSlice(wrapper, { preserveWhitespace: true });
}

function extractInlineText(html) {
    if (typeof document === 'undefined') {
        return '';
    }
    const wrapper = document.createElement('span');
    wrapper.innerHTML = html;
    return wrapper.textContent || '';
}

function applyMarksToInline(node, marks) {
    if (!marks || marks.length === 0 || !node.isInline) {
        return node;
    }
    let nextMarks = node.marks;
    marks.forEach(mark => {
        nextMarks = mark.addToSet(nextMarks);
    });
    return node.mark(nextMarks);
}

export function createMarkdownParser(schema) {
    const tokenizer = createMarkdownTokenizer();
    const hasMark = (name) => Boolean(schema.marks && schema.marks[name]);
    const tokens = {
        blockquote: { block: 'blockquote', getAttrs: tok => ({ sourcepos: getSourcepos(tok) }) },
        paragraph: { block: 'paragraph', getAttrs: tok => ({ sourcepos: getSourcepos(tok) }) },
        list_item: { block: 'listItem', getAttrs: tok => ({ sourcepos: getSourcepos(tok) }) },
        bullet_list: {
            block: 'bulletList',
            getAttrs: (tok, allTokens, index) => ({
                tight: listIsTight(allTokens, index),
                sourcepos: getSourcepos(tok),
            }),
        },
        ordered_list: {
            block: 'orderedList',
            getAttrs: (tok, allTokens, index) => ({
                order: Number(tok.attrGet('start')) || 1,
                tight: listIsTight(allTokens, index),
                sourcepos: getSourcepos(tok),
            }),
        },
        heading: {
            block: 'heading',
            getAttrs: tok => ({
                level: Number(tok.tag.slice(1)) || 1,
                sourcepos: getSourcepos(tok),
            }),
        },
        code_block: { block: 'codeBlock', noCloseToken: true, getAttrs: tok => ({ sourcepos: getSourcepos(tok) }) },
        fence: {
            block: 'codeBlock',
            getAttrs: tok => ({ language: (tok.info || '').trim() || null, sourcepos: getSourcepos(tok) }),
            noCloseToken: true,
        },
        hr: { node: 'horizontalRule', getAttrs: tok => ({ sourcepos: getSourcepos(tok) }) },
        image: {
            node: 'image',
            getAttrs: tok => {
                const src = tok.attrGet('src') || '';
                return {
                    src,
                    alt: tok.children?.[0]?.content || null,
                    title: tok.attrGet('title') || null,
                    dataOriginalSrc: src || null,
                    sourcepos: getSourcepos(tok),
                };
            },
        },
        hardbreak: { node: 'hardBreak' },
        softbreak: { node: 'hardBreak' },

        em: hasMark('italic') ? { mark: 'italic' } : { ignore: true },
        strong: hasMark('bold') ? { mark: 'bold' } : { ignore: true },
        s: hasMark('strike') ? { mark: 'strike' } : { ignore: true },
        link: hasMark('link')
            ? {
                mark: 'link',
                getAttrs: tok => ({
                    href: tok.attrGet('href'),
                    title: tok.attrGet('title') || null,
                }),
            }
            : { ignore: true },
        code_inline: hasMark('code') ? { mark: 'code', noCloseToken: true } : { ignore: true, noCloseToken: true },

        table: { block: 'table', getAttrs: tok => ({ sourcepos: getSourcepos(tok) }) },
        thead: { ignore: true },
        tbody: { ignore: true },
        tr: { block: 'tableRow', getAttrs: tok => ({ sourcepos: getSourcepos(tok) }) },
        th: { block: 'tableHeader', getAttrs: tok => ({ sourcepos: getSourcepos(tok) }) },
        td: { block: 'tableCell', getAttrs: tok => ({ sourcepos: getSourcepos(tok) }) },

        html_inline: { ignore: true, noCloseToken: true },
        html_block: { ignore: true, noCloseToken: true },

        math_inline: { node: 'mathInline', noCloseToken: true, getAttrs: tok => ({ latex: tok.content || '' }) },
        math_inline_double: { node: 'mathBlock', noCloseToken: true, getAttrs: tok => ({ latex: tok.content || '' }) },
        math_block: { node: 'mathBlock', noCloseToken: true, getAttrs: tok => ({ latex: tok.content || '' }) },
        math_block_eqno: { node: 'mathBlock', noCloseToken: true, getAttrs: tok => ({ latex: tok.content || '' }) },
    };

    const parser = new MarkdownParser(schema, tokenizer, tokens);



    const codeBlockType = schema.nodes.codeBlock;
    const mermaidType = schema.nodes.mermaidBlock;
    const csvBlockType = schema.nodes.csvBlock;
    const hardBreakType = schema.nodes.hardBreak;
    const bulletListType = schema.nodes.bulletList;
    const taskListType = schema.nodes.taskList;
    const listItemType = schema.nodes.listItem;
    const taskItemType = schema.nodes.taskItem;
    const paragraphType = schema.nodes.paragraph;
    const tableCellType = schema.nodes.tableCell;
    const tableHeaderType = schema.nodes.tableHeader;
    const cellTypeNames = new Set([
        tableCellType?.name,
        tableHeaderType?.name,
    ].filter(Boolean));

    if (parser.tokenHandlers.fence && codeBlockType) {
        parser.tokenHandlers.fence = (state, tok) => {
            const info = (tok.info || '').trim().toLowerCase();
            const content = withoutTrailingNewline(tok.content || '');
            if (info.startsWith('mermaid') && mermaidType) {
                state.addNode(mermaidType, { code: content, sourcepos: getSourcepos(tok) });
                return;
            }
            if (info === 'csv' && csvBlockType) {
                state.addNode(csvBlockType, { csv: content });
                return;
            }
            state.openNode(codeBlockType, { language: info || null, sourcepos: getSourcepos(tok) });
            state.addText(content);
            state.closeNode();
        };
    }

    if (parser.tokenHandlers.code_block && codeBlockType) {
        parser.tokenHandlers.code_block = (state, tok) => {
            const content = withoutTrailingNewline(tok.content || '');
            state.openNode(codeBlockType, { language: null, sourcepos: getSourcepos(tok) });
            state.addText(content);
            state.closeNode();
        };
    }

    if (parser.tokenHandlers.softbreak && hardBreakType) {
        parser.tokenHandlers.softbreak = state => {
            state.addNode(hardBreakType, null);
        };
    }

    if (parser.tokenHandlers.bullet_list_open && bulletListType) {
        parser.tokenHandlers.bullet_list_open = (state, tok, allTokens, index) => {
            const className = tok.attrGet('class') || '';
            const isTaskList = className.includes('contains-task-list') && taskListType;
            const nodeType = isTaskList ? taskListType : bulletListType;
            const attrs = isTaskList
                ? { sourcepos: getSourcepos(tok) }
                : { tight: listIsTight(allTokens, index), sourcepos: getSourcepos(tok) };
            state.openNode(nodeType, attrs);
        };
        parser.tokenHandlers.bullet_list_close = state => state.closeNode();
    }


    if (parser.tokenHandlers.list_item_open && listItemType) {
        parser.tokenHandlers.list_item_open = (state, tok, allTokens, index) => {
            const className = tok.attrGet('class') || '';
            const isTaskItem = className.includes('task-list-item') && taskItemType;
            const nodeType = isTaskItem ? taskItemType : listItemType;
            const attrs = isTaskItem ? {
                checked: getTaskItemChecked(allTokens, index),
                sourcepos: getSourcepos(tok),
            } : { sourcepos: getSourcepos(tok) };
            state.openNode(nodeType, attrs);
        };
        parser.tokenHandlers.list_item_close = state => state.closeNode();
    }

    // 用于追踪打开的 HTML 标签 mark
    const htmlMarkStack = [];
    const htmlInlineMark = schema.marks.htmlInline;
    const htmlSpanMark = schema.marks.htmlSpan;

    if (parser.tokenHandlers.html_inline) {
        parser.tokenHandlers.html_inline = (state, tok) => {
            if (shouldSkipInlineHtml(tok.content)) {
                return;
            }

            const content = tok.content || '';

            // 检测结束标签
            const closeTag = parseHtmlCloseTag(content);
            if (closeTag) {
                // 找到匹配的开始标签并关闭 mark
                for (let i = htmlMarkStack.length - 1; i >= 0; i--) {
                    if (htmlMarkStack[i].tag === closeTag) {
                        const markInfo = htmlMarkStack.splice(i, 1)[0];
                        state.closeMark(markInfo.mark);
                        break;
                    }
                }
                return;
            }

            // 检测开始标签
            const openTag = parseHtmlOpenTag(content);
            if (openTag) {
                const { tag, attrs } = openTag;
                // 优先使用 htmlSpan（如果是 span 标签），否则用 htmlInline
                let markType = null;
                let markAttrs = {};

                if (tag === 'span' && htmlSpanMark) {
                    markType = htmlSpanMark;
                    markAttrs = {
                        style: attrs.style || null,
                        class: attrs.class || null,
                        id: attrs.id || null,
                    };
                } else if (htmlInlineMark) {
                    markType = htmlInlineMark;
                    markAttrs = {
                        tag,
                        style: attrs.style || null,
                        class: attrs.class || null,
                        id: attrs.id || null,
                    };
                }

                if (markType) {
                    const mark = markType.create(markAttrs);
                    htmlMarkStack.push({ tag, mark });
                    state.openMark(mark);
                }
                return;
            }

            // 其他 HTML（如注释、自闭合标签等），尝试提取文本
            const inlineText = extractInlineText(content);
            if (inlineText) {
                state.addText(inlineText);
                return;
            }

            // 回退：尝试解析为 HTML fragment
            const slice = parseHtmlFragment(schema, content, false);
            if (!slice) {
                return;
            }
            slice.content.forEach(node => {
                state.push(applyMarksToInline(node, state.top().marks));
            });
        };
    }

    if (parser.tokenHandlers.html_block) {
        parser.tokenHandlers.html_block = (state, tok) => {
            const slice = parseHtmlFragment(schema, tok.content || '', true);
            if (!slice) {
                return;
            }
            slice.content.forEach(node => {
                state.push(node);
            });
        };
    }

    if (parser.tokenHandlers.inline && paragraphType && cellTypeNames.size > 0) {
        const originalInline = parser.tokenHandlers.inline;
        parser.tokenHandlers.inline = (state, tok, tokens, index) => {
            const top = state.top();
            if (top && cellTypeNames.has(top.type?.name)) {
                state.openNode(paragraphType, null);
                state.parseTokens(tok.children || []);
                state.closeNode();
                return;
            }
            return originalInline(state, tok, tokens, index);
        };
    }

    return parser;
}

function escapeHtmlAttribute(value) {
    return String(value).replace(/"/g, '&quot;');
}

function serializeHtmlAttributes(attrs, extra = {}) {
    const merged = { ...attrs, ...extra };
    const entries = Object.entries(merged).filter(([, value]) => value !== null && value !== undefined && value !== '');
    if (entries.length === 0) {
        return '';
    }
    const parts = entries.map(([key, value]) => `${key}="${escapeHtmlAttribute(value)}"`);
    return ` ${parts.join(' ')}`;
}

function escapeTableCell(value) {
    return value.replace(/\|/g, '\\|');
}

function renderInlineToString(state, node) {
    const subState = new MarkdownSerializerState(state.nodes, state.marks, state.options);
    subState.renderContent(node);
    return subState.out.trim();
}

function renderInlineContent(state, node) {
    const subState = new MarkdownSerializerState(state.nodes, state.marks, state.options);
    subState.renderInline(node, false);
    return subState.out.trim();
}

export function createMarkdownSerializer(schema) {
    void schema;
    const nodes = {
        blockquote(state, node) {
            state.wrapBlock('> ', null, node, () => state.renderContent(node));
        },
        paragraph(state, node) {
            state.renderInline(node);
            state.closeBlock(node);
        },
        heading(state, node) {
            const level = node.attrs?.level || 1;
            state.write(state.repeat('#', level) + ' ');
            state.renderInline(node, false);
            state.closeBlock(node);
        },
        horizontalRule(state, node) {
            state.write(node.attrs?.markup || '---');
            state.closeBlock(node);
        },
        bulletList(state, node) {
            const bullet = node.attrs?.bullet || '-';
            node.attrs = { ...node.attrs, tight: true };
            state.renderList(node, '  ', () => `${bullet} `);
        },
        orderedList(state, node) {
            const start = node.attrs?.order || 1;
            const maxW = String(start + node.childCount - 1).length;
            const space = state.repeat(' ', maxW + 2);
            node.attrs = { ...node.attrs, tight: true };
            state.renderList(node, space, i => {
                const nStr = String(start + i);
                return state.repeat(' ', maxW - nStr.length) + `${nStr}. `;
            });
        },
        listItem(state, node) {
            state.renderContent(node);
        },
        taskList(state, node) {
            node.attrs = { ...node.attrs, tight: true };
            state.renderList(node, '  ', () => '- ');
        },
        taskItem(state, node) {
            const checked = node.attrs?.checked ? 'x' : ' ';
            const content = [];
            node.forEach(child => content.push(child));

            const main = content.shift() || null;
            const hasMain = Boolean(main);
            const nested = content.filter(Boolean);

            if (hasMain) {
                const mainText = renderInlineContent(state, main);
                if (mainText) {
                    state.write(`[${checked}] ${mainText}`);
                } else {
                    state.write(`[${checked}]`);
                }
            } else {
                state.write(`[${checked}]`);
            }

            if (nested.length > 0) {
                nested.forEach(child => {
                    const childMarkdown = renderInlineToString(state, child);
                    if (childMarkdown) {
                        state.write(`\n  ${childMarkdown.replace(/\n/g, '\n  ')}`);
                    }
                });
            }
        },
        codeBlock(state, node) {
            const language = node.attrs?.language || '';
            const backticks = node.textContent.match(/`{3,}/gm);
            const fence = backticks ? backticks.sort().slice(-1)[0] + '`' : '```';
            state.write(fence + language + '\n');
            state.text(node.textContent, false);
            state.write('\n');
            state.write(fence);
            state.closeBlock(node);
        },
        mermaidBlock(state, node) {
            const code = node.attrs?.code || '';
            state.write('```mermaid\n');
            state.text(code, false);
            state.write('\n```');
            state.closeBlock(node);
        },
        csvBlock(state, node) {
            const csv = node.attrs?.csv || '';
            state.write('```csv\n');
            state.text(csv, false);
            state.write('\n```');
            state.closeBlock(node);
        },
        mathBlock(state, node) {
            const latex = node.attrs?.latex || '';
            state.write('$$\n');
            state.text(latex, false);
            state.write('\n$$');
            state.closeBlock(node);
        },
        mathInline(state, node) {
            const latex = node.attrs?.latex || '';
            state.write(`$${latex}$`);
        },
        image(state, node) {
            const alt = state.esc(node.attrs?.alt || '');
            const title = node.attrs?.title;
            const originalSrc = node.attrs?.dataOriginalSrc || node.attrs?.src || '';
            const needsAngle = /\s|[<>]/.test(originalSrc);
            const escapedSrc = needsAngle ? `<${originalSrc.replace(/>/g, '\\>')}>` : originalSrc;
            const titlePart = title ? ` "${String(title).replace(/"/g, '\\"')}"` : '';
            state.write(`![${alt}](${escapedSrc}${titlePart})`);
        },
        hardBreak(state, node, parent, index) {
            for (let i = index + 1; i < parent.childCount; i += 1) {
                if (parent.child(i).type !== node.type) {
                    state.write('\n');
                    return;
                }
            }
        },
        table(state, node) {
            const rows = [];
            node.forEach(row => rows.push(row));
            if (rows.length === 0) {
                state.closeBlock(node);
                return;
            }
            const headerRowIndex = rows.findIndex(row => {
                let hasHeader = false;
                row.forEach(cell => {
                    if (cell.type.name === 'tableHeader') {
                        hasHeader = true;
                    }
                });
                return hasHeader;
            });

            const headerRow = headerRowIndex >= 0 ? rows[headerRowIndex] : rows[0];
            const bodyRows = headerRowIndex >= 0
                ? rows.filter((_, idx) => idx !== headerRowIndex)
                : rows.slice(1);

            const renderRow = row => {
                const cells = [];
                row.forEach(cell => {
                    let content = renderInlineToString(state, cell);
                    content = content.replace(/\n+/g, '<br>');
                    content = escapeTableCell(content);
                    cells.push(content || '');
                });
                return `| ${cells.join(' | ')} |`;
            };

            const headerLine = renderRow(headerRow);
            const headerCellCount = headerRow.childCount || 1;
            const separator = `| ${Array.from({ length: headerCellCount }, () => '---').join(' | ')} |`;

            state.write(headerLine);
            state.write(`\n${separator}`);
            bodyRows.forEach(row => {
                state.write(`\n${renderRow(row)}`);
            });
            state.closeBlock(node);
        },
        tableRow(state, node) {
            state.renderContent(node);
        },
        tableCell(state, node) {
            state.renderContent(node);
        },
        tableHeader(state, node) {
            state.renderContent(node);
        },
        htmlDiv(state, node) {
            const attrs = serializeHtmlAttributes(node.attrs || {});
            state.write(`<div${attrs}>`);
            state.renderContent(node);
            state.write('</div>');
            state.closeBlock(node);
        },
        text(state, node) {
            if (state.inAutolink) {
                state.text(node.text, false);
            } else {
                // Minimal escaping: only escape characters that would change
                // markdown structure. Skip [] to avoid ugly \[\] in output.
                let text = node.text;
                text = text.replace(/[\\`*~_]/g, (m, i) => {
                    // Don't escape _ between word characters (e.g. some_var)
                    if (m === '_' && i > 0 && i + 1 < text.length && /\w/.test(text[i - 1]) && /\w/.test(text[i + 1])) {
                        return m;
                    }
                    return '\\' + m;
                });
                if (state.atBlockStart) {
                    text = text.replace(/^(\+[ ]|[\-*>])/, '\\$&');
                    text = text.replace(/^(\s*)(#{1,6})(\s|$)/, '$1\\$2$3');
                    text = text.replace(/^(\s*\d+)\.\s/, '$1\\. ');
                }
                state.text(text, false);
            }
        },
    };

    const marks = {
        italic: { open: '*', close: '*', mixable: true, expelEnclosingWhitespace: true },
        bold: { open: '**', close: '**', mixable: true, expelEnclosingWhitespace: true },
        strike: { open: '~~', close: '~~', mixable: true },
        code: {
            open: (_state, _mark, parent, index) => backticksFor(parent.child(index), -1),
            close: (_state, _mark, parent, index) => backticksFor(parent.child(index - 1), 1),
            escape: false,
        },
        link: {
            open(state, mark, parent, index) {
                state.inAutolink = isPlainUrl(mark, parent, index);
                return state.inAutolink ? '<' : '[';
            },
            close(state, mark) {
                const { inAutolink } = state;
                state.inAutolink = undefined;
                if (inAutolink) {
                    return '>';
                }
                const href = mark.attrs?.href || '';
                const title = mark.attrs?.title;
                const needsAngle = /\s|[<>]/.test(href);
                const escapedHref = needsAngle ? `<${href.replace(/>/g, '\\>')}>` : href.replace(/[\(\)"]/g, '\\$&');
                const titlePart = title ? ` "${String(title).replace(/"/g, '\\"')}"` : '';
                return `](${escapedHref}${titlePart})`;
            },
            mixable: true,
        },
        htmlSpan: {
            open(_state, mark) {
                const attrs = serializeHtmlAttributes(mark.attrs || {});
                return `<span${attrs}>`;
            },
            close() {
                return '</span>';
            },
            mixable: true,
            escape: false,
        },
        htmlInline: {
            open(_state, mark) {
                const { tag, ...rest } = mark.attrs || {};
                const attrs = serializeHtmlAttributes(rest);
                const safeTag = tag || 'span';
                return `<${safeTag}${attrs}>`;
            },
            close(_state, mark) {
                const safeTag = mark.attrs?.tag || 'span';
                return `</${safeTag}>`;
            },
            mixable: true,
            escape: false,
        },
    };

    return new MarkdownSerializer(nodes, marks, {
        hardBreakNodeName: 'hardBreak',
        strict: false,
    });
}

function backticksFor(node, side) {
    const ticks = /`+/g;
    let m;
    let len = 0;
    if (node.isText) {
        while ((m = ticks.exec(node.text)) !== null) {
            len = Math.max(len, m[0].length);
        }
    }
    let result = len > 0 && side > 0 ? ' `' : '`';
    for (let i = 0; i < len; i += 1) {
        result += '`';
    }
    if (len > 0 && side < 0) {
        result += ' ';
    }
    return result;
}

function isPlainUrl(link, parent, index) {
    if (link.attrs?.title || !/^\w+:/.test(link.attrs?.href || '')) {
        return false;
    }
    const content = parent.child(index);
    if (!content.isText || content.text !== link.attrs.href || content.marks[content.marks.length - 1] !== link) {
        return false;
    }
    return index === parent.childCount - 1 || !link.isInSet(parent.child(index + 1).marks);
}
