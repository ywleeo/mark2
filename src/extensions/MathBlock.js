import { Node } from '@tiptap/core';
import katex from 'katex';

/**
 * Block math node: $$...$$
 * Renders as a KaTeX display-mode formula.
 */
export const MathBlock = Node.create({
    name: 'mathBlock',
    group: 'block',
    atom: true,
    selectable: true,
    draggable: false,
    priority: 51,

    addAttributes() {
        return {
            latex: { default: '' },
        };
    },

    parseHTML() {
        return [
            {
                tag: 'section',
                getAttrs: el => {
                    const eqn = el.querySelector('eqn');
                    if (!eqn) return false;
                    return { latex: eqn.textContent || '' };
                },
            },
        ];
    },

    renderHTML({ node }) {
        const latex = node.attrs.latex || '';
        let rendered;
        try {
            rendered = katex.renderToString(latex, { displayMode: true, throwOnError: false });
        } catch {
            rendered = `<span class="math-error">${latex}</span>`;
        }
        return ['div', { class: 'math-block', 'data-math-latex': latex }, ['div', { innerHTML: rendered }]];
    },

    addNodeView() {
        return ({ node }) => {
            const dom = document.createElement('div');
            dom.className = 'math-block';
            dom.setAttribute('data-math-latex', node.attrs.latex || '');
            dom.contentEditable = 'false';
            try {
                katex.render(node.attrs.latex || '', dom, { displayMode: true, throwOnError: false });
            } catch {
                dom.textContent = node.attrs.latex || '';
            }
            return { dom };
        };
    },
});

/**
 * Inline math node: $...$
 * Renders as a KaTeX inline formula.
 */
export const MathInline = Node.create({
    name: 'mathInline',
    group: 'inline',
    inline: true,
    atom: true,
    selectable: true,
    draggable: false,

    addAttributes() {
        return {
            latex: { default: '' },
        };
    },

    parseHTML() {
        return [
            {
                tag: 'eq',
                getAttrs: el => ({ latex: el.textContent || '' }),
            },
        ];
    },

    renderHTML({ node }) {
        const latex = node.attrs.latex || '';
        let rendered;
        try {
            rendered = katex.renderToString(latex, { displayMode: false, throwOnError: false });
        } catch {
            rendered = `<span class="math-error">${latex}</span>`;
        }
        return ['span', { class: 'math-inline', 'data-math-latex': latex }, ['span', { innerHTML: rendered }]];
    },

    addNodeView() {
        return ({ node }) => {
            const dom = document.createElement('span');
            dom.className = 'math-inline';
            dom.setAttribute('data-math-latex', node.attrs.latex || '');
            dom.contentEditable = 'false';
            try {
                katex.render(node.attrs.latex || '', dom, { displayMode: false, throwOnError: false });
            } catch {
                dom.textContent = node.attrs.latex || '';
            }
            return { dom };
        };
    },
});
