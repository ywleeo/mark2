import { parseStreamData } from './services/streamParser.js';
import {
    aiProxyJsonRequest,
    cancelAiProxyStream,
    normalizeAiBaseUrl,
    startAiProxyStream,
} from '../../api/aiProxy.js';
import { t } from '../../i18n/index.js';
import { createStore } from '../../services/storage.js';
import { PROVIDER_PRESETS } from './providerPresets.js';
import {
    getCloudProvider,
    listCloudProviders,
    subscribeRegistry,
} from './cloudProviderRegistry.js';

/**
 * gpt mini / nano 类小模型(包括 fallback 占位 gpt-4o-mini)。
 * 用前缀边界避免误伤 "gemini-*-flash" 里的 "mini" 子串。
 */
function isMiniModel(model) {
    return /(?:^|[-_/.])(?:mini|nano)/i.test(model || '');
}

/**
 * 从 model 列表里挑 cloud 默认模型:
 * 1. 列表里有 plugin 声明的 preferred(如 deepseek-v4-flash)→ 用它
 * 2. 否则第一个非 mini/nano 的模型(避免默认到 gpt mini)
 * 3. 兜底列表第一个
 */
function pickCloudDefaultModel(ids, preferredId) {
    if (preferredId && ids.includes(preferredId)) return preferredId;
    return ids.find((m) => !isMiniModel(m)) || ids[0];
}

/**
 * Cloud provider 运行时解析：通过 plugin 接口拿凭据，合并 preset 默认值。
 */
function resolveCloudProvider(plugin) {
    const cred = plugin.getCredentials() || {};
    const models = (Array.isArray(cred.models) && cred.models.length > 0)
        ? cred.models
        : plugin.preset.models;
    return {
        ...plugin.preset,
        baseUrl: cred.baseUrl || plugin.preset.baseUrl || '',
        apiKey: plugin.isAvailable() ? (cred.apiKey || '') : '',
        models,
    };
}

const store = createStore('ai');
store.migrateFrom('ai-config', 'config');

/**
 * 解析 provider 返回的错误载荷，提取统一错误信息。
 * @param {string|object|null|undefined} payload - 原始响应体
 * @returns {{type: string, message: string}|null} 结构化错误
 */
function parseProviderErrorPayload(payload) {
    let data = payload;
    if (typeof payload === 'string') {
        try {
            data = JSON.parse(payload);
        } catch {
            return null;
        }
    }

    const error = data?.error;
    if (!error || typeof error !== 'object') {
        return null;
    }

    return {
        type: String(error.type || ''),
        message: String(error.message || ''),
    };
}

/**
 * 将 provider/代理错误转换成适合给用户看的文案。
 * @param {string} rawMessage - 原始错误信息
 * @returns {string} 用户可读文案
 */
function formatAiErrorMessage(rawMessage) {
    const message = typeof rawMessage === 'string' ? rawMessage : String(rawMessage || t('ai.system.unknownError'));
    const parsed = parseProviderErrorPayload(message.replace(/^API 请求失败:\s*\d+\s*/u, '').trim()) || parseProviderErrorPayload(message);

    if (parsed?.type === 'CreditsError') {
        return t('ai.error.insufficientBalance');
    }
    if (parsed?.type === 'authentication_error' || /invalid api key|incorrect api key|unauthorized|401/i.test(message)) {
        return t('ai.error.invalidKey');
    }
    if (parsed?.type === 'invalid_request_error' || /model.*not found|unknown model|does not exist/i.test(message)) {
        return t('ai.error.modelUnavailable');
    }
    if (/operation timed out|timed out|timeout/i.test(message)) {
        return t('ai.error.timeout');
    }
    if (/load failed|network error|failed to fetch/i.test(message)) {
        return t('ai.error.network');
    }
    if (parsed?.message) {
        return parsed.message;
    }
    return message;
}

/**
 * 将 HTTP 错误包装成统一文案。
 * @param {number} status - HTTP 状态码
 * @param {string} body - 原始响应体
 * @returns {string} 用户可读文案
 */
function formatAiHttpError(status, body) {
    const parsed = parseProviderErrorPayload(body);
    const rawMessage = parsed?.message || `${status} ${String(body || '').trim()}`.trim();
    return formatAiErrorMessage(rawMessage);
}

/**
 * AI 服务 - 直接调用 OpenAI API
 * 支持多 provider 配置，流式响应
 */

class AiService {
    constructor() {
        this.listeners = new Set();
        this.activeTasks = new Map();
        this.config = this.loadConfig();
        // cloud plugin 注册 / 登录态变化 / profile 拉取等都广播到 registry
        subscribeRegistry(() => this.ensureCloudDefaults());
    }

    /**
     * 对所有 cloud plugin 自动维护 model 默认值：
     * - 登录后：对应槽位为空时自动填 plugin 的 preferred 默认模型(避免 gpt mini)
     * - 拿到真实 model 列表后：把旧的 gpt mini 默认(含 fallback 抢占的 gpt-4o-mini)
     *   升级到 preferred 模型(如 deepseek-v4-flash)
     * - 登出后：清掉指向该 plugin 的槽位，避免下拉里残留 "孤立 option"
     * 永远不覆盖用户已选的非 cloud 槽位，也不动用户手选的非 mini 云模型。
     */
    ensureCloudDefaults() {
        for (const plugin of listCloudProviders()) {
            if (!plugin.isAvailable()) {
                const next = { ...this.config };
                let dirty = false;
                if (next.assistantModel?.providerId === plugin.id) {
                    next.assistantModel = null;
                    dirty = true;
                }
                if (next.fastModel?.providerId === plugin.id) {
                    next.fastModel = null;
                    dirty = true;
                }
                if (dirty) this.saveConfig(next);
                continue;
            }
            const cred = plugin.getCredentials() || {};
            // 真实拉取到的列表(非 preset fallback);只有它就绪时才迁移旧默认
            const fetched = (Array.isArray(cred.models) && cred.models.length > 0)
                ? cred.models
                : null;
            const ids = fetched || plugin.preset.models || [];
            if (ids.length === 0) continue;

            const preferred = plugin.preset.defaultModel || null;
            const pick = pickCloudDefaultModel(ids, preferred);
            const canMigrate = !!(fetched && preferred && ids.includes(preferred));

            const next = { ...this.config };
            let dirty = false;
            for (const slot of ['assistantModel', 'fastModel']) {
                const cur = next[slot];
                if (!cur?.providerId) {
                    // 空槽:填默认(优先 preferred)
                    next[slot] = { providerId: plugin.id, model: pick };
                    dirty = true;
                } else if (canMigrate
                    && cur.providerId === plugin.id
                    && cur.model !== preferred
                    && isMiniModel(cur.model)) {
                    // 旧的 gpt mini 默认 → 升级到 preferred,不动用户手选的非 mini 模型
                    next[slot] = { providerId: plugin.id, model: preferred };
                    dirty = true;
                }
            }
            if (dirty) this.saveConfig(next);
        }
    }

    // ── 配置管理 ──────────────────────────────────────────

    loadConfig() {
        return this.normalizeConfig(store.get('config', {}) || {});
    }

    saveConfig(config) {
        this.config = this.normalizeConfig(config);
        store.set('config', this.config);
        this.notify({ type: 'config', data: this.config });
        return this.config;
    }

    getConfig() {
        return this.config;
    }

    normalizeConfig(raw) {
        // 兼容旧格式（有 activeProviderId 字段）→ 迁移到新格式
        if (raw.activeProviderId !== undefined && raw.assistantModel === undefined) {
            const oldProviders = Array.isArray(raw.providers) ? raw.providers : [];
            const migratedProviders = [];
            let migratedAssistant = null;
            for (const op of oldProviders) {
                const preset = PROVIDER_PRESETS.find(p =>
                    normalizeAiBaseUrl(p.baseUrl) === normalizeAiBaseUrl(op.baseUrl || '')
                );
                if (preset && op.apiKey) {
                    if (!migratedProviders.find(p => p.id === preset.id)) {
                        migratedProviders.push({ id: preset.id, apiKey: op.apiKey });
                    }
                    if (op.id === raw.activeProviderId && raw.activeModel) {
                        migratedAssistant = { providerId: preset.id, model: raw.activeModel };
                    }
                }
            }
            raw = {
                providers: migratedProviders,
                assistantModel: migratedAssistant,
                fastModel: null,
                preferences: raw.preferences,
            };
        }

        const presetIds = new Set(PROVIDER_PRESETS.map(p => p.id));
        const providers = Array.isArray(raw.providers)
            ? raw.providers
                .filter(p => p.id && (presetIds.has(p.id) || (p.isCustom && p.name && p.baseUrl)))
                .map(p => {
                    if (p.isCustom) {
                        return {
                            id: p.id,
                            name: String(p.name || ''),
                            baseUrl: String(p.baseUrl || ''),
                            apiKey: String(p.apiKey || ''),
                            models: Array.isArray(p.models) ? p.models.filter(m => typeof m === 'string' && m.trim()) : [],
                            isCustom: true,
                        };
                    }
                    const entry = { id: p.id, apiKey: p.apiKey || '' };
                    if (Array.isArray(p.fetchedModels) && p.fetchedModels.length) {
                        entry.fetchedModels = p.fetchedModels.filter(m => typeof m === 'string' && m.trim());
                    }
                    return entry;
                })
            : [];

        const normalizeModelSlot = (slot) => {
            if (!slot?.providerId || !slot?.model) return null;
            const valid = presetIds.has(slot.providerId)
                || !!getCloudProvider(slot.providerId)
                || providers.some(p => p.id === slot.providerId && p.isCustom);
            if (!valid) return null;
            return { providerId: slot.providerId, model: slot.model };
        };

        return {
            providers,
            assistantModel: normalizeModelSlot(raw.assistantModel),
            fastModel: normalizeModelSlot(raw.fastModel),
            preferences: {
                creativity: raw.preferences?.creativity || 'medium',
            },
        };
    }

    // 合并 preset 定义和用户 apiKey，或返回自定义 provider；cloud plugin 走运行时解析
    getProviderConfig(providerId) {
        const cloudPlugin = getCloudProvider(providerId);
        if (cloudPlugin) {
            return resolveCloudProvider(cloudPlugin);
        }
        const preset = PROVIDER_PRESETS.find(p => p.id === providerId);
        if (preset) {
            const userCfg = this.config.providers.find(p => p.id === providerId);
            return { ...preset, apiKey: userCfg?.apiKey || '' };
        }
        const custom = this.config.providers.find(p => p.id === providerId && p.isCustom);
        return custom ? { ...custom } : null;
    }

    generateId() {
        return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    }

    // ── 便捷方法：获取 assistantModel / fastModel ─────────────

    getActiveProvider() {
        const slot = this.config.assistantModel;
        return slot ? this.getProviderConfig(slot.providerId) : null;
    }

    getActiveModel() {
        return this.config.assistantModel?.model || '';
    }

    getActiveApiKey() {
        return this.getActiveProvider()?.apiKey || '';
    }

    getActiveBaseUrl() {
        return normalizeAiBaseUrl(this.getActiveProvider()?.baseUrl || 'https://api.openai.com/v1');
    }

    getFastProvider() {
        const slot = this.config.fastModel;
        return slot ? this.getProviderConfig(slot.providerId) : this.getActiveProvider();
    }

    getFastModel() {
        return this.config.fastModel?.model || this.getActiveModel();
    }

    getFastApiKey() {
        return this.getFastProvider()?.apiKey || '';
    }

    getTemperature() {
        const map = { low: 0.3, medium: 0.7, high: 0.9 };
        return map[this.config.preferences?.creativity] ?? 0.7;
    }

    getFastBaseUrl() {
        return normalizeAiBaseUrl(this.getFastProvider()?.baseUrl || 'https://api.openai.com/v1');
    }

    // ── 测试连通性 ───────────────────────────────────────

    /**
     * 测试单个模型的连通性，返回 { success, model, duration, error }
     */
    async testModel(provider, model) {
        if (!provider?.apiKey) {
            return { success: false, model, duration: 0, error: t('ai.error.apiKeyMissing') };
        }
        const baseUrl = normalizeAiBaseUrl(provider.baseUrl || 'https://api.openai.com/v1');
        const start = performance.now();

        try {
            const response = await aiProxyJsonRequest({
                method: 'POST',
                url: `${baseUrl}/chat/completions`,
                apiKey: provider.apiKey,
                body: {
                    model,
                    messages: [{ role: 'user', content: 'hi' }],
                    max_tokens: 1,
                    stream: false,
                },
                timeoutMs: 15000,
            });

            const duration = Math.round(performance.now() - start);
            if (response.status < 200 || response.status >= 300) {
                return { success: false, model, duration, error: formatAiHttpError(response.status, response.body) };
            }
            return { success: true, model, duration, error: null };
        } catch (error) {
            const duration = Math.round(performance.now() - start);
            const msg = formatAiErrorMessage(error.message || t('ai.error.connectFailed'));
            return { success: false, model, duration, error: msg };
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
            throw new Error(t('ai.error.apiKeyMissing'));
        }
        const baseUrl = normalizeAiBaseUrl(provider.baseUrl || 'https://api.openai.com/v1');

        try {
            const response = await aiProxyJsonRequest({
                method: 'GET',
                url: `${baseUrl}/models`,
                apiKey: provider.apiKey,
                timeoutMs: 15000,
            });

            if (response.status < 200 || response.status >= 300) {
                throw new Error(formatAiHttpError(response.status, response.body));
            }

            const result = JSON.parse(response.body || '{}');
            const models = (result.data || [])
                .map(m => m.id)
                .filter(Boolean)
                .sort();
            return models;
        } catch (error) {
            throw error;
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
            throw new Error(t('ai.error.emptyMessages'));
        }

        const apiKey = this.getActiveApiKey();
        if (!apiKey) {
            throw new Error(t('ai.error.configApiKey'));
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
            const baseUrl = this.getActiveBaseUrl();

            task.status = 'streaming';
            this.notify({
                type: 'task-stream-start',
                id: taskId,
            });

            let streamResolved = false;
            const streamPromise = new Promise((resolve, reject) => {
                startAiProxyStream({
                    requestId: taskId,
                    url: `${baseUrl}/chat/completions`,
                    apiKey,
                    body: {
                        model: requestOptions.model || this.getActiveModel(),
                        messages: requestOptions.messages,
                        temperature: requestOptions.temperature ?? this.getTemperature(),
                        stream: true,
                        ...(requestOptions.tools?.length ? { tools: requestOptions.tools } : {}),
                    },
                    timeoutMs: 180000,
                    onChunk: (chunk) => {
                        const lines = chunk.split('\n').map(line => line.trim()).filter(Boolean);

                        for (const line of lines) {
                            if (!line.startsWith('data:')) continue;
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
                    },
                    onError: (error) => {
                        if (!streamResolved) {
                            streamResolved = true;
                            reject(new Error(formatAiErrorMessage(error || t('ai.error.requestFailed'))));
                        }
                    },
                    onEnd: () => {
                        if (!streamResolved) {
                            streamResolved = true;
                            resolve();
                        }
                    },
                }).then(unlisten => {
                    task.streamCleanup = unlisten;
                }).catch(reject);
            });

            await streamPromise;
            task.streamCleanup?.();
            task.streamCleanup = null;

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
            task.streamCleanup?.();
            task.streamCleanup = null;
            const isAborted = task.cancelRequested === true || error?.name === 'AbortError';
            this.activeTasks.delete(taskId);
            if (isAborted) {
                if (!task.cancelledNotified) {
                    this.notify({
                        type: 'task-cancelled',
                        id: taskId,
                    });
                }
                throw new Error(t('ai.error.cancelled'));
            } else {
                this.notify({
                    type: 'task-failed',
                    id: taskId,
                    error: formatAiErrorMessage(error.message || error),
                });
                throw new Error(formatAiErrorMessage(error.message || error));
            }
        }
    }

    async cancelTask(taskId) {
        const task = this.activeTasks.get(taskId);
        if (task) {
            task.cancelRequested = true;
            await cancelAiProxyStream(taskId).catch(() => false);
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
            throw new Error(t('ai.error.emptyMessages'));
        }

        const apiKey = this.getActiveApiKey();
        if (!apiKey) {
            throw new Error(t('ai.error.configApiKey'));
        }

        const baseUrl = this.getActiveBaseUrl();
        const response = await aiProxyJsonRequest({
            method: 'POST',
            url: `${baseUrl}/chat/completions`,
            apiKey,
            body: {
                model: options.model || this.getActiveModel(),
                messages: options.messages,
                temperature: options.temperature,
                stream: false,
                ...(options.extraBody || {}),
            },
        });

        if (response.status < 200 || response.status >= 300) {
            throw new Error(formatAiHttpError(response.status, response.body));
        }

        const result = JSON.parse(response.body || '{}');
        const message = result?.choices?.[0]?.message?.content ?? '';

        return {
            content: message,
            raw: result,
        };
    }
}

// 导出单例
export const aiService = new AiService();
