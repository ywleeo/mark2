/**
 * Prompt Composer - 组装完整的 AI 请求
 * 整合 System Prompt + Context + Task Prompt
 */

import { SYSTEM_PROMPTS, adjustSystemPromptByPreferences } from './systemPrompts.js';
import { ContextBuilder } from './contextBuilder.js';
import { TASK_PROMPTS, ACTION_TEMPERATURES } from './taskPrompts.js';

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
    buildMessages(action, selection, options = {}) {
        const messages = [];

        // 1. System Prompt（基于文档类型）
        let systemPrompt = SYSTEM_PROMPTS[this.docType] || SYSTEM_PROMPTS.general;
        systemPrompt = adjustSystemPromptByPreferences(systemPrompt, this.preferences);

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

        const taskPrompt = taskPromptBuilder({
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
    getTemperature(action) {
        let baseTemp = ACTION_TEMPERATURES[action] || 0.5;

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
        messages: composer.buildMessages(action, selection),
        temperature: composer.getTemperature(action),
        metadata: {
            action,
            documentType: composer.getDocumentType(),
            style: composer.getStyle(),
        }
    };
}
