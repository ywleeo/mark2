import { addClickHandler } from '../utils/PointerHelper.js';
import { t } from '../i18n/index.js';
import { createSearchSnippet } from '../utils/workspaceSearchUtils.js';

/**
 * 工作区全文搜索侧栏。组件只负责 DOM 与交互，搜索和文件导航由控制器注入。
 */
export class WorkspaceSearchPanel {
    /**
     * 创建搜索面板。
     * @param {{host: HTMLElement, onQueryChange: Function, onSubmit: Function, onClose: Function, onOpenResult: Function}} options - 组件依赖。
     */
    constructor(options) {
        this.host = options.host;
        this.onQueryChange = options.onQueryChange;
        this.onSubmit = options.onSubmit;
        this.onClose = options.onClose;
        this.onOpenResult = options.onOpenResult;
        this.cleanupFunctions = [];
        this.results = [];
        this.options = {
            caseSensitive: false,
            wholeWord: false,
            useRegex: false,
        };
        this.render();
        this.bindEvents();
    }

    /** 创建静态面板结构。 */
    render() {
        this.host.innerHTML = `
            <section class="workspace-search" aria-label="${t('workspaceSearch.title')}">
                <header class="workspace-search__header">
                    <h2>${t('workspaceSearch.title')}</h2>
                    <button class="workspace-search__close" type="button" data-action="close" title="${t('workspaceSearch.close')}" aria-label="${t('workspaceSearch.close')}">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>
                    </button>
                </header>
                <div class="workspace-search__query-row">
                    <input class="workspace-search__input" type="search" spellcheck="false" autocomplete="off" placeholder="${t('workspaceSearch.placeholder')}" aria-label="${t('workspaceSearch.placeholder')}">
                    <div class="workspace-search__options" aria-label="${t('workspaceSearch.options')}">
                        <button type="button" data-option="caseSensitive" aria-pressed="false" title="${t('workspaceSearch.matchCase')}">Aa</button>
                        <button type="button" data-option="wholeWord" aria-pressed="false" title="${t('workspaceSearch.wholeWord')}">ab</button>
                        <button type="button" data-option="useRegex" aria-pressed="false" title="${t('workspaceSearch.regex')}">.*</button>
                    </div>
                </div>
                <div class="workspace-search__status" role="status" aria-live="polite"></div>
                <div class="workspace-search__results"></div>
            </section>
        `;
        this.input = this.host.querySelector('.workspace-search__input');
        this.status = this.host.querySelector('.workspace-search__status');
        this.resultsElement = this.host.querySelector('.workspace-search__results');
    }

    /** 绑定面板事件并登记清理函数。 */
    bindEvents() {
        const closeButton = this.host.querySelector('[data-action="close"]');
        this.cleanupFunctions.push(addClickHandler(closeButton, () => this.onClose?.()));

        this.host.querySelectorAll('[data-option]').forEach((button) => {
            this.cleanupFunctions.push(addClickHandler(button, () => {
                const option = button.dataset.option;
                this.options[option] = !this.options[option];
                button.setAttribute('aria-pressed', String(this.options[option]));
                button.classList.toggle('is-active', this.options[option]);
                this.emitQueryChange();
            }));
        });

        const onInput = () => this.emitQueryChange();
        const onKeyDown = (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                this.onClose?.();
            } else if (event.key === 'Enter') {
                event.preventDefault();
                this.onSubmit?.(this.getRequest());
            }
        };
        this.input?.addEventListener('input', onInput);
        this.input?.addEventListener('keydown', onKeyDown);
        this.cleanupFunctions.push(() => this.input?.removeEventListener('input', onInput));
        this.cleanupFunctions.push(() => this.input?.removeEventListener('keydown', onKeyDown));

        this.cleanupFunctions.push(addClickHandler(this.resultsElement, (event) => {
            const row = event.target.closest('[data-result-index]');
            if (!row) return;
            const result = this.results[Number(row.dataset.resultIndex)];
            if (result) this.onOpenResult?.(result);
        }));
    }

    /** 返回当前查询和选项的不可变快照。 */
    getRequest() {
        return {
            query: this.input?.value || '',
            options: { ...this.options },
        };
    }

    /** 通知控制器查询条件发生变化。 */
    emitQueryChange() {
        this.onQueryChange?.(this.getRequest());
    }

    /** 显示面板并选中搜索词。 */
    show() {
        this.host.closest('.sidebar')?.classList.add('is-workspace-search-active');
        this.host.hidden = false;
        requestAnimationFrame(() => {
            this.input?.focus();
            this.input?.select();
        });
    }

    /** 隐藏面板并恢复文件树。 */
    hide() {
        this.host.closest('.sidebar')?.classList.remove('is-workspace-search-active');
        this.host.hidden = true;
    }

    /** 判断面板当前是否可见。 */
    isVisible() {
        return !this.host.hidden;
    }

    /** 显示搜索进行中的状态。 */
    setLoading() {
        this.status.textContent = t('workspaceSearch.searching');
        this.resultsElement.replaceChildren();
    }

    /** 显示无工作区、空查询或无结果等提示。 */
    setMessage(message) {
        this.results = [];
        this.status.textContent = '';
        const empty = document.createElement('div');
        empty.className = 'workspace-search__empty';
        empty.textContent = message;
        this.resultsElement.replaceChildren(empty);
    }

    /** 显示可读错误，不把后端错误插入 HTML。 */
    setError(error) {
        this.results = [];
        this.status.textContent = '';
        const element = document.createElement('div');
        element.className = 'workspace-search__error';
        element.textContent = String(error || t('workspaceSearch.failed'));
        this.resultsElement.replaceChildren(element);
    }

    /** 渲染按文件分组的搜索结果。 */
    setResults(response) {
        this.results = Array.isArray(response?.matches) ? response.matches : [];
        if (this.results.length === 0) {
            this.setMessage(t('workspaceSearch.noResults'));
            return;
        }

        const groups = new Map();
        this.results.forEach((match, index) => {
            const key = `${match.rootPath || ''}\u0000${match.filePath || ''}`;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push({ match, index });
        });
        const suffix = response?.truncated ? ` · ${t('workspaceSearch.truncated')}` : '';
        this.status.textContent = t('workspaceSearch.summary', {
            count: this.results.length,
            files: groups.size,
        }) + suffix;

        const fragment = document.createDocumentFragment();
        groups.forEach((items) => {
            const group = document.createElement('section');
            group.className = 'workspace-search__group';

            const header = document.createElement('div');
            header.className = 'workspace-search__file';
            const path = document.createElement('span');
            path.className = 'workspace-search__file-path';
            path.textContent = items[0].match.relativePath || items[0].match.filePath;
            path.title = items[0].match.filePath;
            const count = document.createElement('span');
            count.className = 'workspace-search__file-count';
            count.textContent = String(items.length);
            header.append(path, count);
            group.appendChild(header);

            items.forEach(({ match, index }) => group.appendChild(this.createResultRow(match, index)));
            fragment.appendChild(group);
        });
        this.resultsElement.replaceChildren(fragment);
    }

    /** 创建单条搜索结果 DOM。 */
    createResultRow(match, index) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'workspace-search__result';
        row.dataset.resultIndex = String(index);
        row.title = `${match.filePath}:${match.lineNumber}:${match.columnNumber}`;

        const line = document.createElement('span');
        line.className = 'workspace-search__line';
        line.textContent = String(match.lineNumber);
        const text = document.createElement('span');
        text.className = 'workspace-search__result-text';
        const snippet = createSearchSnippet(match);
        text.append(document.createTextNode(`${snippet.leading ? '…' : ''}${snippet.before}`));
        const mark = document.createElement('mark');
        mark.textContent = snippet.hit || '∅';
        text.append(mark, document.createTextNode(`${snippet.after}${snippet.trailing ? '…' : ''}`));
        row.append(line, text);
        return row;
    }

    /** 释放所有事件与 DOM 引用。 */
    destroy() {
        while (this.cleanupFunctions.length > 0) {
            this.cleanupFunctions.pop()?.();
        }
        this.host.closest('.sidebar')?.classList.remove('is-workspace-search-active');
        this.host.replaceChildren();
    }
}
