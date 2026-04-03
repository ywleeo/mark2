import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

/**
 * 规范化 OpenAI-compatible 的 baseUrl。
 * 用户即使误填到 /chat 或 /chat/completions，也会被收敛到 API 根路径。
 */
export function normalizeAiBaseUrl(baseUrl) {
    const normalized = (baseUrl || 'https://api.openai.com/v1').trim().replace(/\/+$/, '');
    return normalized
        .replace(/\/chat\/completions$/i, '')
        .replace(/\/chat$/i, '')
        .replace(/\/models$/i, '');
}

/**
 * 通过 Tauri 后端发起非流式 AI 请求。
 * 默认总超时 3 分钟，兼容较慢的模型响应。
 */
export async function aiProxyJsonRequest({ method, url, apiKey, body, timeoutMs = 180000 }) {
    return await invoke('ai_proxy_json_request', {
        request: {
            method,
            url,
            apiKey,
            body,
            timeoutMs,
        },
    });
}

/**
 * 通过 Tauri 后端发起流式 AI 请求。
 * 返回取消监听函数，避免事件监听器泄漏。
 * timeoutMs 只控制连接阶段超时，不限制整个流式响应时长。
 */
export async function startAiProxyStream({
    requestId,
    url,
    apiKey,
    body,
    timeoutMs = 180000,
    onChunk,
    onError,
    onEnd,
}) {
    const unlistenChunk = await listen('ai-proxy-stream-chunk', (event) => {
        if (event.payload?.requestId === requestId) {
            onChunk?.(event.payload.chunk || '');
        }
    });

    const unlistenError = await listen('ai-proxy-stream-error', (event) => {
        if (event.payload?.requestId === requestId) {
            onError?.(event.payload.error || '请求失败');
        }
    });

    const unlistenEnd = await listen('ai-proxy-stream-end', (event) => {
        if (event.payload?.requestId === requestId) {
            onEnd?.();
        }
    });

    try {
        await invoke('ai_proxy_start_stream', {
            request: {
                requestId,
                url,
                apiKey,
                body,
                timeoutMs,
            },
        });
    } catch (error) {
        unlistenChunk();
        unlistenError();
        unlistenEnd();
        throw error;
    }

    return () => {
        unlistenChunk();
        unlistenError();
        unlistenEnd();
    };
}

/**
 * 取消后端流式请求。
 */
export async function cancelAiProxyStream(requestId) {
    return await invoke('ai_proxy_cancel_stream', { requestId });
}
