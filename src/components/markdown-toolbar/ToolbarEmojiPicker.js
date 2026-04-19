/**
 * 工具栏 emoji 选择器面板。
 * 结构：顶部搜索框 + 中间分段网格（含最近使用）+ 底部分类 tab 栏。
 * 通过构造函数注入 onSelect 回调,由调用方决定如何插入 emoji。
 */
import { addClickHandler } from '../../utils/PointerHelper.js';
import {
    getCategories,
    getCategoryIcon,
    getCategoryName,
    getEmojiById,
    getLabels,
    searchEmojis
} from './emojiData.js';
import { createStore } from '../../services/storage.js';

const RECENT_KEY = 'emoji-recent';
const RECENT_MAX = 24;
const store = createStore('toolbar');

export class ToolbarEmojiPicker {
    constructor(onSelect) {
        this.onSelect = onSelect;
        this.element = null;
        this.bodyEl = null;
        this.searchInput = null;
        this.tabsEl = null;
        this.visible = false;
        this.outsideHandler = null;
        this.categories = getCategories();
        this.labels = getLabels();
        this.recent = this.loadRecent();
        this.init();
    }

    loadRecent() {
        const ids = store.get(RECENT_KEY, []);
        if (!Array.isArray(ids)) return [];
        return ids.map(id => getEmojiById(id)).filter(Boolean);
    }

    saveRecent(emoji) {
        const exists = this.recent.findIndex(e => e.id === emoji.id);
        if (exists !== -1) this.recent.splice(exists, 1);
        this.recent.unshift(emoji);
        if (this.recent.length > RECENT_MAX) {
            this.recent.length = RECENT_MAX;
        }
        store.set(RECENT_KEY, this.recent.map(e => e.id));
    }

    init() {
        this.element = document.createElement('div');
        this.element.className = 'markdown-toolbar-emoji-picker';

        const searchBar = document.createElement('div');
        searchBar.className = 'emoji-picker-search';
        this.searchInput = document.createElement('input');
        this.searchInput.type = 'text';
        this.searchInput.placeholder = this.labels.search;
        this.searchInput.className = 'emoji-picker-search-input';
        searchBar.appendChild(this.searchInput);

        this.bodyEl = document.createElement('div');
        this.bodyEl.className = 'emoji-picker-body';

        this.tabsEl = document.createElement('div');
        this.tabsEl.className = 'emoji-picker-tabs';

        this.element.appendChild(searchBar);
        this.element.appendChild(this.bodyEl);
        this.element.appendChild(this.tabsEl);
        document.body.appendChild(this.element);

        this.renderBody();
        this.renderTabs();
        this.bindEvents();
    }

    renderBody() {
        const parts = [];
        if (this.recent.length) {
            parts.push(this.sectionHtml('frequent', getCategoryName('frequent'), this.recent));
        }
        for (const cat of this.categories) {
            parts.push(this.sectionHtml(cat.id, cat.name, cat.emojis));
        }
        this.bodyEl.innerHTML = parts.join('');
    }

    sectionHtml(id, name, emojis) {
        const items = emojis.map(e =>
            `<span class="emoji-picker-item" data-id="${e.id}" title="${this.escape(e.name)}">${e.native}</span>`
        ).join('');
        return `
            <div class="emoji-picker-section" data-section="${id}">
                <div class="emoji-picker-section-title">${this.escape(name)}</div>
                <div class="emoji-picker-grid">${items}</div>
            </div>
        `;
    }

    renderTabs() {
        const tabs = [];
        if (this.recent.length) {
            tabs.push({ id: 'frequent', icon: getCategoryIcon('frequent'), name: getCategoryName('frequent') });
        }
        for (const cat of this.categories) {
            tabs.push({ id: cat.id, icon: cat.icon, name: cat.name });
        }
        this.tabsEl.innerHTML = tabs.map(t =>
            `<button class="emoji-picker-tab" data-tab="${t.id}" title="${this.escape(t.name)}">${t.icon}</button>`
        ).join('');
    }

    renderSearch(query) {
        const results = searchEmojis(query);
        if (!results.length) {
            this.bodyEl.innerHTML = `<div class="emoji-picker-empty">${this.escape(this.labels.noResults)}</div>`;
            return;
        }
        const items = results.map(e =>
            `<span class="emoji-picker-item" data-id="${e.id}" title="${this.escape(e.name)}">${e.native}</span>`
        ).join('');
        this.bodyEl.innerHTML = `
            <div class="emoji-picker-section">
                <div class="emoji-picker-grid">${items}</div>
            </div>
        `;
    }

    escape(str) {
        return String(str).replace(/[&<>"']/g, ch => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[ch]);
    }

    bindEvents() {
        addClickHandler(this.bodyEl, (e) => {
            const item = e.target.closest('.emoji-picker-item');
            if (!item) return;
            const id = item.getAttribute('data-id');
            const emoji = getEmojiById(id);
            if (!emoji) return;
            this.saveRecent(emoji);
            this.onSelect?.(emoji.native);
            this.hide();
        });

        addClickHandler(this.tabsEl, (e) => {
            const tab = e.target.closest('.emoji-picker-tab');
            if (!tab) return;
            const id = tab.getAttribute('data-tab');
            this.scrollToSection(id);
        });

        this.searchInput.addEventListener('input', () => {
            const q = this.searchInput.value;
            if (!q.trim()) {
                this.renderBody();
            } else {
                this.renderSearch(q);
            }
        });

        this.searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (this.searchInput.value) {
                    this.searchInput.value = '';
                    this.renderBody();
                } else {
                    this.hide();
                }
            }
        });

        this.outsideHandler = (e) => {
            if (this.visible &&
                !this.element.contains(e.target) &&
                !e.target.closest('[data-action="emoji"]')) {
                this.hide();
            }
        };
        document.addEventListener('mousedown', this.outsideHandler, true);
    }

    scrollToSection(id) {
        const section = this.bodyEl.querySelector(`.emoji-picker-section[data-section="${id}"]`);
        if (section) {
            this.bodyEl.scrollTo({ top: section.offsetTop, behavior: 'smooth' });
        }
    }

    toggle(button) {
        if (this.visible) {
            this.hide();
        } else {
            this.show(button);
        }
    }

    show(button) {
        if (!this.element) return;

        // 重新加载最近使用（可能被其他实例修改）并重绘
        this.recent = this.loadRecent();
        this.searchInput.value = '';
        this.renderBody();
        this.renderTabs();

        this.visible = true;
        this.element.classList.add('is-visible');

        const rect = button.getBoundingClientRect();
        const pickerWidth = 360;
        const pickerHeight = 380;

        let left = rect.left - (pickerWidth - rect.width) / 2;
        let top = rect.bottom + 8;

        if (left < 10) left = 10;
        if (left + pickerWidth > window.innerWidth - 10) {
            left = window.innerWidth - pickerWidth - 10;
        }
        if (top + pickerHeight > window.innerHeight - 10) {
            top = rect.top - pickerHeight - 8;
        }

        this.element.style.left = `${left}px`;
        this.element.style.top = `${top}px`;

        this.bodyEl.scrollTop = 0;
    }

    hide() {
        if (!this.element) return;
        this.visible = false;
        this.element.classList.remove('is-visible');
    }

    destroy() {
        if (this.outsideHandler) {
            document.removeEventListener('mousedown', this.outsideHandler, true);
            this.outsideHandler = null;
        }
        if (this.element?.parentNode) {
            this.element.parentNode.removeChild(this.element);
        }
        this.element = null;
    }
}
