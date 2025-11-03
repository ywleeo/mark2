import { composeMessages } from './services/promptComposer.js';
import { parseStreamData } from './services/streamParser.js';
import {
    cloneRole,
    normalizeRoles,
    DEFAULT_ROLE_ID,
} from './utils/roleUtils.js';

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

    getActiveRole() {
        const { roles = [], activeRoleId } = this.config || {};
        return roles.find(role => role.id === activeRoleId) || roles[0] || null;
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
     * @param {Object} request
     * @param {string} request.prompt - 用户消息
     * @param {Array} [request.history] - 对话历史 [{role, content}, ...]
     * @param {string} [request.systemPrompt] - 系统提示
     */
    async runTask(request) {
        const taskId = this.generateTaskId();

        if (!request.prompt?.trim()) {
            throw new Error('请求内容为空');
        }

        if (!this.config.apiKey) {
                throw new Error('请先配置 API Key');
        }

        const roleId = request.roleId || this.config.activeRoleId || DEFAULT_ROLE_ID;

        // 初始化任务
        const task = {
            request: { ...request, roleId },
            buffer: '',
            status: 'pending',
            thinkBuffer: '',
        };
        this.activeTasks.set(taskId, task);

        // 发送任务开始事件
        this.notify({
            type: 'task-started',
            id: taskId,
            payload: request,
        });

        try {
            const messages = composeMessages(
                { ...request, roleId },
                this.config,
                { includeConfigPrompts: true }
            );

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
                    model: this.config.model,
                    messages,
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
                request,
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

    normalizeConfig(config) {
        const base = {
            apiKey: '',
            model: 'gpt-4o-mini',
            baseUrl: 'https://api.openai.com/v1',
            roles: [],
            activeRoleId: DEFAULT_ROLE_ID,
            rolePrompt: '',
            outputStyle: '',
            thinkBuffer: '',
        };

        const merged = { ...base, ...config };
        const roles = normalizeRoles(merged.roles, {
            legacyPrompt: merged.rolePrompt,
            legacyStyle: merged.outputStyle,
        }).map(role => cloneRole(role));

        let activeRoleId = merged.activeRoleId;
        if (!activeRoleId || !roles.some(role => role.id === activeRoleId)) {
            activeRoleId = roles[0]?.id || DEFAULT_ROLE_ID;
        }

        const activeRole = roles.find(role => role.id === activeRoleId) || roles[0] || null;

        return {
            apiKey: merged.apiKey,
            model: merged.model,
            baseUrl: merged.baseUrl,
            roles,
            activeRoleId,
            rolePrompt: activeRole?.rolePrompt || '',
            outputStyle: activeRole?.outputStyle || '',
            thinkBuffer: merged.thinkBuffer || '',
        };
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
     * 调用 AI，无需事件驱动（用于调度/工具类任务）
     */
    async callAgent(request, options = {}) {
        if (!request?.prompt?.trim()) {
            throw new Error('请求内容为空');
        }

        if (!this.config.apiKey) {
            throw new Error('请先配置 API Key');
        }

        const taskId = this.generateTaskId();
        const {
            includeConfigPrompts = true,
            systemPromptOverride = null,
            responseFormat = null,
            maxOutputTokens = null,
            temperature = null,
            model = null,
        } = options;

        const messages = composeMessages(request, this.config, {
            includeConfigPrompts,
            systemPromptOverride,
        });

        const body = {
            model: model || this.config.model,
            messages,
            stream: false,
        };

        if (responseFormat) {
            body.response_format = responseFormat;
        }

        if (typeof maxOutputTokens === 'number') {
            body.max_output_tokens = maxOutputTokens;
        }

        if (typeof temperature === 'number') {
            body.temperature = temperature;
        }

        const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.config.apiKey}`,
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API 请求失败: ${response.status} ${errorText}`);
        }

        const result = await response.json();
        const message = result?.choices?.[0]?.message?.content ?? '';

        return {
            id: taskId,
            content: message,
            raw: result,
        };
    }
}

// 导出单例
export const aiService = new AiService();
