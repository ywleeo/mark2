import { addClickHandler } from '../../utils/PointerHelper.js';
import { t } from '../../i18n/index.js';

let liveNotice = null;
let liveCleanup = null;

/** 转义工具栏提示文案，避免配置值进入 HTML。 */
function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[character]));
}

/** 将提示定位到触发按钮下方，空间不足时保持在窗口内。 */
function positionToolbarNotice(element, anchor) {
    const rect = anchor?.isConnected ? anchor.getBoundingClientRect() : null;
    if (!rect) {
        element.style.right = '20px';
        element.style.top = '46px';
        return;
    }
    const noticeRect = element.getBoundingClientRect();
    const left = Math.max(10, Math.min(rect.right - noticeRect.width, window.innerWidth - noticeRect.width - 10));
    element.style.left = `${Math.round(left)}px`;
    element.style.top = `${Math.round(rect.bottom + 8)}px`;
}

/**
 * 显示锚定在工具栏按钮上的常驻提示。
 * @param {{anchor?:HTMLElement|null,title:string,hint?:string}} options - 提示内容。
 * @returns {HTMLElement} 提示元素。
 */
export function showToolbarNotice({ anchor = null, title, hint = '' } = {}) {
    dismissToolbarNotice();
    const element = document.createElement('div');
    element.className = 'toolbar-notice toolbar-notice--error';
    element.innerHTML = `
        <div class="toolbar-notice__content">
            <strong>${escapeHtml(title)}</strong>
            ${hint ? `<span>${escapeHtml(hint)}</span>` : ''}
        </div>
        <button type="button" class="toolbar-notice__close" aria-label="${escapeHtml(t('common.close'))}">×</button>
    `;
    document.body.appendChild(element);
    positionToolbarNotice(element, anchor);

    const dismiss = () => dismissToolbarNotice();
    const reposition = () => positionToolbarNotice(element, anchor);
    const clickCleanup = addClickHandler(element.querySelector('.toolbar-notice__close'), dismiss, {
        preventDefault: true,
    });
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    liveCleanup = () => {
        clickCleanup?.();
        window.removeEventListener('resize', reposition);
        window.removeEventListener('scroll', reposition, true);
    };
    liveNotice = element;
    requestAnimationFrame(() => element.classList.add('is-visible'));
    return element;
}

/** 移除当前工具栏提示并清理全局监听。 */
export function dismissToolbarNotice() {
    liveCleanup?.();
    liveCleanup = null;
    const element = liveNotice;
    liveNotice = null;
    if (!element) return;
    element.classList.remove('is-visible');
    setTimeout(() => element.remove(), 180);
}
