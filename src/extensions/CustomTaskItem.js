import TaskItem from '@tiptap/extension-task-item';

// 自定义 TaskItem 扩展，支持解析 markdown-it-task-lists 生成的 HTML
export const CustomTaskItem = TaskItem.extend({
    content() {
        return this.options.nested ? 'paragraph block*' : 'paragraph+';
    },

    parseHTML() {
        const readChecked = (el) => {
            const dataChecked = el.getAttribute?.('data-checked');
            if (dataChecked === 'true' || dataChecked === 'false') {
                return dataChecked === 'true';
            }
            const checkbox = el.querySelector?.('input[type="checkbox"]');
            if (checkbox) {
                return checkbox.checked || checkbox.hasAttribute?.('checked');
            }
            return false;
        };

        return [
            {
                tag: 'li[data-type="taskItem"]',
                priority: 52,
                getAttrs: el => ({
                    checked: readChecked(el),
                }),
            },
            {
                tag: 'li.task-list-item',
                priority: 51,
                getAttrs: el => {
                    const checkbox = el.querySelector?.('input[type="checkbox"]');
                    if (!checkbox && !el.hasAttribute?.('data-checked')) {
                        return false;
                    }
                    return {
                        checked: readChecked(el),
                    };
                },
            },
        ];
    },

    renderHTML({ node, HTMLAttributes }) {
        const checkbox = [
            'input',
            {
                type: 'checkbox',
                checked: node.attrs.checked ? 'checked' : null,
            },
        ];

        return [
            'li',
            {
                ...HTMLAttributes,
                'data-type': 'taskItem',
                'data-checked': node.attrs.checked ? 'true' : 'false',
                class: 'task-list-item',
            },
            [
                'label',
                { class: 'task-list-item__control' },
                checkbox,
                ['span', { class: 'task-list-item__indicator' }]
            ],
            ['div', { class: 'task-list-item__content' }, 0]
        ];
    },
});
