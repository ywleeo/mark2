/**
 * Prompt Composer - 组装完整的 AI 请求
 * 整合 System Prompt + Context + Task Prompt
 */

import { getSystemPrompts, adjustSystemPromptByPreferences } from './systemPrompts.js';
import { ContextBuilder } from './contextBuilder.js';
import { TASK_PROMPTS, getActionTemperatures } from './taskPrompts.js';

export class PromptComposer {
    constructor(documentContent, userPreferences) {
        this.contextBuilder = new ContextBuilder(documentContent);
        this.docType = this.contextBuilder.detectDocumentType();
        this.style = this.contextBuilder.analyzeStyle();
        this.preferences = userPreferences || {};
    }

    /**
     * 为单次操作构建消息列表
     * @param {string} action - 操作类型 (polish, continue, expand, etc.)
     * @param {string} selection - 选中的文本
     * @param {Object} options - 额外选项
     */
    async buildMessages(action, selection, options = {}) {
        const messages = [];

        // 1. System Prompt（基于文档类型）
        const systemPrompts = await getSystemPrompts();
        let systemPrompt = systemPrompts[this.docType] || systemPrompts.general;
        console.log('[PromptComposer] 用户偏好设置:', JSON.stringify(this.preferences));
        console.log('[PromptComposer] 输出风格:', this.preferences?.outputStyle);
        systemPrompt = await adjustSystemPromptByPreferences(systemPrompt, this.preferences);
        console.log('[PromptComposer] System Prompt 是否包含输出风格:', systemPrompt.includes('输出风格要求'));

        messages.push({
            role: 'system',
            content: systemPrompt
        });

        // 2. 提取上下文
        const surrounding = this.contextBuilder.extractSurrounding(selection);

        // 3. Task Prompt
        const taskPromptBuilder = TASK_PROMPTS[action];
        if (!taskPromptBuilder) {
            throw new Error(`未知的操作类型: ${action}`);
        }

        const taskPrompt = await taskPromptBuilder({
            selection,
            context: surrounding,
            style: this.style,
            ...options
        });

        messages.push({
            role: 'user',
            content: taskPrompt
        });

        return messages;
    }

    /**
     * 获取操作的推荐温度参数
     */
    async getTemperature(action) {
        const temperatures = await getActionTemperatures();
        let baseTemp = temperatures[action] || 0.5;

        // 根据用户的创造性偏好调整
        const creativityModifier = {
            low: -0.1,
            medium: 0,
            high: 0.15,
        };

        const modifier = creativityModifier[this.preferences.creativity] || 0;

        return Math.max(0, Math.min(1, baseTemp + modifier));
    }

    /**
     * 获取检测到的文档类型
     */
    getDocumentType() {
        return this.docType;
    }

    /**
     * 获取分析出的风格
     */
    getStyle() {
        return this.style;
    }
}

/**
 * 快捷函数：直接构建请求
 */
export async function buildAiRequest(action, selection, documentContent, userPreferences) {
    const composer = new PromptComposer(documentContent, userPreferences);

    return {
        messages: await composer.buildMessages(action, selection),
        temperature: await composer.getTemperature(action),
        metadata: {
            action,
            documentType: composer.getDocumentType(),
            style: composer.getStyle(),
        }
    };
}
