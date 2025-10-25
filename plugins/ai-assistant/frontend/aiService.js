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
        if (stored) {
            return JSON.parse(stored);
        }
        return {
            apiKey: '',
            model: 'gpt-4o-mini',
            baseUrl: 'https://api.openai.com/v1',
            rolePrompt: '',
            outputStyle: '',
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
        };
        this.activeTasks.set(taskId, task);

        // 发送任务开始事件
        this.notify({
            type: 'task-started',
            id: taskId,
            payload: request,
        });

        try {
            // 构建消息列表
            const messages = [];

            // 构建系统提示词
            let systemPrompt = request.systemPrompt || '';

            // 如果配置了角色提示词，添加到 system prompt
            if (this.config.rolePrompt?.trim()) {
                systemPrompt = this.config.rolePrompt.trim();
            }

            // 如果配置了输出风格，追加到 system prompt
            if (this.config.outputStyle?.trim()) {
                const stylePrompt = `\n\n输出要求：${this.config.outputStyle.trim()}`;
                systemPrompt += stylePrompt;
            }

            if (systemPrompt) {
                messages.push({ role: 'system', content: systemPrompt });
            }

            if (request.history) {
                messages.push(...request.history);
            }

            messages.push({ role: 'user', content: request.prompt });

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
                            const delta = parsed.choices[0]?.delta?.content;

                            if (delta) {
                                task.buffer += delta;
                                this.notify({
                                    type: 'task-stream-chunk',
                                    id: taskId,
                                    delta,
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
            });

            this.activeTasks.delete(taskId);
            return { id: taskId, content: task.buffer };

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
        const task = this.activeTasks.get(taskId);
        if (task) {
            this.activeTasks.delete(taskId);
            this.notify({
                type: 'task-cancelled',
                id: taskId,
            });
            return true;
        }
        return false;
    }
}

// 导出单例
export const aiService = new AiService();
