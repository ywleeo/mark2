import { aiProxyJsonRequest } from '../../api/aiProxy.js';
import { createLogger } from '../../core/diagnostics/Logger.js';
import { t } from '../../i18n/index.js';
import { aiService } from '../ai-assistant/aiService.js';
import { parseNonStreamingResponse } from '../ai-assistant/services/nonStreamingResponseParser.js';

const logger = createLogger('ai-file-task');

/**
 * 文档任务的非流式模型客户端，统一配置解析、错误处理和诊断日志。
 */
export class DocumentTaskClient {
    /**
     * @param {{request?:typeof aiProxyJsonRequest}} [options] - 可替换请求实现
     */
    constructor({ request = aiProxyJsonRequest } = {}) {
        this.request = request;
    }

    /**
     * 执行一次文档任务模型请求。
     * @param {{messages:Array,temperature:number,timeoutMs:number,phase:string,attempt?:number}} options - 请求参数
     * @returns {Promise<ReturnType<typeof parseNonStreamingResponse>>}
     */
    async complete({ messages, temperature, timeoutMs, phase, attempt = 1 }) {
        const provider = aiService.getProviderForScene('documentTask');
        const model = aiService.getModelForScene('documentTask');
        if (!provider?.apiKey || !model) {
            throw new Error(t('inlineCompletion.error.noConfig'));
        }

        let response;
        try {
            response = await this.request({
                method: 'POST',
                url: `${aiService.getBaseUrlForScene('documentTask')}/chat/completions`,
                apiKey: provider.apiKey,
                timeoutMs,
                body: { model, temperature, messages },
            });
        } catch (error) {
            if (/timeout|timed out|超时/i.test(String(error?.message || error))) {
                throw new Error(t('aiFileTask.error.timeout'));
            }
            throw error;
        }

        if (response.status < 200 || response.status >= 300) {
            let errorData = {};
            try { errorData = JSON.parse(response.body || '{}'); } catch { /* 使用统一状态错误 */ }
            throw new Error(errorData.error?.message || t('aiFileTask.error.apiFailed', { status: response.status }));
        }

        const parsed = parseNonStreamingResponse(response.body);
        const summary = {
            phase,
            attempt,
            model,
            timeoutMs,
            finishReason: parsed.finishReason || '(none)',
            contentLength: parsed.content.length,
            reasoningLength: parsed.reasoningLength,
            completionTokens: parsed.completionTokens,
            refusal: parsed.refusal,
        };
        if (parsed.content.trim()) logger.info('response:received', summary);
        else logger.warn('response:empty', summary);
        return parsed;
    }
}
