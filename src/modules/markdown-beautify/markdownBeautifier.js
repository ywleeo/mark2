import { aiService } from '../ai-assistant/aiService.js';
import { aiProxyJsonRequest } from '../../api/aiProxy.js';
import { t } from '../../i18n/index.js';

const MAX_LINES = 300;

const SYSTEM_PROMPT = `你是一个 Markdown 排版专家。请对用户提供的文本进行 Markdown 格式美化。

严格遵守以下规则：
1. 所有原始内容必须完整保留，不得增加、删减或修改任何实质性内容
2. 只优化排版格式，例如添加合适的标题层级、列表、代码块标记、强调、引用块等
3. 直接输出美化后的 Markdown，不要附加任何解释或说明`;

export async function beautifyMarkdown(text) {
    const lineCount = (text.match(/\n/g) ?? []).length + 1;
    if (lineCount > MAX_LINES) {
        throw new Error(t('beautify.error.tooManyLines', { max: MAX_LINES, current: lineCount }));
    }

    const provider = aiService.getFastProvider();
    const model = aiService.getFastModel();
    if (!provider?.apiKey || !model) {
        throw new Error(t('beautify.error.noConfig'));
    }

    const res = await aiProxyJsonRequest({
        method: 'POST',
        url: `${provider.baseUrl}/chat/completions`,
        apiKey: provider.apiKey,
        body: {
            model,
            temperature: 0.2,
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: text },
            ],
        },
    });

    if (res.status < 200 || res.status >= 300) {
        const errData = (() => { try { return JSON.parse(res.body || '{}'); } catch { return {}; } })();
        throw new Error(errData.error?.message || t('beautify.error.apiFailed', { status: res.status }));
    }

    const data = JSON.parse(res.body || '{}');
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
        throw new Error(t('beautify.error.noContent'));
    }
    return content.trim();
}
