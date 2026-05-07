import { api, ServerError } from './serverApi.js';
import { getState, setState } from './accountState.js';
import { clearToken, loadToken } from './tokenStore.js';

/**
 * 启动时从 keyring 读 token，调 /api/me 验证：
 * - 200 → logged-in
 * - 401 → 清 token，guest
 * - 网络错误 → 保留 token 但状态 guest（带 lastError），下次再试
 */
export async function bootstrapSession() {
    const token = await loadToken();
    if (!token) {
        setState({ status: 'guest', token: null, me: null });
        return;
    }
    setState({ token });
    await fetchAndApplyMe();
}

/**
 * 用当前 token 调 /api/me，刷新 me 并更新 status。
 * 如 token 失效则清理，回到 guest。
 */
export async function fetchAndApplyMe() {
    const { token } = getState();
    if (!token) {
        setState({ status: 'guest', me: null });
        return null;
    }
    try {
        const me = await api.me(token);
        setState({ status: 'logged-in', me, lastError: null });
        // 异步拉 profiles，不阻塞主流程；失败也不影响登录态
        api.profiles(token)
            .then((resp) => {
                if (resp && Array.isArray(resp.data)) setState({ profiles: resp.data });
            })
            .catch((err) => console.warn('[cloud-account] fetch profiles failed:', err.message));
        return me;
    } catch (e) {
        if (e instanceof ServerError && e.status === 401) {
            await clearToken();
            setState({ status: 'guest', token: null, me: null, lastError: 'token_revoked' });
            return null;
        }
        // 网络错误：保留 token，标记 guest 但带错误
        setState({ status: 'guest', lastError: e.message || 'me_failed' });
        return null;
    }
}
