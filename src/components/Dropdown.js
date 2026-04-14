/**
 * 轻量自定义下拉组件。
 * 接管一个原生 <select> 元素：隐藏原生控件，渲染纯 DOM 的 trigger + panel，
 * 保持与 <select> 的值双向同步，form submit 读取 select.value 仍然有效。
 *
 * 目的：规避 WebView2 原生 <select> popup 无法响应 color-scheme 的平台差异。
 */
import { addClickHandler } from '../utils/PointerHelper.js';

export class Dropdown {
    constructor(selectEl) {
        this.select = selectEl;
        this.isOpen = false;
        this._cleanups = [];

        this._buildUI();
        this._rebuildPanel();
        this._bindEvents();
    }

    _buildUI() {
        this.select.style.display = 'none';
        this.select.tabIndex = -1;

        this.trigger = document.createElement('button');
        this.trigger.type = 'button';
        this.trigger.className = 'dropdown__trigger';
        for (const c of this.select.classList) {
            this.trigger.classList.add(c);
        }
        this.trigger.innerHTML = `
            <span class="dropdown__trigger-label"></span>
            <svg class="dropdown__arrow" width="12" height="12" viewBox="0 0 20 20" aria-hidden="true">
                <path d="M6 8L10 12L14 8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        `;
        this.select.insertAdjacentElement('afterend', this.trigger);

        this.panel = document.createElement('div');
        this.panel.className = 'dropdown__panel';
        this.panel.setAttribute('role', 'listbox');
        document.body.appendChild(this.panel);
    }

    _rebuildPanel() {
        this.panel.innerHTML = '';
        this._optionEls = [];

        for (const child of Array.from(this.select.children)) {
            if (child.tagName === 'OPTGROUP') {
                const group = document.createElement('div');
                group.className = 'dropdown__group';
                const label = document.createElement('div');
                label.className = 'dropdown__group-label';
                label.textContent = child.label || '';
                group.appendChild(label);
                for (const opt of Array.from(child.children)) {
                    group.appendChild(this._makeOption(opt));
                }
                this.panel.appendChild(group);
            } else if (child.tagName === 'OPTION') {
                this.panel.appendChild(this._makeOption(child));
            }
        }
        this._syncTriggerLabel();
    }

    _makeOption(optionEl) {
        const el = document.createElement('div');
        el.className = 'dropdown__option';
        el.setAttribute('role', 'option');
        el.textContent = optionEl.textContent;
        el.dataset.value = optionEl.value;
        if (optionEl.value === this.select.value) {
            el.classList.add('is-selected');
        }
        const cleanup = addClickHandler(el, (e) => {
            e.preventDefault();
            e.stopPropagation();
            this._selectValue(optionEl.value);
            this.close();
        });
        this._cleanups.push(cleanup);
        this._optionEls.push(el);
        return el;
    }

    _syncTriggerLabel() {
        const selected = this.select.options[this.select.selectedIndex];
        const labelEl = this.trigger.querySelector('.dropdown__trigger-label');
        labelEl.textContent = selected ? selected.textContent : '';
        for (const el of this._optionEls) {
            el.classList.toggle('is-selected', el.dataset.value === this.select.value);
        }
    }

    _selectValue(value) {
        this.select.value = value;
        this.select.dispatchEvent(new Event('change', { bubbles: true }));
        this._syncTriggerLabel();
    }

    setValue(value) {
        const v = value == null ? '' : String(value);
        this.select.value = v;
        this._syncTriggerLabel();
    }

    refresh() {
        this._rebuildPanel();
    }

    _bindEvents() {
        const triggerCleanup = addClickHandler(this.trigger, (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.isOpen ? this.close() : this.open();
        });
        this._cleanups.push(triggerCleanup);

        // 点击外层 <label> 的文字区域也能打开下拉（原生 <label> click 无法触达隐藏的 select）
        const parentLabel = this.select.closest('label');
        if (parentLabel) {
            const labelCleanup = addClickHandler(parentLabel, (e) => {
                if (this.trigger.contains(e.target)) return;
                if (this.panel.contains(e.target)) return;
                e.preventDefault();
                this.isOpen ? this.close() : this.open();
            });
            this._cleanups.push(labelCleanup);
        }

        this._onDocClick = (e) => {
            if (!this.isOpen) return;
            if (this.panel.contains(e.target) || this.trigger.contains(e.target)) return;
            this.close();
        };
        this._onKey = (e) => {
            if (!this.isOpen) return;
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                this.close();
                this.trigger.focus();
                return;
            }
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                this._moveHighlight(e.key === 'ArrowDown' ? 1 : -1);
                return;
            }
            if (e.key === 'Enter') {
                e.preventDefault();
                if (this._highlightedEl) {
                    this._selectValue(this._highlightedEl.dataset.value);
                    this.close();
                    this.trigger.focus();
                }
            }
        };
        this._onScroll = () => {
            if (this.isOpen) this.close();
        };
        this._onResize = () => {
            if (this.isOpen) this._positionPanel();
        };

        document.addEventListener('mousedown', this._onDocClick, true);
        document.addEventListener('keydown', this._onKey);
        window.addEventListener('resize', this._onResize);
        window.addEventListener('scroll', this._onScroll, true);
    }

    _moveHighlight(dir) {
        if (this._optionEls.length === 0) return;
        let idx = this._optionEls.findIndex(el => el === this._highlightedEl);
        if (idx === -1) {
            idx = this._optionEls.findIndex(el => el.classList.contains('is-selected'));
        }
        idx = (idx + dir + this._optionEls.length) % this._optionEls.length;
        this._setHighlight(this._optionEls[idx]);
    }

    _setHighlight(el) {
        if (this._highlightedEl) {
            this._highlightedEl.classList.remove('is-highlighted');
        }
        this._highlightedEl = el;
        if (el) {
            el.classList.add('is-highlighted');
            el.scrollIntoView({ block: 'nearest' });
        }
    }

    _positionPanel() {
        const rect = this.trigger.getBoundingClientRect();
        const panelHeight = this.panel.offsetHeight;
        const spaceBelow = window.innerHeight - rect.bottom;
        const openUp = spaceBelow < panelHeight + 8 && rect.top > panelHeight + 8;
        this.panel.style.left = `${rect.left}px`;
        this.panel.style.minWidth = `${rect.width}px`;
        if (openUp) {
            this.panel.style.top = `${rect.top - panelHeight - 4}px`;
        } else {
            this.panel.style.top = `${rect.bottom + 4}px`;
        }
    }

    open() {
        if (this.isOpen) return;
        this.isOpen = true;
        this.panel.classList.add('is-open');
        this.trigger.classList.add('is-open');
        this._positionPanel();
        const selectedEl = this._optionEls.find(el => el.classList.contains('is-selected'));
        if (selectedEl) this._setHighlight(selectedEl);
    }

    close() {
        if (!this.isOpen) return;
        this.isOpen = false;
        this.panel.classList.remove('is-open');
        this.trigger.classList.remove('is-open');
        if (this._highlightedEl) {
            this._highlightedEl.classList.remove('is-highlighted');
            this._highlightedEl = null;
        }
    }

    destroy() {
        this.close();
        for (const cleanup of this._cleanups) {
            if (typeof cleanup === 'function') cleanup();
        }
        this._cleanups = [];
        document.removeEventListener('mousedown', this._onDocClick, true);
        document.removeEventListener('keydown', this._onKey);
        window.removeEventListener('resize', this._onResize);
        window.removeEventListener('scroll', this._onScroll, true);
        if (this.trigger && this.trigger.parentElement) {
            this.trigger.remove();
        }
        if (this.panel && this.panel.parentElement) {
            this.panel.remove();
        }
        if (this.select) {
            this.select.style.display = '';
            this.select.tabIndex = 0;
        }
    }
}
