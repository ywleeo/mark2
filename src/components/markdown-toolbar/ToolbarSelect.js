/**
 * 工具栏下拉选择器（通用）
 * 把一组互斥操作收进一个下拉。trigger 是普通工具栏按钮，
 * panel 挂在 body 上以 fixed 定位，避免被工具栏裁切。
 * 标题、列表等下拉均复用此组件。
 */
import { addClickHandler } from '../../utils/PointerHelper.js';

export class ToolbarSelect {
    /**
     * @param {object} config
     * @param {string} config.icon - trigger 图标 HTML
     * @param {string} [config.ariaLabel] - trigger 无障碍标签
     * @param {string} [config.dataAction] - trigger 的 data-action 标记
     * @param {Array<{value:*, label:string, iconHtml?:string, itemClass?:string}>} [config.items] - 下拉项
     * @param {(value:*) => void} [config.onSelect] - 选中某项时回调
     */
    constructor(config = {}) {
        this.onSelect = typeof config.onSelect === 'function' ? config.onSelect : () => {};
        this.isOpen = false;
        this._cleanups = [];

        this._build(config);
        this._bindGlobal();
    }

    _build(config) {
        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'toolbar-button toolbar-select';
        if (config.dataAction) trigger.setAttribute('data-action', config.dataAction);
        trigger.setAttribute('aria-label', config.ariaLabel || '');
        trigger.setAttribute('aria-haspopup', 'true');
        trigger.innerHTML = `
            <span class="toolbar-button__icon">${config.icon || ''}</span>
            <svg class="toolbar-select__arrow" width="10" height="10" viewBox="0 0 20 20" aria-hidden="true">
                <path d="M6 8L10 12L14 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        `;
        this.trigger = trigger;
        this._cleanups.push(addClickHandler(trigger, (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.toggle();
        }));

        const panel = document.createElement('div');
        panel.className = 'toolbar-select-panel';
        panel.setAttribute('role', 'listbox');
        for (const item of config.items || []) {
            const el = document.createElement('button');
            el.type = 'button';
            el.className = 'toolbar-select-panel__item';
            if (item.itemClass) el.classList.add(item.itemClass);
            el.setAttribute('role', 'option');
            const iconHtml = item.iconHtml
                ? `<span class="toolbar-select-panel__icon">${item.iconHtml}</span>`
                : '';
            el.innerHTML = `${iconHtml}<span class="toolbar-select-panel__label">${item.label}</span>`;
            this._cleanups.push(addClickHandler(el, (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.close();
                this.onSelect(item.value);
            }));
            panel.appendChild(el);
        }
        this.panel = panel;
        document.body.appendChild(panel);
    }

    _bindGlobal() {
        this._onDocPointer = (e) => {
            if (!this.isOpen) return;
            if (this.panel.contains(e.target) || this.trigger.contains(e.target)) return;
            this.close();
        };
        this._onKey = (e) => {
            if (this.isOpen && e.key === 'Escape') this.close();
        };
        this._onScroll = (e) => {
            if (!this.isOpen) return;
            if (this.panel.contains(e.target)) return;
            this.close();
        };
        this._onResize = () => this.close();

        document.addEventListener('mousedown', this._onDocPointer, true);
        document.addEventListener('keydown', this._onKey);
        window.addEventListener('scroll', this._onScroll, true);
        window.addEventListener('resize', this._onResize);
    }

    /** 返回放进工具栏的 trigger 元素 */
    getElement() {
        return this.trigger;
    }

    toggle() {
        this.isOpen ? this.close() : this.open();
    }

    open() {
        if (this.isOpen) return;
        this.isOpen = true;
        this._position();
        this.panel.classList.add('is-open');
        this.trigger.classList.add('toolbar-button--active');
    }

    close() {
        if (!this.isOpen) return;
        this.isOpen = false;
        this.panel.classList.remove('is-open');
        this.trigger.classList.remove('toolbar-button--active');
    }

    _position() {
        const rect = this.trigger.getBoundingClientRect();
        this.panel.style.top = `${rect.bottom + 4}px`;
        this.panel.style.left = `${rect.left}px`;
    }

    destroy() {
        this.close();
        this._cleanups.forEach(fn => typeof fn === 'function' && fn());
        this._cleanups = [];
        document.removeEventListener('mousedown', this._onDocPointer, true);
        document.removeEventListener('keydown', this._onKey);
        window.removeEventListener('scroll', this._onScroll, true);
        window.removeEventListener('resize', this._onResize);
        this.panel?.remove();
        this.trigger?.remove();
    }
}
