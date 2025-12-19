/**
 * Task Prompts - 针对不同操作的精细化任务指令
 * 从 YAML 配置文件加载
 */

import { loadTaskPrompts } from './promptLoader.js';

// 懒加载的任务提示词对象
let TASK_TEMPLATES = null;
let TASK_TEMPERATURES = null;
let TASK_LABELS = null;

/**
 * 初始化任务提示词（懒加载）
 */
async function initTaskPrompts() {
    if (!TASK_TEMPLATES) {
        const config = await loadTaskPrompts();
        TASK_TEMPLATES = config.templates;
        TASK_TEMPERATURES = config.temperatures;
        TASK_LABELS = config.labels;
    }
}

/**
 * 填充模板变量
 */
function fillTemplate(template, variables) {
    let result = template;

    // 替换简单变量 {selection}, {style.person} 等
    for (const [key, value] of Object.entries(variables)) {
        if (typeof value === 'object' && value !== null) {
            // 处理嵌套对象，如 style.person
            for (const [subKey, subValue] of Object.entries(value)) {
                const placeholder = `{${key}.${subKey}}`;
                result = result.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), subValue || '');
            }
        } else {
            const placeholder = `{${key}}`;
            result = result.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), value || '');
        }
    }

    return result;
}

/**
 * 构建任务提示词函数
 */
async function createTaskPromptBuilder(action) {
    await initTaskPrompts();
    const template = TASK_TEMPLATES[action];

    if (!template) {
        throw new Error(`未知的操作类型: ${action}`);
    }

    return (params) => {
        const { selection, context, style, ...otherParams } = params;

        // 准备变量
        const variables = {
            selection,
            contextBefore: context?.before ? `**前文：**\n${context.before}\n` : '',
            contextAfter: context?.after ? `**后文：**\n${context.after}\n` : '',
            style: {
                person: style?.person || '第一人称',
                tone: style?.tone || '中性',
                vocabulary: style?.vocabulary || '通俗',
            },
            sentenceLength: style?.avgSentenceLength > 25 ? '长句为主' :
                           style?.avgSentenceLength > 15 ? '中等句式' : '短句为主',
            currentLength: selection?.length || 0,
            targetLength: otherParams.targetLength || Math.round((selection?.length || 0) * (otherParams.expandRatio || otherParams.targetRatio || 1)),
            ...otherParams
        };

        return fillTemplate(template, variables);
    };
}

export const TASK_PROMPTS = {
    /**
     * 润色优化
     */
    polish: async (params) => {
        const builder = await createTaskPromptBuilder('polish');
        return builder(params);
    },

    /**
     * 续写
     */
    continue: async (params) => {
        const builder = await createTaskPromptBuilder('continue');
        return builder(params);
    },

    /**
     * 扩写
     */
    expand: async (params) => {
        const builder = await createTaskPromptBuilder('expand');
        return builder(params);
    },

    /**
     * 缩写/精简
     */
    compress: async (params) => {
        const builder = await createTaskPromptBuilder('compress');
        return builder(params);
    },

    /**
     * 总结提炼
     */
    summarize: async (params) => {
        const builder = await createTaskPromptBuilder('summarize');
        return builder(params);
    },

    /**
     * 改写（换个说法）
     */
    rewrite: async (params) => {
        const builder = await createTaskPromptBuilder('rewrite');
        return builder(params);
    },

    /**
     * 翻译
     */
    translate: async (params) => {
        const builder = await createTaskPromptBuilder('translate');
        return builder(params);
    },
};

/**
 * 操作对应的标签（异步获取）
 */
export async function getActionLabels() {
    await initTaskPrompts();
    return TASK_LABELS;
}

/**
 * 不同操作的推荐温度参数（异步获取）
 */
export async function getActionTemperatures() {
    await initTaskPrompts();
    return TASK_TEMPERATURES;
}

// 为了向后兼容，提供同步访问方式（使用默认fallback）
export const ACTION_LABELS = {
    polish: '润色',
    continue: '续写',
    expand: '扩写',
    compress: '精简',
    summarize: '总结',
    rewrite: '改写',
    changeStyle: '转换风格',
    translate: '翻译',
};

export const ACTION_TEMPERATURES = {
    polish: 0.3,
    continue: 0.8,
    expand: 0.6,
    compress: 0.3,
    summarize: 0.4,
    rewrite: 0.5,
    changeStyle: 0.4,
    translate: 0.3,
};
