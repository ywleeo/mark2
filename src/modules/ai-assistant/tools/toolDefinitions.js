/**
 * AI 文档编辑 Tool 定义
 * 供 OpenAI function calling / tool use 使用
 */

export const documentTools = [
    {
        type: 'function',
        function: {
            name: 'edit_document',
            description: '编辑文档中的指定内容。用 old_text 精确匹配文档 markdown 原文（包括 #、-、> 等标记），替换为 new_text。删除内容则 new_text 为空字符串。',
            parameters: {
                type: 'object',
                properties: {
                    old_text: {
                        type: 'string',
                        description: '要替换的 markdown 原文（必须精确匹配，包括标记符号、空格、换行）',
                    },
                    new_text: {
                        type: 'string',
                        description: '替换后的新 markdown 内容',
                    },
                },
                required: ['old_text', 'new_text'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'insert_text',
            description: '在文档中指定位置插入新内容。先找到锚点文本，然后在其前面或后面插入。',
            parameters: {
                type: 'object',
                properties: {
                    anchor: {
                        type: 'string',
                        description: '锚点文本（精确匹配文档 markdown 原文中的一段内容）',
                    },
                    content: {
                        type: 'string',
                        description: '要插入的 markdown 内容',
                    },
                    position: {
                        type: 'string',
                        enum: ['before', 'after'],
                        description: '插入位置：before 在锚点前插入，after 在锚点后插入',
                    },
                },
                required: ['anchor', 'content', 'position'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'replace_all',
            description: '全局查找替换，将文档中所有匹配的文本替换为新文本。适用于批量替换场景，如把所有的A换成B。',
            parameters: {
                type: 'object',
                properties: {
                    search: {
                        type: 'string',
                        description: '要查找的文本',
                    },
                    replace: {
                        type: 'string',
                        description: '替换为的文本',
                    },
                },
                required: ['search', 'replace'],
            },
        },
    },
];
