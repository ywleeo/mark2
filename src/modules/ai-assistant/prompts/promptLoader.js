/**
 * Prompt Loader - 从 YAML 文件加载提示词配置
 */

import yaml from 'js-yaml';
import systemPromptsSource from './system-prompts.yaml?raw';
import taskPromptsSource from './task-prompts.yaml?raw';

// 缓存加载的配置
let systemPromptsCache = null;
let taskPromptsCache = null;

function parseSystemPrompts() {
    try {
        const config = yaml.load(systemPromptsSource) || {};
        const { styles = {}, ...basePrompts } = config;
        return { basePrompts, styles };
    } catch (error) {
        console.error('[PromptLoader] 解析系统提示词配置失败:', error);
        throw error;
    }
}

function parseTaskPrompts() {
    try {
        const config = yaml.load(taskPromptsSource) || {};
        const {
            temperatures = {},
            labels = {},
            styleDescriptions = {},
            ...templates
        } = config;
        return {
            temperatures,
            labels,
            styleDescriptions,
            templates,
        };
    } catch (error) {
        console.error('[PromptLoader] 解析任务提示词配置失败:', error);
        throw error;
    }
}

/**
 * 加载系统提示词配置
 */
export async function loadSystemPrompts() {
    if (systemPromptsCache) {
        return systemPromptsCache;
    }

    systemPromptsCache = parseSystemPrompts();

    return systemPromptsCache;
}

/**
 * 加载任务提示词配置
 */
export async function loadTaskPrompts() {
    if (taskPromptsCache) {
        return taskPromptsCache;
    }

    taskPromptsCache = parseTaskPrompts();

    return taskPromptsCache;
}

/**
 * 重新加载配置（用于热更新）
 */
export function reloadPrompts() {
    systemPromptsCache = null;
    taskPromptsCache = null;
}

/**
 * 获取系统提示词
 */
export async function getSystemPrompt(type = 'general') {
    const { basePrompts } = await loadSystemPrompts();
    return basePrompts[type] || basePrompts.general;
}

/**
 * 获取风格调整提示词
 */
export async function getStylePrompt(style) {
    const { styles } = await loadSystemPrompts();
    return styles[style] || '';
}

/**
 * 获取任务提示词模板
 */
export async function getTaskTemplate(action) {
    const { templates } = await loadTaskPrompts();
    return templates[action];
}

/**
 * 获取任务温度
 */
export async function getTaskTemperature(action) {
    const { temperatures } = await loadTaskPrompts();
    return temperatures[action] || 0.5;
}

/**
 * 获取任务标签
 */
export async function getTaskLabel(action) {
    const { labels } = await loadTaskPrompts();
    return labels[action] || action;
}

/**
 * 获取风格转换说明
 */
export async function getStyleDescription(style) {
    const { styleDescriptions } = await loadTaskPrompts();
    return styleDescriptions[style] || '';
}
