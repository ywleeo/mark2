/**
 * Titlebar 账户入口 + 浮动账户面板。
 *
 * - 在 titlebar 的 #titlebar-account 按钮上挂点击,toggle 出一个浮动面板。
 * - 浮动面板内挂一个 AccountSettingsRow 实例(完全复用现有的 guest /
 *   authenticating / logged-in 三态渲染、登录/登出/dev-toggle)。
 * - 订阅 accountState:登录态变化 → 切换图标 is-logged-in;有 lastError
 *   → 右上角红点 has-error。
 * - 外面点击 / Esc → 关闭。
 * - features.cloudAccount === false 时按钮 hidden,本模块不挂任何监听。
 */

import { addClickHandler } from '../../utils/PointerHelper.js';
import { subscribe, getState } from './accountState.js';
import { fetchAndApplyMe } from './session.js';
import { AccountPanel } from './accountPanel.js';

const POPOVER_ID = 'accountPopover';
const BUTTON_ID  = 'titlebar-account';

let isSetup = false;

export function setupAccountTitlebarIcon() {
    if (isSetup) return;

    const btn = document.getElementById(BUTTON_ID);
    if (!btn) {
        console.warn('[cloud-account] titlebar account button not found');
        return;
    }
    isSetup = true;
    btn.hidden = false;

    let popover = null;
    let row = null;
    let unsubscribeState = null;
    let outsideClickCleanup = null;
    let onKeyDown = null;
    let onResize = null;

    function close() {
        if (!popover) return;
        if (row) { row.destroy(); row = null; }
        popover.remove();
        popover = null;
        if (outsideClickCleanup) { outsideClickCleanup(); outsideClickCleanup = null; }
        if (onKeyDown) { document.removeEventListener('keydown', onKeyDown); onKeyDown = null; }
        if (onResize)  { window.removeEventListener('resize',   onResize);  onResize  = null; }
        btn.classList.remove('is-open');
    }

    function anchor() {
        if (!popover) return;
        const r = btn.getBoundingClientRect();
        popover.style.top   = `${Math.round(r.bottom + 6)}px`;
        popover.style.right = `${Math.round(window.innerWidth - r.right)}px`;
    }

    function open() {
        if (popover) return;
        popover = document.createElement('div');
        popover.id = POPOVER_ID;
        popover.className = 'account-popover';
        document.body.appendChild(popover);
        anchor();

        row = new AccountPanel();
        row.mount(popover);

        btn.classList.add('is-open');

        // 每次打开都触发一次后台 refresh:用现有缓存先即时渲染,数据回来后 state 变化自动重渲染。
        // silent:true 让网络失败不去污染 lastError(避免每次开就闪小红点);未登录态自然跳过。
        if (getState().status === 'logged-in') {
            void fetchAndApplyMe({ silent: true });
        }

        // Esc 关闭(stopPropagation 避免冲到搜索框等其它 Esc 监听)
        onKeyDown = (e) => {
            if (e.key === 'Escape' && !e.isComposing) {
                e.preventDefault();
                e.stopPropagation();
                close();
            }
        };
        document.addEventListener('keydown', onKeyDown);

        // 外部点击关闭:点 popover 自身和触发按钮不算外部
        const onOutside = (e) => {
            if (!popover) return;
            const t = e.target;
            if (popover.contains(t) || btn.contains(t)) return;
            close();
        };
        // 用 mousedown 比 click 更早响应,避免点了别处后还能短暂操作 popover
        document.addEventListener('mousedown', onOutside, true);
        outsideClickCleanup = () => document.removeEventListener('mousedown', onOutside, true);

        // 窗口尺寸变化时重新对齐(macOS 全屏 / Windows 缩放)
        onResize = () => anchor();
        window.addEventListener('resize', onResize);
    }

    addClickHandler(btn, () => {
        if (popover) close(); else open();
    });

    // 状态变化 → 同步图标视觉
    function applyIconState(state) {
        btn.classList.toggle('is-logged-in', state.status === 'logged-in');
        btn.classList.toggle('is-authenticating', state.status === 'authenticating');
        // token_revoked 是 server 主动失效,属于"提示用户重新登录"——红点合理
        // 其它瞬时错误(open_browser_failed 等)也归入红点,鼓励用户去看 popover
        btn.classList.toggle('has-error', Boolean(state.lastError));
    }
    applyIconState(getState());
    unsubscribeState = subscribe(applyIconState);

    // 不返回 cleanup —— 单例图标跟应用同生命周期,无需手动 dispose
    void unsubscribeState;
}
