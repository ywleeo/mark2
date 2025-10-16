// 剪贴板增强模块 - 复制时添加内联样式

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

            // 克隆选中的内容
            const fragment = range.cloneContents();
            const container = document.createElement('div');
            container.appendChild(fragment);

            // 找到所有选中范围内的原始元素（用于获取计算样式）
            const originalElements = this.getSelectedElements(range);

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

            // 设置剪贴板内容
            const html = container.innerHTML;
            const text = container.textContent || '';

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
