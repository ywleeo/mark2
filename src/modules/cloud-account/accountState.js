/**
 * 当前 mark2 cloud 账户状态。
 *
 * status: 'unknown' | 'guest' | 'authenticating' | 'logged-in'
 * me: { user_id, email, plan, plan_status, credits, billing_url } | null
 * token: string | null
 * lastError: string | null
 */

const listeners = new Set();

const state = {
    status: 'unknown',
    me: null,
    token: null,
    profiles: null, // [{ id, label, description, capabilities, ... }] 从 /v1/profiles 拉
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
