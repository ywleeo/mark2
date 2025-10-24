/**
 * AI 助手插件
 * 完全解耦的 AI 功能模块
 */
import { AiSidebar } from './AiSidebar.js';
import { AiConfigManager } from './AiConfigManager.js';
import { aiService } from './aiService.js';

export const metadata = {
    id: 'ai-assistant',
    name: 'AI 写作助手',
    version: '1.0.0',
    description: '基于 LLM 的智能写作助手',
};

/**
 * 插件激活入口
 * @param {Object} context - 插件上下文
 */
export async function activate(context) {
    console.log('[AI Plugin] 正在激活...');

    const { app } = context;

    let aiSidebar = null;
    let aiConfigManager = null;

    // 导出插件 API
    const api = {
        /**
         * 显示 AI 侧边栏
         */
        showSidebar() {
            if (!aiSidebar) {
                const container = document.getElementById('aiSidebar');
                if (!container) {
                    console.error('[AI Plugin] 未找到 AI 侧边栏容器');
                    return;
                }

                aiSidebar = new AiSidebar(container, async (options) => {
                    // 获取编辑器上下文
                    const context = await app.getEditorContext?.(options);
                    return context || '';
                });
            }
            aiSidebar.show();
        },

        /**
         * 隐藏 AI 侧边栏
         */
        hideSidebar() {
            aiSidebar?.hide();
        },

        /**
         * 切换 AI 侧边栏显示
         */
        toggleSidebar() {
            if (!aiSidebar) {
                this.showSidebar();
            } else {
                aiSidebar.toggle();
            }
        },

        /**
         * 打开 AI 配置对话框
         */
        async openSettings() {
            if (!aiConfigManager) {
                aiConfigManager = new AiConfigManager({
                    onSubmit: async (payload) => {
                        try {
                            aiService.saveConfig(payload);
                            aiConfigManager?.setConfig(aiService.getConfig());
                        } catch (error) {
                            console.error('[AI Plugin] 保存配置失败:', error);
                        }
                    },
                });
            }

            aiConfigManager.open(aiService.getConfig());
        },

        /**
         * 获取 AI 服务实例
         */
        getService() {
            return aiService;
        },
    };

    // 注册清理函数
    context.onCleanup(() => {
        aiSidebar?.destroy?.();
        aiConfigManager?.close?.(false);
    });

    console.log('[AI Plugin] 激活完成');
    return api;
}

/**
 * 插件停用
 */
export async function deactivate() {
    console.log('[AI Plugin] 已停用');
}
