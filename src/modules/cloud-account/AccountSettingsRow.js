import { open as openShell } from '@tauri-apps/plugin-shell';

import { addClickHandler } from '../../utils/PointerHelper.js';
import { t } from '../../i18n/index.js';
import { subscribe } from './accountState.js';
import { startLogin, cancelLogin, logout } from './deviceFlow.js';
import { getServerBaseUrl, setServerBaseUrl } from './serverConfig.js';
import { bootstrapSession } from './session.js';

const DEV_BASE_URL = 'http://localhost:8787';

/**
 * Settings → AI tab 第一行：mark2 账户管理。
 *
 * mount(container) 把 DOM 插到 container 末尾，并订阅状态自动渲染。
 * destroy() 清理订阅与监听。
 */
export class AccountSettingsRow {
    constructor() {
        this.root = document.createElement('div');
        this.root.className = 'cloud-account-row';

        this.label = document.createElement('div');
        this.label.className = 'settings-section-label';
        this.label.textContent = t('settings.cloudAccount');

        this.body = document.createElement('div');
        this.body.className = 'cloud-account-body';

        this.root.appendChild(this.label);
        this.root.appendChild(this.body);

        this._cleanups = [];
    }

    mount(container) {
        container.appendChild(this.root);
        const unsubscribe = subscribe((state) => this._render(state));
        this._cleanups.push(unsubscribe);
        this._renderDevToggle();
    }

    destroy() {
        this._cleanups.forEach((fn) => { try { fn(); } catch (_) {} });
        this._cleanups = [];
        this._clearActionListeners();
        if (this.root.parentElement) this.root.parentElement.removeChild(this.root);
    }

    _clearActionListeners() {
        if (this._actionCleanups) {
            this._actionCleanups.forEach((fn) => { try { fn(); } catch (_) {} });
        }
        this._actionCleanups = [];
    }

    _render(state) {
        this._clearActionListeners();
        this.body.innerHTML = '';

        if (state.status === 'logged-in' && state.me) {
            this._renderLoggedIn(state);
            return;
        }
        if (state.status === 'authenticating') {
            this._renderAuthenticating();
            return;
        }
        this._renderGuest(state);
    }

    _renderGuest(state) {
        const text = document.createElement('div');
        text.className = 'cloud-account-text';
        text.textContent = t('settings.cloudAccountGuestDesc');

        const actions = document.createElement('div');
        actions.className = 'cloud-account-actions';

        const loginBtn = document.createElement('button');
        loginBtn.type = 'button';
        loginBtn.className = 'btn primary';
        loginBtn.textContent = t('settings.cloudAccountLogin');
        const c = addClickHandler(loginBtn, () => {
            startLogin().catch((e) => console.warn('[cloud-account] startLogin error:', e));
        }, { preventDefault: true });
        this._actionCleanups.push(c);

        actions.appendChild(loginBtn);

        if (state.lastError && state.lastError !== 'token_revoked') {
            const err = document.createElement('div');
            err.className = 'cloud-account-error';
            err.textContent = t('settings.cloudAccountErrorPrefix') + state.lastError;
            this.body.appendChild(err);
        }
        this.body.appendChild(text);
        this.body.appendChild(actions);
    }

    _renderAuthenticating() {
        const text = document.createElement('div');
        text.className = 'cloud-account-text';
        text.textContent = t('settings.cloudAccountAuthenticating');

        const actions = document.createElement('div');
        actions.className = 'cloud-account-actions';

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'btn secondary';
        cancelBtn.textContent = t('settings.cloudAccountCancel');
        const c = addClickHandler(cancelBtn, () => cancelLogin(), { preventDefault: true });
        this._actionCleanups.push(c);
        actions.appendChild(cancelBtn);

        this.body.appendChild(text);
        this.body.appendChild(actions);
    }

    _renderLoggedIn(state) {
        const me = state.me;

        const info = document.createElement('div');
        info.className = 'cloud-account-info';

        const email = document.createElement('span');
        email.className = 'cloud-account-email';
        email.textContent = me.email;

        const plan = document.createElement('span');
        plan.className = 'cloud-account-plan';
        plan.textContent = formatPlan(me);

        info.appendChild(email);
        info.appendChild(plan);

        const actions = document.createElement('div');
        actions.className = 'cloud-account-actions';

        const manageBtn = document.createElement('button');
        manageBtn.type = 'button';
        manageBtn.className = 'btn secondary';
        manageBtn.textContent = t('settings.cloudAccountManage');
        const c1 = addClickHandler(manageBtn, () => {
            if (me.billing_url) openShell(me.billing_url).catch(() => {});
        }, { preventDefault: true });
        this._actionCleanups.push(c1);

        const logoutBtn = document.createElement('button');
        logoutBtn.type = 'button';
        logoutBtn.className = 'btn secondary';
        logoutBtn.textContent = t('settings.cloudAccountLogout');
        const c2 = addClickHandler(logoutBtn, () => {
            logout().catch((e) => console.warn('[cloud-account] logout error:', e));
        }, { preventDefault: true });
        this._actionCleanups.push(c2);

        actions.appendChild(manageBtn);
        actions.appendChild(logoutBtn);

        this.body.appendChild(info);
        this.body.appendChild(actions);
    }

    _renderDevToggle() {
        const wrapper = document.createElement('label');
        wrapper.className = 'cloud-account-dev-toggle';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = getServerBaseUrl() === DEV_BASE_URL;

        const label = document.createElement('span');
        label.className = 'cloud-account-dev-toggle__text';
        label.textContent = t('settings.cloudAccountDevToggle');

        const hint = document.createElement('span');
        hint.className = 'cloud-account-dev-toggle__hint';
        hint.textContent = t('settings.cloudAccountDevToggleHint');

        wrapper.appendChild(checkbox);
        wrapper.appendChild(label);
        wrapper.appendChild(hint);

        const onChange = async () => {
            const useDev = checkbox.checked;
            setServerBaseUrl(useDev ? DEV_BASE_URL : null);
            // 切 server 后旧 token 在新 server 上无效，先登出再重新加载
            try { await logout(); } catch (_) { /* ignore */ }
            void bootstrapSession();
        };
        checkbox.addEventListener('change', onChange);
        this._cleanups.push(() => checkbox.removeEventListener('change', onChange));

        this.root.appendChild(wrapper);
    }
}

function formatPlan(me) {
    if (me.plan === 'pro_monthly') return t('settings.cloudAccountPlanPro');
    return me.plan || '';
}
