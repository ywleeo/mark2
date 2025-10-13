import { Node, mergeAttributes } from '@tiptap/core';
import MarkdownIt from 'markdown-it';
import TurndownService from 'turndown';

// 任务列表类型常量
export const TASK_ITEM_TYPE = 'taskItem';
export const TASK_LIST_TYPE = 'taskList';

// 设置 token 属性的辅助函数
const setAttribute = (token, name, value) => {
    if (!token) {
        return;
    }
    const index = token.attrIndex(name);
    if (index >= 0) {
        token.attrs[index][1] = value;
    } else {
        token.attrPush([name, value]);
    }
};

// 查找匹配的开始标签索引
const findMatchingOpenIndex = (tokens, closeIndex, type) => {
    for (let i = closeIndex; i >= 0; i--) {
        if (tokens[i].type === type) {
            return i;
        }
    }
    return -1;
};

// MarkdownIt 任务列表插件
export const taskListPlugin = md => {
    md.core.ruler.after('inline', 'task-list-items', state => {
        const tokens = state.tokens;
        for (let idx = 2; idx < tokens.length; idx++) {
            const inlineToken = tokens[idx];
            if (inlineToken.type !== 'inline') {
                continue;
            }
            const paragraphOpen = tokens[idx - 1];
            const listItemOpen = tokens[idx - 2];
            if (!paragraphOpen || paragraphOpen.type !== 'paragraph_open') {
                continue;
            }
            if (!listItemOpen || listItemOpen.type !== 'list_item_open') {
                continue;
            }
            if (!inlineToken.children || inlineToken.children.length === 0) {
                continue;
            }

            const firstChild = inlineToken.children[0];
            if (!firstChild || firstChild.type !== 'text') {
                continue;
            }

            const match = firstChild.content.match(/^\s*\[( |x|X)\]\s*/);
            if (!match) {
                continue;
            }

            const checked = match[1].toLowerCase() === 'x';

            firstChild.content = firstChild.content.slice(match[0].length).replace(/^\s+/, '');

            if (firstChild.content.length === 0) {
                inlineToken.children.shift();
            }

            setAttribute(listItemOpen, 'data-type', TASK_ITEM_TYPE);
            setAttribute(listItemOpen, 'data-checked', checked ? 'true' : 'false');

            for (let search = idx - 3; search >= 0; search--) {
                const token = tokens[search];
                const isListToken = token.type === 'bullet_list_open' || token.type === 'ordered_list_open';
                if (isListToken && token.level === listItemOpen.level - 1) {
                    setAttribute(token, 'data-type', TASK_LIST_TYPE);
                    break;
                }
            }
        }
    });

    const defaultListItemOpen =
        md.renderer.rules.list_item_open ||
        ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));

    const defaultListItemClose =
        md.renderer.rules.list_item_close ||
        ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));

    md.renderer.rules.list_item_open = (tokens, idx, options, env, self) => {
        const token = tokens[idx];
        if (token.attrGet('data-type') === TASK_ITEM_TYPE) {
            const attrs = self.renderAttrs(token);
            const checked = token.attrGet('data-checked') === 'true';
            const checkbox = `<input class="task-list-item-checkbox" type="checkbox"${checked ? ' checked' : ''} disabled />`;
            return `<li${attrs}><label class="task-list-item-label">${checkbox}<span class="task-list-item-indicator" aria-hidden="true"></span></label><div class="task-list-item-content">`;
        }
        return defaultListItemOpen(tokens, idx, options, env, self);
    };

    md.renderer.rules.list_item_close = (tokens, idx, options, env, self) => {
        const openIndex = findMatchingOpenIndex(tokens, idx, 'list_item_open');
        if (openIndex >= 0 && tokens[openIndex].attrGet('data-type') === TASK_ITEM_TYPE) {
            return '</div></li>';
        }
        return defaultListItemClose(tokens, idx, options, env, self);
    };
};

// Tiptap 自定义图片节点
export const MarkdownImage = Node.create({
    name: 'image',
    inline: true,
    group: 'inline',
    draggable: true,
    selectable: true,
    addAttributes() {
        return {
            src: {
                default: null,
            },
            alt: {
                default: null,
            },
            title: {
                default: null,
            },
            dataOriginalSrc: {
                default: null,
                parseHTML: element => element.getAttribute('data-original-src'),
                renderHTML: attributes => {
                    if (!attributes.dataOriginalSrc) {
                        return {};
                    }
                    return { 'data-original-src': attributes.dataOriginalSrc };
                },
            },
        };
    },
    parseHTML() {
        return [
            {
                tag: 'img[src]',
            },
        ];
    },
    renderHTML({ HTMLAttributes }) {
        return ['img', mergeAttributes(HTMLAttributes)];
    },
});

// 创建并配置 MarkdownIt 实例
export function createConfiguredMarkdownIt() {
    const md = new MarkdownIt({
        html: true,
        breaks: true,
        linkify: true,
    });

    // 启用表格支持
    md.enable('table');
    md.use(taskListPlugin);

    // 移除代码块末尾的换行符
    const trimCodeRenderer = renderer => {
        return (tokens, idx, options, env, self) => {
            const output = renderer ? renderer(tokens, idx, options, env, self) : '';
            return typeof output === 'string'
                ? output.replace(/\r?\n(?=<\/code><\/pre>)/, '')
                : output;
        };
    };

    md.renderer.rules.fence = trimCodeRenderer(md.renderer.rules.fence);
    md.renderer.rules.code_block = trimCodeRenderer(md.renderer.rules.code_block);

    return md;
}

// 创建并配置 TurndownService 实例
export function createConfiguredTurndownService() {
    const turndownService = new TurndownService({
        headingStyle: 'atx',
        codeBlockStyle: 'fenced',
        emDelimiter: '*',
        strongDelimiter: '**',
        bulletListMarker: '-',
    });

    // 禁用自动转义，保持原样
    turndownService.escape = function(string) {
        return string;
    };

    // 保留图片的原始 src 属性
    turndownService.addRule('preserveImageOriginalSrc', {
        filter: 'img',
        replacement: (content, node) => {
            const alt = (node.getAttribute('alt') || '').replace(/]/g, '\\]');
            const title = node.getAttribute('title');
            const originalSrc = node.getAttribute('data-original-src') || node.getAttribute('src') || '';
            const titlePart = title ? ` "${title.replace(/"/g, '\\"')}"` : '';
            const needsAngle = /\s|[<>]/.test(originalSrc);
            const escapedSrc = needsAngle ? `<${originalSrc.replace(/>/g, '\\>')}>` : originalSrc;
            return `![${alt}](${escapedSrc}${titlePart})`;
        },
    });

    // 任务列表项的转换规则
    turndownService.addRule('taskListItem', {
        filter: node => {
            if (!node || node.nodeName !== 'LI') {
                return false;
            }
            const dataType = node.getAttribute('data-type') || (node.dataset ? node.dataset.type : null);
            return dataType === TASK_ITEM_TYPE;
        },
        replacement: (content, node, options) => {
            const checkedAttr = (node.getAttribute('data-checked') || (node.dataset ? node.dataset.checked : '') || '').toLowerCase();
            const hasCheckedInput = node.querySelector('input[type="checkbox"][checked]');
            const isChecked = checkedAttr === 'true' || (!checkedAttr && Boolean(hasCheckedInput));
            const checkboxMarker = isChecked ? 'x' : ' ';
            const prefix = `${options.bulletListMarker} [${checkboxMarker}] `;
            const normalized = content
                .replace(/^\n+/, '')
                .replace(/\n+$/, '\n')
                .replace(/\n/gm, '\n' + ' '.repeat(prefix.length));
            const needsLineBreak = node.nextSibling && !/\n$/.test(normalized);
            return prefix + normalized + (needsLineBreak ? '\n' : '');
        },
    });

    return turndownService;
}
