/**
 * 卡片导出侧边栏的选区追踪控制器。
 * 负责监听 document.selectionchange、debounce、取选中文本/HTML、sanitize，
 * 结果回写到传入的 sidebar 实例,并触发 sidebar 的预览刷新。
 */

const DEBOUNCE_MS = 300;

export class CardSelectionController {
    constructor(sidebar) {
        this.sidebar = sidebar;
        this.active = false;
        this.debounceTimer = null;
        this.onChange = this.onChange.bind(this);
    }

    start() {
        if (this.active) return;
        this.active = true;
        document.addEventListener('selectionchange', this.onChange);
    }

    stop() {
        if (!this.active) return;
        this.active = false;
        document.removeEventListener('selectionchange', this.onChange);
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
    }

    onChange() {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => this.capture(false), DEBOUNCE_MS);
    }

    /**
     * 取当前选区 payload 并触发 sidebar 的预览更新。
     * @param {boolean} forceUpdate 即使选区为空也更新(用于 onShow 首次刷新)
     */
    capture(forceUpdate = false) {
        const payload = this.getPayload();
        if (!payload.inMarkdown) return;
        if (!payload.text && !payload.html && !forceUpdate) return;
        this.sidebar.updateContentPreview({ ...payload, forceUpdate });
    }

    getPayload() {
        try {
            const selection = window.getSelection();
            if (!selection || selection.rangeCount === 0) {
                return { text: '', html: '', inMarkdown: false };
            }

            const text = selection.toString().trim();
            const range = selection.getRangeAt(0);
            const markdownRoot =
                document.querySelector('.markdown-pane .markdown-content') ||
                document.querySelector('.markdown-content');

            if (!markdownRoot || !range || !markdownRoot.contains(range.commonAncestorContainer)) {
                return { text: '', html: '', inMarkdown: false };
            }

            const fragment = range.cloneContents();
            const container = document.createElement('div');
            container.appendChild(fragment);
            container.style.cssText = 'position: fixed; left: -99999px; top: -99999px; visibility: hidden; pointer-events: none;';
            document.body.appendChild(container);
            try {
                sanitizeSelectionHtml(container);
                const html = container.innerHTML.trim();
                return { text, html, inMarkdown: true };
            } finally {
                container.remove();
            }
        } catch (error) {
            console.warn('[CardSelectionController] 无法读取选中文本', error);
            return { text: '', html: '', inMarkdown: false };
        }
    }
}

/**
 * 清洗选区 HTML:移除 script/style/事件属性/颜色内联样式,孤立 li 用 ul 包裹。
 */
function sanitizeSelectionHtml(container) {
    if (!container) return;

    container.querySelectorAll('script, style').forEach(node => node.remove());
    container.querySelectorAll('*').forEach(node => {
        [...node.attributes].forEach(attr => {
            const name = attr.name.toLowerCase();
            if (name.startsWith('on') || name === 'contenteditable') {
                node.removeAttribute(attr.name);
            }
        });
        if (node.style) {
            const tag = node.tagName?.toLowerCase?.() || '';
            const classList = node.classList || { contains: () => false };
            const isViewContainer =
                tag === 'body' ||
                tag === 'html' ||
                classList.contains('markdown-pane') ||
                classList.contains('markdown-content') ||
                classList.contains('tiptap-editor');

            // 移除颜色相关的内联样式，由 CSS 的 data-theme-appearance 规则控制
            node.style.removeProperty('color');
            node.style.removeProperty('background-color');

            if (isViewContainer) {
                node.style.removeProperty('background');
                node.style.removeProperty('background-image');
            }
        }
    });

    // 检测孤立的 li 元素(没有 ul/ol 父级),用 ul 包裹
    const orphanLis = [...container.children].filter(child => child.tagName === 'LI');
    if (orphanLis.length > 0) {
        const ul = document.createElement('ul');
        orphanLis.forEach(li => ul.appendChild(li));
        container.appendChild(ul);
    }
}
