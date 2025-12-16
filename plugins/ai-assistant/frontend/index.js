/**
 * AI 助手插件 - 重构版
 * 浮动窗口式的专业写作助手
 */
import { ConfigDialog } from './components/ConfigDialog.js';
import { aiService } from './aiService.js';

export const metadata = {
    id: 'ai-assistant',
    name: 'AI 助手',
    version: '2.0.0',
    description: '专业的 AI 写作助手',
};

/**
 * 插件激活入口
 */
export async function activate(context) {
    console.log('[AI Plugin] 正在激活 v2.0...');

    const { app, services } = context;

    let configDialog = null;

    // 导出插件 API
    const api = {
        /**
         * 打开配置对话框
         */
        async openSettings() {
            if (!configDialog) {
                configDialog = new ConfigDialog();
            }
            configDialog.open(aiService.getConfig());
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
        configDialog?.destroy?.();
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
