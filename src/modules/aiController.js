import { listen } from '@tauri-apps/api/event';
import { clearAiApiKey, executeAi, executeAiStream, fetchAiConfig, persistAiConfig } from './aiGateway.js';

export function createAiController() {
    let configSnapshot = null;
    const listeners = new Set();
    const activeTasks = new Map();
    const streamUnsubscribes = [];
    let streamListenersReady = null;

    const notify = (event) => {
        listeners.forEach(listener => {
            try {
                listener(event);
            } catch (error) {
                console.warn('AI 控制器事件回调执行失败', error);
            }
        });
    };

    const ensureTaskEntry = (taskId) => {
        if (!taskId) {
            return null;
        }
        if (!activeTasks.has(taskId)) {
            activeTasks.set(taskId, {
                buffer: '',
                reasoning: '',
                status: 'pending',
                metadata: null,
                isStream: false,
            });
        }
        return activeTasks.get(taskId);
    };

    async function ensureStreamListeners() {
        if (streamListenersReady) {
            await streamListenersReady;
            return;
        }

        streamListenersReady = (async () => {
            const handleStart = await listen('ai-stream-start', (event) => {
                const payload = event?.payload ?? {};
                const { id } = payload;
                const task = ensureTaskEntry(id);
                if (task) {
                    task.status = 'streaming';
                    task.reasoning = '';
                    notify({
                        type: 'task-stream-start',
                        id,
                        request: task.metadata,
                        stream: task.isStream === true,
                    });
                }
            });

            const handleChunk = await listen('ai-stream-chunk', (event) => {
                const payload = event?.payload ?? {};
                const {
                    id,
                    content_delta: delta,
                    reasoning_delta: reasoningDelta,
                    finish_reason: finishReason,
                    role,
                } = payload;
                const task = ensureTaskEntry(id);
                if (!task) {
                    return;
                }
                if (typeof delta === 'string' && delta.length > 0) {
                    task.buffer += delta;
                }
                if (typeof reasoningDelta === 'string' && reasoningDelta.length > 0) {
                    task.reasoning += reasoningDelta;
                }
                notify({
                    type: 'task-stream-chunk',
                    id,
                    delta: typeof delta === 'string' ? delta : '',
                    buffer: task.buffer,
                    reasoningDelta: typeof reasoningDelta === 'string' ? reasoningDelta : '',
                    reasoning: task.reasoning,
                    finishReason: typeof finishReason === 'string' ? finishReason : null,
                    role: typeof role === 'string' ? role : null,
                    deltaRaw: delta,
                    request: task.metadata,
                    stream: task.isStream === true,
                });
            });

            const handleEnd = await listen('ai-stream-end', (event) => {
                const payload = event?.payload ?? {};
                const { id, content, reasoning } = payload;
                const task = ensureTaskEntry(id);
                if (!task) {
                    return;
                }
                task.status = 'completed';
                if (typeof content === 'string' && content.length > 0) {
                    task.buffer = content;
                }
                if (typeof reasoning === 'string' && reasoning.length > 0) {
                    task.reasoning = reasoning;
                }
                notify({
                    type: 'task-stream-end',
                    id,
                    buffer: task.buffer,
                    reasoning: task.reasoning,
                    deltaRaw: null,
                    request: task.metadata,
                    stream: task.isStream === true,
                });
                notify({
                    type: 'task-completed',
                    id,
                    content: task.buffer,
                    reasoning: task.reasoning,
                    request: task.metadata,
                    stream: task.isStream === true,
                });
                activeTasks.delete(id);
            });

            const handleError = await listen('ai-stream-error', (event) => {
                const payload = event?.payload ?? {};
                const { id, message } = payload;
                const task = ensureTaskEntry(id);
                const errorMessage = typeof message === 'string' && message.trim().length > 0
                    ? message
                    : 'AI 流式生成失败';
                const error = new Error(errorMessage);
                notify({
                    type: 'task-failed',
                    id,
                    error,
                    request: task?.metadata,
                    stream: task?.isStream === true,
                });
                if (task) {
                    task.status = 'failed';
                }
                activeTasks.delete(id);
            });

            streamUnsubscribes.push(handleStart, handleChunk, handleEnd, handleError);
        })();

        await streamListenersReady;
    }

    async function ensureConfig() {
        if (!configSnapshot) {
            configSnapshot = await fetchAiConfig();
            notify({ type: 'config', data: configSnapshot });
        }
        return configSnapshot;
    }

    async function refreshConfig() {
        configSnapshot = await fetchAiConfig();
        notify({ type: 'config', data: configSnapshot });
        return configSnapshot;
    }

    async function saveConfig(update) {
        await persistAiConfig(update);
        return await refreshConfig();
    }

    async function resetApiKey() {
        await clearAiApiKey();
        return await refreshConfig();
    }

    async function runTask(request, options = {}) {
        const prepared = {
            prompt: request.prompt ?? '',
            context: request.context ?? null,
            systemPrompt: request.systemPrompt ?? null,
            mode: request.mode ?? null,
        };

        if (!prepared.prompt.trim()) {
            throw new Error('请求内容为空');
        }

        const useStream = options.stream !== false;
        const taskId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        notify({ type: 'task-started', id: taskId, payload: prepared });

        if (useStream) {
            await ensureStreamListeners();
            const taskEntry = ensureTaskEntry(taskId);
            if (taskEntry) {
                taskEntry.metadata = prepared;
                taskEntry.buffer = '';
                taskEntry.status = 'pending';
                taskEntry.isStream = true;
            }
            try {
                const result = await executeAiStream(taskId, prepared.prompt, {
                    context: prepared.context,
                    systemPrompt: prepared.systemPrompt,
                    mode: prepared.mode,
                });
                const finalReasoning = typeof result?.reasoning === 'string' && result.reasoning.trim().length > 0
                    ? result.reasoning
                    : taskEntry?.reasoning ?? '';
                if (activeTasks.has(taskId)) {
                    // 后端未触发完成事件时的兜底
                    activeTasks.delete(taskId);
                    notify({
                        type: 'task-completed',
                        id: taskId,
                        content: result?.content ?? '',
                        reasoning: finalReasoning,
                        request: prepared,
                        stream: true,
                    });
                }
                return { id: taskId, content: result?.content ?? '', reasoning: finalReasoning };
            } catch (error) {
                if (activeTasks.has(taskId)) {
                    activeTasks.delete(taskId);
                    notify({
                        type: 'task-failed',
                        id: taskId,
                        error,
                        request: prepared,
                        stream: true,
                    });
                }
                throw error;
            }
        }

        try {
            const result = await executeAi(prepared.prompt, {
                context: prepared.context,
                systemPrompt: prepared.systemPrompt,
                mode: prepared.mode,
            });
            notify({ type: 'task-completed', id: taskId, content: result, request: prepared, stream: false });
            return { id: taskId, content: result };
        } catch (error) {
            notify({ type: 'task-failed', id: taskId, error, request: prepared, stream: false });
            throw error;
        }
    }

    function subscribe(listener) {
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
        };
    }

    return {
        ensureConfig,
        refreshConfig,
        saveConfig,
        resetApiKey,
        runTask,
        subscribe,
        getCurrentConfig() {
            return configSnapshot;
        },
    };
}
