import { parseStreamData } from './services/streamParser.js';

/**
 * AI 服务 - 直接调用 OpenAI API
 * 支持多 provider 配置，流式响应
 */

class AiService {
    constructor() {
        this.listeners = new Set();
        this.activeTasks = new Map();
        this.config = this.loadConfig();
    }

    // ── 配置管理 ──────────────────────────────────────────

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

    saveConfig(config) {
        this.config = this.normalizeConfig(config);
        localStorage.setItem('ai-config', JSON.stringify(this.config));
        this.notify({ type: 'config', data: this.config });
        return this.config;
    }

    getConfig() {
        return this.config;
    }

    normalizeConfig(config) {
        const providers = Array.isArray(config.providers) ? config.providers.map(p => ({
            id: p.id || this.generateId(),
            name: (p.name || '').trim() || 'Unnamed',
            apiKey: p.apiKey || '',
            baseUrl: (p.baseUrl || '').trim() || 'https://api.openai.com/v1',
            models: Array.isArray(p.models) ? p.models.filter(Boolean) : [],
        })) : [];

        let activeProviderId = config.activeProviderId || '';
        let activeModel = config.activeModel || '';

        // 确保 activeProviderId 指向存在的 provider
        if (providers.length > 0 && !providers.find(p => p.id === activeProviderId)) {
            activeProviderId = providers[0].id;
        }

        // 确保 activeModel 属于当前 provider
        const activeProvider = providers.find(p => p.id === activeProviderId);
        if (activeProvider && activeProvider.models.length > 0 && !activeProvider.models.includes(activeModel)) {
            activeModel = activeProvider.models[0];
        }

        return {
            providers,
            activeProviderId,
            activeModel,
            preferences: {
                creativity: config.preferences?.creativity || 'medium',
            },
        };
    }

    generateId() {
        return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    }

    // ── 便捷方法：获取当前激活的 provider 和 model ──────────

    getActiveProvider() {
        return this.config.providers.find(p => p.id === this.config.activeProviderId) || null;
    }

    getActiveModel() {
        return this.config.activeModel || '';
    }

    getActiveApiKey() {
        return this.getActiveProvider()?.apiKey || '';
    }

    getActiveBaseUrl() {
        return this.getActiveProvider()?.baseUrl || 'https://api.openai.com/v1';
    }

    // ── 测试连通性 ───────────────────────────────────────

    /**
     * 测试单个模型的连通性，返回 { success, model, duration, error }
     */
    async testModel(provider, model) {
        if (!provider?.apiKey) {
            return { success: false, model, duration: 0, error: '请填写 API Key' };
        }
        const baseUrl = (provider.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        const start = performance.now();

        try {
            const response = await fetch(`${baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${provider.apiKey}`,
                },
                body: JSON.stringify({
                    model,
                    messages: [{ role: 'user', content: 'hi' }],
                    max_tokens: 1,
                    stream: false,
                }),
                signal: controller.signal,
            });

            const duration = Math.round(performance.now() - start);
            if (!response.ok) {
                const errorText = await response.text();
                return { success: false, model, duration, error: `${response.status}: ${errorText.slice(0, 120)}` };
            }
            return { success: true, model, duration, error: null };
        } catch (error) {
            const duration = Math.round(performance.now() - start);
            const msg = error.name === 'AbortError' ? '超时（15s）' : (error.message || '连接失败');
            return { success: false, model, duration, error: msg };
        } finally {
            clearTimeout(timeoutId);
        }
    }

    /**
     * 测试 provider 下所有模型（兼容旧调用）
     */
    async testConnection(provider) {
        const models = provider?.models;
        if (!models || models.length === 0) {
            const result = await this.testModel(provider, 'gpt-4o');
            if (!result.success) throw new Error(result.error);
            return result;
        }
        const result = await this.testModel(provider, models[0]);
        if (!result.success) throw new Error(result.error);
        return result;
    }

    // ── 获取模型列表 ─────────────────────────────────────

    async fetchModels(provider) {
        if (!provider?.apiKey) {
            throw new Error('请填写 API Key');
        }
        const baseUrl = (provider.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        try {
            const response = await fetch(`${baseUrl}/models`, {
                headers: {
                    'Authorization': `Bearer ${provider.apiKey}`,
                },
                signal: controller.signal,
            });

            if (!response.ok) {
                throw new Error(`获取模型列表失败: ${response.status}`);
            }

            const result = await response.json();
            const models = (result.data || [])
                .map(m => m.id)
                .filter(Boolean)
                .sort();
            return models;
        } catch (error) {
            if (error.name === 'AbortError') {
                throw new Error('获取模型列表超时（15s）');
            }
            throw error;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    // ── 事件系统 ─────────────────────────────────────────

    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    notify(event) {
        this.listeners.forEach(listener => {
            try {
                listener(event);
            } catch (error) {
                console.warn('[aiService] 事件监听器执行失败:', error);
            }
        });
    }

    generateTaskId() {
        return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    }

    // ── AI 调用 ──────────────────────────────────────────

    async runTask(options = {}) {
        const { taskId: providedTaskId, ...requestOptions } = options;
        const taskId = providedTaskId || this.generateTaskId();

        if (!requestOptions.messages || !Array.isArray(requestOptions.messages) || requestOptions.messages.length === 0) {
            throw new Error('消息列表为空');
        }

        const apiKey = this.getActiveApiKey();
        if (!apiKey) {
            throw new Error('请先配置 API Key');
        }

        const task = {
            options: requestOptions,
            buffer: '',
            status: 'pending',
            thinkBuffer: '',
            toolCalls: [],
        };
        this.activeTasks.set(taskId, task);

        this.notify({
            type: 'task-started',
            id: taskId,
            payload: requestOptions,
        });

        try {
            const controller = new AbortController();
            task.abortController = controller;

            const baseUrl = this.getActiveBaseUrl();
            const response = await fetch(`${baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                    model: requestOptions.model || this.getActiveModel(),
                    messages: requestOptions.messages,
                    temperature: requestOptions.temperature,
                    stream: true,
                    ...(requestOptions.tools?.length ? { tools: requestOptions.tools } : {}),
                }),
                signal: controller.signal,
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`API 请求失败: ${response.status} ${errorText}`);
            }

            task.status = 'streaming';
            this.notify({
                type: 'task-stream-start',
                id: taskId,
            });

            const reader = response.body?.getReader?.();
            if (!reader) {
                throw new Error('当前系统禁止流式网络访问，请在系统偏好设置中授予 Mark2 网络权限后重试');
            }
            const decoder = new TextDecoder();

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n').map(line => line.trim()).filter(Boolean);

                for (const line of lines) {
                    if (line.startsWith('data:')) {
                        const data = line.slice(5).trimStart();
                        if (data === '[DONE]') continue;

                        try {
                            const { answerDelta, reasoningDelta, toolCallDeltas } = parseStreamData(data);

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

                            if (toolCallDeltas) {
                                for (const delta of toolCallDeltas) {
                                    const idx = delta.index;
                                    if (!task.toolCalls[idx]) {
                                        task.toolCalls[idx] = {
                                            id: delta.id || '',
                                            type: delta.type || 'function',
                                            function: { name: '', arguments: '' },
                                        };
                                    }
                                    const tc = task.toolCalls[idx];
                                    if (delta.id) tc.id = delta.id;
                                    if (delta.function.name) {
                                        const wasEmpty = tc.function.name === '';
                                        tc.function.name += delta.function.name;
                                        // 第一次拿到函数名时通知订阅者（用于 UI 显示生成中状态）
                                        if (wasEmpty) {
                                            this.notify({
                                                type: 'task-stream-tool-call',
                                                id: taskId,
                                                name: tc.function.name,
                                                index: idx,
                                            });
                                        }
                                    }
                                    if (delta.function.arguments) tc.function.arguments += delta.function.arguments;
                                }
                            }
                        } catch (e) {
                            console.warn('[aiService] 解析流式数据失败:', e);
                        }
                    }
                }
            }

            const completedToolCalls = task.toolCalls.length > 0 ? task.toolCalls : null;
            this.notify({
                type: 'task-stream-end',
                id: taskId,
                buffer: task.buffer,
                thinkBuffer: task.thinkBuffer,
                toolCalls: completedToolCalls,
            });

            this.activeTasks.delete(taskId);
            return { id: taskId, content: task.buffer, thinking: task.thinkBuffer, toolCalls: completedToolCalls };

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

    async chat(options) {
        if (!options.messages || !Array.isArray(options.messages) || options.messages.length === 0) {
            throw new Error('消息列表为空');
        }

        const apiKey = this.getActiveApiKey();
        if (!apiKey) {
            throw new Error('请先配置 API Key');
        }

        const baseUrl = this.getActiveBaseUrl();
        const response = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: options.model || this.getActiveModel(),
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
