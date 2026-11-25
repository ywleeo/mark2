import { requestDocumentTaskStream } from './DocumentTaskStreamTransport.js';
import { createLogger } from '../../core/diagnostics/Logger.js';
import { aiService } from '../ai-assistant/aiService.js';
import { normalizeAiBaseUrl } from '../../api/aiProxy.js';
import { parseNonStreamingResponse } from '../ai-assistant/services/nonStreamingResponseParser.js';
import { parseDocumentTaskAgentTurn } from './DocumentTaskAgentTools.js';
import { createDocumentTaskInterruption } from './DocumentTaskRecovery.js';
import { classifyDocumentTaskRequestError } from './DocumentTaskErrors.js';

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

    /** 固定本轮使用的模型和服务商连接，后续设置变更只影响下一轮。 */
    forTask(modelSlot = aiService.getModelSlot('documentTask')) {
        const connection = this.resolveConnection(modelSlot);
        return { complete: options => this.complete(options, connection) };
    }

    /** 根据模型所属服务商解析模型 ID、密钥与请求地址。 */
    resolveConnection(modelSlot) {
        const provider = modelSlot && aiService.getProviderConfig(modelSlot.providerId);
        return {
            model: modelSlot?.model,
            apiKey: provider?.apiKey,
            baseUrl: normalizeAiBaseUrl(provider?.baseUrl || 'https://api.openai.com/v1'),
        };
    }

    /**
     * 执行一次文档任务模型请求。
     * @param {{messages:Array,temperature:number,idleTimeoutMs?:number,isActive?:()=>boolean,phase:string,attempt?:number,tools?:Array}} options - 请求参数
     * @returns {Promise<ReturnType<typeof parseNonStreamingResponse> & {rawBody:string}>}
     */
    async complete({ messages, temperature, idleTimeoutMs = 90000, isActive = () => true, signal, phase, attempt = 1, tools = [] },
        { model, apiKey, baseUrl } = this.resolveConnection(aiService.getModelSlot('documentTask'))) {
        if (!apiKey || !model) {
            throw createDocumentTaskInterruption('AI_MODEL_NOT_CONFIGURED');
        }

        let response;
        const hasImage = phase === 'image';
        const startedAt = performance.now();
        try {
            response = await this.request({
                url: `${baseUrl}/chat/completions`,
                apiKey,
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
            const failure = classifyDocumentTaskRequestError(error, { hasImage });
            logger.warn('request:failed', { phase, attempt, model, code: failure.code });
            throw failure;
        }

        if (response.status < 200 || response.status >= 300) {
            const failure = classifyDocumentTaskRequestError(response.body, { hasImage, status: response.status });
            logger.warn('request:rejected', { phase, attempt, model, code: failure.code, status: response.status });
            throw failure;
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
