import { aiProxyJsonRequest } from '../../api/aiProxy.js';
import { t } from '../../i18n/index.js';
import { aiService } from '../../modules/ai-assistant/aiService.js';

const BEFORE_LIMIT = 2600;
const AFTER_LIMIT = 1200;
const OUTLINE_LIMIT = 1400;

const MODE_INSTRUCTIONS = {
    polish: '润色这段内容：保持原意和信息量，改善表达、节奏和可读性。',
    expand: '扩写这段内容：保持原文语气和观点，补充必要细节，让表达更充分。',
    shorten: '精简这段内容：保留关键信息和语气，删除冗余，让表达更紧凑。',
};

const IDEA_TYPE_LABELS = {
    angle: '角度',
    example: '例子',
    structure: '结构',
    question: '问题',
    title: '标题',
};

function stripFences(text) {
    let value = String(text || '').trim();
    const fence = value.match(/^```(?:markdown|md|text)?\s*([\s\S]*?)\s*```$/i);
    if (fence) value = fence[1].trim();
    return value;
}

function stripAssistantPreamble(text) {
    return String(text || '')
        .replace(/^(好的|可以|当然|以下是|下面是|改写如下)[，,:：\s]*/u, '')
        .replace(/^Here(?:'| i)s (?:the )?(?:rewritten|polished|expanded|shortened) (?:version|text)[:,\s]*/i, '')
        .trim();
}

function extractOutline(markdown) {
    const lines = String(markdown || '').split('\n');
    const outline = lines
        .filter(line => /^#{1,6}\s+\S/.test(line.trim()))
        .map(line => line.trim())
        .join('\n');
    return outline.length > OUTLINE_LIMIT ? outline.slice(0, OUTLINE_LIMIT).trimEnd() : outline;
}

function clampAround(text, limit, fromStart = false) {
    const value = String(text || '');
    if (value.length <= limit) return value;
    return fromStart ? value.slice(0, limit).trimEnd() : value.slice(-limit).trimStart();
}

function buildSystemPrompt(mode) {
    return `你是一个 Markdown 写作改稿助手。
任务：${MODE_INSTRUCTIONS[mode] || MODE_INSTRUCTIONS.polish}

要求：
1. 只输出改写后的选中内容，不要解释，不要加标题，不要用代码块包裹。
2. 保持原文语言、写作风格、语气和 Markdown 结构。
3. 不要改写选区外的内容，也不要重复选区外上下文。
4. 如果选区是列表、标题、引用或表格片段，尽量保持同类 Markdown 格式。
5. 输出必须可以直接替换用户选中的原文。`;
}

function sanitizeRewrite(raw) {
    return stripAssistantPreamble(stripFences(raw)).trim();
}

function parseAiContent(body) {
    const data = JSON.parse(body || '{}');
    const content = data?.choices?.[0]?.message?.content;
    return typeof content === 'string' ? content : '';
}

function parseJsonArray(content) {
    let text = stripFences(content).trim();
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start >= 0 && end > start) {
        text = text.slice(start, end + 1);
    }
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
}

function normalizeIdeas(rawIdeas) {
    return rawIdeas
        .map((item, index) => {
            if (typeof item === 'string') {
                return { id: `idea-${index}`, type: 'angle', text: item.trim(), why: '' };
            }
            const type = ['angle', 'example', 'structure', 'question', 'title'].includes(item?.type)
                ? item.type
                : 'angle';
            return {
                id: `idea-${index}`,
                type,
                typeLabel: IDEA_TYPE_LABELS[type] || IDEA_TYPE_LABELS.angle,
                text: typeof item?.text === 'string' ? item.text.trim() : '',
                why: typeof item?.why === 'string' ? item.why.trim() : '',
            };
        })
        .filter(item => item.text);
}

/**
 * 生成选区改写上下文。
 * @param {import('@tiptap/pm/state').EditorState} state - 当前编辑器状态
 * @param {string} selectedMarkdown - 已序列化的选区 Markdown
 * @param {string} markdown - 当前完整 Markdown
 * @returns {{selectedText: string, beforeSelection: string, afterSelection: string, outline: string}}
 */
export function buildSelectionRewriteContext(state, selectedMarkdown, markdown) {
    const { from, to } = state.selection;
    const beforeText = state.doc.textBetween(0, from, '\n', '\n');
    const afterText = state.doc.textBetween(to, state.doc.content.size, '\n', '\n');
    return {
        selectedText: String(selectedMarkdown || '').trim(),
        beforeSelection: clampAround(beforeText, BEFORE_LIMIT, false),
        afterSelection: clampAround(afterText, AFTER_LIMIT, true),
        outline: extractOutline(markdown),
    };
}

/**
 * 生成写作灵感上下文。
 * @param {import('@tiptap/pm/state').EditorState} state - 当前编辑器状态
 * @param {string} selectedMarkdown - 选区 Markdown，无选区为空
 * @param {string} markdown - 当前完整 Markdown
 * @returns {{selectedText: string, beforeSelection: string, afterSelection: string, outline: string}}
 */
export function buildWritingIdeaContext(state, selectedMarkdown, markdown) {
    const selection = state.selection;
    const from = selection?.from ?? 0;
    const to = selection?.to ?? from;
    const beforeText = state.doc.textBetween(0, from, '\n', '\n');
    const afterText = state.doc.textBetween(to, state.doc.content.size, '\n', '\n');
    const selectedText = selectedMarkdown || (selection?.empty ? '' : state.doc.textBetween(from, to, '\n', '\n'));
    return {
        selectedText: String(selectedText || '').trim(),
        beforeSelection: clampAround(beforeText, BEFORE_LIMIT, false),
        afterSelection: clampAround(afterText, AFTER_LIMIT, true),
        outline: extractOutline(markdown),
    };
}

/**
 * 请求 AI 给当前光标或选区提供写作灵感。
 * @param {{selectedText: string, beforeSelection: string, afterSelection: string, outline: string}} context - 写作上下文
 * @returns {Promise<Array<{id:string,type:string,typeLabel:string,text:string,why:string}>>}
 */
export async function requestWritingIdeas(context) {
    const provider = aiService.getProviderForScene('completion');
    const model = aiService.getModelForScene('completion');
    if (!provider?.apiKey || !model) {
        throw new Error(t('inlineCompletion.error.noConfig'));
    }

    const scopeInstruction = context.selectedText
        ? '用户选中了文档中的一段内容。围绕选区提供可继续展开、换角度、补例子或优化结构的灵感。'
        : '用户在光标处卡住了。根据当前上下文提供下一步可写的灵感。';

    const userPrompt = `<DocumentOutline>
${context.outline || '(无)'}
</DocumentOutline>

<BeforeCursorOrSelection>
${context.beforeSelection || '(无)'}
</BeforeCursorOrSelection>

<SelectedText>
${context.selectedText || '(无)'}
</SelectedText>

<AfterCursorOrSelection>
${context.afterSelection || '(无)'}
</AfterCursorOrSelection>`;

    const res = await aiProxyJsonRequest({
        method: 'POST',
        url: `${provider.baseUrl}/chat/completions`,
        apiKey: provider.apiKey,
        body: {
            model,
            temperature: Math.max(aiService.getTemperature(), 0.7),
            max_tokens: 700,
            messages: [
                {
                    role: 'system',
                    content: `你是写作编辑，不要替作者直接写完整正文。
${scopeInstruction}

要求：
1. 给 5 条具体、可执行、贴合原文风格的写作灵感。
2. 每条只给一个明确方向，避免空泛建议。
3. 不要输出解释性前言。
4. 只输出 JSON 数组，不要用代码块包裹。
格式：
[
  {"type":"angle|example|structure|question|title","text":"具体灵感","why":"为什么适合当前上下文"}
]`,
                },
                { role: 'user', content: userPrompt },
            ],
        },
    });

    if (res.status < 200 || res.status >= 300) {
        const errData = (() => { try { return JSON.parse(res.body || '{}'); } catch { return {}; } })();
        throw new Error(errData.error?.message || t('inlineCompletion.error.apiFailed', { status: res.status }));
    }

    try {
        const ideas = normalizeIdeas(parseJsonArray(parseAiContent(res.body)));
        if (ideas.length === 0) throw new Error(t('inlineCompletion.error.noContent'));
        return ideas;
    } catch (error) {
        console.warn('[AiWriting] parse ideas failed', error);
        throw new Error(t('inlineCompletion.error.noContent'));
    }
}

/**
 * 根据一条灵感生成可放到光标处的正文续写。
 * @param {string} ideaText - 灵感内容
 * @param {{selectedText: string, beforeSelection: string, afterSelection: string, outline: string}} context - 写作上下文
 * @returns {Promise<string>} 正文续写
 */
export async function requestIdeaExpansion(ideaText, context) {
    const provider = aiService.getProviderForScene('completion');
    const model = aiService.getModelForScene('completion');
    if (!provider?.apiKey || !model) {
        throw new Error(t('inlineCompletion.error.noConfig'));
    }

    const res = await aiProxyJsonRequest({
        method: 'POST',
        url: `${provider.baseUrl}/chat/completions`,
        apiKey: provider.apiKey,
        body: {
            model,
            temperature: aiService.getTemperature(),
            max_tokens: 800,
            messages: [
                {
                    role: 'system',
                    content: `你是 Markdown 写作续写助手。
根据用户选择的灵感，在当前光标位置继续写一小段正文。
只输出新增正文，不要解释，不要重复光标前已有内容。
保持原文语言、文体、语气和 Markdown 格式。`,
                },
                {
                    role: 'user',
                    content: `<Idea>
${ideaText}
</Idea>

<DocumentOutline>
${context.outline || '(无)'}
</DocumentOutline>

<BeforeCursorOrSelection>
${context.beforeSelection || '(无)'}
</BeforeCursorOrSelection>

<SelectedText>
${context.selectedText || '(无)'}
</SelectedText>

<AfterCursorOrSelection>
${context.afterSelection || '(无)'}
</AfterCursorOrSelection>`,
                },
            ],
        },
    });

    if (res.status < 200 || res.status >= 300) {
        const errData = (() => { try { return JSON.parse(res.body || '{}'); } catch { return {}; } })();
        throw new Error(errData.error?.message || t('inlineCompletion.error.apiFailed', { status: res.status }));
    }

    const content = sanitizeRewrite(parseAiContent(res.body));
    if (!content) {
        throw new Error(t('inlineCompletion.error.noContent'));
    }
    return content;
}

/**
 * 请求 AI 改写当前选区。
 * @param {'polish'|'expand'|'shorten'} mode - 改写模式
 * @param {{selectedText: string, beforeSelection: string, afterSelection: string, outline: string}} context - 选区上下文
 * @returns {Promise<string>} 可直接替换选区的 Markdown
 */
export async function requestSelectionRewrite(mode, context) {
    const provider = aiService.getProviderForScene('completion');
    const model = aiService.getModelForScene('completion');
    if (!provider?.apiKey || !model) {
        throw new Error(t('inlineCompletion.error.noConfig'));
    }

    const userPrompt = `<DocumentOutline>
${context.outline || '(无)'}
</DocumentOutline>

<BeforeSelection>
${context.beforeSelection || '(无)'}
</BeforeSelection>

<SelectedText>
${context.selectedText}
</SelectedText>

<AfterSelection>
${context.afterSelection || '(无)'}
</AfterSelection>`;

    const res = await aiProxyJsonRequest({
        method: 'POST',
        url: `${provider.baseUrl}/chat/completions`,
        apiKey: provider.apiKey,
        body: {
            model,
            temperature: aiService.getTemperature(),
            max_tokens: mode === 'expand' ? 1200 : 800,
            messages: [
                { role: 'system', content: buildSystemPrompt(mode) },
                { role: 'user', content: userPrompt },
            ],
        },
    });

    if (res.status < 200 || res.status >= 300) {
        const errData = (() => { try { return JSON.parse(res.body || '{}'); } catch { return {}; } })();
        throw new Error(errData.error?.message || t('inlineCompletion.error.apiFailed', { status: res.status }));
    }

    const content = sanitizeRewrite(parseAiContent(res.body));
    if (!content) {
        throw new Error(t('inlineCompletion.error.noContent'));
    }
    return content;
}
