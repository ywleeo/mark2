import { parseStreamData } from './services/streamParser.js';

/**
 * AI 服务 - 直接调用 OpenAI API
 * 完全前端实现，支持流式响应
 */

class AiService {
    constructor() {
        this.listeners = new Set();
        this.activeTasks = new Map();
        this.config = this.loadConfig();
    }

    /**
     * 从 localStorage 加载配置
     */
    loadConfig() {
        const stored = localStorage.getItem('ai-config');
        let raw = {};
        if (stored) {
            try {
                raw = JSON.parse(stored) || {};
            } catch (error) {
                console.warn('[aiService] 无法解析已保存的配置，使用默认值', error);
            }
        }
        return this.normalizeConfig(raw);
    }

    /**
     * 保存配置到 localStorage
     */
    saveConfig(config) {
        const merged = { ...this.config, ...config };
        this.config = this.normalizeConfig(merged);
        localStorage.setItem('ai-config', JSON.stringify(this.config));
        this.notify({ type: 'config', data: this.config });
        return this.config;
    }

    /**
     * 获取当前配置
     */
    getConfig() {
        return this.config;
    }

    /**
     * 规范化配置
     */
    normalizeConfig(config) {
        return {
            apiKey: config.apiKey || '',
            baseUrl: config.baseUrl || 'https://api.openai.com/v1',
            model: config.model || 'gpt-4o',
            preferences: {
                outputStyle: config.preferences?.outputStyle || 'balanced',
                creativity: config.preferences?.creativity || 'medium',
            }
        };
    }

    /**
     * 清除 API Key
     */
    resetApiKey() {
        return this.saveConfig({ apiKey: '' });
    }

    /**
     * 订阅事件
     */
    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /**
     * 发送事件
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
     * 生成任务 ID
     */
    generateTaskId() {
        return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    }

    /**
     * 执行 AI 对话（流式响应）
     * @param {Object} options
     * @param {Array} options.messages - OpenAI 格式的消息数组 [{role, content}, ...]
     * @param {number} [options.temperature] - 温度参数
     */
    async runTask(options) {
        const taskId = this.generateTaskId();

        if (!options.messages || !Array.isArray(options.messages) || options.messages.length === 0) {
            throw new Error('消息列表为空');
        }

        if (!this.config.apiKey) {
            throw new Error('请先配置 API Key');
        }

        // 初始化任务
        const task = {
            options,
            buffer: '',
            status: 'pending',
            thinkBuffer: '',
        };
        this.activeTasks.set(taskId, task);

        // 发送任务开始事件
        this.notify({
            type: 'task-started',
            id: taskId,
            payload: options,
        });

        try {
            const controller = new AbortController();
            task.abortController = controller;

            // 调用 OpenAI API
            const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.config.apiKey}`,
                },
                body: JSON.stringify({
                    model: options.model || this.config.model,
                    messages: options.messages,
                    temperature: options.temperature,
                    stream: true,
                }),
                signal: controller.signal,
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`API 请求失败: ${response.status} ${errorText}`);
            }

            // 处理流式响应
            task.status = 'streaming';
            this.notify({
                type: 'task-stream-start',
                id: taskId,
            });

            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                const lines = chunk.split('\n').filter(line => line.trim() !== '');

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6);
                        if (data === '[DONE]') continue;

                        try {
                            const { answerDelta, reasoningDelta } = parseStreamData(data);

                            if (reasoningDelta) {
                                task.thinkBuffer += reasoningDelta;
                                this.notify({
                                    type: 'task-stream-think',
                                    id: taskId,
                                    delta: reasoningDelta,
                                    buffer: task.thinkBuffer,
                                });
                            }

                            if (answerDelta) {
                                task.buffer += answerDelta;
                                this.notify({
                                    type: 'task-stream-chunk',
                                    id: taskId,
                                    delta: answerDelta,
                                    buffer: task.buffer,
                                });
                            }
                        } catch (e) {
                            console.warn('[aiService] 解析流式数据失败:', e);
                        }
                    }
                }
            }

            // 完成
            this.notify({
                type: 'task-stream-end',
                id: taskId,
                buffer: task.buffer,
                thinkBuffer: task.thinkBuffer,
            });

            this.activeTasks.delete(taskId);
            return { id: taskId, content: task.buffer, thinking: task.thinkBuffer };

        } catch (error) {
            const isAborted = task.abortController?.signal?.aborted || error?.name === 'AbortError';
            this.activeTasks.delete(taskId);
            if (isAborted) {
                if (!task.cancelledNotified) {
                    this.notify({
                        type: 'task-cancelled',
                        id: taskId,
                    });
                }
                throw new Error('请求已取消');
            } else {
                this.notify({
                    type: 'task-failed',
                    id: taskId,
                    error: error.message || error,
                });
                throw error;
            }
        }
    }

    /**
     * 取消任务
     */
    async cancelTask(taskId) {
        const task = this.activeTasks.get(taskId);
        if (task) {
            if (task.abortController && !task.abortController.signal.aborted) {
                task.abortController.abort();
            }
            this.activeTasks.delete(taskId);
            this.notify({
                type: 'task-cancelled',
                id: taskId,
            });
            task.cancelledNotified = true;
            return true;
        }
        return false;
    }

    /**
     * 调用 AI（非流式）
     */
    async chat(options) {
        if (!options.messages || !Array.isArray(options.messages) || options.messages.length === 0) {
            throw new Error('消息列表为空');
        }

        if (!this.config.apiKey) {
            throw new Error('请先配置 API Key');
        }

        const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.config.apiKey}`,
            },
            body: JSON.stringify({
                model: options.model || this.config.model,
                messages: options.messages,
                temperature: options.temperature,
                stream: false,
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API 请求失败: ${response.status} ${errorText}`);
        }

        const result = await response.json();
        const message = result?.choices?.[0]?.message?.content ?? '';

        return {
            content: message,
            raw: result,
        };
    }
}

// 导出单例
export const aiService = new AiService();
