import { withAiMarkdownOutputRules } from '../../utils/aiMarkdownOutputRules.js';
import { buildInlineCompletionContext } from '../inlineCompletion/CompletionContextBuilder.js';

const BEFORE_LIMIT = 2600;
const AFTER_LIMIT = 1200;
const OUTLINE_LIMIT = 1400;

const MODE_INSTRUCTIONS = {
    polish: '润色这段内容：保持原意和信息量，改善表达、节奏和可读性。',
    expand: '扩写这段内容：保持原文语气和观点，补充必要细节，让表达更充分。',
    shorten: '精简这段内容：保留关键信息和语气，删除冗余，让表达更紧凑。',
};

/**
 * 从完整 Markdown 中提取有限长度的标题提纲。
 * @param {string} markdown - 完整 Markdown
 * @returns {string} 标题提纲
 */
function extractOutline(markdown) {
    const lines = String(markdown || '').split('\n');
    const outline = lines
        .filter(line => /^#{1,6}\s+\S/.test(line.trim()))
        .map(line => line.trim())
        .join('\n');
    return outline.length > OUTLINE_LIMIT ? outline.slice(0, OUTLINE_LIMIT).trimEnd() : outline;
}

/**
 * 从文本开头或结尾截取指定长度。
 * @param {string} text - 原始文本
 * @param {number} limit - 最大长度
 * @param {boolean} fromStart - 是否从开头截取
 * @returns {string} 截取后的文本
 */
function clampAround(text, limit, fromStart = false) {
    const value = String(text || '');
    if (value.length <= limit) return value;
    return fromStart ? value.slice(0, limit).trimEnd() : value.slice(-limit).trimStart();
}

/**
 * 构造选区改写的系统指令。
 * @param {string} mode - 改写模式
 * @returns {string} 系统指令
 */
function buildSelectionRewriteSystemPrompt(mode) {
    return withAiMarkdownOutputRules(`你是一个 Markdown 写作改稿助手。
任务：${MODE_INSTRUCTIONS[mode] || MODE_INSTRUCTIONS.polish}

要求：
1. 只输出改写后的选中内容，不要解释，不要加标题，不要用代码块包裹。
2. 保持原文语言、写作风格、语气和 Markdown 结构。
3. 不要改写选区外的内容，也不要重复选区外上下文。
4. 如果选区是列表、标题、引用或表格片段，尽量保持同类 Markdown 格式。
5. 输出必须可以直接替换用户选中的原文。`);
}

/**
 * 生成选区改写上下文。
 * @param {import('@tiptap/pm/state').EditorState} state - 当前编辑器状态
 * @param {string} selectedMarkdown - 已序列化的选区 Markdown
 * @param {string} markdown - 当前完整 Markdown
 * @param {{from:number,to:number}} [range] - Toolbar 捕获的原始选区范围
 * @returns {{selectedText: string, beforeSelection: string, afterSelection: string, outline: string}}
 */
export function buildSelectionRewriteContext(state, selectedMarkdown, markdown, range = state.selection) {
    const { from, to } = range;
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
 * 构造选区改写请求体。
 * 不设置较小的 token 上限，避免推理模型在生成最终正文前耗尽额度。
 * @param {{mode:string,model:string,temperature:number,userPrompt:string,retryInstruction?:string}} options - 请求参数
 * @returns {object} OpenAI-compatible Chat Completions 请求体
 */
export function buildSelectionRewriteRequestBody({
    mode,
    model,
    temperature,
    userPrompt,
    retryInstruction = '',
}) {
    return {
        model,
        temperature,
        messages: [
            {
                role: 'system',
                content: `${buildSelectionRewriteSystemPrompt(mode)}${retryInstruction ? `\n\n${retryInstruction}` : ''}`,
            },
            { role: 'user', content: userPrompt },
        ],
    };
}

/**
 * 生成写作灵感上下文。
 * @param {import('@tiptap/pm/state').EditorState} state - 当前编辑器状态
 * @param {string} selectedMarkdown - 选区 Markdown，无选区为空
 * @param {string} markdown - 当前完整 Markdown
 * @param {{serialize: Function}|null} serializer - Markdown serializer
 * @param {{from:number,to:number}|null} range - Toolbar 捕获的原始范围
 * @returns {{selectedText: string, beforeSelection: string, afterSelection: string, outline: string, completionContext: object}}
 */
export function buildWritingIdeaContext(state, selectedMarkdown, markdown, serializer = null, range = null) {
    const selection = range || state.selection;
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
        completionContext: buildInlineCompletionContext(state, markdown, serializer),
    };
}
