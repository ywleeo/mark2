import { Node, mergeAttributes } from '@tiptap/core';
import MarkdownIt from 'markdown-it';
import markdownItTaskLists from 'markdown-it-task-lists';
import markdownItMultimdTable from 'markdown-it-multimd-table';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { addTaskListRules } from './taskListTurndown.js';
import { addMermaidRules, isMermaidNode, mermaidReplacement } from './mermaidTurndown.js';

// 任务列表类型常量
export const TASK_ITEM_TYPE = 'taskItem';

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
        linkify: false, // 禁用自动链接识别，保持纯文本 URL 原样
    });

    // 使用 markdown-it-multimd-table 插件支持表格
    md.use(markdownItMultimdTable, {
        multiline: true,
        rowspan: true,
        headerless: true,
        multibody: true,
        autolabel: true,
    });

    // 使用官方的 markdown-it-task-lists 插件
    md.use(markdownItTaskLists, {
        enabled: true,
        label: true,
        labelAfter: true
    });

    // 自定义渲染器，在插件之后获取渲染器并扩展
    const pluginListItemRender = md.renderer.rules.list_item_open || function(tokens, idx, options, env, self) {
        return self.renderToken(tokens, idx, options);
    };

    md.renderer.rules.list_item_open = function(tokens, idx, options, env, self) {
        const token = tokens[idx];
        const isTaskItem = token.attrGet('class') && token.attrGet('class').includes('task-list-item');

        if (isTaskItem) {
            // 查找 checkbox 状态
            let checked = false;
            for (let i = idx + 1; i < tokens.length && tokens[i].type !== 'list_item_close'; i++) {
                if (tokens[i].type === 'inline' && tokens[i].children) {
                    // checkbox HTML 在 inline token 的 children 里
                    const checkboxChild = tokens[i].children.find(child =>
                        child.type === 'html_inline' && child.content.includes('type="checkbox"')
                    );
                    if (checkboxChild) {
                        checked = checkboxChild.content.includes('checked');
                        break;
                    }
                }
            }

            token.attrSet('data-type', 'taskItem');
            token.attrSet('data-checked', checked ? 'true' : 'false');
        }

        return pluginListItemRender(tokens, idx, options, env, self);
    };

    const pluginBulletListRender = md.renderer.rules.bullet_list_open || function(tokens, idx, options, env, self) {
        return self.renderToken(tokens, idx, options);
    };

    md.renderer.rules.bullet_list_open = function(tokens, idx, options, env, self) {
        const token = tokens[idx];
        const hasTaskList = token.attrGet('class') && token.attrGet('class').includes('contains-task-list');

        if (hasTaskList) {
            token.attrSet('data-type', 'taskList');
        }

        return pluginBulletListRender(tokens, idx, options, env, self);
    };

    // 移除代码块末尾的换行符
    const trimCodeRenderer = renderer => {
        return (tokens, idx, options, env, self) => {
            const output = renderer ? renderer(tokens, idx, options, env, self) : '';
            return typeof output === 'string'
                ? output.replace(/\r?\n(?=<\/code><\/pre>)/, '')
                : output;
        };
    };

    const defaultFenceRenderer = md.renderer.rules.fence || ((tokens, idx, options, env, self) => {
        return self.renderToken(tokens, idx, options);
    });

    md.renderer.rules.fence = function(tokens, idx, options, env, self) {
        const token = tokens[idx];
        const info = (token.info || '').trim().toLowerCase();

        if (info.startsWith('mermaid')) {
            const rawContent = (token.content || '').replace(/\r\n?/g, '\n');
            const encoded = encodeURIComponent(rawContent);
            return `<div class="mermaid" data-mermaid-code="${encoded}"></div>`;
        }

        return defaultFenceRenderer(tokens, idx, options, env, self);
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
        blankReplacement: (_content, node) => {
            if (isMermaidNode(node)) {
                const mermaid = mermaidReplacement(node);
                if (mermaid) {
                    return mermaid;
                }
            }
            return node && node.isBlock ? '\n\n' : '';
        },
    });

    // 使用 GFM 插件支持表格/删除线等
    turndownService.use(gfm);

    // Turndown 的默认 GFM 删除线只输出单个 ~，这里覆盖为标准的 "~~"
    turndownService.addRule('strikethrough', {
        filter: ['del', 's', 'strike'],
        replacement: (content) => `~~${content}~~`
    });

    // 禁用自动转义，保持原样
    turndownService.escape = function(string) {
        return string;
    };

    // 保留编辑器内需要写回 Markdown 的原始 HTML 标签
    const preservedInlineTags = [
        'span',
        'kbd',
        'small',
        'mark',
        'abbr',
        'cite',
        'time',
        'var',
        'samp',
        'dfn',
        'ins',
    ];
    const preservedBlockTags = ['div'];
    [...preservedInlineTags, ...preservedBlockTags].forEach(tagName => {
        turndownService.keep(tagName);
    });
    turndownService.keep(node => {
        if (!node || node.nodeType !== 1) {
            return false;
        }
        const tagName = (node.nodeName || '').toLowerCase();
        return tagName.includes('-');
    });

    // 添加 Mermaid 图表转换规则
    addMermaidRules(turndownService);

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
    // 覆盖默认列表项规则，避免 TipTap 生成的 <li><p>...</p></li> 产生多余空行
    turndownService.addRule('listItemNoExtraBlankLine', {
        filter: 'li',
        replacement: function (content, node, options) {
            // 任务列表项由上面的规则处理
            const dataType = node.getAttribute('data-type') || (node.dataset ? node.dataset.type : null);
            if (dataType === TASK_ITEM_TYPE) {
                return '';
            }

            // 移除 TipTap 段落标签产生的多余换行
            content = content
                .replace(/^\n+/, '')
                .replace(/\n+$/, '\n')
                .replace(/\n\n+/g, '\n');

            let prefix = options.bulletListMarker + ' ';
            const parent = node.parentNode;
            if (parent && parent.nodeName === 'OL') {
                const start = parent.getAttribute('start');
                const index = Array.prototype.indexOf.call(parent.children, node);
                prefix = (start ? Number(start) + index : index + 1) + '. ';
            }

            // 多行内容缩进对齐（2 个空格）
            content = content.replace(/\n/gm, '\n  ');

            return prefix + content + (node.nextSibling && !/\n$/.test(content) ? '\n' : '');
        }
    });

    // 覆盖列表规则，清理 TipTap 产生的多余空行
    turndownService.addRule('listNoExtraBlankLines', {
        filter: ['ul', 'ol'],
        replacement: function (content, node) {
            // 清理列表项之间的多余空行
            const cleaned = content.replace(/\n\n+/g, '\n').trim();
            return '\n\n' + cleaned + '\n\n';
        }
    });

    // 添加任务列表转换规则
    addTaskListRules(turndownService);

    return turndownService;
}
