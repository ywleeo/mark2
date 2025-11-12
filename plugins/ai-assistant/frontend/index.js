/**
 * AI 助手插件
 * 完全解耦的 AI 功能模块
 */
import { AiSidebar } from './AiSidebar.js';
import { AiConfigManager } from './AiConfigManager.js';
import { aiService } from './aiService.js';

export const metadata = {
    id: 'ai-assistant',
    name: 'AI 助手',
    version: '1.0.0',
    description: '基于 LLM 的智能写作助手',
};

/**
 * 插件激活入口
 * @param {Object} context - 插件上下文
 */
export async function activate(context) {
    console.log('[AI Plugin] 正在激活...');

    const { app, services } = context;

    let aiSidebar = null;
    let aiConfigManager = null;
    let editorRefs = {
        markdownEditor: null,
        codeEditor: null,
    };

    const detachEditorReady = context.eventBus.on('editor:ready', (payload) => {
        editorRefs = {
            markdownEditor: payload?.markdownEditor || null,
            codeEditor: payload?.monacoEditor || null,
        };
        if (aiSidebar) {
            aiSidebar.setEditorReferences(editorRefs);
        }
    });

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

                aiSidebar = new AiSidebar(container, {
                    app,
                    services,
                    getEditorContext: async (options) => {
                        const editorContext = await app.getEditorContext?.(options);
                        return editorContext || '';
                    },
                    getDocumentContent: async () => {
                        const documentContent = await app.getDocumentContent?.();
                        return documentContent || '';
                    },
                    getActiveViewMode: async () => {
                        const mode = await app.getActiveViewMode?.();
                        return mode || 'markdown';
                    },
                    documentApi: app.document,
                });
                aiSidebar.setEditorReferences(editorRefs);
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
        if (typeof detachEditorReady === 'function') {
            detachEditorReady();
        }
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
