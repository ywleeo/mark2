import { Extension } from '@tiptap/core';

const SOURCEPOS_ATTR = 'sourcepos';

export const SourcePos = Extension.create({
    name: 'sourcePos',

    addGlobalAttributes() {
        return [
            {
                types: [
                    'paragraph',
                    'heading',
                    'blockquote',
                    'bulletList',
                    'orderedList',
                    'listItem',
                    'taskList',
                    'taskItem',
                    'codeBlock',
                    'horizontalRule',
                    'table',
                    'tableRow',
                    'tableCell',
                    'tableHeader',
                    'mermaidBlock',
                    'csvBlock',
                    'videoBlock',
                    'mathBlock',
                    'detailsBlock',
                    'htmlDiv',
                    'image',
                ],
                attributes: {
                    [SOURCEPOS_ATTR]: {
                        default: null,
                        parseHTML: element => element.getAttribute('data-sourcepos'),
                        renderHTML: () => ({}),
                    },
                },
            },
            {
                types: ['tableCell', 'tableHeader'],
                attributes: {
                    markdownAlignment: {
                        default: null,
                        parseHTML: element => element.getAttribute('data-markdown-alignment'),
                        renderHTML: attributes => attributes.markdownAlignment
                            ? { 'data-markdown-alignment': attributes.markdownAlignment }
                            : {},
                    },
                },
            },
        ];
    },
});
