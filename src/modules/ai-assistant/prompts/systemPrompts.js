/**
 * System Prompts - 不同场景的专业角色设定
 * 从 YAML 配置文件加载
 */

import { loadSystemPrompts } from './promptLoader.js';

// 懒加载的提示词对象
let SYSTEM_PROMPTS = null;

/**
 * 获取系统提示词（异步）
 */
export async function getSystemPrompts() {
    if (!SYSTEM_PROMPTS) {
        const { basePrompts } = await loadSystemPrompts();
        SYSTEM_PROMPTS = basePrompts;
    }
    return SYSTEM_PROMPTS;
}

// 为了向后兼容，提供同步访问方式（使用默认fallback）
export const SYSTEM_PROMPTS_FALLBACK = {
    general: '你是专业的中文写作助手。',
    novel: '你是专业的小说写作助手。',
    marketing: '你是资深广告文案策划。',
    academic: '你是学术写作专家。',
    business: '你是商务写作专家。',
};

/**
 * 根据用户偏好调整 System Prompt
 */
export async function adjustSystemPromptByPreferences(basePrompt, preferences) {
    let adjusted = basePrompt;

    // 从 YAML 加载风格提示词
    if (preferences.outputStyle) {
        const { styles } = await loadSystemPrompts();
        const stylePrompt = styles[preferences.outputStyle];
        if (stylePrompt) {
            adjusted += stylePrompt;
        }
    }

    return adjusted;
}
