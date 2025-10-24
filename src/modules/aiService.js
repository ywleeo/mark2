/**
 * AI 服务统一入口
 * 简化架构，所有 AI 请求都通过这个服务
 */

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

class AiService {
    constructor() {
        this.listeners = new Set();
        this.activeTasks = new Map();
        this.streamListenersReady = null;
        this.configSnapshot = null;
    }

    /**
     * 订阅 AI 事件
     */
    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /**
     * 发送事件给所有订阅者
     */
    notify(event) {
        this.listeners.forEach(listener => {
            try {
                listener(event);
            } catch (error) {
                console.warn('[aiService] 事件监听器执行失败:', error);
            }
        });
    }

    /**
     * 确保流式监听器已初始化
     */
    async ensureStreamListeners() {
        if (this.streamListenersReady) {
            await this.streamListenersReady;
            return;
        }

        this.streamListenersReady = (async () => {
            // 监听流式开始事件
            await listen('ai-stream-start', (event) => {
                const { id } = event.payload;
                const task = this.activeTasks.get(id);
                if (task) {
                    task.status = 'streaming';
                    this.notify({
                        type: 'task-stream-start',
                        id,
                        request: task.request,
                    });
                }
            });

            // 监听流式数据块
            await listen('ai-stream-chunk', (event) => {
                const { id, content_delta, reasoning_delta } = event.payload;
                const task = this.activeTasks.get(id);
                if (task) {
                    if (content_delta) task.buffer += content_delta;
                    if (reasoning_delta) task.reasoning += reasoning_delta;

                    this.notify({
                        type: 'task-stream-chunk',
                        id,
                        delta: content_delta || '',
                        buffer: task.buffer,
                        reasoningDelta: reasoning_delta || '',
                        reasoning: task.reasoning,
                    });
                }
            });

            // 监听流式结束
            await listen('ai-stream-end', (event) => {
                const { id } = event.payload;
                const task = this.activeTasks.get(id);
                if (task) {
                    this.notify({
                        type: 'task-stream-end',
                        id,
                        buffer: task.buffer,
                        reasoning: task.reasoning,
                    });
                }
            });

            // 监听任务意图
            await listen('ai-task-intent', (event) => {
                this.notify({
                    type: 'task-intent',
                    ...event.payload,
                });
            });

            // 监听 TODO 列表
            await listen('ai-task-todo-list', (event) => {
                this.notify({
                    type: 'task-todo-list',
                    ...event.payload,
                });
            });

            // 监听 TODO 更新
            await listen('ai-task-todo-update', (event) => {
                this.notify({
                    type: 'task-todo-update',
                    ...event.payload,
                });
            });

            // 监听任务总结
            await listen('ai-task-summary', (event) => {
                this.notify({
                    type: 'task-summary',
                    ...event.payload,
                });
            });
        })();

        await this.streamListenersReady;
    }

    /**
     * 生成任务 ID
     */
    generateTaskId() {
        return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    }

    /**
     * 执行 AI 任务（统一入口）
     * @param {Object} request - 完整的请求对象
     * @param {string} request.prompt - 用户提示
     * @param {string} [request.context] - 上下文内容
     * @param {string} [request.systemPrompt] - 系统提示
     * @param {string} [request.mode] - 模式
     * @param {Array} [request.history] - 对话历史
     * @param {Object} options - 额外选项
     * @param {boolean} [options.useTaskMode] - 是否使用任务模式
     * @param {string} [options.currentFile] - 当前文件路径
     * @param {string} [options.workspaceRoot] - 工作区根路径
     */
    async runTask(request, options = {}) {
        const taskId = this.generateTaskId();

        // 验证必需参数
        if (!request.prompt?.trim()) {
            throw new Error('请求内容为空');
        }

        // 初始化任务状态
        this.activeTasks.set(taskId, {
            request,
            buffer: '',
            reasoning: '',
            status: 'pending',
        });

        // 发送任务开始事件
        this.notify({
            type: 'task-started',
            id: taskId,
            payload: request,
        });

        try {
            // 如果使用任务模式
            if (options.useTaskMode) {
                await this.ensureStreamListeners();

                // 准备 payload - 直接透传所有参数
                const payload = {
                    prompt: request.prompt,
                    context: request.context || null,
                    system_prompt: request.systemPrompt || null,
                    mode: request.mode || null,
                    history: request.history || null,
                };

                console.log('[aiService] 执行任务请求:', {
                    taskId,
                    hasContext: !!payload.context,
                    hasHistory: !!payload.history,
                    historyLength: payload.history?.length,
                });

                // 调用 Tauri 命令
                const result = await invoke('ai_execute_task', {
                    payload,
                    taskId,
                    task_id: taskId,
                    workspaceRoot: options.workspaceRoot || null,
                });

                this.activeTasks.delete(taskId);
                return { id: taskId, content: result };
            } else {
                // 普通流式模式（待实现）
                throw new Error('普通流式模式暂未实现');
            }
        } catch (error) {
            this.activeTasks.delete(taskId);
            this.notify({
                type: 'task-failed',
                id: taskId,
                error: error.message || error,
            });
            throw error;
        }
    }

    /**
     * 取消任务
     */
    async cancelTask(taskId) {
        try {
            await invoke('ai_cancel_task', { taskId });
            this.activeTasks.delete(taskId);
            this.notify({
                type: 'task-cancelled',
                id: taskId,
            });
            return true;
        } catch (error) {
            console.warn('[aiService] 取消任务失败:', error);
            return false;
        }
    }

    /**
     * 获取配置
     */
    async ensureConfig() {
        if (this.configSnapshot) {
            return this.configSnapshot;
        }
        return await this.refreshConfig();
    }

    /**
     * 刷新配置
     */
    async refreshConfig() {
        try {
            const config = await invoke('ai_fetch_config');
            this.configSnapshot = config;
            this.notify({ type: 'config', data: config });
            return config;
        } catch (error) {
            console.warn('[aiService] 获取配置失败:', error);
            return null;
        }
    }

    /**
     * 保存配置
     */
    async saveConfig(config) {
        await invoke('ai_persist_config', { config });
        return await this.refreshConfig();
    }

    /**
     * 清除 API Key
     */
    async resetApiKey() {
        await invoke('ai_clear_api_key');
        return await this.refreshConfig();
    }
}

// 导出单例
export const aiService = new AiService();
