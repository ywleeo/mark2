import TaskItem from '@tiptap/extension-task-item';

// 自定义 TaskItem 扩展，支持解析 markdown-it-task-lists 生成的 HTML
export const CustomTaskItem = TaskItem.extend({
    // 修改内容的包裹方式，使用 inline 而不是 block
    content: 'inline*',

    parseHTML() {
        return [
            {
                tag: 'li.task-list-item',
                priority: 51,
                getAttrs: el => {
                    // 查找 input checkbox
                    const checkbox = el.querySelector('input[type="checkbox"]');
                    if (!checkbox) return false;

                    return {
                        checked: checkbox.checked || checkbox.hasAttribute('checked'),
                    };
                },
            },
            {
                tag: 'li[data-type="taskItem"]',
                priority: 51,
                getAttrs: el => ({
                    checked: el.getAttribute('data-checked') === 'true',
                }),
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
                checkbox,
                ['span', 0], // 内容位置
            ],
        ];
    },
});
