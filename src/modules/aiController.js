import { clearAiApiKey, executeAi, fetchAiConfig, persistAiConfig } from './aiGateway.js';

export function createAiController() {
    let configSnapshot = null;
    const listeners = new Set();

    const notify = (event) => {
        listeners.forEach(listener => {
            try {
                listener(event);
            } catch (error) {
                console.warn('AI 控制器事件回调执行失败', error);
            }
        });
    };

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

    async function runTask(request) {
        const prepared = {
            prompt: request.prompt ?? '',
            context: request.context ?? null,
            systemPrompt: request.systemPrompt ?? null,
            mode: request.mode ?? null,
        };

        if (!prepared.prompt.trim()) {
            throw new Error('请求内容为空');
        }

        const taskId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        notify({ type: 'task-started', id: taskId, payload: prepared });

        try {
            const result = await executeAi(prepared.prompt, {
                context: prepared.context,
                systemPrompt: prepared.systemPrompt,
                mode: prepared.mode,
            });
            notify({ type: 'task-completed', id: taskId, content: result });
            return { id: taskId, content: result };
        } catch (error) {
            notify({ type: 'task-failed', id: taskId, error });
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
