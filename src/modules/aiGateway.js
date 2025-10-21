import { invoke } from '@tauri-apps/api/core';

export async function fetchAiConfig() {
    return await invoke('get_ai_config');
}

export async function persistAiConfig(config) {
    return await invoke('save_ai_config', { payload: config });
}

export async function clearAiApiKey() {
    return await invoke('clear_ai_api_key');
}

export async function executeAi(prompt, options = {}) {
    const payload = {
        prompt,
        context: options.context ?? null,
        system_prompt: options.systemPrompt ?? null,
        mode: options.mode ?? null,
    };

    return await invoke('ai_execute', { payload });
}

export async function executeAiStream(taskId, prompt, options = {}) {
    const payload = {
        prompt,
        context: options.context ?? null,
        system_prompt: options.systemPrompt ?? null,
        mode: options.mode ?? null,
    };

    return await invoke('ai_execute_stream', {
        payload,
        taskId,
        task_id: taskId,
    });
}
