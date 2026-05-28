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
        if (body instanceof FormData) {
            // multipart 由浏览器自带 boundary,不能手设 Content-Type
            opts.body = body;
        } else {
            opts.headers['Content-Type'] = 'application/json';
            opts.body = JSON.stringify(body);
        }
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
        // FastAPI 的 HTTPValidationError / 自定义错误都尽量提取一个可读字符串
        const err = extractErrorMessage(payload) || `http_${resp.status}`;
        throw new ServerError(err, { status: resp.status, body: payload });
    }
    return payload;
}

function extractErrorMessage(payload) {
    if (!payload) return null;
    if (typeof payload.error === 'string') return payload.error;
    if (typeof payload.detail === 'string') return payload.detail;
    if (Array.isArray(payload.detail) && payload.detail[0]?.msg) return payload.detail[0].msg;
    if (payload.error && typeof payload.error.message === 'string') return payload.error.message;
    return null;
}

export const api = {
    // ---------- auth ----------
    sendCode: ({ email, turnstile_token = '' }) =>
        request('/api/auth/send-code', {
            method: 'POST',
            body: { email, turnstile_token },
        }),

    register: ({ email, code, name, password }) =>
        request('/api/auth/register', {
            method: 'POST',
            body: { email, code, name, password },
        }),

    login: ({ email, password }) =>
        request('/api/auth/login', {
            method: 'POST',
            body: { email, password },
        }),

    me: (token) =>
        request('/api/auth/me', { token }),

    appToken: (token) =>
        request('/api/auth/app-token', { method: 'POST', token }),

    // ---------- oauth ----------
    oauthCode: ({
        token,
        response_type,
        client_id,
        redirect_uri,
        code_challenge,
        code_challenge_method,
        state,
    }) =>
        request('/api/oauth/code', {
            method: 'POST',
            token,
            body: {
                response_type,
                client_id,
                redirect_uri,
                code_challenge,
                code_challenge_method,
                state,
            },
        }),

    oauthToken: ({ grant_type, code, redirect_uri, client_id, code_verifier }) =>
        request('/api/oauth/token', {
            method: 'POST',
            body: { grant_type, code, redirect_uri, client_id, code_verifier },
        }),

    // ---------- llm ----------
    models: (token) =>
        request('/api/v1/models', { token }),

    // ---------- billing ----------
    // 订阅信息(空数组表示 free 用户,有数据时只取第一条)
    subscription: (token) =>
        request('/api/orders/subscription/me', { token }),

    // 配额使用量(过滤 / 单位换算交给调用方)
    quotas: (token) =>
        request('/api/quotas', { token }),

    // ---------- storage / shares ----------
    uploadFile: ({ blob, filename, token }) => {
        const fd = new FormData();
        fd.append('file', blob, filename);
        return request('/api/storage/upload', { method: 'POST', token, body: fd });
    },

    createShareLink: ({ file_id, password = null, expires_in_days = null, token }) =>
        request('/api/shares', {
            method: 'POST',
            token,
            body: { file_id, password, expires_in_days },
        }),

    // 一步分享:直接上传内容生成分享链接。内容进独立的 share_files,不污染用户云盘(storage_files)。
    shareUpload: ({ blob, filename, password = null, expires_in_days = null, token }) => {
        const params = new URLSearchParams();
        if (password) params.set('password', password);
        if (expires_in_days != null) params.set('expires_in_days', String(expires_in_days));
        const qs = params.toString();
        const fd = new FormData();
        fd.append('file', blob, filename);
        return request(`/api/shares/upload${qs ? `?${qs}` : ''}`, { method: 'POST', token, body: fd });
    },

    // 公开:取分享元信息(filename / size / requires_password / expires_at)
    getShareInfo: ({ uuid, password = null }) => {
        const q = password ? `?password=${encodeURIComponent(password)}` : '';
        return request(`/api/shares/${encodeURIComponent(uuid)}${q}`);
    },

    // 公开:取分享文件原文(text 内容)
    getShareRaw: ({ uuid, password = null }) => {
        const q = password ? `?password=${encodeURIComponent(password)}` : '';
        return request(`/api/shares/${encodeURIComponent(uuid)}/raw${q}`);
    },

    // 云文件列表(扁平,服务端无目录层级)。page_size 服务端上限 100。
    listFiles: ({ token, page = 1, page_size = 100 } = {}) =>
        request(`/api/storage/files?page=${page}&page_size=${page_size}`, { token }),

    // 取某个云文件的原文(text)
    fileContent: ({ file_id, token }) =>
        request(`/api/storage/files/${encodeURIComponent(file_id)}/content`, { token }),

    // 删除云文件(连带退还配额,share 走 FK 级联删)
    deleteFile: ({ file_id, token }) =>
        request(`/api/storage/files/${encodeURIComponent(file_id)}`, { method: 'DELETE', token }),
};

export { ServerError };
