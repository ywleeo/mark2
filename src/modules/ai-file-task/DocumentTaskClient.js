import { requestDocumentTaskStream } from './DocumentTaskStreamTransport.js';
import { createLogger } from '../../core/diagnostics/Logger.js';
import { t } from '../../i18n/index.js';
import { aiService } from '../ai-assistant/aiService.js';
import { parseNonStreamingResponse } from '../ai-assistant/services/nonStreamingResponseParser.js';
import { parseDocumentTaskAgentTurn } from './DocumentTaskAgentTools.js';
import { createDocumentTaskInterruption } from './DocumentTaskRecovery.js';

const logger = createLogger('ai-file-task');

/**
 * 文档任务的流式模型客户端，统一配置解析、错误处理和诊断日志。
 */
export class DocumentTaskClient {
    /**
     * @param {{request?:typeof requestDocumentTaskStream}} [options] - 可替换请求实现
     */
    constructor({ request = requestDocumentTaskStream } = {}) {
        this.request = request;
    }

    /**
     * 执行一次文档任务模型请求。
     * @param {{messages:Array,temperature:number,idleTimeoutMs?:number,isActive?:()=>boolean,phase:string,attempt?:number,tools?:Array}} options - 请求参数
     * @returns {Promise<ReturnType<typeof parseNonStreamingResponse> & {rawBody:string}>}
     */
    async complete({ messages, temperature, idleTimeoutMs = 90000, isActive = () => true, signal, phase, attempt = 1, tools = [] }) {
        const provider = aiService.getProviderForScene('documentTask');
        const model = aiService.getModelForScene('documentTask');
        if (!provider?.apiKey || !model) {
            throw new Error(t('inlineCompletion.error.noConfig'));
        }

        let response;
        const startedAt = performance.now();
        try {
            response = await this.request({
                url: `${aiService.getBaseUrlForScene('documentTask')}/chat/completions`,
                apiKey: provider.apiKey,
                idleTimeoutMs,
                isActive,
                signal,
                body: {
                    model,
                    temperature,
                    messages,
                    ...(tools.length ? { tools } : {}),
                },
            });
        } catch (error) {
            if (/timeout|timed out|超时/i.test(String(error?.message || error))) {
                const idleError = createDocumentTaskInterruption('AI_IDLE_TIMEOUT');
                idleError.message = t('aiFileTask.idleTimeout');
                throw idleError;
            }
            throw error;
        }

        if (response.status < 200 || response.status >= 300) {
            let errorData = {};
            try { errorData = JSON.parse(response.body || '{}'); } catch { /* 使用统一状态错误 */ }
            throw new Error(errorData.error?.message || t('aiFileTask.error.apiFailed', { status: response.status }));
        }

        let parsed;
        try {
            parsed = parseNonStreamingResponse(response.body);
        } catch {
            logger.warn('response:incomplete', { phase, attempt, model });
            throw createDocumentTaskInterruption('AI_RESPONSE_INCOMPLETE');
        }
        if (Number.isFinite(response.reasoningLength)) parsed.reasoningLength = response.reasoningLength;
        const toolCount = parseDocumentTaskAgentTurn(response.body)?.toolCalls.length || 0;
        const summary = {
            phase,
            attempt,
            model,
            idleTimeoutMs,
            elapsedMs: Math.round(performance.now() - startedAt),
            finishReason: parsed.finishReason || '(none)',
            contentLength: parsed.content.length,
            reasoningLength: parsed.reasoningLength,
            completionTokens: parsed.completionTokens,
            refusal: parsed.refusal,
            toolCount,
        };
        if (parsed.content.trim() || toolCount) logger.info('response:received', summary);
        else logger.warn('response:empty', summary);
        return { ...parsed, rawBody: response.body };
    }
}
