/**
 * 翻译核心：调大模型做中英自动互译。
 * 词 → 译文 + 音标；句子 → 整句译文 + 挑出的生僻词逐个解释（带音标）。
 */
import { aiService } from '../ai-assistant/aiService.js';
import { aiProxyJsonRequest } from '../../api/aiProxy.js';
import { t } from '../../i18n/index.js';

const SYSTEM_PROMPT = `你是一个中英翻译助手。用户会输入一个词/短语，或一句话/一段话。

只输出一个 JSON 对象，不要输出任何额外文字，不要用代码块包裹。JSON 结构：
{"type":"word"|"sentence","translation":"翻译结果","phonetic":"音标或null","partOfSpeech":"词性或null","usage":"用法说明或null","examples":[{"en":"英文例句","zh":"中文翻译"}],"terms":[{"word":"英文词","phonetic":"音标","explanation":"中文解释"}]}

规则：
1. 自动判断输入是中文还是英文，做中英互译（中→英、英→中）。
2. 自动判断输入是「词/短语」还是「句子/段落」，填入 type。
3. type 为 word 时（输入是词/短语）：
   - translation：核心翻译，简洁
   - phonetic：英文那一侧单词的 IPA 音标（带斜杠，如 /əˈmenəti/），输入英文给输入词、输入中文给英文译文，无法给出为 null
   - partOfSpeech：词性，如 n./v./adj./adv./prep. 等，无法确定为 null
   - usage：用法说明，2-4 句简明中文，讲常见搭配、使用语境、易混淆点或近义辨析
   - examples：2-3 个例句，每个 {en: 英文例句, zh: 中文翻译}，例句要自然、能体现该词的典型用法
   - terms：空数组 []
4. type 为 sentence 时（输入是句子/段落）：
   - translation：整句翻译
   - phonetic、partOfSpeech、usage 为 null，examples 为空数组 []
   - terms：从英文那一侧（输入英文则原文、输入中文则译文）挑出的较生僻、较难的单词，每个给 word、IPA 音标 phonetic、简洁中文 explanation，常见简单词不要挑，没有则为空数组
5. 音标只针对英文单词，使用 IPA；中文不需要音标。`;

/**
 * 翻译一段文本。
 * @param {string} text - 词或句子
 * @returns {Promise<{type:'word'|'sentence', translation:string, phonetic:string|null, terms:Array}>}
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
            temperature: 0.2,
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: input },
            ],
        },
    });

    if (res.status < 200 || res.status >= 300) {
        const errData = (() => { try { return JSON.parse(res.body || '{}'); } catch { return {}; } })();
        throw new Error(errData.error?.message || t('translator.error.apiFailed', { status: res.status }));
    }

    const data = JSON.parse(res.body || '{}');
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
        throw new Error(t('translator.error.noContent'));
    }

    return parseResult(content);
}

/**
 * 从模型回复里提取并解析 JSON，对代码块包裹 / 夹带文字做容错。
 */
function parseResult(content) {
    let jsonText = content.trim();

    const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenceMatch) {
        jsonText = fenceMatch[1].trim();
    } else {
        const start = jsonText.indexOf('{');
        const end = jsonText.lastIndexOf('}');
        if (start !== -1 && end > start) {
            jsonText = jsonText.slice(start, end + 1);
        }
    }

    let parsed;
    try {
        parsed = JSON.parse(jsonText);
    } catch {
        throw new Error(t('translator.error.parseFailed'));
    }

    const type = parsed.type === 'sentence' ? 'sentence' : 'word';
    const cleanStr = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    return {
        type,
        translation: typeof parsed.translation === 'string' ? parsed.translation.trim() : '',
        phonetic: cleanStr(parsed.phonetic),
        partOfSpeech: cleanStr(parsed.partOfSpeech),
        usage: cleanStr(parsed.usage),
        examples: Array.isArray(parsed.examples)
            ? parsed.examples
                .map(it => ({
                    en: typeof it?.en === 'string' ? it.en.trim() : '',
                    zh: typeof it?.zh === 'string' ? it.zh.trim() : '',
                }))
                .filter(it => it.en || it.zh)
            : [],
        terms: Array.isArray(parsed.terms)
            ? parsed.terms
                .filter(it => it && typeof it.word === 'string' && it.word.trim())
                .map(it => ({
                    word: it.word.trim(),
                    phonetic: typeof it.phonetic === 'string' ? it.phonetic.trim() : '',
                    explanation: typeof it.explanation === 'string' ? it.explanation.trim() : '',
                }))
            : [],
    };
}
