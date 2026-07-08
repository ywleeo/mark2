import { aiProxyJsonRequest } from '../../api/aiProxy.js';
import { t } from '../../i18n/index.js';
import { aiService } from '../ai-assistant/aiService.js';

const FILE_CONTEXT_LIMIT = 60000;
const DOCUMENT_OUTPUT_PATTERNS = [
    /(?:写|存|保存|输出|放|整理|生成|创建|建立|导出).{0,12}(?:新文件|文件|文档|文稿|markdown|md|todo|待办|清单|大纲|报告|草稿|列表)/i,
    /(?:新文件|文件|文档|文稿|markdown|md).{0,12}(?:里|中|内|保存|写入|打开|生成|创建|建立)/i,
    /(?:to-do|todo)\s*(?:list)?/i,
];

/**
 * 判断用户是否明确要求把结果做成一个新文档。
 * @param {string} instruction - 用户输入的自由指令
 * @returns {boolean}
 */
function shouldOpenDocumentFromInstruction(instruction) {
    const text = String(instruction || '').trim();
    return DOCUMENT_OUTPUT_PATTERNS.some(pattern => pattern.test(text));
}

/**
 * 去掉模型常见的 Markdown 代码围栏包裹，保留正文内容。
 * @param {string} text - AI 返回内容
 * @returns {string}
 */
function stripMarkdownFence(text) {
    const value = String(text || '').trim();
    const match = value.match(/^```(?:[\w-]+)?\s*([\s\S]*?)\s*```$/i);
    return (match ? match[1] : value).trim();
}

/**
 * 从 OpenAI-compatible 响应体中提取文本内容。
 * @param {string} body - JSON 响应体
 * @returns {string}
 */
function parseAiContent(body) {
    const data = JSON.parse(body || '{}');
    const content = data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text ?? '';
    if (Array.isArray(content)) {
        return content
            .map(part => (typeof part === 'string' ? part : part?.text || ''))
            .join('')
            .trim();
    }
    return typeof content === 'string' ? content.trim() : '';
}

/**
 * 裁剪超长文件，避免一次性文件任务把上下文撑爆。
 * @param {string} content - 文件内容
 * @returns {{content:string,truncated:boolean,originalLength:number}}
 */
function clampFileContent(content) {
    const value = String(content || '');
    if (value.length <= FILE_CONTEXT_LIMIT) {
        return { content: value, truncated: false, originalLength: value.length };
    }
    return {
        content: value.slice(0, FILE_CONTEXT_LIMIT).trimEnd(),
        truncated: true,
        originalLength: value.length,
    };
}

/**
 * 解析 AI 文档任务的结构化返回。
 * @param {string} text - 模型输出
 * @returns {{action:'show_answer'|'open_document',filename:string|null,content:string}}
 */
function parseTaskResult(text) {
    const raw = stripMarkdownFence(text);
    try {
        const parsed = JSON.parse(raw);
        const action = parsed?.action === 'open_document' ? 'open_document' : 'show_answer';
        const content = typeof parsed?.content === 'string' ? parsed.content.trim() : '';
        const filename = typeof parsed?.filename === 'string' && parsed.filename.trim()
            ? parsed.filename.trim()
            : null;
        return { action, filename, content };
    } catch {
        return { action: 'show_answer', filename: null, content: raw.trim() };
    }
}

/**
 * 执行一次性 AI 文档任务。
 */
export class AiFileTaskService {
    /**
     * 根据用户自由指令处理单个文档内容。
     * @param {{filePath:string,fileContent:string,instruction:string}} options - 任务参数
     * @returns {Promise<{action:'show_answer'|'open_document',filename:string|null,content:string}>}
     */
    async runFileTask({ filePath, fileContent, instruction }) {
        const provider = aiService.getProviderForScene('documentTask');
        const model = aiService.getModelForScene('documentTask');
        if (!provider?.apiKey || !model) {
            throw new Error(t('inlineCompletion.error.noConfig'));
        }

        const trimmedInstruction = String(instruction || '').trim();
        if (!trimmedInstruction) {
            throw new Error(t('aiFileTask.error.emptyInstruction'));
        }

        const clamped = clampFileContent(fileContent);
        const truncationNotice = clamped.truncated
            ? `\n\n注意：源文件较长，只提供前 ${FILE_CONTEXT_LIMIT} 个字符。原始长度 ${clamped.originalLength} 个字符。`
            : '';

        const response = await aiProxyJsonRequest({
            method: 'POST',
            url: `${provider.baseUrl}/chat/completions`,
            apiKey: provider.apiKey,
            body: {
                model,
                temperature: aiService.getTemperature(),
                max_tokens: 2200,
                messages: [
                    {
                        role: 'system',
                        content: `你是 Mark2 的文件处理助手。你不是聊天助手，而是一次性文档任务执行器。

要求：
1. 严格根据用户指令和提供的文件内容输出结果。
2. 你必须只输出 JSON，不要输出 Markdown 代码围栏，不要输出寒暄。
3. JSON 格式为：{"action":"show_answer|open_document","filename":null|string,"content":"..."}
4. 如果用户只是询问、分析、总结、检查问题，action 使用 "show_answer"。
5. 只有用户明确要求"写到/存到/创建/生成/保存到新文件或文档"时，action 才使用 "open_document"，filename 给一个合适的 .md 建议名。
6. 如果用户只是问"你觉得如何/怎么样/有什么问题/如何优化/总结一下/分析一下"，即使内容较长，也必须使用 "show_answer"。
7. content 使用 Markdown 正文。不要声称已经保存文件或已经写入文件，应用会决定如何打开或保存。
8. 不要编造文件中不存在的信息；信息不足时在 content 中明确标注。`,
                    },
                    {
                        role: 'user',
                        content: `<UserInstruction>
${trimmedInstruction}
</UserInstruction>

<SourceFile path="${filePath}">
${clamped.content}
</SourceFile>${truncationNotice}`,
                    },
                ],
            },
        });

        if (response.status < 200 || response.status >= 300) {
            throw new Error(t('aiFileTask.error.apiFailed', { status: response.status }));
        }

        const result = parseTaskResult(parseAiContent(response.body));
        if (result.action === 'open_document' && !shouldOpenDocumentFromInstruction(trimmedInstruction)) {
            result.action = 'show_answer';
            result.filename = null;
        }
        if (!result.content) {
            throw new Error(t('aiFileTask.error.noContent'));
        }

        return result;
    }
}
