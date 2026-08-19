import { mergeAttributes, Node } from '@tiptap/core';

/**
 * 合并内部结构类名与用户类名，避免重复写入 details-block。
 * @param {unknown} userClass - 用户提供的 class 属性
 * @returns {string}
 */
function normalizeDetailsClassName(userClass) {
    const classNames = typeof userClass === 'string' ? userClass.split(/\s+/).filter(Boolean) : [];
    return Array.from(new Set(['details-block', ...classNames])).join(' ');
}

/**
 * 把 details 节点属性同步到 NodeView DOM，并保留用户提供的基础 HTML 属性。
 * @param {HTMLDetailsElement} element - 折叠块 DOM
 * @param {Record<string, unknown>} attrs - ProseMirror 节点属性
 */
function applyDetailsAttributes(element, attrs) {
    element.className = normalizeDetailsClassName(attrs.class);
    element.dataset.type = 'details-block';
    element.open = attrs.open === true;

    if (attrs.id) element.id = String(attrs.id);
    else element.removeAttribute('id');

    if (attrs.style) element.setAttribute('style', String(attrs.style));
    else element.removeAttribute('style');
}

/**
 * 原生 `<details>` 折叠块。
 * summary 由第一个 detailsSummary 子节点承载，后续 block 子节点继续使用标准 Markdown 结构。
 */
export const DetailsBlock = Node.create({
    name: 'detailsBlock',
    group: 'block',
    content: 'detailsSummary block*',
    defining: true,
    isolating: true,

    addAttributes() {
        return {
            open: {
                default: false,
                parseHTML: element => element.hasAttribute('open'),
                renderHTML: attributes => (attributes.open ? { open: '' } : {}),
            },
            id: {
                default: null,
                parseHTML: element => element.getAttribute('id'),
            },
            class: {
                default: null,
                parseHTML: element => element.getAttribute('class'),
            },
            style: {
                default: null,
                parseHTML: element => element.getAttribute('style'),
            },
        };
    },

    parseHTML() {
        return [{ tag: 'details' }];
    },

    renderHTML({ HTMLAttributes }) {
        const { class: userClass, ...attributes } = HTMLAttributes;
        return [
            'details',
            mergeAttributes(
                { 'data-type': 'details-block' },
                attributes,
                { class: normalizeDetailsClassName(userClass) }
            ),
            0,
        ];
    },

    addNodeView() {
        return ({ node }) => {
            const dom = document.createElement('details');
            let currentNode = node;
            applyDetailsAttributes(dom, currentNode.attrs);

            return {
                dom,
                contentDOM: dom,
                update(nextNode) {
                    if (nextNode.type !== currentNode.type) return false;

                    // 用户点击 summary 产生的展开状态只属于当前视图，不应自动改写 Markdown。
                    // 只有文档本身的 open 属性变化时，才覆盖 DOM 的临时展开状态。
                    const documentOpenChanged = nextNode.attrs.open !== currentNode.attrs.open;
                    const transientOpen = dom.open;
                    currentNode = nextNode;
                    applyDetailsAttributes(dom, currentNode.attrs);
                    if (!documentOpenChanged) dom.open = transientOpen;
                    return true;
                },
                ignoreMutation(mutation) {
                    return mutation.type === 'attributes'
                        && mutation.target === dom
                        && mutation.attributeName === 'open';
                },
            };
        };
    },
});

/**
 * `<summary>` 标题节点，只允许行内内容，并且只能作为 detailsBlock 的第一个子节点出现。
 */
export const DetailsSummary = Node.create({
    name: 'detailsSummary',
    content: 'inline*',
    defining: true,

    parseHTML() {
        return [{ tag: 'summary' }];
    },

    renderHTML() {
        return ['summary', { class: 'details-block__summary' }, 0];
    },
});
