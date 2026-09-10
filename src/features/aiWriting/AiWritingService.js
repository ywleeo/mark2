import { aiProxyJsonRequest } from '../../api/aiProxy.js';
import { t } from '../../i18n/index.js';
import { aiService } from '../../modules/ai-assistant/aiService.js';
import { createLogger } from '../../core/diagnostics/Logger.js';
import { parseNonStreamingResponse } from '../../modules/ai-assistant/services/nonStreamingResponseParser.js';
import { requestCompletion } from '../inlineCompletion/CompletionEngine.js';
import { getForcedToolCallCompatibility } from '../../modules/ai-assistant/providerCompatibility.js';
import {
    createWritingIdeasTool,
    createWritingIdeasToolChoice,
    parseWritingIdeasToolResponse,
} from './WritingIdeasTool.js';
import {
    buildSelectionRewriteContext,
    buildSelectionRewriteRequestBody,
    buildWritingIdeaContext,
} from './AiWritingBuilders.js';

export {
    buildSelectionRewriteContext,
    buildSelectionRewriteRequestBody,
    buildWritingIdeaContext,
} from './AiWritingBuilders.js';

const SELECTION_REWRITE_TIMEOUT_MS = 45000;
const logger = createLogger('selection-rewrite');

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

function sanitizeRewrite(raw) {
    return stripAssistantPreamble(stripFences(raw)).trim();
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
    const compatibility = getForcedToolCallCompatibility(provider, model);
    const ideasTool = createWritingIdeasTool({ strict: compatibility.strictToolSchema });

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
        url: `${compatibility.baseUrl}/chat/completions`,
        apiKey: provider.apiKey,
        body: {
            model,
            temperature: Math.max(aiService.getTemperature(), 0.7),
            messages: [
                {
                    role: 'system',
                    content: `你是写作编辑，不要替作者直接写完整正文。
${scopeInstruction}

要求：
1. 给 5 条具体、可执行、贴合原文风格的写作灵感。
2. 每条只给一个明确方向，避免空泛建议。
3. 不要输出解释性前言。
4. 灵感只提供“下一步可以写什么”，不要写完整故事梗概、结局、主题总结或人生感悟。
5. 灵感应保留未解决的问题或冲突，方便继续展开。
6. 必须调用 ${ideasTool.function.name} 提交结果，不要在正文中输出结果。`,
                },
                { role: 'user', content: userPrompt },
            ],
            tools: [ideasTool],
            tool_choice: createWritingIdeasToolChoice(),
            ...compatibility.body,
        },
    });

    if (res.status < 200 || res.status >= 300) {
        const errData = (() => { try { return JSON.parse(res.body || '{}'); } catch { return {}; } })();
        throw new Error(errData.error?.message || t('inlineCompletion.error.apiFailed', { status: res.status }));
    }

    try {
        const ideas = parseWritingIdeasToolResponse(res.body);
        if (ideas.length === 0) throw new Error(t('aiWriting.error.noIdeas'));
        return ideas;
    } catch (error) {
        console.warn('[AiWriting] parse ideas failed', error);
        throw new Error(t('aiWriting.error.noIdeas'));
    }
}

/**
 * 根据一条灵感生成可放到光标处的正文续写。
 * @param {string} ideaText - 灵感内容
 * @param {{selectedText: string, beforeSelection: string, afterSelection: string, outline: string}} context - 写作上下文
 * @returns {Promise<string>} 正文续写
 */
export async function requestIdeaExpansion(ideaText, context) {
    const completionContext = context.completionContext || {
        beforeCursor: context.beforeSelection || '',
        afterCursor: context.afterSelection || '',
        outline: context.outline || '',
        writingMode: 'auto',
        currentFormat: {
            mode: 'paragraph',
            insertionMode: 'inline',
            blockType: 'paragraph',
            listType: '',
            beforeInBlock: '',
            afterInBlock: '',
            insideContainer: false,
            instruction: '自然延续当前段落。',
        },
    };
    return requestCompletion(completionContext, { ideaText });
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

    /**
     * 执行一次改写请求，并返回清理后的正文。
     * @param {number} attempt - 当前尝试次数
     * @param {string} retryInstruction - 空响应重试指令
     * @returns {Promise<string>} 改写正文，空字符串代表 provider 未返回正文
     */
    const requestOnce = async (attempt, retryInstruction = '') => {
        let res;
        try {
            res = await aiProxyJsonRequest({
                method: 'POST',
                url: `${aiService.getBaseUrlForScene('completion')}/chat/completions`,
                apiKey: provider.apiKey,
                timeoutMs: SELECTION_REWRITE_TIMEOUT_MS,
                body: buildSelectionRewriteRequestBody({
                    mode,
                    model,
                    temperature: attempt === 1
                        ? aiService.getTemperature()
                        : Math.min(aiService.getTemperature(), 0.4),
                    userPrompt,
                    retryInstruction,
                }),
            });
        } catch (error) {
            if (/timeout|timed out|超时/i.test(String(error?.message || error))) {
                throw new Error(t('inlineCompletion.error.timeout'));
            }
            throw error;
        }

        if (res.status < 200 || res.status >= 300) {
            const errData = (() => { try { return JSON.parse(res.body || '{}'); } catch { return {}; } })();
            throw new Error(errData.error?.message || t('inlineCompletion.error.apiFailed', { status: res.status }));
        }

        const parsed = parseNonStreamingResponse(res.body);
        const content = sanitizeRewrite(parsed.content);
        logger[content ? 'info' : 'warn']('response:received', {
            model,
            attempt,
            finishReason: parsed.finishReason || '(none)',
            contentLength: parsed.content.length,
            reasoningLength: parsed.reasoningLength,
            completionTokens: parsed.completionTokens,
            refusal: parsed.refusal,
            outputLength: content.length,
        });
        return content;
    };

    const first = await requestOnce(1);
    if (first) return first;

    const retry = await requestOnce(
        2,
        '上一次没有生成最终正文。减少思考，直接输出可替换选区的改写结果。',
    );
    if (retry) return retry;
    throw new Error(t('aiWriting.error.noContent'));
}
