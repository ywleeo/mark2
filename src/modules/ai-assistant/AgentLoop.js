/**
 * Agent 循环
 * 管理多轮 LLM 调用 + 工具执行，直到没有工具调用为止
 */

import { aiService } from './aiService.js';

const MAX_ITERATIONS = 10;

export class AgentLoop {
    /**
     * @param {Object} options
     * @param {(name: string, args: object) => Promise<object>} options.toolExecutor
     * @param {Array} options.toolDefinitions - OpenAI function calling 格式
     * @param {() => void} [options.onIterationStart] - 第 2 轮及以后每轮 LLM 调用前触发（用于创建新 content box）
     * @param {(delta: string, buffer: string) => void} [options.onChunk]
     * @param {(delta: string, buffer: string) => void} [options.onThink]
     * @param {(call: {id, name, args}) => void} [options.onToolCall]
     * @param {(result: {id, name, result}) => void} [options.onToolResult]
     * @param {(call: {name: string}) => void} [options.onToolCallStreaming] - 工具调用开始流式生成时触发
     * @param {(error: Error) => void} [options.onError]
     */
    constructor({ toolExecutor, toolDefinitions, onIterationStart, onChunk, onThink, onToolCall, onToolResult, onToolCallStreaming, onError }) {
        this.toolExecutor = toolExecutor;
        this.toolDefinitions = toolDefinitions;
        this.onIterationStart = onIterationStart;
        this.onChunk = onChunk;
        this.onThink = onThink;
        this.onToolCall = onToolCall;
        this.onToolResult = onToolResult;
        this.onToolCallStreaming = onToolCallStreaming;
        this.onError = onError;
        this.currentTaskId = null;
        this.aborted = false;
    }

    /**
     * 执行 agent 循环
     * @param {Array} messages - 初始消息列表（含 system、用户历史等）
     * @returns {Promise<Array>} 更新后的完整消息历史
     */
    async run(messages) {
        this.aborted = false;
        const history = [...messages];

        try {
            for (let i = 0; i < MAX_ITERATIONS; i++) {
                if (this.aborted) break;

                // 第 2 轮及以后：通知 UI 创建新的 content box
                if (i > 0) {
                    this.onIterationStart?.();
                }

                const taskId = `agent-${Date.now()}-${i}`;
                this.currentTaskId = taskId;

                // 订阅流式事件
                const unsubscribe = aiService.subscribe((event) => {
                    if (event.id !== taskId) return;
                    if (event.type === 'task-stream-chunk') {
                        this.onChunk?.(event.delta, event.buffer);
                    } else if (event.type === 'task-stream-think') {
                        this.onThink?.(event.delta, event.buffer);
                    } else if (event.type === 'task-stream-tool-call') {
                        this.onToolCallStreaming?.({ name: event.name });
                    }
                });

                let result;
                try {
                    result = await aiService.runTask({
                        taskId,
                        messages: history,
                        tools: this.toolDefinitions,
                    });
                } finally {
                    unsubscribe();
                    this.currentTaskId = null;
                }

                if (this.aborted) break;

                // 将 assistant 响应加入历史
                const assistantMsg = { role: 'assistant', content: result.content || null };
                if (result.toolCalls?.length) {
                    assistantMsg.tool_calls = result.toolCalls;
                }
                history.push(assistantMsg);

                // 无工具调用 → agent 完成
                if (!result.toolCalls?.length) {
                    return history;
                }

                // 串行执行工具（避免并发的确认弹窗冲突）
                for (const toolCall of result.toolCalls) {
                    if (this.aborted) break;

                    const name = toolCall.function.name;
                    let args = {};
                    try {
                        args = JSON.parse(toolCall.function.arguments || '{}');
                    } catch {
                        // ignore malformed JSON
                    }

                    this.onToolCall?.({ id: toolCall.id, name, args });

                    // 等到浏览器完成一次绘制，确保 tool card spinner 先渲染再执行工具
                    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

                    let toolResult;
                    try {
                        toolResult = await this.toolExecutor(name, args);
                    } catch (err) {
                        toolResult = { error: err.message || '工具执行失败' };
                    }

                    this.onToolResult?.({ id: toolCall.id, name, result: toolResult });

                    history.push({
                        role: 'tool',
                        tool_call_id: toolCall.id,
                        content: JSON.stringify(toolResult),
                    });
                }

                if (this.aborted) break;
            }
        } catch (err) {
            if (!this.aborted) {
                this.onError?.(err);
            }
        }

        return history;
    }

    abort() {
        this.aborted = true;
        if (this.currentTaskId) {
            void aiService.cancelTask(this.currentTaskId);
            this.currentTaskId = null;
        }
    }
}
