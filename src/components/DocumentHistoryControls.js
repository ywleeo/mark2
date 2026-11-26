/** 文档导航按钮，和文件类型及编辑工具栏显隐独立。 */
import { t } from '../i18n/index.js';
import { navigationHistory } from '../modules/navigationHistory.js';
import { addClickHandler } from '../utils/PointerHelper.js';

/** 绑定当前标签页的历史，并返回应用退出时的清理函数。 */
export function setupDocumentHistoryControls(container) {
    if (!container) return undefined;

    /** 创建一个带本地化提示的导航按钮。 */
    function createButton(action, icon) {
        const button = document.createElement('button');
        const label = t(`toolbar.${action}`);
        button.className = 'toolbar-button';
        button.dataset.action = action;
        button.type = 'button';
        button.title = label;
        button.setAttribute('aria-label', label);
        button.innerHTML = `<i class="toolbar-icon toolbar-icon--uicon fi fi-rr-${icon}" aria-hidden="true"></i>`;
        return button;
    }

    const back = createButton('navBack', 'arrow-small-left');
    const forward = createButton('navForward', 'arrow-small-right');
    container.append(back, forward);

    /** 在历史改变或切换标签时刷新两个按钮。 */
    function sync() {
        back.disabled = !navigationHistory.canGoBack();
        forward.disabled = !navigationHistory.canGoForward();
    }

    const removeBack = addClickHandler(back, navigationHistory.goBack);
    const removeForward = addClickHandler(forward, navigationHistory.goForward);
    const unsubscribe = navigationHistory.onChange(sync);
    sync();

    /** 移除按钮、点击处理器与历史订阅。 */
    return () => {
        unsubscribe();
        removeBack();
        removeForward();
        container.replaceChildren();
    };
}
