// 查找框功能模块
import { searchPluginKey } from '../extensions/SearchExtension.js';
import { addClickHandler } from '../utils/PointerHelper.js';

// 查找框管理类
export class SearchBoxManager {
    constructor(editor, codeEditor = null) {
        this.editor = editor; // Markdown 编辑器
        this.codeEditor = codeEditor; // 代码编辑器
        this.searchBox = null;
        this.searchInput = null;
        this.searchInfo = null;
        this.cleanupFunctions = []; // 存储清理函数

        this.initSearchBox();
    }

    // 设置代码编辑器引用
    setCodeEditor(codeEditor) {
        this.codeEditor = codeEditor;
    }

    // 获取当前激活的编辑器
    getActiveEditor() {
        // 检查是否在代码编辑模式
        if (this.codeEditor && this.codeEditor.isVisible) {
            return { type: 'code', editor: this.codeEditor };
        }
        // 默认使用 Markdown 编辑器
        return { type: 'markdown', editor: this.editor };
    }

    // 初始化查找 UI
    initSearchBox() {
        if (typeof document === 'undefined') return;

        // 获取 HTML 中已有的搜索框元素
        this.searchBox = document.querySelector('.search-box');
        if (!this.searchBox) return;

        this.searchInput = this.searchBox.querySelector('input[type="text"]');
        this.searchInfo = this.searchBox.querySelector('.search-info');

        const prevBtn = this.searchBox.querySelector('.prev-btn');
        const nextBtn = this.searchBox.querySelector('.next-btn');
        const closeBtn = this.searchBox.querySelector('.close-btn');

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

        // 使用 PointerHelper 处理按钮点击
        const closeBtnCleanup = addClickHandler(closeBtn, () => this.hideSearch());
        const prevBtnCleanup = addClickHandler(prevBtn, () => this.searchPrev());
        const nextBtnCleanup = addClickHandler(nextBtn, () => this.searchNext());

        this.cleanupFunctions.push(closeBtnCleanup, prevBtnCleanup, nextBtnCleanup);
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

        const { type, editor } = this.getActiveEditor();
        if (type === 'markdown' && editor) {
            editor.commands.clearSearch();
        } else if (type === 'code' && editor) {
            editor.clearSearch();
        }
    }

    // 处理搜索输入
    handleSearchInput() {
        const searchTerm = this.searchInput?.value || '';
        const { type, editor } = this.getActiveEditor();

        if (!editor) return;

        if (!searchTerm) {
            if (type === 'markdown') {
                editor.commands.clearSearch();
            } else {
                editor.clearSearch();
            }
            if (this.searchInfo) {
                this.searchInfo.textContent = '';
            }
            return;
        }

        if (type === 'markdown') {
            editor.commands.setSearchTerm(searchTerm);
            this.updateSearchInfo();
        } else {
            const result = editor.setSearchTerm(searchTerm);
            this.updateSearchInfoFromResult(result);
        }
    }

    // 查找下一个
    searchNext() {
        const { type, editor } = this.getActiveEditor();
        if (!editor) return;

        if (type === 'markdown') {
            editor.commands.nextSearchResult();
            this.updateSearchInfo();
        } else {
            const result = editor.nextSearchResult();
            this.updateSearchInfoFromResult(result);
        }
    }

    // 查找上一个
    searchPrev() {
        const { type, editor } = this.getActiveEditor();
        if (!editor) return;

        if (type === 'markdown') {
            editor.commands.prevSearchResult();
            this.updateSearchInfo();
        } else {
            const result = editor.prevSearchResult();
            this.updateSearchInfoFromResult(result);
        }
    }

    // 更新搜索信息 (Markdown 编辑器)
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

    // 更新搜索信息 (代码编辑器)
    updateSearchInfoFromResult(result) {
        if (!this.searchInfo) return;

        if (result && result.total > 0) {
            const current = result.current + 1;
            this.searchInfo.textContent = `${current} / ${result.total}`;
        } else if (this.searchInput?.value) {
            this.searchInfo.textContent = '无结果';
        } else {
            this.searchInfo.textContent = '';
        }
    }

    // 销毁
    destroy() {
        // 清理事件监听器
        this.cleanupFunctions.forEach(cleanup => {
            if (typeof cleanup === 'function') {
                cleanup();
            }
        });
        this.cleanupFunctions = [];

        // 清理引用
        this.searchBox = null;
        this.searchInput = null;
        this.searchInfo = null;
    }
}
