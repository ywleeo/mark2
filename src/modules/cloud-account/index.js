import { getState } from './accountState.js';
import { getServerBaseUrl } from './serverConfig.js';

export { getState, subscribe } from './accountState.js';
export { bootstrapSession, fetchAndApplyMe } from './session.js';
export { startLogin, cancelLogin, logout } from './deviceFlow.js';
export { getServerBaseUrl, setServerBaseUrl } from './serverConfig.js';

/**
 * 同步返回当前云账户在 AI 调用中需要的凭据。
 * - baseUrl: 完整的 v1 endpoint（已附 /v1）
 * - apiKey:  cloud token，可直接作为 Authorization Bearer
 * - profiles: 已知 profile 列表（未拉取时为 null，使用方应有 fallback）
 * - loggedIn: 是否已登录
 */
export function getCloudCredentials() {
    const { token, profiles, status } = getState();
    return {
        loggedIn: status === 'logged-in' && !!token,
        baseUrl: `${getServerBaseUrl()}/v1`,
        apiKey: token || '',
        profiles: profiles || null,
    };
}
