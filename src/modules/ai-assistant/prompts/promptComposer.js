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
     * 将用户选择的输出风格转换为 style 对象
     */
    convertOutputStyleToStyle(outputStyle) {
        // 风格映射表：outputStyle -> { tone, vocabulary }
        const styleMap = {
            'taobao': {
                person: '第二人称',
                tone: '热情促销、引导购买',
                vocabulary: '卖货话术、优惠信息、产品卖点'
            },
            'xiaohongshu': {
                person: '第一人称',
                tone: '种草分享、真诚推荐',
                vocabulary: '口语化、emoji、实用建议'
            },
            'zhihu': {
                person: '第一人称',
                tone: '理性客观、逻辑清晰',
                vocabulary: '专业术语、数据引用'
            },
            'weibo': {
                person: '第一人称',
                tone: '直接简短、态度鲜明',
                vocabulary: '热点词汇、网络流行语'
            },
            'bilibili': {
                person: '第一人称',
                tone: '真诚分享、平等互动',
                vocabulary: '年轻化、网络梗、弹幕词'
            },
            'wechat': {
                person: '第二人称',
                tone: '情感共鸣、启发思考',
                vocabulary: '金句、故事、痛点'
            },
            'toutiao': {
                person: '第三人称',
                tone: '客观报道、时效性强',
                vocabulary: '新闻用语、数据、权威来源'
            },
            'douyin': {
                person: '第一人称',
                tone: '热情互动、节奏快',
                vocabulary: '家人们、懂的都懂、互动词'
            },
            'business_style': {
                person: '第一人称',
                tone: '专业严谨、客观中立',
                vocabulary: '专业术语、数据支撑'
            },
            'literary': {
                person: '第一人称',
                tone: '优美抒情、意境营造',
                vocabulary: '意象、修辞手法'
            },
            'balanced': {
                person: '第一人称',
                tone: '适中平衡、专业亲和',
                vocabulary: '书面口语结合、通俗易懂'
            },
            'rational': {
                person: '第一人称',
                tone: '理性客观、逻辑严谨',
                vocabulary: '专业准确、数据事实'
            },
            'humorous': {
                person: '第一人称',
                tone: '轻松幽默、调侃有趣',
                vocabulary: '比喻梗、网络用语'
            },
            'cute': {
                person: '第一人称',
                tone: '温柔可爱、治愈亲切',
                vocabulary: '语气词、叠词、emoji'
            },
            'standup_comedy': {
                person: '第一人称',
                tone: '犀利吐槽、讽刺幽默',
                vocabulary: '段子、反转、自嘲'
            },
            'novel_master': {
                person: '第三人称',
                tone: '克制精准、人性洞察',
                vocabulary: '朴实有力、细节真实'
            },
            'novel_romance': {
                person: '第三人称',
                tone: '细腻甜蜜、情感丰富',
                vocabulary: '心理描写、氛围营造'
            },
            'novel_mystery': {
                person: '第三人称',
                tone: '紧张压迫、悬念迭起',
                vocabulary: '细节精准、氛围诡异'
            },
            'novel_costume': {
                person: '第三人称',
                tone: '古典雅致、温馨甜宠',
                vocabulary: '古风词汇、细节描写'
            },
            'novel_wuxia': {
                person: '第三人称',
                tone: '豪放洒脱、快意恩仇',
                vocabulary: '江湖气息、武打场面'
            },
            'novel_xianxia': {
                person: '第三人称',
                tone: '玄幻宏大、爽感十足',
                vocabulary: '修仙术语、体系设定'
            },
            'novel_history': {
                person: '第三人称',
                tone: '厚重严谨、正史笔法',
                vocabulary: '历史用语、时代感'
            }
        };

        return styleMap[outputStyle] || null;
    }

    /**
     * 为单次操作构建消息列表
     * @param {string} action - 操作类型 (polish, continue, expand, etc.)
     * @param {string} selection - 选中的文本
     * @param {Object} options - 额外选项
     */
    async buildMessages(action, selection, options = {}) {
        const messages = [];

        // 1. System Prompt（直接使用用户选择的输出风格）
        console.log('[PromptComposer] 用户偏好设置:', JSON.stringify(this.preferences));
        console.log('[PromptComposer] 输出风格:', this.preferences?.outputStyle);
        const systemPrompt = await adjustSystemPromptByPreferences(this.preferences);
        console.log('[PromptComposer] System Prompt 长度:', systemPrompt.length);

        messages.push({
            role: 'system',
            content: systemPrompt
        });

        // 2. 提取上下文
        const surrounding = this.contextBuilder.extractSurrounding(selection);

        // 3. 决定使用哪个风格：创作型任务用用户选择的风格，提炼型任务用文档分析的风格
        const creativeActions = ['polish', 'continue', 'expand'];
        let styleToUse = this.style; // 默认使用文档分析的风格

        if (creativeActions.includes(action) && this.preferences?.outputStyle) {
            // 对于创作型任务，使用用户选择的风格
            const userStyle = this.convertOutputStyleToStyle(this.preferences.outputStyle);
            if (userStyle) {
                styleToUse = userStyle;
                console.log('[PromptComposer] 创作型任务，使用用户选择的风格:', this.preferences.outputStyle, userStyle);
            }
        } else {
            console.log('[PromptComposer] 提炼型任务或无用户风格，使用文档分析的风格:', this.style);
        }

        // 4. Task Prompt
        const taskPromptBuilder = TASK_PROMPTS[action];
        if (!taskPromptBuilder) {
            throw new Error(`未知的操作类型: ${action}`);
        }

        const taskPrompt = await taskPromptBuilder({
            selection,
            context: surrounding,
            style: styleToUse,
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
export async function buildAiRequest(action, selection, documentContent, userPreferences, options = {}) {
    const composer = new PromptComposer(documentContent, userPreferences);

    return {
        messages: await composer.buildMessages(action, selection, options),
        temperature: await composer.getTemperature(action),
        metadata: {
            action,
            documentType: composer.getDocumentType(),
            style: composer.getStyle(),
        }
    };
}
