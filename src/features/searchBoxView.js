/**
 * 搜索框视图模板。
 * 视图由各文档栏独立创建，避免主副栏共享输入框和事件监听器。
 */
const SEARCH_BOX_TEMPLATE = `
    <div class="search-row">
        <input type="text" class="search-input" placeholder="查找">
        <button class="search-button toggle-replace-btn" title="切换替换栏 (⌘⌥F)" aria-label="切换替换栏">
            <span class="search-button-label">替换</span>
        </button>
        <input type="text" class="replace-input" placeholder="替换为">
        <span class="search-info"></span>
        <button class="search-button prev-btn" title="上一个 (⇧⏎)" aria-label="上一个">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
                <polyline points="6 15 12 9 18 15"/>
            </svg>
        </button>
        <button class="search-button next-btn" title="下一个 (⏎)" aria-label="下一个">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
                <polyline points="6 9 12 15 18 9"/>
            </svg>
        </button>
        <button class="search-button replace-btn" title="替换当前 (⏎)" aria-label="替换当前">
            <span class="search-button-label">替换</span>
        </button>
        <button class="search-button multi-btn" title="全部替换 (⌘⏎)" aria-label="全部替换">
            <span class="search-button-label">全部</span>
        </button>
        <button class="search-button close-btn" title="关闭 (Esc)" aria-label="关闭">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
                <line x1="6" y1="6" x2="18" y2="18"/>
                <line x1="6" y1="18" x2="18" y2="6"/>
            </svg>
        </button>
    </div>
`;

/**
 * 将当前语言文案应用到单个搜索框，避免全局选择器只更新双栏中的第一栏。
 * @param {HTMLElement} searchBox - 待本地化的搜索框。
 * @param {(key:string)=>string} translate - i18n 翻译函数。
 */
function applySearchBoxLocale(searchBox, translate) {
    if (typeof translate !== 'function') {
        return;
    }

    const assignments = [
        ['.search-input', 'placeholder', 'search.find'],
        ['.replace-input', 'placeholder', 'search.replace'],
        ['.toggle-replace-btn', 'title', 'search.toggleReplace'],
        ['.toggle-replace-btn', 'aria-label', 'search.toggleReplace'],
        ['.toggle-replace-btn .search-button-label', 'textContent', 'search.replaceLabel'],
        ['.replace-btn', 'title', 'search.replaceCurrent'],
        ['.replace-btn', 'aria-label', 'search.replaceCurrent'],
        ['.replace-btn .search-button-label', 'textContent', 'search.replaceLabel'],
        ['.multi-btn', 'title', 'search.replaceAll'],
        ['.multi-btn', 'aria-label', 'search.replaceAll'],
        ['.multi-btn .search-button-label', 'textContent', 'search.replaceAllLabel'],
        ['.prev-btn', 'title', 'search.prev'],
        ['.prev-btn', 'aria-label', 'search.prev'],
        ['.next-btn', 'title', 'search.next'],
        ['.next-btn', 'aria-label', 'search.next'],
        ['.close-btn', 'title', 'search.close'],
        ['.close-btn', 'aria-label', 'search.close'],
    ];

    for (const [selector, attribute, key] of assignments) {
        const element = searchBox.querySelector(selector);
        if (!element) continue;
        const value = translate(key);
        if (attribute === 'textContent') {
            element.textContent = value;
        } else {
            element.setAttribute(attribute, value);
        }
    }
}

/**
 * 在指定文档栏内创建一份独立搜索框。
 * @param {HTMLElement|null} hostElement - 搜索框所属的 document pane。
 * @param {((key:string)=>string)|null} translate - 可选 i18n 翻译函数。
 * @returns {HTMLElement|null} 新创建的搜索框；宿主不可用时返回 null。
 */
export function createSearchBoxView(hostElement, translate = null) {
    if (typeof document === 'undefined' || !hostElement?.appendChild) {
        return null;
    }

    const searchBox = document.createElement('div');
    searchBox.className = 'search-box is-find-only';
    searchBox.setAttribute('role', 'search');
    searchBox.innerHTML = SEARCH_BOX_TEMPLATE;
    applySearchBoxLocale(searchBox, translate);
    hostElement.appendChild(searchBox);
    return searchBox;
}
