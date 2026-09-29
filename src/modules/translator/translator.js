/**
 * 选区翻译核心：中文翻英文，其他语言统一翻成简体中文。
 * UI 与文档插入策略由 Markdown Toolbar 负责，本模块只返回可插入的译文。
 */
import { aiService } from '../ai-assistant/aiService.js';
import { aiProxyJsonRequest } from '../../api/aiProxy.js';
import { t } from '../../i18n/index.js';
import { parseNonStreamingResponse } from '../ai-assistant/services/nonStreamingResponseParser.js';
import { TRANSLATION_SYSTEM_PROMPT } from './translationPolicy.js';

/** 清理模型偶尔附加的代码围栏或“译文”前缀。 */
function sanitizeTranslation(raw) {
    let value = String(raw || '').trim();
    const fence = value.match(/^```(?:markdown|md|text)?\s*([\s\S]*?)\s*```$/i);
    if (fence) value = fence[1].trim();
    return value
        .replace(/^(?:译文|翻译(?:结果)?|translation)\s*[:：]\s*/i, '')
        .trim();
}

/**
 * 翻译一段选中文本。
 * @param {string} text - 选区中的文本或 Markdown。
 * @returns {Promise<string>} 可直接插入文档的译文。
 */
export async function translate(text) {
    const input = (text ?? '').trim();
    if (!input) {
        throw new Error(t('translator.error.empty'));
    }

    const provider = aiService.getProviderForScene('translation');
    const model = aiService.getModelForScene('translation');
    if (!provider?.apiKey || !model) {
        throw new Error(t('translator.error.noConfig'));
    }

    const res = await aiProxyJsonRequest({
        method: 'POST',
        url: `${provider.baseUrl}/chat/completions`,
        apiKey: provider.apiKey,
        body: {
            model,
            temperature: 0.1,
            messages: [
                { role: 'system', content: TRANSLATION_SYSTEM_PROMPT },
                { role: 'user', content: input },
            ],
        },
    });

    if (res.status < 200 || res.status >= 300) {
        const errData = (() => { try { return JSON.parse(res.body || '{}'); } catch { return {}; } })();
        throw new Error(errData.error?.message || t('translator.error.apiFailed', { status: res.status }));
    }

    const parsed = parseNonStreamingResponse(res.body);
    const translation = sanitizeTranslation(parsed.content);
    if (!translation) {
        throw new Error(t('translator.error.noContent'));
    }
    return translation;
}
