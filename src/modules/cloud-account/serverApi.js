import { getServerBaseUrl } from './serverConfig.js';

class ServerError extends Error {
    constructor(message, { status, body } = {}) {
        super(message);
        this.name = 'ServerError';
        this.status = status;
        this.body = body;
    }
}

async function request(path, { method = 'GET', body, token, headers } = {}) {
    const url = `${getServerBaseUrl()}${path}`;
    const opts = { method, headers: { ...(headers || {}) } };
    if (token) opts.headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
    }

    let resp;
    try {
        resp = await fetch(url, opts);
    } catch (e) {
        throw new ServerError(`network: ${e.message}`, { status: 0 });
    }

    let payload = null;
    const ct = resp.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
        try { payload = await resp.json(); } catch (_) { /* ignore */ }
    }
    if (!resp.ok) {
        const err = (payload && payload.error) || `http_${resp.status}`;
        throw new ServerError(err, { status: resp.status, body: payload });
    }
    return payload;
}

export const api = {
    requestDeviceCode: () =>
        request('/api/device/code', { method: 'POST', body: {} }),

    pollDeviceToken: (device_code) =>
        request('/api/device/token', { method: 'POST', body: { device_code } }),

    exchangeAuthCode: (exchange_code) =>
        request('/api/auth/exchange', { method: 'POST', body: { exchange_code } }),

    revoke: (token) =>
        request('/api/auth/revoke', { method: 'POST', body: {}, token }),

    me: (token) =>
        request('/api/me', { token }),

    profiles: (token) =>
        request('/v1/profiles', { token }),
};

export { ServerError };
