import { listen } from '@tauri-apps/api/event';
import { open as openShell } from '@tauri-apps/plugin-shell';

import { setState, getState } from './accountState.js';
import { clearToken, saveToken } from './tokenStore.js';
import { fetchAndApplyMe } from './session.js';
import { DEEP_LINK_SCHEME, LOGIN_URL } from './serverConfig.js';

const DEEP_LINK_EVENT = 'cloud-deep-link';
const FLOW_TIMEOUT_MS = 10 * 60 * 1000; // 10 分钟内没回调就取消

let unlistenDeepLink = null;
let pendingFlow = null; // { startedAt }
let pendingTimer = null;

// ---------------- Deep link ----------------

/**
 * 解析 deep link 回调。
 * 服务端约定 `cb=mark2://auth`，登录成功后浏览器跳到 `mark2://auth?token=XXX`
 * （或可能 `access_token=XXX`），失败则带 `error=...`。
 *
 * 兼容多种参数名，避免约定不一致时一个字段差异就跑不通。
 */
function parseCallback(url) {
    try {
        const u = new URL(url);
        if (u.protocol !== DEEP_LINK_SCHEME) return null;
        const params = u.searchParams;
        const token = params.get('token') || params.get('access_token');
        const error = params.get('error');
        if (!token && !error) return null;
        return { token, error };
    } catch (_) {
        return null;
    }
}

async function ensureDeepLinkListener() {
    if (unlistenDeepLink) return;
    unlistenDeepLink = await listen(DEEP_LINK_EVENT, async (event) => {
        const urls = Array.isArray(event.payload) ? event.payload : [event.payload];
        for (const url of urls) {
            const parsed = parseCallback(url);
            if (!parsed) {
                console.warn('[cloud-account] unrecognized deep link:', url);
                continue;
            }
            await handleCallback(parsed);
        }
    });
}

async function handleCallback({ token, error }) {
    if (!pendingFlow) {
        // 没在等待：可能是冷启动收到 deep link，或者用户重复点击。仍然处理 token，以免漏掉。
    }
    clearPendingFlow();

    if (error) {
        setState({ status: 'guest', lastError: error });
        return;
    }
    if (!token) {
        setState({ status: 'guest', lastError: 'invalid_callback' });
        return;
    }

    try {
        await saveToken(token);
        setState({ token, status: 'logged-in', lastError: null });
        await fetchAndApplyMe();
    } catch (e) {
        console.error('[cloud-account] save token / fetch me failed:', e);
        setState({ status: 'guest', lastError: e.message || 'login_failed' });
    }
}

function clearPendingFlow() {
    pendingFlow = null;
    if (pendingTimer) {
        clearTimeout(pendingTimer);
        pendingTimer = null;
    }
}

// ---------------- 公共 API ----------------

/**
 * 打开服务端登录页，浏览器登录完成后通过 deep link 回传 token。
 */
export async function startLogin() {
    await ensureDeepLinkListener();
    setState({ status: 'authenticating', lastError: null });

    pendingFlow = { startedAt: Date.now() };
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => {
        if (!pendingFlow) return;
        clearPendingFlow();
        if (getState().status === 'authenticating') {
            setState({ status: 'guest', lastError: 'login_timeout' });
        }
    }, FLOW_TIMEOUT_MS);

    try {
        await openShell(LOGIN_URL);
    } catch (e) {
        console.warn('[cloud-account] open browser failed:', e);
        clearPendingFlow();
        setState({ status: 'guest', lastError: 'open_browser_failed' });
        throw e;
    }
}

export function cancelLogin() {
    clearPendingFlow();
    setState({ status: 'guest' });
}

export async function logout() {
    await clearToken();
    setState({ status: 'guest', token: null, me: null, models: null, subscription: null, quotas: null, lastError: null });
}
