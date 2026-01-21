import { Node } from '@tiptap/core';

const decodeMermaidCode = value => {
    if (!value) return '';
    try {
        return decodeURIComponent(value);
    } catch (_error) {
        return value;
    }
};

const encodeMermaidCode = value => {
    if (!value) return '';
    try {
        return encodeURIComponent(value);
    } catch (_error) {
        return value;
    }
};

const extractCodeFromElement = element => {
    if (!element) return '';
    const dataAttr = element.getAttribute?.('data-mermaid-code');
    if (dataAttr) {
        return decodeMermaidCode(dataAttr);
    }
    const source = element.querySelector?.('.mermaid-source');
    if (source) {
        return source.textContent || '';
    }
    const codeElement = element.querySelector?.('code');
    if (codeElement) {
        return codeElement.textContent || '';
    }
    return element.textContent || '';
};

export const MermaidBlock = Node.create({
    name: 'mermaidBlock',
    group: 'block',
    atom: true,
    selectable: true,
    draggable: false,
    priority: 1100,

    addAttributes() {
        return {
            code: {
                default: '',
            },
        };
    },

    parseHTML() {
        return [
            {
                tag: 'div.mermaid',
                getAttrs: element => ({
                    code: extractCodeFromElement(element),
                }),
            },
            {
                tag: 'pre',
                getAttrs: element => {
                    const className = `${element.getAttribute('class') || ''}`.toLowerCase();
                    const codeElement = element.querySelector('code');
                    const childClass = `${codeElement?.getAttribute('class') || ''}`.toLowerCase();
                    const isMermaid = className.includes('mermaid') || childClass.includes('mermaid');
                    if (!isMermaid) {
                        return false;
                    }
                    return {
                        code: codeElement?.textContent || element.textContent || '',
                    };
                },
            },
        ];
    },

    renderHTML({ node }) {
        const code = typeof node.attrs.code === 'string' ? node.attrs.code : '';
        const encoded = encodeMermaidCode(code);
        // 添加隐藏的 .mermaid-source 占位符，使元素不为空
        // 这样可以避免 .mermaid:empty { display: none } 规则隐藏元素
        return [
            'div',
            {
                class: 'mermaid',
                'data-mermaid-code': encoded,
            },
            [
                'span',
                {
                    class: 'mermaid-source',
                    style: 'display: none;',
                },
                code,
            ],
        ];
    },
});
