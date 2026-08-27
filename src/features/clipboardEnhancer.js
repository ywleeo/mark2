// 剪贴板增强模块：复制时补齐展示样式，粘贴时清理外部富文本样式。

const REMOVED_ELEMENT_SELECTOR = 'script, style, meta, link, title, xml';
const UNWRAPPED_INLINE_TAGS = new Set(['SPAN', 'FONT', 'O:P']);
const BLOCK_TAGS = new Set([
    'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DIV', 'DL', 'FIELDSET',
    'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'HEADER', 'HR', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'UL',
]);

/**
 * 根据富文本 CSS 提取 Markdown 能表达的行内语义。
 * @param {string} style - 元素的 style 属性
 * @returns {string[]}
 */
function getSemanticTagsFromStyle(style) {
    if (!style) return [];
    const tags = [];
    const fontWeight = style.match(/(?:^|;)\s*font-weight\s*:\s*([^;]+)/i)?.[1]?.trim().toLowerCase() || '';
    const numericWeight = Number.parseInt(fontWeight, 10);
    if (fontWeight === 'bold' || fontWeight === 'bolder' || (Number.isFinite(numericWeight) && numericWeight >= 600)) {
        tags.push('strong');
    }
    if (/(?:^|;)\s*font-style\s*:\s*(?:italic|oblique)\b/i.test(style)) {
        tags.push('em');
    }
    if (/(?:^|;)\s*text-decoration(?:-line)?\s*:[^;]*\bline-through\b/i.test(style)) {
        tags.push('s');
    }
    return tags;
}

/**
 * 用语义标签包裹元素内容，让 CSS 粗体、斜体和删除线能够转换为 Markdown 标记。
 * @param {Element} element - 待转换的富文本元素
 * @param {Document} documentRef - 当前 WebView 文档
 */
function promoteVisualStyleToSemanticTags(element, documentRef) {
    const currentTag = element.tagName?.toLowerCase() || '';
    const semanticTags = getSemanticTagsFromStyle(element.getAttribute('style') || '')
        .filter(tag => !(
            (tag === 'strong' && (currentTag === 'strong' || currentTag === 'b'))
            || (tag === 'em' && (currentTag === 'em' || currentTag === 'i'))
            || (tag === 's' && (currentTag === 's' || currentTag === 'strike' || currentTag === 'del'))
        ));

    for (const tag of semanticTags) {
        const wrapper = documentRef.createElement(tag);
        while (element.firstChild) wrapper.appendChild(element.firstChild);
        element.appendChild(wrapper);
    }
}

/**
 * 仅保留 Markdown 结构解析需要的 HTML 属性。
 * @param {Element} element - 待清理的元素
 */
function removePresentationalAttributes(element) {
    const tag = element.tagName?.toLowerCase() || '';
    const allowedByTag = {
        a: new Set(['href', 'title']),
        img: new Set(['src', 'alt', 'title']),
        ol: new Set(['start']),
        li: new Set(['value']),
        td: new Set(['colspan', 'rowspan']),
        th: new Set(['colspan', 'rowspan']),
        input: new Set(['type', 'checked']),
    };
    const allowed = allowedByTag[tag] || new Set();

    for (const attribute of Array.from(element.attributes || [])) {
        const name = attribute.name.toLowerCase();
        const isCodeLanguage = tag === 'code'
            && name === 'class'
            && /(?:^|\s)language-[\w-]+(?:\s|$)/i.test(attribute.value);
        if (!allowed.has(name) && !isCodeLanguage) {
            element.removeAttribute(attribute.name);
        }
    }
}

/**
 * 将没有块级子节点的外部 div 转为普通段落；纯容器 div 则直接展开。
 * @param {Element} element - div 元素
 * @param {Document} documentRef - 当前 WebView 文档
 */
function normalizeExternalDiv(element, documentRef) {
    const hasBlockChild = Array.from(element.children || [])
        .some(child => BLOCK_TAGS.has(child.tagName));
    if (hasBlockChild) {
        element.replaceWith(...Array.from(element.childNodes));
        return;
    }

    const paragraph = documentRef.createElement('p');
    while (element.firstChild) paragraph.appendChild(element.firstChild);
    element.replaceWith(paragraph);
}

/**
 * 在缺少 DOM 的测试或非浏览器环境中执行保守清洗。
 * @param {string} html - 外部剪贴板 HTML
 * @returns {string}
 */
function sanitizeHtmlWithoutDom(html) {
    return html
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<(script|style|title|xml)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
        .replace(/<(?:meta|link)\b[^>]*\/?\s*>/gi, '')
        .replace(/<\/?(?:span|font|o:p)\b[^>]*>/gi, '')
        .replace(/\s(?:style|class|id|lang|dir)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
}

/**
 * 判断剪贴板 HTML 是否由 ProseMirror 的结构化序列化器生成。
 * 这类内容携带开放深度和节点上下文，不能用浏览器 Range 克隆结果覆盖。
 * @param {string} html - 剪贴板中的 HTML
 * @returns {boolean}
 */
export function isProseMirrorClipboardHtml(html) {
    return typeof html === 'string' && /\bdata-pm-slice\s*=/i.test(html);
}

/**
 * 清理 Word、网页等外部来源的剪贴板 HTML，只留下 Markdown 可表达的语义结构。
 * ProseMirror 自身生成的 HTML 携带切片上下文，必须原样保留。
 * @param {string} html - 剪贴板 HTML
 * @param {Document|null} documentRef - 可选的 DOM 文档，主要用于测试
 * @returns {string}
 */
export function sanitizePastedHtml(html, documentRef = globalThis.document) {
    if (typeof html !== 'string' || !html || isProseMirrorClipboardHtml(html)) return html;
    if (!documentRef?.createElement) return sanitizeHtmlWithoutDom(html);

    const template = documentRef.createElement('template');
    template.innerHTML = html.replace(/<!--[\s\S]*?-->/g, '');
    const root = template.content || template;
    root.querySelectorAll(REMOVED_ELEMENT_SELECTOR).forEach(element => element.remove());

    // 自内向外处理，确保展开 span/font 时已经完成其子节点的清洗。
    const elements = Array.from(root.querySelectorAll('*')).reverse();
    for (const element of elements) {
        promoteVisualStyleToSemanticTags(element, documentRef);
        removePresentationalAttributes(element);

        if (UNWRAPPED_INLINE_TAGS.has(element.tagName)) {
            element.replaceWith(...Array.from(element.childNodes));
        } else if (element.tagName === 'DIV') {
            normalizeExternalDiv(element, documentRef);
        }
    }

    return template.innerHTML;
}

/** 复制选区时为外部富文本目标补齐计算样式。 */
export class ClipboardEnhancer {
    constructor(element) {
        this.element = element;
        this.boundHandleCopy = this.handleCopy.bind(this);
        this.init();
    }

    init() {
        if (this.element) {
            this.element.addEventListener('copy', this.boundHandleCopy);
        }
    }

    handleCopy(event) {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) {
            return;
        }

        try {
            const range = selection.getRangeAt(0);
            const nativeHtml = event.clipboardData?.getData('text/html') || '';
            const nativeText = event.clipboardData?.getData('text/plain') || '';

            // ProseMirror 已经序列化过的内容必须作为结构来源，否则 TaskItem
            // 等 NodeView 的控件 DOM 会和正文拆开。普通选区才回退到 Range 克隆。
            const container = document.createElement('div');
            if (isProseMirrorClipboardHtml(nativeHtml)) {
                container.innerHTML = nativeHtml;
            } else {
                container.appendChild(range.cloneContents());
            }

            // 找到所有选中范围内的原始元素（用于获取计算样式）
            const originalElements = this.getSelectedElements(range);

            // 移除 KaTeX 的 MathML 源码元素（隐藏但会被复制）
            container.querySelectorAll('.katex-mathml').forEach(el => el.remove());

            // 为克隆的元素添加内联样式
            const clonedElements = container.querySelectorAll('*');

            // 创建原始元素到克隆元素的映射
            clonedElements.forEach((clonedEl, index) => {
                // 尝试找到对应的原始元素
                if (index < originalElements.length) {
                    const originalEl = originalElements[index];
                    const computedStyle = window.getComputedStyle(originalEl);
                    const inlineStyle = this.computedToInline(originalEl, computedStyle);

                    if (inlineStyle) {
                        // 合并原有的内联样式
                        const existingStyle = clonedEl.getAttribute('style') || '';
                        const mergedStyle = existingStyle ? `${existingStyle}; ${inlineStyle}` : inlineStyle;
                        clonedEl.setAttribute('style', mergedStyle);
                    }
                }
            });

            // 先提取 HTML（保留 KaTeX 渲染效果）
            const html = container.innerHTML;

            // 清理数学公式中 KaTeX span 之间的多余换行
            container.querySelectorAll('.math-block, .math-inline').forEach(el => {
                const raw = el.textContent || '';
                el.textContent = raw.replace(/\n/g, '');
            });
            const text = nativeText || container.textContent || '';

            event.clipboardData.setData('text/html', html);
            event.clipboardData.setData('text/plain', text);
            event.preventDefault();

        } catch (error) {
            console.error('复制处理失败:', error);
            // 出错时使用默认行为
        }
    }

    getSelectedElements(range) {
        const elements = [];
        const container = range.commonAncestorContainer;

        // 如果容器是文本节点，使用其父元素
        const containerElement = container.nodeType === Node.ELEMENT_NODE
            ? container
            : container.parentElement;

        if (!containerElement) return elements;

        // 获取容器内的所有元素
        const allElements = containerElement.querySelectorAll('*');

        allElements.forEach(element => {
            // 检查元素是否在选中范围内
            if (range.intersectsNode(element)) {
                elements.push(element);
            }
        });

        // 也包含容器本身
        if (range.intersectsNode(containerElement)) {
            elements.push(containerElement);
        }

        return elements;
    }

    computedToInline(element, computedStyle) {
        const styles = [];

        // 关键样式属性
        const props = [
            'color',
            'background-color',
            'background',
            'font-size',
            'font-weight',
            'font-style',
            'font-family',
            'line-height',
            'text-decoration',
            'text-align',
            'border-left',
            'border-right',
            'border-top',
            'border-bottom',
            'border-color',
            'border-width',
            'border-style',
            'border-radius',
            'padding',
            'margin-top',
            'margin-bottom',
            'display',
        ];

        props.forEach(prop => {
            const value = computedStyle.getPropertyValue(prop);
            if (value && this.isValidValue(value)) {
                styles.push(`${prop}: ${value}`);
            }
        });

        return styles.length > 0 ? styles.join('; ') : '';
    }

    isValidValue(value) {
        const invalid = ['', 'none', 'normal', 'auto', 'rgba(0, 0, 0, 0)', 'transparent', '0px'];
        return !invalid.includes(value.trim());
    }

    destroy() {
        if (this.element) {
            this.element.removeEventListener('copy', this.boundHandleCopy);
        }
    }
}
