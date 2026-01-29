import { Mark, Node } from '@tiptap/core';

// 支持 span 标签（行内元素）
export const HtmlSpan = Mark.create({
    name: 'htmlSpan',

    addAttributes() {
        return {
            style: {
                default: null,
                parseHTML: element => element.getAttribute('style'),
                renderHTML: attributes => {
                    if (!attributes.style) return {};
                    return { style: attributes.style };
                },
            },
            class: {
                default: null,
                parseHTML: element => element.getAttribute('class'),
                renderHTML: attributes => {
                    if (!attributes.class) return {};
                    return { class: attributes.class };
                },
            },
            id: {
                default: null,
                parseHTML: element => element.getAttribute('id'),
                renderHTML: attributes => {
                    if (!attributes.id) return {};
                    return { id: attributes.id };
                },
            },
        };
    },

    parseHTML() {
        return [
            {
                tag: 'span',
            },
        ];
    },

    renderHTML({ HTMLAttributes }) {
        return ['span', HTMLAttributes, 0];
    },
});

// 支持 div 标签（块级元素）
export const HtmlDiv = Node.create({
    name: 'htmlDiv',
    group: 'block',
    content: 'block+',

    addAttributes() {
        return {
            style: {
                default: null,
                parseHTML: element => element.getAttribute('style'),
                renderHTML: attributes => {
                    if (!attributes.style) return {};
                    return { style: attributes.style };
                },
            },
            class: {
                default: null,
                parseHTML: element => element.getAttribute('class'),
                renderHTML: attributes => {
                    if (!attributes.class) return {};
                    return { class: attributes.class };
                },
            },
            id: {
                default: null,
                parseHTML: element => element.getAttribute('id'),
                renderHTML: attributes => {
                    if (!attributes.id) return {};
                    return { id: attributes.id };
                },
            },
        };
    },

    parseHTML() {
        return [
            {
                tag: 'div',
                getAttrs: element => {
                    const className = `${element.getAttribute('class') || ''}`.toLowerCase();
                    if (className.includes('mermaid')) {
                        return false;
                    }
                    return null;
                },
            },
        ];
    },

    renderHTML({ HTMLAttributes }) {
        return ['div', HTMLAttributes, 0];
    },
});

// 支持其他常见的行内 HTML 标签
export const HtmlInline = Mark.create({
    name: 'htmlInline',

    addAttributes() {
        return {
            tag: {
                default: 'span',
                parseHTML: element => element.tagName.toLowerCase(),
                renderHTML: attributes => {
                    return {};
                },
            },
            style: {
                default: null,
                parseHTML: element => element.getAttribute('style'),
                renderHTML: attributes => {
                    if (!attributes.style) return {};
                    return { style: attributes.style };
                },
            },
            class: {
                default: null,
                parseHTML: element => element.getAttribute('class'),
                renderHTML: attributes => {
                    if (!attributes.class) return {};
                    return { class: attributes.class };
                },
            },
            id: {
                default: null,
                parseHTML: element => element.getAttribute('id'),
                renderHTML: attributes => {
                    if (!attributes.id) return {};
                    return { id: attributes.id };
                },
            },
        };
    },

    parseHTML() {
        return [
            { tag: 'span' },
            { tag: 'kbd' },
            { tag: 'small' },
            { tag: 'mark' },
            { tag: 'abbr' },
            { tag: 'cite' },
            { tag: 'time' },
            { tag: 'var' },
            { tag: 'samp' },
            { tag: 'dfn' },
            { tag: 'ins' },
            { tag: 'del' },
        ];
    },

    renderHTML({ HTMLAttributes, mark }) {
        const tag = mark.attrs.tag || 'span';
        return [tag, HTMLAttributes, 0];
    },
});
