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
     * 构建完整对话消息（可复用）
     */
    composeMessages(request, options = {}) {
        const {
            includeConfigPrompts = true,
            systemPromptOverride = null,
        } = options;

        const messages = [];
        let systemPrompt = systemPromptOverride ?? request.systemPrompt ?? '';

        if (includeConfigPrompts) {
            if (this.config.rolePrompt?.trim()) {
                systemPrompt = this.config.rolePrompt.trim();
            }
            if (this.config.outputStyle?.trim()) {
                const stylePrompt = `\n\n输出要求：${this.config.outputStyle.trim()}`;
                systemPrompt = `${systemPrompt || ''}${stylePrompt}`;
            }
        }

        if (systemPrompt) {
            messages.push({ role: 'system', content: systemPrompt });
        }

        if (Array.isArray(request.history) && request.history.length > 0) {
            const validHistory = request.history
                .filter(entry => !!entry?.role && !!entry?.content)
                .map(entry => ({
                    role: entry.role,
                    content: entry.content,
                }));
            messages.push(...validHistory);
        }

        messages.push({ role: 'user', content: request.prompt });
        return messages;
    }

    /**
     * 从 localStorage 加载配置
     */
    loadConfig() {
        const stored = localStorage.getItem('ai-config');
        if (stored) {
            return JSON.parse(stored);
        }
        return {
            apiKey: '',
            model: 'gpt-4o-mini',
            baseUrl: 'https://api.openai.com/v1',
            rolePrompt: '',
            outputStyle: '',
            thinkBuffer: '',
        };
    }

    /**
     * 保存配置到 localStorage
     */
    saveConfig(config) {
        this.config = { ...this.config, ...config };
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

        // 初始化任务
        const task = {
            request,
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
            const messages = this.composeMessages(request, { includeConfigPrompts: true });

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
                            const parsed = JSON.parse(data);
                            console.log('[aiService] streaming payload:', parsed);
                            const choiceDelta = parsed.choices?.[0]?.delta || {};

                            const contentNode = choiceDelta.content;
                            let answerDelta = '';
                            let reasoningDelta = '';

                            if (Array.isArray(contentNode)) {
                                contentNode.forEach((part) => {
                                    const text = part?.text ?? part?.content ?? '';
                                    if (!text) return;
                                    const type = part?.type || '';
                                    if (type.includes('reason') || type === 'thinking') {
                                        reasoningDelta += text;
                                    } else {
                                        answerDelta += text;
                                    }
                                });
                            } else if (typeof contentNode === 'string') {
                                answerDelta = contentNode;
                            } else if (contentNode?.text) {
                                answerDelta = contentNode.text;
                            }

                            const reasoningNode = choiceDelta.reasoning;
                            if (Array.isArray(reasoningNode)) {
                                reasoningNode.forEach((part) => {
                                    if (typeof part?.text === 'string') {
                                        reasoningDelta += part.text;
                                    }
                                });
                            } else if (typeof reasoningNode?.text === 'string') {
                                reasoningDelta += reasoningNode.text;
                            }

                            if (typeof choiceDelta.reasoning_content === 'string') {
                                reasoningDelta += choiceDelta.reasoning_content;
                            } else if (Array.isArray(choiceDelta.reasoning_content)) {
                                choiceDelta.reasoning_content.forEach((part) => {
                                    if (typeof part === 'string') {
                                        reasoningDelta += part;
                                    } else if (part && typeof part.text === 'string') {
                                        reasoningDelta += part.text;
                                    }
                                });
                            }

                            if (reasoningDelta) {
                                task.thinkBuffer += reasoningDelta;
                                console.log('[aiService] think delta:', reasoningDelta);
                                this.notify({
                                    type: 'task-stream-think',
                                    id: taskId,
                                    delta: reasoningDelta,
                                    buffer: task.thinkBuffer,
                                });
                            }

                            if (answerDelta) {
                                task.buffer += answerDelta;
                                console.log('[aiService] content delta:', answerDelta);
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
            console.log('[aiService] stream finished', {
                id: taskId,
                contentLength: task.buffer.length,
                thinkLength: task.thinkBuffer.length,
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

        const messages = this.composeMessages(request, {
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
