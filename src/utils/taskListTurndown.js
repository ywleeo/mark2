import { TASK_ITEM_TYPE } from './markdownPlugins.js';

// 工具函数
const hasClass = (node, className) => {
    if (!node) return false;
    if (node.classList && typeof node.classList.contains === 'function') {
        return node.classList.contains(className);
    }
    const classAttr = node.getAttribute ? node.getAttribute('class') : null;
    if (!classAttr) return false;
    return classAttr.split(/\s+/).includes(className);
};

const isElementNode = (node) => node && node.nodeType === 1;

const toArray = (collection) => {
    if (!collection) return [];
    if (Array.isArray(collection)) return collection;
    if (typeof collection.length === 'number') return Array.from(collection);
    return [];
};

// 查找 checkbox 元素
const findCheckbox = (node) => {
    if (!isElementNode(node)) return null;

    if (typeof node.querySelector === 'function') {
        return node.querySelector('input[type="checkbox"]');
    }

    if (typeof node.getElementsByTagName === 'function') {
        const inputs = node.getElementsByTagName('input');
        return toArray(inputs).find(input => {
            const type = (input.getAttribute ? input.getAttribute('type') : input.type || '').toLowerCase();
            return type === 'checkbox';
        }) || null;
    }

    return null;
};

// 判断是否为任务列表项
const isTaskListItemNode = (node) => {
    if (!isElementNode(node)) return false;

    const tagName = (node.nodeName || '').toUpperCase();
    if (tagName !== 'LI') return false;

    const dataType = (node.getAttribute ? node.getAttribute('data-type') : null) ||
        (node.dataset ? node.dataset.type : null) || '';

    if (dataType === TASK_ITEM_TYPE || dataType === TASK_ITEM_TYPE.toLowerCase()) {
        return true;
    }

    if (hasClass(node, 'task-list-item')) return true;

    return Boolean(findCheckbox(node));
};

// 读取任务项的选中状态
const readTaskItemChecked = (node) => {
    const dataChecked = (node.getAttribute ? node.getAttribute('data-checked') : null) ||
        (node.dataset ? node.dataset.checked : null) || '';

    if (typeof dataChecked === 'string') {
        const normalized = dataChecked.toLowerCase();
        if (normalized === 'true' || normalized === 'false') {
            return normalized === 'true';
        }
    }

    const checkbox = findCheckbox(node);
    if (checkbox) {
        if (typeof checkbox.checked === 'boolean') {
            return checkbox.checked;
        }
        if (typeof checkbox.hasAttribute === 'function') {
            return checkbox.hasAttribute('checked');
        }
    }

    return false;
};

// 创建临时容器
const createTemporaryContainer = (node) => {
    const ownerDocument = node?.ownerDocument;
    if (ownerDocument?.createElement) {
        return ownerDocument.createElement('div');
    }
    if (typeof document !== 'undefined' && document.createElement) {
        return document.createElement('div');
    }
    return null;
};

// 克隆节点到容器
const cloneNodeInto = (target, source) => {
    if (!target || !source) return;

    if (typeof source.cloneNode === 'function') {
        target.appendChild(source.cloneNode(true));
        return;
    }

    const ownerDocument = target.ownerDocument;
    if (ownerDocument?.createTextNode) {
        target.appendChild(ownerDocument.createTextNode(source.textContent || ''));
    }
};

// 提取任务项内部 HTML
const extractTaskItemInnerHtml = (node) => {
    if (!isElementNode(node)) return '';

    // 优先查找专用的内容容器
    const contentWrapper = typeof node.querySelector === 'function'
        ? node.querySelector('.task-list-item__content')
        : null;

    if (contentWrapper && typeof contentWrapper.innerHTML === 'string') {
        return contentWrapper.innerHTML;
    }

    // 手动过滤掉 label 和 checkbox 相关元素
    const container = createTemporaryContainer(node);
    if (!container) {
        return node.textContent || '';
    }

    const children = toArray(node.childNodes);
    children.forEach(child => {
        if (child && child.nodeType === 1) {
            const tagName = (child.nodeName || '').toLowerCase();
            const className = child.getAttribute ? child.getAttribute('class') || '' : '';
            if (tagName === 'label' || className.includes('task-list-item__control')) {
                return; // 跳过控制元素
            }
        }
        cloneNodeInto(container, child);
    });

    return container.innerHTML;
};

// 转换任务项内容为 Markdown
const convertTaskItemContentToMarkdown = (node, turndownService, fallbackMarkdown = '') => {
    const innerHtml = extractTaskItemInnerHtml(node);
    if (!innerHtml) return fallbackMarkdown || '';

    try {
        return turndownService.turndown(innerHtml);
    } catch (error) {
        console.warn('Failed to convert task item content:', error);
        return fallbackMarkdown || '';
    }
};

// 添加任务列表转换规则到 TurndownService
export function addTaskListRules(turndownService) {
    // 任务列表项转换规则
    turndownService.addRule('taskListItem', {
        filter: node => isTaskListItemNode(node),
        replacement: (content, node, options) => {
            const isChecked = readTaskItemChecked(node);
            const checkboxMarker = isChecked ? 'x' : ' ';
            const prefix = `${options.bulletListMarker} [${checkboxMarker}] `;

            const innerMarkdown = convertTaskItemContentToMarkdown(node, turndownService, content);
            const normalized = (innerMarkdown || '')
                .replace(/^\n+/, '')
                .replace(/\n+$/, '\n')
                .replace(/\n{3,}/g, '\n\n');

            const indented = normalized
                .split('\n')
                .map((line, index) => {
                    if (!line) return '';
                    return index === 0 ? line : ' '.repeat(prefix.length) + line;
                })
                .join('\n')
                .replace(/\s+$/, '');

            const needsLineBreak = Boolean(node.nextSibling) && !/\n$/.test(indented);
            return prefix + indented + (needsLineBreak ? '\n' : '');
        },
    });
}
