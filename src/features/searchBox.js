// 查找框功能模块
import { searchPluginKey } from '../extensions/SearchExtension.js';
import { addClickHandler } from '../utils/PointerHelper.js';
import { t } from '../i18n/index.js';

// 查找框管理类
export class SearchBoxManager {
    constructor(editor, codeEditor = null) {
        this.editor = editor; // Markdown 编辑器
        this.codeEditor = codeEditor; // 代码编辑器
        this.searchBox = null;
        this.searchInput = null;
        this.replaceInput = null;
        this.searchInfo = null;
        this.cleanupFunctions = []; // 存储清理函数
        this.codeEditorChangeCleanup = null;

        this.initSearchBox();
    }

    // 设置代码编辑器引用
    setCodeEditor(codeEditor) {
        if (this.codeEditorChangeCleanup) {
            this.codeEditorChangeCleanup();
            this.codeEditorChangeCleanup = null;
        }
        this.codeEditor = codeEditor;
        if (this.codeEditor?.onDidChangeContent) {
            this.codeEditorChangeCleanup = this.codeEditor.onDidChangeContent(() => {
                this.handleContentMutated('code');
            });
        }
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

        this.searchInput = this.searchBox.querySelector('.search-input');
        this.replaceInput = this.searchBox.querySelector('.replace-input');
        this.searchInfo = this.searchBox.querySelector('.search-info');

        const prevBtn = this.searchBox.querySelector('.prev-btn');
        const nextBtn = this.searchBox.querySelector('.next-btn');
        const closeBtn = this.searchBox.querySelector('.close-btn');
        const multiBtn = this.searchBox.querySelector('.multi-btn');
        const replaceBtn = this.searchBox.querySelector('.replace-btn');
        const toggleReplaceBtn = this.searchBox.querySelector('.toggle-replace-btn');

        if (!this.searchInput || !this.replaceInput || !closeBtn || !prevBtn || !nextBtn || !multiBtn) return;

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

        this.replaceInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                if (e.metaKey || e.ctrlKey) {
                    // Cmd/Ctrl+Enter: 全部替换
                    e.preventDefault();
                    this.selectAllMatches();
                } else {
                    // Enter: 替换当前
                    e.preventDefault();
                    this.replaceCurrentMatch();
                }
            } else if (e.key === 'Escape') {
                this.hideSearch();
            }
        });

        // 全局 ESC 键监听（用于失焦时也能关闭搜索框）
        this.globalKeyHandler = (e) => {
            if (e.key === 'Escape' && this.searchBox?.classList.contains('is-visible')) {
                this.hideSearch();
            }
        };
        document.addEventListener('keydown', this.globalKeyHandler);

        // 使用 PointerHelper 处理按钮点击
        const closeBtnCleanup = addClickHandler(closeBtn, () => this.hideSearch());
        const prevBtnCleanup = addClickHandler(prevBtn, () => this.searchPrev());
        const nextBtnCleanup = addClickHandler(nextBtn, () => this.searchNext());
        const multiBtnCleanup = addClickHandler(multiBtn, () => this.selectAllMatches());

        this.cleanupFunctions.push(closeBtnCleanup, prevBtnCleanup, nextBtnCleanup, multiBtnCleanup);

        if (replaceBtn) {
            const replaceBtnCleanup = addClickHandler(replaceBtn, () => this.replaceCurrentMatch());
            this.cleanupFunctions.push(replaceBtnCleanup);
        }

        if (toggleReplaceBtn) {
            const toggleCleanup = addClickHandler(toggleReplaceBtn, () => this.toggleReplaceRow());
            this.cleanupFunctions.push(toggleCleanup);
        }
    }

    // 显示查找框（withReplace 显式传入时切换替换行；不传则保留上次状态）
    showSearch(withReplace) {
        if (!this.searchBox) return;
        this.searchBox.classList.add('is-visible');
        if (typeof withReplace === 'boolean') {
            this.searchBox.classList.toggle('is-find-only', !withReplace);
        }
        this.searchInput?.focus();
        this.searchInput?.select();
    }

    // 切换替换行展开/收起
    toggleReplaceRow() {
        if (!this.searchBox) return;
        const willShow = this.searchBox.classList.contains('is-find-only');
        this.searchBox.classList.toggle('is-find-only', !willShow);
        if (willShow) {
            this.replaceInput?.focus();
        } else {
            this.searchInput?.focus();
        }
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

    // 替换当前匹配（一处），随后跳到下一个
    replaceCurrentMatch() {
        if (!this.searchBox?.classList.contains('is-visible')) return;

        const searchTerm = this.searchInput?.value || '';
        if (!searchTerm) {
            this.showInfoMessage(t('search.tipEmpty'));
            return;
        }

        const { type, editor } = this.getActiveEditor();
        if (!editor) return;

        const replaceText = this.replaceInput?.value ?? '';

        if (type === 'code') {
            if (typeof editor.replaceCurrentSearchMatch === 'function') {
                const result = editor.replaceCurrentSearchMatch(replaceText);
                if (!result || result.replaced === 0) {
                    this.showInfoMessage(t('search.noMatches'));
                }
            }
            return;
        }

        // markdown：直接对 currentIndex 那一段做替换，再跳到下一个
        const replaced = this.replaceCurrentMarkdownMatch(replaceText);
        if (!replaced) {
            this.showInfoMessage(t('search.noMatches'));
        }
    }

    replaceCurrentMarkdownMatch(replacementText = '') {
        if (!this.editor) return false;

        const pluginState = searchPluginKey.getState(this.editor.state);
        const results = pluginState?.results || [];
        const currentIndex = pluginState?.currentIndex ?? -1;
        if (currentIndex < 0 || !results[currentIndex]) return false;

        const { from, to } = results[currentIndex];
        const replacement = typeof replacementText === 'string'
            ? replacementText
            : String(replacementText ?? '');

        const { state, view } = this.editor;
        if (!state || !view) return false;

        const tr = state.tr.insertText(replacement, from, to);
        view.dispatch(tr);
        this.editor.commands.focus();
        // 跳到下一个匹配
        this.editor.commands.nextSearchResult?.();
        this.updateSearchInfo();
        return true;
    }

    // 批量选中所有匹配（多光标编辑）
    selectAllMatches() {
        if (!this.searchBox?.classList.contains('is-visible')) {
            this.showInfoMessage(t('search.tipOpenFirst'));
            return;
        }

        const searchTerm = this.searchInput?.value || '';
        if (!searchTerm) {
            this.showInfoMessage(t('search.tipEmpty'));
            return;
        }

        const { type, editor } = this.getActiveEditor();
        if (!editor) {
            return;
        }

        if (type === 'code') {
            const replaceText = this.replaceInput?.value ?? '';
            if (typeof editor.replaceAllSearchMatches === 'function') {
                const result = editor.replaceAllSearchMatches(replaceText);
                if (result?.replaced > 0) {
                    this.showInfoMessage(t(replaceText ? 'search.replaced' : 'search.deleted', { n: result.replaced }));
                } else {
                    this.showInfoMessage(t('search.noMatches'));
                }
            }
            return;
        }

        const replaceText = this.replaceInput?.value ?? '';
        const replacedCount = this.replaceMarkdownMatches(replaceText);
        if (replacedCount > 0) {
            this.showInfoMessage(t(replaceText ? 'search.replaced' : 'search.deleted', { n: replacedCount }));
        } else {
            this.showInfoMessage(t('search.noMatches'));
        }
    }

    replaceMarkdownMatches(replacementText = '') {
        if (!this.editor) {
            return 0;
        }

        const pluginState = searchPluginKey.getState(this.editor.state);
        const results = pluginState?.results || [];
        if (results.length === 0) {
            return 0;
        }

        const { state, view } = this.editor;
        if (!state || !view) {
            return 0;
        }

        const replacement = typeof replacementText === 'string'
            ? replacementText
            : String(replacementText ?? '');
        const tr = state.tr;
        for (let i = results.length - 1; i >= 0; i -= 1) {
            const { from, to } = results[i];
            tr.insertText(replacement, from, to);
        }

        this.editor.commands.focus();
        view.dispatch(tr);
        this.updateSearchInfo();
        return results.length;
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
            this.searchInfo.textContent = t('search.noMatches');
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
            this.searchInfo.textContent = t('search.noMatches');
        } else {
            this.searchInfo.textContent = '';
        }
    }

    showInfoMessage(message) {
        if (this.searchInfo) {
            this.searchInfo.textContent = message;
        }
    }

    // 文档切换时重新触发搜索
    refreshSearchOnDocumentChange() {
        // 如果搜索框不可见或没有搜索词，直接返回
        if (!this.searchBox?.classList.contains('is-visible')) {
            return;
        }

        const searchTerm = this.searchInput?.value;
        if (!searchTerm) {
            return;
        }

        // 重新触发搜索（基于新文档重新计算匹配结果）
        const { type, editor } = this.getActiveEditor();
        if (!editor) return;

        if (type === 'markdown') {
            editor.commands.setSearchTerm(searchTerm);
            this.updateSearchInfo();
        } else {
            const result = editor.setSearchTerm(searchTerm);
            this.updateSearchInfoFromResult(result);
        }
    }

    handleContentMutated(source = null) {
        if (!this.searchBox?.classList.contains('is-visible')) {
            return;
        }

        const searchTerm = this.searchInput?.value;
        if (!searchTerm) {
            return;
        }

        if (source === 'code') {
            if (!this.codeEditor) {
                return;
            }
            const result = typeof this.codeEditor.refreshSearchMatches === 'function'
                ? this.codeEditor.refreshSearchMatches()
                : this.codeEditor.setSearchTerm(searchTerm);
            if (this.codeEditor.isVisible) {
                this.updateSearchInfoFromResult(result);
            }
            return;
        }

        if (source === 'markdown') {
            this.updateSearchInfo();
            return;
        }

        const { type, editor } = this.getActiveEditor();
        if (!editor) {
            return;
        }

        if (type === 'markdown') {
            this.updateSearchInfo();
        } else if (typeof editor.refreshSearchMatches === 'function') {
            const result = editor.refreshSearchMatches();
            this.updateSearchInfoFromResult(result);
        } else {
            const result = editor.setSearchTerm(searchTerm);
            this.updateSearchInfoFromResult(result);
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

        // 清理全局键盘监听
        if (this.globalKeyHandler) {
            document.removeEventListener('keydown', this.globalKeyHandler);
            this.globalKeyHandler = null;
        }

        if (this.codeEditorChangeCleanup) {
            this.codeEditorChangeCleanup();
            this.codeEditorChangeCleanup = null;
        }

        // 清理引用
        this.searchBox = null;
        this.searchInput = null;
        this.replaceInput = null;
        this.searchInfo = null;
    }
}
