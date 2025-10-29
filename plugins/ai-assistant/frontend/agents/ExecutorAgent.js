import { aiService } from '../aiService.js';

const EXECUTOR_SYSTEM_PROMPT = [
    '你是 Mark2 编辑器的解答智能体（Executor）。',
    '目标：基于调度 AI 提供的上下文，生成满足用户需求的最终回答。',
    '',
    '请遵守：',
    '1. 只根据提供的上下文回答，不要捏造信息；若信息不足，请明确说明。',
    '2. 尊重 expectedFormat 中的格式要求（若提供）。',
    '3. 保持回答清晰、直接。',
].join('\n');

function buildExecutorPrompt({ prompt, context = [], expectedFormat = null }) {
    const sections = [];

    if (Array.isArray(context) && context.length > 0) {
        const contextBlocks = context.map((item, index) => {
            const label = item.label || `上下文 ${index + 1}`;
            return [
                `### ${label}`,
                item.content || '',
            ].join('\n');
        });
        sections.push('以下是可用的上下文：', contextBlocks.join('\n\n'));
    }

    sections.push('请完成以下任务：', prompt);

    if (expectedFormat) {
        sections.push('输出格式要求：', expectedFormat);
    }

    return sections.join('\n\n');
}

/**
 * 解答智能体：调用底层 AI 生成最终回答
 */
export class ExecutorAgent {
    buildRequest({ prompt, context = [], expectedFormat = null, history = [] }) {
        const normalizedHistory = Array.isArray(history) ? history : [];
        const finalPrompt = buildExecutorPrompt({ prompt, context, expectedFormat });

        return {
            prompt: finalPrompt,
            history: normalizedHistory,
            systemPrompt: EXECUTOR_SYSTEM_PROMPT,
        };
    }

    async runTask(options) {
        const request = this.buildRequest(options);
        const result = await aiService.runTask(request);
        return result;
    }
}
