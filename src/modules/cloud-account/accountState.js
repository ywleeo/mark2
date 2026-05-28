/**
 * 当前 mark2 cloud 账户状态。
 *
 * status: 'unknown' | 'guest' | 'authenticating' | 'logged-in'
 * me: { id, email, name, avatar, level, points, status } | null
 * token: string | null
 * models: [{ id, object, created, owned_by }] | null         来自 /api/v1/models
 * subscription: { plan, status, started_at, expires_at, is_permanent } | null
 *                                                            来自 /api/orders/subscription/me
 *                                                            free 用户 (返回 []) 也置为 null,
 *                                                            渲染时按 me.level=0 兜底显示 Free
 * quotas: [{ resource_type, total_used, period_used, hard_limit, effective_limit,
 *           remaining, usage_percent, is_unlimited, ... }] | null   来自 /api/quotas
 * lastError: string | null
 */

const listeners = new Set();

const state = {
    status: 'unknown',
    me: null,
    token: null,
    models: null,
    subscription: null,
    quotas: null,
    lastError: null,
};

export function getState() {
    return { ...state };
}

export function subscribe(fn) {
    listeners.add(fn);
    fn(getState());
    return () => listeners.delete(fn);
}

export function setState(patch) {
    Object.assign(state, patch);
    const snap = getState();
    listeners.forEach((fn) => {
        try { fn(snap); } catch (e) { console.error('[cloud-account] listener error:', e); }
    });
}
