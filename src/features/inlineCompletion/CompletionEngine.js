import { aiProxyJsonRequest } from '../../api/aiProxy.js';
import { t } from '../../i18n/index.js';
import { aiService } from '../../modules/ai-assistant/aiService.js';
import { createLogger } from '../../core/diagnostics/Logger.js';
import { buildCompletionPrompts } from './CompletionPromptBuilder.js';
import { parseCompletionResponse } from './CompletionResponseParser.js';
import { sanitizeCompletionWithMeta } from './CompletionSanitizer.js';

const logger = createLogger('inline-completion');
const COMPLETION_TIMEOUT_MS = 45000;

const LENGTH_PRESETS = {
    short: {
        hint: '80-140 个中文字符，或长度相当的一小段英文',
        maxChars: 280,
    },
    medium: {
        hint: '200-350 个中文字符，或长度相当的一段英文',
        maxChars: 700,
    },
    long: {
        hint: '500-800 个中文字符，或长度相当的多段英文',
        maxChars: 1200,
    },
};

/**
 * 获取当前续写长度配置。
 * @returns {{hint:string,maxChars:number}} 长度配置
 */
function getLengthPreset() {
    return LENGTH_PRESETS[aiService.getCompletionLength()] || LENGTH_PRESETS.medium;
}

/**
 * 执行一次模型请求。
 * @param {object} options - 请求参数
 * @returns {Promise<ReturnType<typeof parseCompletionResponse>>} 模型正文与诊断信息
 */
async function requestOnce({ provider, model, prompts, temperature }) {
    const baseUrl = aiService.getBaseUrlForScene('completion');
    let response;
    try {
        response = await aiProxyJsonRequest({
            method: 'POST',
            url: `${baseUrl}/chat/completions`,
            apiKey: provider.apiKey,
            timeoutMs: COMPLETION_TIMEOUT_MS,
            body: {
                model,
                temperature,
                messages: [
                    { role: 'system', content: prompts.systemPrompt },
                    { role: 'user', content: prompts.userPrompt },
                ],
            },
        });
    } catch (error) {
        if (/timeout|timed out|超时/i.test(String(error?.message || error))) {
            throw new Error(t('inlineCompletion.error.timeout'));
        }
        throw error;
    }

    if (response.status < 200 || response.status >= 300) {
        const errorData = (() => {
            try { return JSON.parse(response.body || '{}'); } catch { return {}; }
        })();
        throw new Error(errorData.error?.message || t('inlineCompletion.error.apiFailed', { status: response.status }));
    }
    return parseCompletionResponse(response.body);
}

/**
 * 记录不包含用户内容的响应摘要，便于定位 provider 空返回。
 * @param {string} model - 模型 ID
 * @param {number} attempt - 尝试次数
 * @param {object} response - 解析后的响应
 * @param {object} sanitized - 清理结果
 */
function logResponseSummary(model, attempt, response, sanitized) {
    const payload = {
        model,
        attempt,
        timeoutMs: COMPLETION_TIMEOUT_MS,
        finishReason: response.finishReason || '(none)',
        contentLength: response.content.length,
        reasoningLength: response.reasoningLength,
        completionTokens: response.completionTokens,
        refusal: response.refusal,
        sanitizeReason: sanitized.reason,
        outputLength: sanitized.text.length,
    };
    if (sanitized.text) logger.info('response:accepted', payload);
    else logger.warn('response:empty', payload);
}

/**
 * 统一执行直接续写和按灵感续写。
 * @param {object} context - CompletionContextBuilder 生成的上下文
 * @param {{ideaText?:string}} options - 可选写作方向
 * @returns {Promise<string>} 可直接插入的 Markdown
 */
export async function requestCompletion(context, { ideaText = '' } = {}) {
    const provider = aiService.getProviderForScene('completion');
    const model = aiService.getModelForScene('completion');
    if (!provider?.apiKey || !model) throw new Error(t('inlineCompletion.error.noConfig'));

    const lengthPreset = getLengthPreset();
    const prompts = buildCompletionPrompts(context, { lengthHint: lengthPreset.hint, ideaText });
    const firstResponse = await requestOnce({
        provider,
        model,
        prompts,
        temperature: aiService.getTemperature(),
    });
    const first = sanitizeCompletionWithMeta(firstResponse.content, context, lengthPreset.maxChars);
    logResponseSummary(model, 1, firstResponse, first);
    if (first.text) return first.text;

    const retryPrompts = buildCompletionPrompts(context, {
        lengthHint: lengthPreset.hint,
        ideaText,
        retryReason: first.reason === 'duplicate-only'
            ? '上一次只重复了光标前内容。请从光标处继续生成真正新增的文字。'
            : '上一次没有生成最终正文。请直接给出可插入的新增内容，不要只输出思考过程。',
    });
    const retryResponse = await requestOnce({
        provider,
        model,
        prompts: retryPrompts,
        temperature: Math.min(aiService.getTemperature(), 0.5),
    });
    const retry = sanitizeCompletionWithMeta(retryResponse.content, context, lengthPreset.maxChars);
    logResponseSummary(model, 2, retryResponse, retry);
    if (retry.text) return retry.text;
    throw new Error(t('inlineCompletion.error.noContent'));
}

/**
 * 保留旧调用名称，所有入口最终都进入统一引擎。
 * @param {object} context - 续写上下文
 * @returns {Promise<string>} 续写文本
 */
export function requestInlineCompletion(context) {
    return requestCompletion(context);
}
