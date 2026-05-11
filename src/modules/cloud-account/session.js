import { api, ServerError } from './serverApi.js';
import { getState, setState } from './accountState.js';
import { clearToken, loadToken } from './tokenStore.js';

/**
 * 启动时从 keyring 读 token，调 /api/auth/me 验证：
 * - 200 → logged-in
 * - 401 → 清 token，guest（不显示错误，对用户透明）
 * - 其它（404/网络等）→ 保留 token，guest，仅日志，不在 UI 显示"登录失败"
 *   （用户没主动操作，不该看到错误条；下次手动登录 / 重启再试）
 */
export async function bootstrapSession() {
    const token = await loadToken();
    if (!token) {
        setState({ status: 'guest', token: null, me: null });
        return;
    }
    setState({ token });
    await fetchAndApplyMe({ silent: true });
}

/**
 * 用当前 token 调 /api/auth/me，刷新 me 并更新 status。
 * 如 token 失效则清理，回到 guest。
 *
 * @param {{ silent?: boolean }} opts
 *   silent=true 时失败不写 lastError（用于启动期，避免 UI 弹"登录失败"）
 */
export async function fetchAndApplyMe(opts = {}) {
    const silent = !!opts.silent;
    const { token } = getState();
    if (!token) {
        setState({ status: 'guest', me: null });
        return null;
    }
    try {
        const me = await api.me(token);
        setState({ status: 'logged-in', me, lastError: null });
        // 异步拉 models，不阻塞主流程；失败也不影响登录态
        api.models(token)
            .then((resp) => {
                if (resp && Array.isArray(resp.data)) setState({ models: resp.data });
            })
            .catch((err) => console.warn('[cloud-account] fetch models failed:', err.message));
        return me;
    } catch (e) {
        if (e instanceof ServerError && e.status === 401) {
            await clearToken();
            setState({
                status: 'guest',
                token: null,
                me: null,
                lastError: silent ? null : 'token_revoked',
            });
            return null;
        }
        if (silent) {
            // 启动期失败：保留 token，仅日志
            console.warn('[cloud-account] bootstrap me failed:', e.message);
            setState({ status: 'guest', lastError: null });
            return null;
        }
        // 用户主动操作时的失败：写 lastError
        setState({ status: 'guest', lastError: e.message || 'me_failed' });
        return null;
    }
}
