/**
 * 当前 mark2 cloud 账户状态。
 *
 * status: 'unknown' | 'guest' | 'authenticating' | 'logged-in'
 * me: { id, email, name, avatar, level, points, status } | null
 * token: string | null
 * models: [{ id, object, created, owned_by }] | null  从 /api/v1/models 拉
 * lastError: string | null
 */

const listeners = new Set();

const state = {
    status: 'unknown',
    me: null,
    token: null,
    models: null,
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
