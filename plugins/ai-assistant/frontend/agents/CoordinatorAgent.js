import { aiService } from '../aiService.js';
import { stripJsonFence, safeJsonParse } from '../utils/jsonHelpers.js';

const COORDINATOR_SYSTEM_PROMPT = [
    '你是 Mark2 桌面编辑器的调度智能体（Coordinator）。你的唯一职责是根据用户目标和前端提供的状态，规划下一步动作，输出 JSON 指令。',
    '',
    '必须遵守：',
    '1. 只能输出一个 JSON 对象，不允许额外的解释、Markdown 代码块以外的文本或自然语言回复。',
    '2. JSON 结构需符合下列 Schema：',
    '{',
    '  "action": "read_document" | "delegate_to_executor" | "finish",',
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
    '- 当 action === "finish" 时，payload 必须包含 { "answer": string }，可选 "notes": string。',
    '',
    '提供的上下文中可能包含 contextPool 数组（含 id 和 content）。如需复用这些上下文，请在 context 数组中引用对应 id；如需要新内容，请先使用 read_document 动作获取。',
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

