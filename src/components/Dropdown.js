/**
 * 轻量自定义下拉组件。
 * 接管一个原生 <select> 元素：隐藏原生控件，渲染纯 DOM 的 trigger + panel，
 * 保持与 <select> 的值双向同步，form submit 读取 select.value 仍然有效。
 *
 * 目的：规避 WebView2 原生 <select> popup 无法响应 color-scheme 的平台差异。
 */
import { addClickHandler } from '../utils/PointerHelper.js';

let nextDropdownId = 0;

/** 保留原生 select 的值，按需为候选项启用搜索。 */
export class Dropdown {
    /** 初始化视图和输入事件，search 仅用于提供本地化搜索提示。 */
    constructor(selectEl, { search = null } = {}) {
        this.select = selectEl;
        this.search = search;
        this._listId = `dropdown-list-${++nextDropdownId}`;
        this.isOpen = false;
        this._cleanups = [];
        this._optionCleanups = [];

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
        this.optionsList = document.createElement('div');
        this.optionsList.id = this._listId;
        this.optionsList.setAttribute('role', 'listbox');
        this.trigger.setAttribute('aria-controls', this._listId);
        this.trigger.setAttribute('aria-expanded', 'false');
        this.trigger.setAttribute('aria-haspopup', 'listbox');
        if (this.search) this._buildSearch();
        this.panel.appendChild(this.optionsList);
        if (this.emptyResult) this.panel.appendChild(this.emptyResult);
        document.body.appendChild(this.panel);
    }

    /** 搜索框持有焦点，通过 aria-activedescendant 指向高亮候选。 */
    _buildSearch() {
        this.panel.classList.add('dropdown__panel--searchable');
        this.searchInput = document.createElement('input');
        this.searchInput.type = 'text';
        this.searchInput.className = 'dropdown__search';
        this.searchInput.placeholder = this.search.placeholder;
        this.searchInput.autocomplete = 'off';
        this.searchInput.spellcheck = false;
        this.searchInput.setAttribute('aria-label', this.search.placeholder);
        this.searchInput.setAttribute('role', 'combobox');
        this.searchInput.setAttribute('aria-autocomplete', 'list');
        this.searchInput.setAttribute('aria-controls', this._listId);
        this.searchInput.setAttribute('aria-expanded', 'false');
        this.panel.appendChild(this.searchInput);

        this.emptyResult = document.createElement('div');
        this.emptyResult.className = 'dropdown__empty';
        this.emptyResult.setAttribute('role', 'status');
        this.emptyResult.textContent = this.search.empty;
        this.emptyResult.hidden = true;
    }

    _rebuildPanel() {
        for (const cleanup of this._optionCleanups) cleanup();
        this._optionCleanups = [];
        this._setHighlight(null);
        this.optionsList.replaceChildren();
        this._optionEls = [];

        for (const child of Array.from(this.select.children)) {
            if (child.tagName === 'OPTGROUP') {
                const group = document.createElement('div');
                group.className = 'dropdown__group';
                group.setAttribute('role', 'group');
                group.setAttribute('aria-label', child.label);
                const label = document.createElement('div');
                label.className = 'dropdown__group-label';
                label.textContent = child.label || '';
                group.appendChild(label);
                for (const opt of Array.from(child.children)) {
                    group.appendChild(this._makeOption(opt));
                }
                this.optionsList.appendChild(group);
            } else if (child.tagName === 'OPTION') {
                this.optionsList.appendChild(this._makeOption(child));
            }
        }
        this._syncTriggerLabel();
        if (this.searchInput && this.isOpen) this._filterOptions();
    }

    _makeOption(optionEl) {
        const el = document.createElement('div');
        el.className = 'dropdown__option';
        el.id = `${this._listId}-option-${this._optionEls.length}`;
        el.setAttribute('role', 'option');
        el.textContent = optionEl.textContent;
        el.dataset.value = optionEl.value;
        el.dataset.searchText = `${optionEl.textContent} ${optionEl.parentElement?.label || ''}`.toLowerCase();
        if (optionEl.disabled) el.setAttribute('aria-disabled', 'true');
        const cleanup = addClickHandler(el, (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (optionEl.disabled) return;
            this._selectValue(optionEl.value);
            this.close();
            if (this.searchInput) this.trigger.focus();
        });
        this._optionCleanups.push(cleanup);
        this._optionEls.push(el);
        return el;
    }

    _syncTriggerLabel() {
        const selected = this.select.options[this.select.selectedIndex];
        const labelEl = this.trigger.querySelector('.dropdown__trigger-label');
        labelEl.textContent = selected ? selected.textContent : '';
        for (const el of this._optionEls) {
            const selected = el.dataset.value === this.select.value;
            el.classList.toggle('is-selected', selected);
            el.setAttribute('aria-selected', String(selected));
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
            if (e.isComposing || e.keyCode === 229) return;
            const isArrow = e.key === 'ArrowDown' || e.key === 'ArrowUp';
            if (!this.isOpen) {
                if (this.searchInput && e.target === this.trigger && isArrow) {
                    e.preventDefault();
                    this.open(e.key === 'ArrowDown' ? 1 : -1);
                }
                return;
            }
            if (this.searchInput && e.target !== this.searchInput && e.target !== this.trigger) return;
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                this.close();
                this.trigger.focus();
                return;
            }
            if (e.key === 'Tab' && this.searchInput) {
                this.close();
                this.trigger.focus();
                return;
            }
            if (isArrow) {
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
        this._onScroll = (e) => {
            if (!this.isOpen) return;
            // panel 自身滚动不关闭
            if (e.target === this.panel || (this.panel.contains && this.panel.contains(e.target))) return;
            this.close();
        };
        this._onResize = () => {
            if (this.isOpen) this._positionPanel();
        };

        document.addEventListener('mousedown', this._onDocClick, true);
        this._keyTargets = this.searchInput ? [this.trigger, this.searchInput] : [document];
        for (const target of this._keyTargets) target.addEventListener('keydown', this._onKey);
        if (this.searchInput) {
            this._onSearchInput = (event) => {
                if (!event.isComposing) this._filterOptions();
            };
            this.searchInput.addEventListener('input', this._onSearchInput);
            this.searchInput.addEventListener('compositionend', this._onSearchInput);
        }
        window.addEventListener('resize', this._onResize);
        window.addEventListener('scroll', this._onScroll, true);
    }

    /** 按模型名和供应商逐词匹配，隐藏空分组和不再匹配的候选。 */
    _filterOptions() {
        const terms = this.searchInput.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
        for (const option of this._optionEls) {
            option.hidden = terms.length > 0 && (!option.dataset.value
                || !terms.every(term => option.dataset.searchText.includes(term)));
        }
        for (const group of this.optionsList.querySelectorAll('.dropdown__group')) {
            group.hidden = !group.querySelector('.dropdown__option:not([hidden])');
        }
        const first = this._optionEls.find(option => !option.hidden && !option.hasAttribute('aria-disabled'));
        this.emptyResult.hidden = Boolean(first);
        this._positionPanel();
        this.optionsList.scrollTop = 0;
        this._setHighlight(terms.length ? first : this._optionEls.find(option => option.classList.contains('is-selected')));
    }

    _moveHighlight(dir) {
        const options = this._optionEls.filter(option => !option.hidden && !option.hasAttribute('aria-disabled'));
        if (!options.length) return;
        const currentIndex = options.indexOf(this._highlightedEl);
        const nextIndex = currentIndex === -1
            ? (dir > 0 ? 0 : options.length - 1)
            : (currentIndex + dir + options.length) % options.length;
        this._setHighlight(options[nextIndex]);
    }

    _setHighlight(el) {
        if (this._highlightedEl) {
            this._highlightedEl.classList.remove('is-highlighted');
        }
        this._highlightedEl = el && !el.hasAttribute('aria-disabled') ? el : null;
        this.searchInput?.removeAttribute('aria-activedescendant');
        if (this._highlightedEl) {
            el.classList.add('is-highlighted');
            this.searchInput?.setAttribute('aria-activedescendant', el.id);
            if (this.searchInput) {
                this._revealSearchOption(el);
            } else {
                el.scrollIntoView({ block: 'nearest' });
            }
        }
    }

    /** 只滚动候选列表，保持搜索栏及下拉框锚点不动。 */
    _revealSearchOption(option) {
        const list = this.optionsList;
        const viewport = list.getBoundingClientRect();
        const row = option.getBoundingClientRect();
        if (row.top < viewport.top) {
            list.scrollTop += row.top - viewport.top;
        } else if (row.bottom > viewport.bottom) {
            list.scrollTop += row.bottom - viewport.bottom;
        }
    }

    /** 在触发按钮两侧取可用空间，把搜索框和列表都限制在窗口内。 */
    _positionSearchPanel(rect) {
        const margin = 8;
        const gap = 4;
        const above = rect.top - gap - margin;
        const below = window.innerHeight - rect.bottom - gap - margin;
        this.panel.style.minWidth = `${Math.max(0, Math.min(rect.width, window.innerWidth - 2 * margin))}px`;
        this.panel.style.maxHeight = '';
        const preferredHeight = this.panel.offsetHeight;
        const openUp = below < preferredHeight && above > below;
        this.panel.style.maxHeight = `${Math.max(0, Math.min(preferredHeight, openUp ? above : below))}px`;
        const left = Math.max(margin, Math.min(rect.left, window.innerWidth - this.panel.offsetWidth - margin));
        this.panel.style.left = `${left}px`;
        this.panel.style.top = `${openUp ? rect.top - this.panel.offsetHeight - gap : rect.bottom + gap}px`;
    }

    _positionPanel() {
        const rect = this.trigger.getBoundingClientRect();
        if (this.searchInput) {
            this._positionSearchPanel(rect);
            return;
        }
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

    open(direction = null) {
        if (this.isOpen) return;
        this.isOpen = true;
        this.panel.classList.add('is-open');
        this.trigger.classList.add('is-open');
        this.trigger.setAttribute('aria-expanded', 'true');
        if (this.searchInput) {
            this.searchInput.value = '';
            this.searchInput.setAttribute('aria-expanded', 'true');
            this._filterOptions();
            this.searchInput.focus({ preventScroll: true });
            if (direction !== null) this._moveHighlight(direction);
            return;
        }
        this._positionPanel();
        const selectedEl = this._optionEls.find(el => el.classList.contains('is-selected'));
        if (selectedEl) this._setHighlight(selectedEl);
    }

    close() {
        if (!this.isOpen) return;
        this.isOpen = false;
        this.panel.classList.remove('is-open');
        this.trigger.classList.remove('is-open');
        this.trigger.setAttribute('aria-expanded', 'false');
        this.searchInput?.setAttribute('aria-expanded', 'false');
        this._setHighlight(null);
    }

    destroy() {
        this.close();
        for (const cleanup of this._cleanups) {
            if (typeof cleanup === 'function') cleanup();
        }
        this._cleanups = [];
        for (const cleanup of this._optionCleanups) cleanup();
        this._optionCleanups = [];
        document.removeEventListener('mousedown', this._onDocClick, true);
        for (const target of this._keyTargets) target.removeEventListener('keydown', this._onKey);
        this.searchInput?.removeEventListener('input', this._onSearchInput);
        this.searchInput?.removeEventListener('compositionend', this._onSearchInput);
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
