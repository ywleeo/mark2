import { Fragment, Schema } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { createMarkdownParser, createMarkdownSerializer } from '../../src/modules/markdownPipeline.js';
import { extractFrontmatter, preprocessMarkdown } from '../../src/components/markdown-editor/MarkdownPreprocessor.js';
import { SourcePreservingMarkdownSerializer } from '../../src/components/markdown-editor/SourcePreservingMarkdownSerializer.js';

/** 生成带源码位置的块节点属性。 */
const blockAttrs = {
    sourcepos: { default: null },
};

/**
 * 创建与 Mark2 Markdown 管线节点名一致的无 DOM ProseMirror Schema。
 * 测试只需要解析和序列化协议，不加载 NodeView 或浏览器交互插件。
 * @returns {Schema} Markdown 回归测试 Schema。
 */
export function createMarkdownTestSchema() {
    return new Schema({
        nodes: {
            doc: { content: 'block*' },
            text: { group: 'inline' },
            paragraph: { group: 'block', content: 'inline*', attrs: blockAttrs },
            blockquote: { group: 'block', content: 'block+', attrs: blockAttrs },
            horizontalRule: {
                group: 'block',
                attrs: { ...blockAttrs, markup: { default: null } },
            },
            heading: {
                group: 'block',
                content: 'inline*',
                attrs: { ...blockAttrs, level: { default: 1 } },
            },
            codeBlock: {
                group: 'block',
                content: 'text*',
                marks: '',
                code: true,
                attrs: { ...blockAttrs, language: { default: null } },
            },
            hardBreak: { group: 'inline', inline: true, selectable: false },
            bulletList: {
                group: 'block',
                content: 'listItem+',
                attrs: {
                    ...blockAttrs,
                    tight: { default: true },
                    bullet: { default: '-' },
                },
            },
            orderedList: {
                group: 'block',
                content: 'listItem+',
                attrs: {
                    ...blockAttrs,
                    order: { default: 1 },
                    tight: { default: true },
                },
            },
            listItem: { content: 'paragraph block*', attrs: blockAttrs },
            taskList: { group: 'block', content: 'taskItem+', attrs: blockAttrs },
            taskItem: {
                content: 'paragraph block*',
                attrs: { ...blockAttrs, checked: { default: false } },
            },
            table: { group: 'block', content: 'tableRow+', attrs: blockAttrs },
            tableRow: {
                content: '(tableCell | tableHeader)+',
                attrs: blockAttrs,
            },
            tableCell: {
                content: 'block+',
                attrs: {
                    ...blockAttrs,
                    colspan: { default: 1 },
                    rowspan: { default: 1 },
                    colwidth: { default: null },
                    markdownAlignment: { default: null },
                },
            },
            tableHeader: {
                content: 'block+',
                attrs: {
                    ...blockAttrs,
                    colspan: { default: 1 },
                    rowspan: { default: 1 },
                    colwidth: { default: null },
                    markdownAlignment: { default: null },
                },
            },
            image: {
                inline: true,
                group: 'inline',
                atom: true,
                attrs: {
                    ...blockAttrs,
                    src: { default: '' },
                    alt: { default: null },
                    title: { default: null },
                    dataOriginalSrc: { default: null },
                },
            },
            mermaidBlock: {
                group: 'block',
                atom: true,
                attrs: { ...blockAttrs, code: { default: '' } },
            },
            csvBlock: {
                group: 'block',
                atom: true,
                attrs: { ...blockAttrs, csv: { default: '' } },
            },
            videoBlock: {
                group: 'block',
                atom: true,
                attrs: { ...blockAttrs, src: { default: '' } },
            },
            mathBlock: {
                group: 'block',
                atom: true,
                attrs: { ...blockAttrs, latex: { default: '' } },
            },
            mathInline: {
                inline: true,
                group: 'inline',
                atom: true,
                attrs: { latex: { default: '' } },
            },
            detailsBlock: {
                group: 'block',
                content: 'detailsSummary block*',
                attrs: {
                    ...blockAttrs,
                    open: { default: false },
                    id: { default: null },
                    class: { default: null },
                    style: { default: null },
                },
            },
            detailsSummary: { content: 'inline*' },
            htmlDiv: {
                group: 'block',
                content: 'block+',
                attrs: {
                    ...blockAttrs,
                    id: { default: null },
                    class: { default: null },
                    style: { default: null },
                },
            },
        },
        marks: {
            italic: {},
            bold: {},
            strike: {},
            code: { excludes: '_' },
            link: {
                attrs: {
                    href: { default: '' },
                    title: { default: null },
                },
                inclusive: false,
            },
            htmlSpan: {
                attrs: {
                    style: { default: null },
                    class: { default: null },
                    id: { default: null },
                },
            },
            htmlInline: {
                attrs: {
                    tag: { default: 'span' },
                    style: { default: null },
                    class: { default: null },
                    id: { default: null },
                },
            },
        },
    });
}

/**
 * 创建一个真实 Markdown 解析→编辑→局部序列化测试会话。
 * @param {string} source - 完整 Markdown 源码。
 * @returns {object} 可修改文档并重新序列化的测试会话。
 */
export function createMarkdownRoundTripSession(source) {
    const schema = createMarkdownTestSchema();
    const parser = createMarkdownParser(schema);
    const markdownSerializer = createMarkdownSerializer(schema);
    const { body, raw: frontmatterRaw } = extractFrontmatter(source);
    const documentNode = parser.parse(preprocessMarkdown(body));
    const sourceSerializer = new SourcePreservingMarkdownSerializer({ markdownSerializer });
    sourceSerializer.reset(body, documentNode);

    return {
        schema,
        documentNode,
        frontmatterRaw,
        body,

        /**
         * 输出完整 Markdown，模拟 ContentLoader 合并 frontmatter 的行为。
         * @param {object} [nextDocument=documentNode] - 待序列化的 ProseMirror 文档。
         * @returns {string} 完整 Markdown。
         */
        serialize(nextDocument = documentNode) {
            const nextBody = sourceSerializer.serialize(nextDocument);
            return frontmatterRaw ? `${frontmatterRaw}\n${nextBody}` : nextBody;
        },
    };
}

/**
 * 在真实 ProseMirror 文档中替换第一处文本。
 * @param {object} documentNode - 原文档。
 * @param {string} searchText - 待替换文本。
 * @param {string} replacement - 新文本。
 * @returns {object} 修改后的文档。
 */
export function replaceFirstDocumentText(documentNode, searchText, replacement) {
    let range = null;
    documentNode.descendants((node, position) => {
        if (range || !node.isText) return !range;
        const index = node.text.indexOf(searchText);
        if (index < 0) return true;
        range = {
            from: position + index,
            to: position + index + searchText.length,
        };
        return false;
    });
    if (!range) throw new Error(`未在 ProseMirror 文档中找到文本: ${searchText}`);

    return EditorState.create({ doc: documentNode })
        .tr.insertText(replacement, range.from, range.to)
        .doc;
}

/**
 * 在第一个无序列表末尾追加一个列表项。
 * @param {object} documentNode - 原文档。
 * @param {string} itemText - 新列表项文本。
 * @returns {object} 修改后的文档。
 */
export function appendBulletListItem(documentNode, itemText) {
    const { schema } = documentNode.type;
    let listRange = null;
    documentNode.descendants((node, position) => {
        if (listRange || node.type.name !== 'bulletList') return !listRange;
        listRange = { node, from: position, to: position + node.nodeSize };
        return false;
    });
    if (!listRange) throw new Error('未在 ProseMirror 文档中找到无序列表');

    const paragraph = schema.nodes.paragraph.create(null, schema.text(itemText));
    const listItem = schema.nodes.listItem.create(null, paragraph);
    const nextList = listRange.node.copy(listRange.node.content.append(Fragment.from(listItem)));
    return EditorState.create({ doc: documentNode })
        .tr.replaceWith(listRange.from, listRange.to, nextList)
        .doc;
}
