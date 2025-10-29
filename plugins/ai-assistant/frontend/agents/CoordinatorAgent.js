import { aiService } from '../aiService.js';
import { stripJsonFence, safeJsonParse } from '../utils/jsonHelpers.js';

const COORDINATOR_SYSTEM_PROMPT = [
    '你是 Mark2 桌面编辑器的调度智能体（Coordinator）。你的唯一职责是根据用户目标和前端提供的状态，规划下一步动作，输出 JSON 指令。',
    '',
    '必须遵守：',
    '1. 只能输出一个 JSON 对象，不允许额外的解释、Markdown 代码块以外的文本或自然语言回复。',
    '2. JSON 结构需符合下列 Schema：',
    '{',
    '  "action": "read_document" | "delegate_to_executor" | "insert_after_range" | "replace_range" | "append_to_document" | "finish",',
    '  "payload": { ... },',
    '  "metadata": {',
    '    "reasoning": "简要说明为何采取该动作",',
    '    "confidence": "low" | "medium" | "high"',
    '  }',
    '}',
    '',
    '字段要求：',
    '- 当 action === "read_document" 时，payload 可包含：',
    '  {',
    '    "range": { "startLine": number, "endLine": number },',
    '    "purpose": "说明为何读取该范围"',
    '  }',
    '- 当 action === "delegate_to_executor" 时，payload 必须包含：',
    '  {',
    '    "prompt": "交给解答 AI 的自然语言任务描述",',
    '    "context": [ { "id": string } 或 { "label": string, "content": string } ... ],',
    '    "expectedFormat": "可选，对输出格式的额外约束"',
    '  }',
    '- 当 action === "insert_after_range" 时，payload 必须包含：',
    '  {',
    '    "range": { "startLine": number, "endLine": number } (可选，缺省则视为文档末尾),',
    '    "content": "要插入的文本" 或 `useLastExecutorAnswer: true`,',
    '    "justification": "说明插入原因",',
    '    "preview": "可选，简短预览"',
    '  }',
    '- 当 action === "replace_range" 时，payload 必须包含：',
    '  {',
    '    "range": { "startLine": number, "endLine": number },',
    '    "content": "新的文本内容" （可引用 last_executor_answer 或上下文片段）,',
    '    "justification": "说明替换原因",',
    '    "preview": "可选，简短预览"',
    '  }',
    '- 当 action === "append_to_document" 时，payload 必须包含：',
    '  {',
    '    "content": "追加到文末的文本",',
    '    "justification": "说明追加原因",',
    '    "preview": "可选，简短预览"',
    '  }',
    '- 当 action === "finish" 时，payload 必须包含 { "answer": string }，可选 "notes": string。',
    '',
    '只允许使用 constraints.availableActions 中列出的动作类型。',
    '提供的上下文中包含 contextPool（id 与 content）。如需复用这些片段，可在 payload 中引用 id；若需要最新的文档内容，请先使用 read_document 动作按需读取。',
    '如需插入或替换上一轮解答的结果，可设置 `useLastExecutorAnswer: true`，系统会自动使用最新的解答文本。',
    '在无法推进或需要用户澄清时，应使用 finish，并在 answer 字段中说明情况。',
].join('\n');

/**
 * 调度智能体：负责从当前会话状态规划下一步动作
 */
export class CoordinatorAgent {
    constructor(options = {}) {
        this.options = {
            responseFormat: { type: 'json_object' },
            ...options,
        };
    }

    /**
     * 生成下一步动作
     * @param {object} sessionState - 前端整理的会话状态
     */
    async planNextAction(sessionState) {
        const serializedState = JSON.stringify(sessionState, null, 2);
        const { content } = await aiService.callAgent(
            {
                prompt: serializedState,
                systemPrompt: COORDINATOR_SYSTEM_PROMPT,
            },
            {
                includeConfigPrompts: false,
                responseFormat: this.options.responseFormat,
                temperature: this.options.temperature ?? 0,
                model: this.options.model ?? null,
            }
        );

        const cleaned = stripJsonFence(content || '');
        const parsed = safeJsonParse(cleaned);

        if (!parsed || !parsed.action) {
            throw new Error('调度 AI 返回结果无法解析');
        }

        return {
            action: parsed.action,
            payload: parsed.payload || {},
            metadata: parsed.metadata || {},
            raw: content,
        };
    }
}
