/**
 * 浮层账户面板 —— guest / authenticating / logged-in 三态渲染。
 *
 * 跟 AccountSettingsRow 不同点:
 * - 专为右下角紧凑浮层设计,有自己的 .account-panel 样式
 * - logged-in 时展示头像 + plan 徽章 + 配额用量(读 accountState.quotas)
 * - subscription 信息也读 accountState.subscription(plan / 过期日)
 * - 仍带「使用本地开发 server」开关,放面板底部
 */

import { open as openShell } from '@tauri-apps/plugin-shell';

import { addClickHandler } from '../../utils/PointerHelper.js';
import { t } from '../../i18n/index.js';
import { subscribe } from './accountState.js';
import { startLogin, cancelLogin, logout } from './oauthFlow.js';

const PROFILE_URL = 'https://mark2app.com/profile/info';

// ── ResourceType,跟 backend/app/models/billing.py 保持一致 ──
const R_STORAGE_BYTES       = 10;
const R_STORAGE_FILE_COUNT  = 11;
const R_LLM_TOTAL_TOKENS    = 22;
const R_POINTS              = 30;

// ── 格式化工具 ──

function formatBytes(n) {
    if (n == null || isNaN(n)) return '—';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
    return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatCount(n) {
    if (n == null || isNaN(n)) return '—';
    return Number(n).toLocaleString('en-US');
}

function formatTokens(n) {
    if (n == null || isNaN(n)) return '—';
    if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return String(n);
}

// limit_value 约定:-1 = 无限,0 = 套餐不含,null = 未配
function formatLimit(limit, formatter) {
    if (limit === -1 || limit === null || limit === undefined) return '∞';
    return formatter(limit);
}

// 首字母圈头像:按 email hash 出稳定 hue
function initialAvatar(name, email) {
    const ch = (name || email || '?').trim().charAt(0).toUpperCase() || '?';
    let h = 0;
    const s = email || name || '';
    for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    const hue = h % 360;
    return { ch, color: `hsl(${hue}, 55%, 48%)` };
}

function formatExpiresAt(iso) {
    try {
        const d = new Date(iso);
        if (isNaN(d.getTime())) return null;
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    } catch (_) {
        return null;
    }
}

// 把 quotas 数组按 resource_type 索引化
function indexQuotas(quotas) {
    const map = new Map();
    for (const q of quotas || []) {
        if (q && typeof q.resource_type === 'number') map.set(q.resource_type, q);
    }
    return map;
}

/**
 * 服务端 quota 一条同时给四档:cumulative(累计)+ daily / weekly / monthly。
 *
 * 优先级:**短周期优先**(daily > weekly > monthly > cumulative)。
 * 道理:服务端拒请求时按 *最严* 那档判,daily 一旦撞顶就调不通,即便 monthly
 * 还剩很多——UI 必须把最贴近"现在能不能用"的那档暴露出来,否则会误导用户
 * 以为还有量。storage/files 之类没分周期的资源自然降级到 cumulative。
 *
 * @returns {{used:number, limit:number|null, period:'daily'|'weekly'|'monthly'|'cumulative'} | null}
 */
function resolveQuotaWindow(quota) {
    if (!quota) return null;
    if (quota.hard_limit_daily != null) {
        return {
            used:   Number(quota.period_used_daily || 0),
            limit:  quota.hard_limit_daily,
            period: 'daily',
        };
    }
    if (quota.hard_limit_weekly != null) {
        return {
            used:   Number(quota.period_used_weekly || 0),
            limit:  quota.hard_limit_weekly,
            period: 'weekly',
        };
    }
    if (quota.hard_limit_monthly != null) {
        return {
            used:   Number(quota.period_used_monthly || 0),
            limit:  quota.hard_limit_monthly,
            period: 'monthly',
        };
    }
    return {
        used:   Number(quota.total_used || 0),
        limit:  quota.effective_limit,
        period: 'cumulative',
    };
}

// plan 名(优先用 subscription,fallback 用 me.level)
function resolvePlan(state) {
    if (state.subscription?.plan) return state.subscription.plan;
    const level = state.me?.level;
    return level === 2 ? 'team' : level === 1 ? 'pro' : 'free';
}

// ── AccountPanel 类 ──

export class AccountPanel {
    constructor() {
        this.root = document.createElement('div');
        this.root.className = 'account-panel';

        this.body = document.createElement('div');
        this.body.className = 'account-panel__body';
        this.root.appendChild(this.body);

        this._cleanups = [];
        this._actionCleanups = [];
    }

    mount(container) {
        container.appendChild(this.root);
        const unsubscribe = subscribe((state) => this._render(state));
        this._cleanups.push(unsubscribe);
    }

    destroy() {
        this._cleanups.forEach((fn) => { try { fn(); } catch (_) {} });
        this._cleanups = [];
        this._clearActionListeners();
        if (this.root.parentElement) this.root.parentElement.removeChild(this.root);
    }

    _clearActionListeners() {
        this._actionCleanups.forEach((fn) => { try { fn(); } catch (_) {} });
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
        const wrap = document.createElement('div');
        wrap.className = 'account-panel__guest';

        const text = document.createElement('p');
        text.className = 'account-panel__guest-text';
        text.textContent = t('account.guestDesc');
        wrap.appendChild(text);

        if (state.lastError && state.lastError !== 'token_revoked') {
            const err = document.createElement('div');
            err.className = 'account-panel__error';
            err.textContent = t('account.errorPrefix') + state.lastError;
            wrap.appendChild(err);
        }

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'account-panel__primary-btn';
        btn.textContent = t('account.signIn');
        const c = addClickHandler(btn, () => {
            startLogin().catch((e) => console.warn('[cloud-account] startLogin error:', e));
        }, { preventDefault: true });
        this._actionCleanups.push(c);
        wrap.appendChild(btn);

        this.body.appendChild(wrap);
    }

    _renderAuthenticating() {
        const wrap = document.createElement('div');
        wrap.className = 'account-panel__guest';

        const text = document.createElement('p');
        text.className = 'account-panel__guest-text';
        text.textContent = t('account.authenticating');
        wrap.appendChild(text);

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'account-panel__secondary-btn';
        btn.textContent = t('account.cancel');
        const c = addClickHandler(btn, () => cancelLogin(), { preventDefault: true });
        this._actionCleanups.push(c);
        wrap.appendChild(btn);

        this.body.appendChild(wrap);
    }

    _renderLoggedIn(state) {
        const me = state.me;
        const plan = resolvePlan(state);
        const sub = state.subscription;
        const expired = sub && sub.status === 0;
        const displayPlan = expired ? 'expired' : plan;

        // ── header: 头像 + 名 / 邮箱 + plan 徽章 ──
        const head = document.createElement('header');
        head.className = 'account-panel__head';

        const avatar = document.createElement('button');
        avatar.type = 'button';
        avatar.className = 'account-panel__avatar';
        avatar.title = PROFILE_URL;
        if (me.avatar) {
            const img = document.createElement('img');
            img.src = me.avatar;
            img.alt = '';
            avatar.appendChild(img);
        } else {
            const { ch, color } = initialAvatar(me.name, me.email);
            avatar.textContent = ch;
            avatar.style.background = color;
            avatar.style.color = '#fff';
        }
        const avatarCleanup = addClickHandler(avatar, () => {
            openShell(PROFILE_URL).catch((e) => console.warn('[cloud-account] open profile failed:', e));
        }, { preventDefault: true });
        this._actionCleanups.push(avatarCleanup);
        head.appendChild(avatar);

        const id = document.createElement('div');
        id.className = 'account-panel__id';
        const name = document.createElement('div');
        name.className = 'account-panel__name';
        name.textContent = me.name || me.email;
        const email = document.createElement('div');
        email.className = 'account-panel__email';
        email.textContent = me.email;
        id.appendChild(name);
        id.appendChild(email);
        head.appendChild(id);

        const plan_el = document.createElement('div');
        plan_el.className = `account-panel__plan account-panel__plan--${displayPlan}`;
        plan_el.textContent = t(`account.plan.${displayPlan}`);
        head.appendChild(plan_el);

        this.body.appendChild(head);

        // 过期 / 永久 / 至 yyyy-mm-dd
        if (sub) {
            const meta = document.createElement('div');
            meta.className = 'account-panel__plan-meta';
            if (sub.is_permanent) {
                meta.textContent = t('account.permanent');
            } else if (sub.expires_at) {
                const d = formatExpiresAt(sub.expires_at);
                if (d) meta.textContent = t('account.expiresAt', { date: d });
            }
            if (meta.textContent) this.body.appendChild(meta);
        }

        // ── usage list ──
        const usage = document.createElement('ul');
        usage.className = 'account-panel__usage';

        const qmap = indexQuotas(state.quotas);
        const storage = qmap.get(R_STORAGE_BYTES);
        const files   = qmap.get(R_STORAGE_FILE_COUNT);
        const tokens  = qmap.get(R_LLM_TOTAL_TOKENS);
        const points  = qmap.get(R_POINTS);

        usage.appendChild(this._renderUsageRow({
            label: t('account.usage.storage'),
            quota: storage,
            format: formatBytes,
            showBar: true,
        }));
        usage.appendChild(this._renderUsageRow({
            label: t('account.usage.files'),
            quota: files,
            format: formatCount,
            showBar: true,
        }));
        usage.appendChild(this._renderUsageRow({
            label: t('account.usage.llmTokens'),
            quota: tokens,
            format: formatTokens,
            showBar: true,
        }));
        usage.appendChild(this._renderUsageRow({
            label: t('account.usage.points'),
            quota: points,
            format: formatCount,
            showBar: true,
        }));

        this.body.appendChild(usage);

        // ── footer: 退出 ──
        const foot = document.createElement('footer');
        foot.className = 'account-panel__foot';
        const logoutBtn = document.createElement('button');
        logoutBtn.type = 'button';
        logoutBtn.className = 'account-panel__secondary-btn';
        logoutBtn.textContent = t('account.signOut');
        const c = addClickHandler(logoutBtn, () => {
            logout().catch((e) => console.warn('[cloud-account] logout error:', e));
        }, { preventDefault: true });
        this._actionCleanups.push(c);
        foot.appendChild(logoutBtn);
        this.body.appendChild(foot);
    }

    _renderUsageRow({ label, quota, format, showBar }) {
        const li = document.createElement('li');
        li.className = 'account-panel__usage-row';

        const head = document.createElement('div');
        head.className = 'account-panel__usage-head';

        const labelEl = document.createElement('span');
        labelEl.className = 'account-panel__usage-label';
        labelEl.textContent = label;

        const valueEl = document.createElement('span');
        valueEl.className = 'account-panel__usage-value';

        const win = resolveQuotaWindow(quota);
        if (!win) {
            valueEl.textContent = '—';
            valueEl.classList.add('is-muted');
        } else {
            const { used, limit, period } = win;
            // 周期标签:daily/weekly/monthly 各自显示"今日/本周/本月";cumulative 不加
            const periodLabel = period === 'cumulative' ? '' : ` ${t(`account.period.${period}`)}`;
            //   -1     → 真无限(显式 unlimited)
            //   0      → 套餐显式不含
            //   null   → 该维度未配限额(cumulative fallback);0 用量 → "套餐不含",有用量 → 只显示用量
            //   > 0    → 普通限额,显示 used / limit + 周期标签
            if (limit === -1) {
                valueEl.textContent = `${format(used)} / ∞${periodLabel}`;
            } else if (limit === 0) {
                valueEl.textContent = t('account.usage.notIncluded');
                valueEl.classList.add('is-muted');
            } else if (limit === null || limit === undefined) {
                if (used > 0) {
                    valueEl.textContent = `${format(used)}${periodLabel}`;
                } else {
                    valueEl.textContent = t('account.usage.notIncluded');
                    valueEl.classList.add('is-muted');
                }
            } else {
                valueEl.textContent = `${format(used)} / ${formatLimit(limit, format)}${periodLabel}`;
            }
        }
        head.appendChild(labelEl);
        head.appendChild(valueEl);
        li.appendChild(head);

        // 进度条:走 resolveQuotaWindow 拿当前主轴(月/周/日/累计),limit > 0 才画。
        // server 的 usage_percent 只反映 cumulative 维度,LLM 这种走 monthly 的会一直是 0%,
        // 所以这里按 win.used / win.limit 自己算 pct。
        if (showBar && win && typeof win.limit === 'number' && win.limit > 0) {
            const pct = Math.max(0, Math.min(100, (win.used / win.limit) * 100));
            const bar = document.createElement('div');
            bar.className = 'account-panel__usage-bar';
            const fill = document.createElement('div');
            fill.className = 'account-panel__usage-bar-fill';
            // 阈值染色:>=90% 红、>=70% 橙
            if (pct >= 90) fill.classList.add('is-danger');
            else if (pct >= 70) fill.classList.add('is-warn');
            fill.style.width = `${pct}%`;
            bar.appendChild(fill);
            li.appendChild(bar);
        }
        return li;
    }

}
