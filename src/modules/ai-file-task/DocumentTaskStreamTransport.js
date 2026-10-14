/** 文档任务流式传输：由后端检测无数据超时，完整合并后才交给工具执行器。 */
import { startAiProxyStream, cancelAiProxyStream } from '../../api/aiProxy.js';
import { CompletionStream } from '../ai-assistant/services/CompletionStream.js';
import { createDocumentTaskInterruption } from './DocumentTaskRecovery.js';

/**
 * 接收整次生成；没有前端总时限，用户取消可在流中或等待首包时中断。
 * 后端请求和监听启动发生竞态时，结束后也确保取消请求并释放所有监听。
 */
export function requestDocumentTaskStream({ url, apiKey, body, idleTimeoutMs, isActive = () => true, signal }, {
    startStream = startAiProxyStream,
    cancelStream = cancelAiProxyStream,
    checkIntervalMs = 250,
} = {}) {
    const requestId = `document-task-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
    const parser = new CompletionStream();
    return new Promise((resolve, reject) => {
        let settled = false;
        let cleanup = null;
        let checkTimer = null;
        /** 所有终止路径共享清理，防止晚到的启动结果残留事件监听。 */
        const finish = (error, response) => {
            if (settled) return;
            settled = true;
            clearInterval(checkTimer);
            signal?.removeEventListener('abort', onAbort);
            cleanup?.();
            void Promise.resolve().then(() => cancelStream(requestId)).catch(() => {});
            if (error) reject(error);
            else resolve(response);
        };
        /** Stop 直接中断网络，不等待下一次数据或状态轮询。 */
        const onAbort = () => finish(createDocumentTaskInterruption('AI_TASK_CANCELLED'));
        /** 仅在仍属于本轮任务时回传完整结果，工具参数不以半包形式执行。 */
        const complete = () => {
            if (settled) return;
            if (!isActive()) return finish(createDocumentTaskInterruption('AI_TASK_CANCELLED'));
            try { finish(null, { status: 200, ...parser.finish() }); } catch (error) { finish(error); }
        };
        checkTimer = setInterval(() => {
            if (!isActive()) finish(createDocumentTaskInterruption('AI_TASK_CANCELLED'));
        }, checkIntervalMs);
        signal?.addEventListener('abort', onAbort, { once: true });
        if (signal?.aborted || !isActive()) { onAbort(); return; }
        Promise.resolve().then(() => settled ? null : startStream({
            requestId, url, apiKey, body: { ...body, stream: true },
            timeoutMs: idleTimeoutMs, idleTimeoutMs,
            onChunk: chunk => {
                if (settled) return;
                if (!isActive()) return finish(createDocumentTaskInterruption('AI_TASK_CANCELLED'));
                try { parser.push(chunk); if (parser.done) complete(); } catch (error) {
                    if (apiKey) error.message = error.message.split(apiKey).join('•••');
                    finish(error);
                }
            },
            onEnd: complete,
            onError: message => {
                if (!isActive()) return finish(createDocumentTaskInterruption('AI_TASK_CANCELLED'));
                if (String(message).includes('AI_IDLE_TIMEOUT')) finish(createDocumentTaskInterruption('AI_IDLE_TIMEOUT'));
                else if (String(message).includes('AI_RESPONSE_INCOMPLETE')) finish(createDocumentTaskInterruption('AI_RESPONSE_INCOMPLETE'));
                else finish(new Error(apiKey ? String(message).split(apiKey).join('•••') : String(message)));
            },
        })).then(unlisten => {
            cleanup = unlisten;
            if (settled) {
                cleanup?.();
                void Promise.resolve().then(() => cancelStream(requestId)).catch(() => {});
            }
        }).catch(error => finish(error));
    });
}
