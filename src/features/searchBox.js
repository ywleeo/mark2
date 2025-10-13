// 查找框功能模块
import { searchPluginKey } from '../extensions/SearchExtension.js';

// 查找框管理类
export class SearchBoxManager {
    constructor(editor) {
        this.editor = editor;
        this.searchBox = null;
        this.searchInput = null;
        this.searchInfo = null;

        this.initSearchBox();
    }

    // 初始化查找 UI
    initSearchBox() {
        if (typeof document === 'undefined') return;

        // 获取 HTML 中已有的搜索框元素
        this.searchBox = document.querySelector('.search-box');
        if (!this.searchBox) return;

        this.searchInput = this.searchBox.querySelector('input[type="text"]');
        this.searchInfo = this.searchBox.querySelector('.search-info');

        const closeBtn = this.searchBox.querySelector('.close-btn');
        const buttons = this.searchBox.querySelectorAll('.search-controls .search-button');
        const prevBtn = buttons[0];
        const nextBtn = buttons[1];

        if (!this.searchInput || !closeBtn || !prevBtn || !nextBtn) return;

        // 绑定事件
        this.searchInput.addEventListener('input', () => this.handleSearchInput());
        this.searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                if (e.shiftKey) {
                    this.searchPrev();
                } else {
                    this.searchNext();
                }
            } else if (e.key === 'Escape') {
                this.hideSearch();
            }
        });
        closeBtn.addEventListener('click', () => this.hideSearch());
        prevBtn.addEventListener('click', () => this.searchPrev());
        nextBtn.addEventListener('click', () => this.searchNext());
    }

    // 显示查找框
    showSearch() {
        if (!this.searchBox) return;
        this.searchBox.classList.add('is-visible');
        this.searchInput?.focus();
        this.searchInput?.select();
    }

    // 隐藏查找框
    hideSearch() {
        if (!this.searchBox) return;
        this.searchBox.classList.remove('is-visible');
        if (this.editor) {
            this.editor.commands.clearSearch();
        }
    }

    // 处理搜索输入
    handleSearchInput() {
        const searchTerm = this.searchInput?.value || '';

        if (!this.editor) return;

        if (!searchTerm) {
            this.editor.commands.clearSearch();
            if (this.searchInfo) {
                this.searchInfo.textContent = '';
            }
            return;
        }

        this.editor.commands.setSearchTerm(searchTerm);
        this.updateSearchInfo();
    }

    // 查找下一个
    searchNext() {
        if (!this.editor) return;
        this.editor.commands.nextSearchResult();
        this.updateSearchInfo();
    }

    // 查找上一个
    searchPrev() {
        if (!this.editor) return;
        this.editor.commands.prevSearchResult();
        this.updateSearchInfo();
    }

    // 更新搜索信息
    updateSearchInfo() {
        if (!this.editor || !this.searchInfo) return;

        // 直接从 editor state 获取搜索状态
        const pluginState = searchPluginKey.getState(this.editor.state);

        if (pluginState && pluginState.results && pluginState.results.length > 0) {
            const current = pluginState.currentIndex + 1;
            const total = pluginState.results.length;
            this.searchInfo.textContent = `${current} / ${total}`;
        } else if (this.searchInput?.value) {
            this.searchInfo.textContent = '无结果';
        } else {
            this.searchInfo.textContent = '';
        }
    }

    // 销毁
    destroy() {
        // 不需要删除元素，只需清理引用
        this.searchBox = null;
        this.searchInput = null;
        this.searchInfo = null;
    }
}
