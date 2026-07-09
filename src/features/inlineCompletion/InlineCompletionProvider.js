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
4. 严格遵守 CurrentFormat 中的格式要求，续写必须接在当前块后面，而不是另起一个独立大纲。
5. 如果 CurrentFormat.insideContainer 为 true，说明光标已经在列表、引用、标题等有样式容器里；只输出容器内部文本，绝对不要再输出这个容器的 Markdown 标记，例如不要输出 1.、-、>、#。
6. 如果当前位置在列表项内部，只续写列表项的文字内容，不要输出列表编号、bullet、checkbox 或缩进。
7. 如果当前位置在引用块内部，只续写引用文字，不要输出 >。
8. 如果当前位置在标题内部，只续写标题文字或标题后的正文，不要输出 #。
9. 如果当前位置是普通段落，默认继续普通段落，不要突然创建标题、编号列表、嵌套列表、表格或引用。
10. 如果当前位置是以冒号结尾的引导句，只直接补它后面的内容；需要列举时使用一层扁平列表，不要先输出“1.”再嵌套子列表。
11. 如果 afterCursor 不为空，续写必须自然衔接后文，不要冲突。
12. 把续写当作连载中的“下一小段情节”，只推进当前场景或下一个具体动作。
13. 不要在本次续写里完结故事、总结主题、升华感悟、给出命运定论或写出大结局。
14. 不要使用“原来/终于/从此/那一刻/老天爷/命运/一切都明白了”这类收束式表达。
15. 优先写具体细节、人物动作、对话、环境变化和新的阻碍，让故事还能继续往后写。
16. 结尾可以停在动作、发现、疑问、冲突或悬念上，但不要收束。
17. 即使格式判断不确定，也必须输出一段可以直接接在光标后的内容，不要返回空内容。
18. 控制长度在 ${lengthHint} 左右。`;
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

/**
 * 提取光标前最近一行有内容的文本，用来识别“标题：”后空行续写的场景。
 * @param {string} beforeCursor - 光标前文本
 * @returns {string} 最近非空行
 */
function getPreviousNonEmptyLine(beforeCursor) {
    const lines = String(beforeCursor || '').split('\n');
    for (let index = lines.length - 1; index >= 0; index -= 1) {
        const line = lines[index]?.trimEnd();
        if (line?.trim()) return line;
    }
    return '';
}

/**
 * 获取光标所在位置的祖先节点类型，用于判断是否位于列表、标题等结构内。
 * @param {import('@tiptap/pm/state').EditorState} state - 当前编辑器状态
 * @returns {{names: string[], attrs: Record<string, unknown>[]}} 祖先节点信息
 */
function getSelectionAncestors(state) {
    const $from = state.selection.$from;
    const names = [];
    const attrs = [];
    for (let depth = 0; depth <= $from.depth; depth += 1) {
        const node = $from.node(depth);
        names.push(node.type?.name || '');
        attrs.push(node.attrs || {});
    }
    return { names, attrs };
}

/**
 * 生成当前位置的格式合同，给模型明确续写应该接续哪一种 Markdown 结构。
 * @param {import('@tiptap/pm/state').EditorState} state - 当前编辑器状态
 * @param {string} beforeCursor - 光标前文本
 * @returns {{mode: string, instruction: string, beforeInBlock: string, afterInBlock: string, blockType: string, listType: string, previousNonEmptyLine: string, insideContainer: boolean}}
 */
function inferCurrentFormat(state, beforeCursor) {
    const { $from } = state.selection;
    const parent = $from.parent;
    const parentOffset = $from.parentOffset;
    const beforeInBlock = parent.textBetween(0, parentOffset, '\n', '\n');
    const afterInBlock = parent.textBetween(parentOffset, parent.content.size, '\n', '\n');
    const { names, attrs } = getSelectionAncestors(state);
    const listType = names.find(name => /^(bulletList|orderedList|taskList)$/i.test(name)) || '';
    const quoteType = names.find(name => /^(blockquote|blockQuote)$/i.test(name)) || '';
    const headingIndex = names.findIndex(name => name === 'heading');
    const blockType = parent.type?.name || '';
    const trimmedBefore = beforeInBlock.trimEnd();
    const previousNonEmptyLine = getPreviousNonEmptyLine(beforeCursor);

    if (listType) {
        return {
            mode: 'list',
            blockType,
            listType,
            beforeInBlock,
            afterInBlock,
            previousNonEmptyLine,
            insideContainer: true,
            instruction: `当前位置已经在 ${listType} 的列表项内部。只输出列表项里的文字内容；不要输出编号、bullet、checkbox、缩进或新的列表外壳。`,
        };
    }

    if (quoteType) {
        return {
            mode: 'quote',
            blockType,
            listType: '',
            beforeInBlock,
            afterInBlock,
            previousNonEmptyLine,
            insideContainer: true,
            instruction: '当前位置已经在引用块内部。只输出引用里的文字内容；不要输出 > 或新的引用块标记。',
        };
    }

    if (headingIndex >= 0 || blockType === 'heading') {
        const level = attrs[headingIndex]?.level || parent.attrs?.level || '';
        return {
            mode: 'heading',
            blockType,
            listType: '',
            beforeInBlock,
            afterInBlock,
            previousNonEmptyLine,
            insideContainer: true,
            instruction: `当前位置已经在 ${level ? `${level} 级` : ''}标题内部。只输出标题文字或标题后的正文；不要输出 # 或重复标题标记。`,
        };
    }

    if (/[:：]\s*$/.test(trimmedBefore) || (!trimmedBefore && /[:：]\s*$/.test(previousNonEmptyLine))) {
        return {
            mode: 'intro-label',
            blockType,
            listType: '',
            beforeInBlock,
            afterInBlock,
            previousNonEmptyLine,
            insideContainer: false,
            instruction: '当前位置接在以冒号结尾的引导句后。续写要直接填充这个引导句下面的内容；如果需要列举，只使用一层扁平 bullet list。禁止输出编号列表、空编号、嵌套列表或“1.”外层。',
        };
    }

    return {
        mode: 'paragraph',
        blockType,
        listType: '',
        beforeInBlock,
        afterInBlock,
        previousNonEmptyLine,
        insideContainer: false,
        instruction: '当前位置是普通正文段落。续写默认保持普通段落格式；除非上下文已经在列表里，否则不要突然输出 Markdown 列表或标题。',
    };
}

/**
 * 将当前位置格式转换成给模型读取的稳定文本。
 * @param {{mode: string, instruction: string, beforeInBlock: string, afterInBlock: string, blockType: string, listType: string, previousNonEmptyLine?: string, insideContainer?: boolean}} format - 当前格式合同
 * @returns {string} prompt 片段
 */
function formatCurrentFormat(format) {
    return [
        `mode: ${format.mode}`,
        `blockType: ${format.blockType || '(unknown)'}`,
        `listType: ${format.listType || '(none)'}`,
        `insideContainer: ${format.insideContainer ? 'true' : 'false'}`,
        `textBeforeCursorInCurrentBlock: ${format.beforeInBlock || '(empty)'}`,
        `textAfterCursorInCurrentBlock: ${format.afterInBlock || '(empty)'}`,
        `previousNonEmptyLine: ${format.previousNonEmptyLine || '(empty)'}`,
        `instruction: ${format.instruction}`,
    ].join('\n');
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

/**
 * 解析兼容 OpenAI Chat Completions 和部分兼容服务的返回内容。
 * @param {string} body - AI API 原始响应体
 * @returns {string} AI 文本内容
 */
function parseAiContent(body) {
    const data = JSON.parse(body || '{}');
    const choice = data?.choices?.[0];
    const content = choice?.message?.content ?? choice?.text;
    if (Array.isArray(content)) {
        return content
            .map(part => (typeof part === 'string' ? part : part?.text || ''))
            .join('')
            .trim();
    }
    return typeof content === 'string' ? content : '';
}

/**
 * 清理模型违反格式合同时产生的编号外层。
 * 典型错误是当前位置已经是“常见误区：”，模型却输出编号列表甚至嵌套 bullet。
 * @param {string} completion - 模型原始续写
 * @param {{mode?: string}} format - 当前格式合同
 * @returns {string} 清理后的续写
 */
function unwrapAccidentalOutline(completion, format) {
    let value = String(completion || '');
    if (format?.mode !== 'intro-label' && format?.mode !== 'paragraph') return value;

    if (format?.mode === 'intro-label') {
        value = value.replace(/^(\s*)\d+[.)]\s+/gm, '$1- ');
    }

    const shellMatch = value.match(/^\s*-\s*\n+([\s\S]+)$/);
    if (!shellMatch) {
        return value
            .split('\n')
            .map(line => line.replace(/^\s{2,}(?=[-*+•o]\s+)/, ''))
            .join('\n')
            .replace(/^(\s*)[•o]\s+/gm, '$1- ');
    }

    const body = shellMatch[1]
        .split('\n')
        .map(line => line.replace(/^\s{2,}(?=[-*+•o]\s+)/, ''))
        .join('\n')
        .trimStart();
    const firstContentLine = body.split('\n').find(line => line.trim());
    if (!/^\s*(?:[-*+•o]\s+)/.test(firstContentLine || '')) return value;
    return body.replace(/^(\s*)[•o]\s+/gm, '$1- ');
}

/**
 * 当光标已经在有样式容器内部时，移除模型误输出的容器标记。
 * @param {string} completion - 模型续写
 * @param {{mode?: string, insideContainer?: boolean}} format - 当前格式合同
 * @returns {string} 去掉重复容器标记后的文本
 */
function stripCurrentContainerMarkers(completion, format) {
    if (!format?.insideContainer) return String(completion || '');
    const value = String(completion || '');
    if (format.mode === 'list') {
        return value.replace(/^\s*(?:[-*+•o]|\d+[.)]|\[[ xX]\])\s+/gm, '');
    }
    if (format.mode === 'quote') {
        return value.replace(/^\s*>\s?/gm, '');
    }
    if (format.mode === 'heading') {
        return value.replace(/^\s*#{1,6}\s+/gm, '');
    }
    return value;
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

/**
 * 裁剪续写长度，尽量避免截断英文单词，同时不因为中文无空格而清空内容。
 * @param {string} text - 续写文本
 * @param {number} maxChars - 最大字符数
 * @returns {string} 裁剪后的文本
 */
function clampCompletionLength(text, maxChars) {
    const value = String(text || '');
    if (value.length <= maxChars) return value.trim();
    const sliced = value.slice(0, maxChars);
    const softTrimmed = sliced.replace(/\s+\S*$/, '').trimEnd();
    return (softTrimmed || sliced).trim();
}

function sanitizeCompletion(raw, beforeCursor, maxChars = MAX_COMPLETION_CHARS, format = null) {
    const basic = stripAssistantPreamble(stripFences(raw));
    const formatted = stripCurrentContainerMarkers(unwrapAccidentalOutline(basic, format), format);
    const deduped = removeDuplicatePrefix(formatted, beforeCursor);
    const candidate = clampCompletionLength(deduped, maxChars);
    if (candidate) return candidate;

    // 去重可能会在模型只重复光标前一小段时把结果清空。此时回退到基础清理结果，
    // 由用户决定是否接受，避免把可见 AI 输出变成 “no completion”。
    return clampCompletionLength(formatted || basic, maxChars);
}

/**
 * 执行一次续写请求。
 * @param {{provider: object, model: string, lengthPreset: object, userPrompt: string, systemPrompt: string}} options - 请求参数
 * @returns {Promise<string>} AI 原始文本内容
 */
async function requestCompletionOnce({ provider, model, lengthPreset, userPrompt, systemPrompt }) {
    const res = await aiProxyJsonRequest({
        method: 'POST',
        url: `${provider.baseUrl}/chat/completions`,
        apiKey: provider.apiKey,
        body: {
            model,
            temperature: aiService.getTemperature(),
            max_tokens: lengthPreset.maxTokens,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
            ],
        },
    });

    if (res.status < 200 || res.status >= 300) {
        const errData = (() => { try { return JSON.parse(res.body || '{}'); } catch { return {}; } })();
        throw new Error(errData.error?.message || t('inlineCompletion.error.apiFailed', { status: res.status }));
    }

    return parseAiContent(res.body);
}

/**
 * 生成 inline 续写所需的局部上下文。
 * @param {import('@tiptap/pm/state').EditorState} state - 当前编辑器状态
 * @param {string} markdown - 当前 Markdown 原文，用于提取大纲
 * @returns {{beforeCursor: string, afterCursor: string, outline: string, currentFormat: ReturnType<typeof inferCurrentFormat>}}
 */
export function buildInlineCompletionContext(state, markdown) {
    const { from } = state.selection;
    const beforeText = state.doc.textBetween(0, from, '\n', '\n');
    const afterText = state.doc.textBetween(from, state.doc.content.size, '\n', '\n');
    return {
        beforeCursor: clampTextEnd(beforeText, BEFORE_LIMIT),
        afterCursor: clampTextStart(afterText, AFTER_LIMIT),
        outline: extractOutline(markdown),
        currentFormat: inferCurrentFormat(state, beforeText),
    };
}

/**
 * 请求 AI 生成光标位置后的续写内容。
 * @param {{beforeCursor: string, afterCursor: string, outline: string, currentFormat?: ReturnType<typeof inferCurrentFormat>}} context - 写作上下文
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
    const systemPrompt = buildSystemPrompt(lengthPreset.hint);
    const userPrompt = `<DocumentOutline>
${context.outline || '(无)'}
</DocumentOutline>

<CursorTailDoNotRepeat>
${cursorTail}
</CursorTailDoNotRepeat>

<CurrentFormat>
${formatCurrentFormat(context.currentFormat || {
        mode: 'paragraph',
        blockType: '',
        listType: '',
        beforeInBlock: '',
        afterInBlock: '',
        previousNonEmptyLine: '',
        insideContainer: false,
        instruction: '当前位置格式未知。默认保持普通正文段落格式。',
    })}
</CurrentFormat>

<BeforeCursor>
${context.beforeCursor}
</BeforeCursor>

<AfterCursor>
${context.afterCursor || '(无)'}
</AfterCursor>`;

    const content = await requestCompletionOnce({ provider, model, lengthPreset, userPrompt, systemPrompt });
    const completion = sanitizeCompletion(content, context.beforeCursor, lengthPreset.maxChars, context.currentFormat);
    if (completion) return completion;

    const retryPrompt = `<BeforeCursor>
${context.beforeCursor.slice(-900)}
</BeforeCursor>

<CurrentFormat>
${formatCurrentFormat(context.currentFormat || {
        mode: 'paragraph',
        blockType: '',
        listType: '',
        beforeInBlock: '',
        afterInBlock: '',
        previousNonEmptyLine: '',
        insideContainer: false,
        instruction: '当前位置格式未知。默认保持普通正文段落格式。',
    })}
</CurrentFormat>

请直接续写光标后的内容。不要解释，不要重复已有文字，不要返回空内容。`;
    const retryContent = await requestCompletionOnce({
        provider,
        model,
        lengthPreset,
        userPrompt: retryPrompt,
        systemPrompt: '你是写作续写助手。只输出可以直接接在光标后的内容，不要解释，不要返回空内容。',
    });
    const retryCompletion = sanitizeCompletion(retryContent, context.beforeCursor, lengthPreset.maxChars, context.currentFormat);
    if (retryCompletion) return retryCompletion;

    throw new Error(t('inlineCompletion.error.noContent'));
}
