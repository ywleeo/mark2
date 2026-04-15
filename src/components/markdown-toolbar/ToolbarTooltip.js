/**
 * 工具栏按钮的 tooltip 控制器。
 * 独立管理 tooltip DOM 节点、定位逻辑、滚动隐藏。
 */
export class ToolbarTooltip {
    constructor() {
        this.element = null;
        this.boundScrollHandler = null;
        this.init();
    }

    init() {
        if (typeof document === 'undefined') return;
        this.element = document.createElement('div');
        this.element.className = 'markdown-toolbar-tooltip';
        this.element.setAttribute('role', 'tooltip');
        document.body.appendChild(this.element);
        this.hide();

        if (typeof window !== 'undefined') {
            this.boundScrollHandler = () => this.hide();
            window.addEventListener('scroll', this.boundScrollHandler, true);
        }
    }

    show(button, text) {
        if (!this.element || !text || typeof window === 'undefined') return;

        this.element.textContent = text;
        this.element.style.left = '0px';
        this.element.style.top = '0px';
        this.element.classList.add('is-visible', 'is-measuring');

        const buttonRect = button.getBoundingClientRect();
        const tooltipRect = this.element.getBoundingClientRect();
        const spacing = 12;
        const viewportPadding = 12;

        let left = buttonRect.left + (buttonRect.width / 2) - (tooltipRect.width / 2);
        const maxLeft = window.innerWidth - tooltipRect.width - viewportPadding;
        left = Math.min(Math.max(left, viewportPadding), Math.max(maxLeft, viewportPadding));

        const availableBelow = window.innerHeight - buttonRect.bottom - viewportPadding;
        const availableAbove = buttonRect.top - viewportPadding;
        let top;
        if (tooltipRect.height > availableBelow && availableAbove > availableBelow) {
            top = Math.max(viewportPadding, buttonRect.top - tooltipRect.height - spacing);
        } else {
            top = buttonRect.bottom + spacing;
            const maxTop = window.innerHeight - tooltipRect.height - viewportPadding;
            top = Math.min(Math.max(top, viewportPadding), Math.max(maxTop, viewportPadding));
        }

        this.element.style.left = `${left}px`;
        this.element.style.top = `${top}px`;
        this.element.classList.remove('is-measuring');
    }

    hide() {
        if (this.element) {
            this.element.classList.remove('is-visible', 'is-measuring');
        }
    }

    destroy() {
        if (this.element?.parentNode) {
            this.element.parentNode.removeChild(this.element);
        }
        this.element = null;
        if (this.boundScrollHandler && typeof window !== 'undefined') {
            window.removeEventListener('scroll', this.boundScrollHandler, true);
            this.boundScrollHandler = null;
        }
    }
}
