import { splitThinkAndAnswer } from '../utils/aiStreamUtils.js';

export function createAiRuntime({
    controller,
    getActiveViewMode,
    getEditorContext,
    adapters,
    markDocumentDirty,
}) {
    if (!controller) {
        throw new Error('createAiRuntime: controller 未定义');
    }

    const listeners = new Set();
    const tasks = new Map();
    const streamSessions = new Map();

    const markdownAdapter = adapters?.markdown ?? null;
    const codeAdapter = adapters?.code ?? null;

    const emit = (event) => {
        listeners.forEach(listener => {
            try {
                listener(event);
            } catch (error) {
                console.warn('AI Runtime 事件回调失败', error);
            }
        });
    };

    const resolveAdapterKey = (preferred) => {
        let target = preferred;
        if (target === 'code' && !codeAdapter?.hasEditor?.()) {
            target = markdownAdapter?.hasEditor?.() ? 'markdown' : null;
        } else if (target === 'markdown' && !markdownAdapter?.hasEditor?.()) {
            target = codeAdapter?.hasEditor?.() ? 'code' : null;
        }
        if (!target) {
            target = markdownAdapter?.hasEditor?.() ? 'markdown' : (codeAdapter?.hasEditor?.() ? 'code' : null);
        }
        return target;
    };

    const getAdapterByKey = (key) => {
        if (key === 'code') {
            return codeAdapter;
        }
        if (key === 'markdown') {
            return markdownAdapter;
        }
        return null;
    };

    const cleanupStreamSession = (taskId) => {
        streamSessions.delete(taskId);
    };

    const controllerUnsubscribe = controller.subscribe(event => {
        switch (event.type) {
            case 'config': {
                emit(event);
                break;
            }
            case 'task-started': {
                const preferredViewMode = typeof getActiveViewMode === 'function'
                    ? getActiveViewMode()
                    : 'markdown';
                tasks.set(event.id, {
                    id: event.id,
                    mode: event.payload?.mode || 'custom',
                    preferredViewMode,
                    stream: true,
                    status: 'pending',
                });
                emit(event);
                break;
            }
            case 'task-stream-start': {
                const taskInfo = tasks.get(event.id) || {
                    preferredViewMode: typeof getActiveViewMode === 'function'
                        ? getActiveViewMode()
                        : 'markdown',
                };
                taskInfo.status = 'streaming';
                const adapterKey = resolveAdapterKey(taskInfo.preferredViewMode);
                const adapter = getAdapterByKey(adapterKey);
                if (adapter?.beginSession) {
                    adapter.beginSession(event.id);
                }
                streamSessions.set(event.id, {
                    adapterKey,
                    answer: '',
                    reasoning: '',
                });
                emit(event);
                break;
            }
            case 'task-stream-chunk': {
                const session = streamSessions.get(event.id);
                if (session) {
                    if (typeof event.delta === 'string' && event.delta.length > 0) {
                        session.answer += event.delta;
                        const adapter = getAdapterByKey(session.adapterKey);
                        adapter?.appendChunk?.(event.id, event.delta);
                    }
                    if (typeof event.reasoningDelta === 'string' && event.reasoningDelta.length > 0) {
                        session.reasoning += event.reasoningDelta;
                    }
                }
                emit({
                    ...event,
                    reasoning: session?.reasoning ?? event.reasoning,
                });
                break;
            }
            case 'task-stream-end': {
                const session = streamSessions.get(event.id);
                const adapter = session ? getAdapterByKey(session.adapterKey) : null;
                const { think, answer } = splitThinkAndAnswer(event.buffer || '');
                const reasoning = session?.reasoning || event.reasoning || think;
                const finalAnswer = answer || session?.answer || event.buffer || '';
                if (adapter?.finalizeSession) {
                    adapter.finalizeSession(event.id, finalAnswer.trim());
                    markDocumentDirty?.();
                }
                cleanupStreamSession(event.id);
                const taskInfo = tasks.get(event.id);
                if (taskInfo) {
                    taskInfo.status = 'completed';
                }
                emit({
                    ...event,
                    reasoning,
                    answer: finalAnswer,
                });
                break;
            }
            case 'task-completed': {
                const taskInfo = tasks.get(event.id);
                if (!event.stream) {
                    const viewMode = taskInfo?.preferredViewMode || (typeof getActiveViewMode === 'function'
                        ? getActiveViewMode()
                        : 'markdown');
                    const adapterKey = resolveAdapterKey(viewMode);
                    const adapter = getAdapterByKey(adapterKey);
                    if (adapter?.insertContent) {
                        const fragments = splitThinkAndAnswer(event.content || '');
                        const finalAnswer = fragments.answer || event.content || '';
                        adapter.insertContent(finalAnswer);
                        markDocumentDirty?.();
                    }
                }
                tasks.delete(event.id);
                emit({
                    ...event,
                    reasoning: event.reasoning || splitThinkAndAnswer(event.content || '').think || '',
                });
                break;
            }
            case 'task-failed': {
                const session = streamSessions.get(event.id);
                if (session) {
                    const adapter = getAdapterByKey(session.adapterKey);
                    adapter?.abortSession?.(event.id);
                    cleanupStreamSession(event.id);
                }
                const taskInfo = tasks.get(event.id);
                if (taskInfo) {
                    taskInfo.status = 'failed';
                }
                tasks.delete(event.id);
                emit(event);
                break;
            }
            case 'task-cancelled': {
                const session = streamSessions.get(event.id);
                if (session) {
                    const adapter = getAdapterByKey(session.adapterKey);
                    adapter?.abortSession?.(event.id);
                    cleanupStreamSession(event.id);
                }
                const taskInfo = tasks.get(event.id);
                if (taskInfo) {
                    taskInfo.status = 'cancelled';
                }
                tasks.delete(event.id);
                emit(event);
                break;
            }
            default: {
                emit(event);
                break;
            }
        }
    });

    function subscribe(listener) {
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
        };
    }

    async function runTask(request) {
        const prepared = {
            prompt: request.prompt,
            mode: request.mode,
            systemPrompt: request.systemPrompt ?? null,
        };

        const preferSelection = !!request.useSelection;
        if (typeof getEditorContext === 'function') {
            prepared.context = await getEditorContext({
                preferSelection,
            });
        }

        if (typeof prepared.context === 'string' && prepared.context.trim().length === 0) {
            prepared.context = null;
        }

        const result = await controller.runTask(prepared, { stream: request.stream !== false });
        return result;
    }

    return {
        subscribe,
        runTask,
        async cancelActiveTask() {
            const entries = Array.from(tasks.values())
                .filter(task => task.stream && task.status !== 'completed' && task.status !== 'failed' && task.status !== 'cancelled');
            if (entries.length === 0) {
                return false;
            }
            const target = entries[entries.length - 1];
            const success = await controller.cancelTask(target.id);
            return success;
        },
        ensureConfig: (...args) => controller.ensureConfig(...args),
        refreshConfig: (...args) => controller.refreshConfig(...args),
        saveConfig: (...args) => controller.saveConfig(...args),
        resetApiKey: (...args) => controller.resetApiKey(...args),
        getCurrentConfig: (...args) => controller.getCurrentConfig(...args),
        dispose() {
            controllerUnsubscribe?.();
            listeners.clear();
            tasks.clear();
            streamSessions.clear();
        },
    };
}
