import { aiService } from '../../modules/ai-assistant/aiService.js';
import { aiProxyJsonRequest } from '../../api/aiProxy.js';
import { t } from '../../i18n/index.js';

const BEFORE_LIMIT = 6000;
const AFTER_LIMIT = 1200;
const OUTLINE_LIMIT = 1600;
const MAX_COMPLETION_CHARS = 900;

const LENGTH_PRESETS = {
    short: {
        hint: '80-140 个中文字符，或长度相当的一小段英文',
        maxChars: 280,
        maxTokens: 220,
    },
    medium: {
        hint: '200-350 个中文字符，或长度相当的一段英文',
        maxChars: 700,
        maxTokens: 520,
    },
    long: {
        hint: '500-800 个中文字符，或长度相当的多段英文',
        maxChars: 1200,
        maxTokens: 1000,
    },
};

function buildSystemPrompt(lengthHint) {
    return `你是一个写作续写助手。
你的任务是从光标位置继续写下去，不要改写已有内容。

要求：
1. 只输出续写内容，不要解释。
2. 输出的第一个字就是光标后的新内容，绝对不要重复光标前已有文字。
3. 保持原文语言、语气、文体、结构和 Markdown 格式。
4. 如果当前位置在列表中，继续同一种列表格式。
5. 如果当前位置在标题后，围绕该标题展开。
6. 如果 afterCursor 不为空，续写必须自然衔接后文，不要冲突。
7. 控制长度在 ${lengthHint} 左右。`;
}

function getLengthPreset() {
    const key = aiService.getCompletionLength();
    return LENGTH_PRESETS[key] || LENGTH_PRESETS.medium;
}

function clampTextEnd(text, limit) {
    const value = String(text || '');
    if (value.length <= limit) return value;
    const sliced = value.slice(-limit);
    const boundary = sliced.search(/(^|\n)(#{1,6}\s+|\s*$)/);
    return boundary > 0 ? sliced.slice(boundary).trimStart() : sliced.trimStart();
}

function clampTextStart(text, limit) {
    const value = String(text || '');
    if (value.length <= limit) return value;
    return value.slice(0, limit).trimEnd();
}

function extractOutline(markdown) {
    const lines = String(markdown || '').split('\n');
    const outline = lines
        .filter(line => /^#{1,6}\s+\S/.test(line.trim()))
        .map(line => line.trim())
        .join('\n');
    return outline.length > OUTLINE_LIMIT ? outline.slice(0, OUTLINE_LIMIT).trimEnd() : outline;
}

function stripFences(text) {
    let value = String(text || '').trim();
    const fence = value.match(/^```(?:markdown|md|text)?\s*([\s\S]*?)\s*```$/i);
    if (fence) value = fence[1].trim();
    return value;
}

function stripAssistantPreamble(text) {
    return String(text || '')
        .replace(/^(好的|可以|当然|以下是|下面是)[，,:：\s]*/u, '')
        .replace(/^Here(?:'| i)s (?:a|the)?\s*(?:continuation|completion)[:,\s]*/i, '')
        .trim();
}

function normalizeForOverlap(text) {
    return String(text || '').replace(/\s+/g, '');
}

function removeDuplicatePrefix(completion, beforeCursor) {
    const beforeTail = String(beforeCursor || '').slice(-1200);
    const beforeComparable = normalizeForOverlap(beforeTail);
    let value = String(completion || '');

    for (let len = Math.min(500, value.length); len >= 8; len--) {
        const prefix = value.slice(0, len);
        const prefixComparable = normalizeForOverlap(prefix);
        if (prefixComparable.length >= 8 && beforeComparable.endsWith(prefixComparable)) {
            value = value.slice(len);
            break;
        }
    }

    let changed = true;
    while (changed) {
        changed = false;
        const firstLine = value.split('\n')[0]?.trim();
        const firstLineComparable = normalizeForOverlap(firstLine);
        if (firstLineComparable.length >= 8 && beforeComparable.endsWith(firstLineComparable)) {
            const nextLineIndex = value.indexOf('\n');
            value = nextLineIndex >= 0 ? value.slice(nextLineIndex + 1) : '';
            changed = true;
        }
    }

    return value.trimStart();
}

function sanitizeCompletion(raw, beforeCursor, maxChars = MAX_COMPLETION_CHARS) {
    let value = stripFences(raw);
    value = stripAssistantPreamble(value);
    value = removeDuplicatePrefix(value, beforeCursor);
    if (value.length > maxChars) {
        value = value.slice(0, maxChars).replace(/\s+\S*$/, '').trimEnd();
    }
    return value.trim();
}

/**
 * 生成 inline 续写所需的局部上下文。
 * @param {import('@tiptap/pm/state').EditorState} state - 当前编辑器状态
 * @param {string} markdown - 当前 Markdown 原文，用于提取大纲
 * @returns {{beforeCursor: string, afterCursor: string, outline: string}}
 */
export function buildInlineCompletionContext(state, markdown) {
    const { from } = state.selection;
    const beforeText = state.doc.textBetween(0, from, '\n', '\n');
    const afterText = state.doc.textBetween(from, state.doc.content.size, '\n', '\n');
    return {
        beforeCursor: clampTextEnd(beforeText, BEFORE_LIMIT),
        afterCursor: clampTextStart(afterText, AFTER_LIMIT),
        outline: extractOutline(markdown),
    };
}

/**
 * 请求 AI 生成光标位置后的续写内容。
 * @param {{beforeCursor: string, afterCursor: string, outline: string}} context - 写作上下文
 * @returns {Promise<string>} 续写内容
 */
export async function requestInlineCompletion(context) {
    const provider = aiService.getProviderForScene('completion');
    const model = aiService.getModelForScene('completion');
    if (!provider?.apiKey || !model) {
        throw new Error(t('inlineCompletion.error.noConfig'));
    }

    const lengthPreset = getLengthPreset();
    const cursorTail = context.beforeCursor.slice(-600);
    const userPrompt = `<DocumentOutline>
${context.outline || '(无)'}
</DocumentOutline>

<CursorTailDoNotRepeat>
${cursorTail}
</CursorTailDoNotRepeat>

<BeforeCursor>
${context.beforeCursor}
</BeforeCursor>

<AfterCursor>
${context.afterCursor || '(无)'}
</AfterCursor>`;

    const res = await aiProxyJsonRequest({
        method: 'POST',
        url: `${provider.baseUrl}/chat/completions`,
        apiKey: provider.apiKey,
        body: {
            model,
            temperature: aiService.getTemperature(),
            max_tokens: lengthPreset.maxTokens,
            messages: [
                { role: 'system', content: buildSystemPrompt(lengthPreset.hint) },
                { role: 'user', content: userPrompt },
            ],
        },
    });

    if (res.status < 200 || res.status >= 300) {
        const errData = (() => { try { return JSON.parse(res.body || '{}'); } catch { return {}; } })();
        throw new Error(errData.error?.message || t('inlineCompletion.error.apiFailed', { status: res.status }));
    }

    const data = JSON.parse(res.body || '{}');
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
        throw new Error(t('inlineCompletion.error.noContent'));
    }

    const completion = sanitizeCompletion(content, context.beforeCursor, lengthPreset.maxChars);
    if (!completion) {
        throw new Error(t('inlineCompletion.error.noContent'));
    }
    return completion;
}
