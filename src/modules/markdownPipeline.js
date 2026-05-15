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

// 顶层 block 之间额外空行（用户在源码里特意留的视觉间距）按 markdown 语义会
// 被合并成默认的一个空行。这里靠 markdown-it 给每个 block 留的 map 行号差，把多
// 出来的空行还原成空的 paragraph token 注入到 token 流里，让 ProseMirror doc
// 持有这些"空段落"节点；序列化时再把它们写回额外的 \n，做到 round-trip 幂等。
//
// 仅在顶层（level === 0）做。list / blockquote 内部的空行有自己的语义（loose
// list / blockquote 续行），不能碰。
function injectBlankLinePlaceholders(tokens) {
    if (!Array.isArray(tokens) || tokens.length === 0) return tokens;
    const TokenCtor = tokens[0].constructor;
    if (!TokenCtor) return tokens;

    const out = [];
    let prevEndLine = -1;

    for (const tok of tokens) {
        // 顶层 block 起点：level=0，nesting >= 0（opener 或自闭合 token），带 map
        const isTopBlockStart = tok.level === 0 && tok.nesting >= 0 && Array.isArray(tok.map);

        if (isTopBlockStart) {
            const startLine = tok.map[0];
            // gap = startLine - prevEndLine（map[1] 是结束行的下一行，所以 gap == 中间空行数）
            // 默认 markdown 段落分隔已经隐含一个空行，多出来 (gap - 1) 个才需要补
            if (prevEndLine >= 0 && startLine > prevEndLine) {
                const extra = startLine - prevEndLine - 1;
                for (let j = 0; j < extra; j += 1) {
                    const open = new TokenCtor('paragraph_open', 'p', 1);
                    open.block = true;
                    const inline = new TokenCtor('inline', '', 0);
                    inline.content = '';
                    inline.children = [];
                    inline.block = true;
                    inline.level = 1;
                    const close = new TokenCtor('paragraph_close', 'p', -1);
                    close.block = true;
                    out.push(open, inline, close);
                }
            }
            prevEndLine = tok.map[1];
        }

        out.push(tok);
    }

    return out;
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

    // label/labelAfter 会把整段内容再塞一份到 <label> html_inline 里——我们用 TipTap 渲染、
    // html_inline fallback 会 extractInlineText 把这段文字加回 doc 导致内容写两份，
    // 进而被序列化器逐字转义，每存一次反斜杠翻倍。这两个选项一定不能开。
    md.use(markdownItTaskLists, {
        enabled: true,
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
    // 包一层 tokenizer.parse：拿到原 token 流后，按行号差注入"空段落"占位 token，
    // 让顶层 block 之间的多余空行能进 doc。MarkdownParser 内部正是调 tokenizer.parse。
    const origTokenizeParse = tokenizer.parse.bind(tokenizer);
    tokenizer.parse = (src, env) => injectBlankLinePlaceholders(origTokenizeParse(src, env));
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
            // 单条 inline HTML 解析失败时，吞掉异常、跳过本块；不让一个坏标签拖崩整篇 markdown
            try {
                if (shouldSkipInlineHtml(tok.content)) {
                    return;
                }

                const content = tok.content || '';

                // <br> 识别为 hardBreak，支持标题/段落内折行
                if (hardBreakType && /^<br\s*\/?\s*>$/i.test(content)) {
                    state.addNode(hardBreakType, null);
                    return;
                }

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
                    try {
                        // 单个节点 push 失败也不影响其他兄弟节点
                        state.push(applyMarksToInline(node, state.top().marks));
                    } catch (err) {
                        console.warn('[markdown] push html_inline node failed:', err);
                    }
                });
            } catch (err) {
                console.warn('[markdown] html_inline handler failed:', err, tok.content);
            }
        };
    }

    if (parser.tokenHandlers.html_block) {
        parser.tokenHandlers.html_block = (state, tok) => {
            const content = tok.content || '';
            let slice = null;
            try {
                slice = parseHtmlFragment(schema, content, true);
            } catch (err) {
                console.warn('[markdown] html_block parse failed:', err);
            }

            // schema 不认识的 block 标签（<center>/<details>/<summary>/<font> 等），
            // DOMParser 会降级到子节点，常常吐出纯 inline 内容；
            // 直接 push 到 doc 会让 doc.create() 校验失败、整篇 markdown 解析崩溃 → 编辑器空白。
            // 这里把连续的 inline 节点缓冲后包一层 paragraph 再下发。
            let inlineBuffer = [];
            const flushInline = () => {
                if (inlineBuffer.length === 0 || !paragraphType) {
                    inlineBuffer = [];
                    return;
                }
                try {
                    state.openNode(paragraphType, null);
                    inlineBuffer.forEach(n => state.push(n));
                    state.closeNode();
                } catch (err) {
                    console.warn('[markdown] flush inline html_block nodes failed:', err);
                }
                inlineBuffer = [];
            };

            if (slice && slice.content.size > 0) {
                slice.content.forEach(node => {
                    if (node.isInline) {
                        inlineBuffer.push(node);
                    } else {
                        flushInline();
                        try { state.push(node); }
                        catch (err) { console.warn('[markdown] push html_block node failed:', err); }
                    }
                });
                flushInline();
                return;
            }

            // 解析不到任何可用节点，把原文当作纯文本兜底，避免内容丢失
            const fallback = extractInlineText(content).trim();
            if (fallback && paragraphType) {
                state.openNode(paragraphType, null);
                state.addText(fallback);
                state.closeNode();
            }
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

    // 终极兜底：parse 不论怎么爆都不允许返回空 doc，否则编辑器会一片空白。
    // 抛错时把原 markdown 作为 codeBlock 整段塞进去，至少让用户看到内容并意识到出了问题。
    const originalParse = parser.parse.bind(parser);
    parser.parse = (markdown) => {
        try {
            return originalParse(markdown);
        } catch (err) {
            console.error('[markdown] parser.parse threw, falling back to verbatim doc:', err);
            return buildFallbackDoc(schema, markdown);
        }
    };

    return parser;
}

/**
 * 构造一个把原 markdown 全文塞进 codeBlock 的兜底 doc。
 * 用在 parser.parse 抛错时——保证编辑器不会因为解析失败而空白。
 */
function buildFallbackDoc(schema, markdown) {
    const docType = schema.nodes.doc;
    const codeBlockType = schema.nodes.codeBlock;
    const paragraphType = schema.nodes.paragraph;
    const text = typeof markdown === 'string' ? markdown : '';
    if (codeBlockType && text) {
        return docType.create(null, codeBlockType.create(null, schema.text(text)));
    }
    if (paragraphType) {
        return docType.create(null, text ? paragraphType.create(null, schema.text(text)) : paragraphType.create());
    }
    return docType.create();
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
        paragraph(state, node, parent, index) {
            // 顶层的空段落是 parser 为保留多余空行注入的占位节点：把它写成额外
            // 的换行而不是常规 paragraph，否则相邻 closeBlock 会被合并成单个空行。
            // 仅在 doc 直接子节点上生效；列表/引用内部的空段落不参与。
            // 结尾空段落（TrailingParagraphManager 加的）也不动，保持现有写盘行为。
            const isTopEmpty = node.content.size === 0
                && parent
                && parent.type?.name === 'doc'
                && typeof index === 'number'
                && index < parent.childCount - 1;
            if (isTopEmpty) {
                state.flushClose(2);
                state.out += '\n';
                return;
            }
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
                    // ATX 标题不能跨行，改用 <br> 保留折行
                    if (parent.type.name === 'heading') {
                        state.write('<br>');
                    } else {
                        state.write('\n');
                    }
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
