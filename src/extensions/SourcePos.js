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
        ];
    },
});
