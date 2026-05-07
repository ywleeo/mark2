import { listen } from '@tauri-apps/api/event';
import { open as openShell } from '@tauri-apps/plugin-shell';

import { api, ServerError } from './serverApi.js';
import { setState } from './accountState.js';
import { clearToken, saveToken } from './tokenStore.js';
import { fetchAndApplyMe } from './session.js';

const DEEP_LINK_EVENT = 'cloud-deep-link';
const POLL_BACKOFF_FACTOR = 2;
const POLL_BACKOFF_MAX = 30;

let unlistenDeepLink = null;
let activeFlow = null;

function parseExchangeCode(url) {
    try {
        const u = new URL(url);
        if (u.protocol !== 'mark2:') return null;
        return u.searchParams.get('exchange_code');
    } catch (_) {
        return null;
    }
}

async function ensureDeepLinkListener() {
    if (unlistenDeepLink) return;
    unlistenDeepLink = await listen(DEEP_LINK_EVENT, async (event) => {
        const urls = Array.isArray(event.payload) ? event.payload : [event.payload];
        for (const url of urls) {
            const code = parseExchangeCode(url);
            if (!code) continue;
            try {
                const result = await api.exchangeAuthCode(code);
                await saveToken(result.access_token);
                if (activeFlow) {
                    activeFlow.cancelled = true;
                    activeFlow = null;
                }
                setState({ token: result.access_token, status: 'logged-in', lastError: null });
                await fetchAndApplyMe();
            } catch (e) {
                console.error('[cloud-account] exchange failed:', e);
                setState({ status: 'guest', lastError: e.message || 'exchange_failed' });
            }
        }
    });
}

/**
 * 启动 device flow 登录：打开浏览器，启动后台轮询。
 * deep link 优先，轮询是兜底。
 */
export async function startLogin() {
    await ensureDeepLinkListener();

    setState({ status: 'authenticating', lastError: null });

    let codeResp;
    try {
        codeResp = await api.requestDeviceCode();
    } catch (e) {
        setState({ status: 'guest', lastError: e.message || 'device_code_failed' });
        throw e;
    }

    try {
        await openShell(codeResp.verification_uri);
    } catch (e) {
        // 浏览器打开失败不致命，但用户得知道
        console.warn('[cloud-account] open browser failed:', e);
    }

    const flow = {
        device_code: codeResp.device_code,
        cancelled: false,
        startedAt: Date.now(),
        expiresIn: codeResp.expires_in || 600,
    };
    activeFlow = flow;

    let interval = codeResp.interval || 3;
    while (!flow.cancelled) {
        if ((Date.now() - flow.startedAt) / 1000 > flow.expiresIn) {
            setState({ status: 'guest', lastError: 'device_code_expired' });
            activeFlow = null;
            return;
        }
        await sleep(interval * 1000);
        if (flow.cancelled) return;

        try {
            const r = await api.pollDeviceToken(flow.device_code);
            if (r.access_token) {
                await saveToken(r.access_token);
                setState({ token: r.access_token, status: 'logged-in', lastError: null });
                activeFlow = null;
                await fetchAndApplyMe();
                return;
            }
            if (r.error === 'authorization_pending') continue;
            if (r.error === 'slow_down') {
                interval = Math.min(interval * POLL_BACKOFF_FACTOR, POLL_BACKOFF_MAX);
                continue;
            }
            // expired_token / access_denied / 其它
            setState({ status: 'guest', lastError: r.error || 'authorization_failed' });
            activeFlow = null;
            return;
        } catch (e) {
            // 网络抖动：继续轮询，但放慢节奏
            if (e instanceof ServerError) {
                interval = Math.min(interval * POLL_BACKOFF_FACTOR, POLL_BACKOFF_MAX);
                continue;
            }
            throw e;
        }
    }
}

export function cancelLogin() {
    if (activeFlow) {
        activeFlow.cancelled = true;
        activeFlow = null;
        setState({ status: 'guest' });
    }
}

export async function logout() {
    const { getState } = await import('./accountState.js');
    const { token } = getState();
    if (token) {
        try { await api.revoke(token); } catch (_) { /* ignore */ }
    }
    await clearToken();
    setState({ status: 'guest', token: null, me: null, lastError: null });
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
