/**
 * Feature 装配模块。
 * 将现有侧边栏和面板能力按统一协议注册到 FeatureManager。
 */

import { createTerminalPanel } from '../modules/terminalPanel.js';
import { createScratchpadPanel } from '../modules/scratchpadPanel.js';
import { initCardExportSidebar } from '../modules/card-export/index.js';
import { initAiSidebar } from '../modules/ai-assistant/AiSidebar.js';

/**
 * 注册当前应用的核心功能模块。
 * @param {{featureManager: Object, context: Object}} options - Feature 装配参数
 * @returns {Function}
 */
export function registerCoreFeatures(options = {}) {
    const { featureManager, context = {} } = options;
    if (!featureManager || typeof featureManager.registerFeature !== 'function') {
        throw new Error('registerCoreFeatures 需要 featureManager');
    }

    const disposers = [];
    const register = (definition) => {
        disposers.push(featureManager.registerFeature(definition));
    };

    register({
        id: 'card-export',
        title: '卡片导出侧边栏',
        contributes: { sidebar: true },
        async mount() {
            return await initCardExportSidebar();
        },
        async unmount(api) {
            api?.destroy?.();
        },
    });

    register({
        id: 'ai-sidebar',
        title: 'AI 侧边栏',
        contributes: { sidebar: true },
        mount() {
            return initAiSidebar({
                getAppState: context.getAppState,
                getEditorRegistry: context.getEditorRegistry,
                reloadCurrentFile: context.reloadCurrentFile,
                confirm: context.confirm,
            });
        },
    });

    register({
        id: 'terminal',
        title: '终端面板',
        contributes: { panel: true },
        mount() {
            const panel = createTerminalPanel({
                getWorkspaceCwd: context.getWorkspaceCwd,
            });
            panel?.initialize?.();
            return panel;
        },
        async unmount(api) {
            api?.destroy?.();
        },
    });

    register({
        id: 'scratchpad',
        title: '便签面板',
        contributes: { panel: true },
        mount() {
            const panel = createScratchpadPanel();
            panel?.initialize?.();
            return panel;
        },
    });

    return () => {
        while (disposers.length > 0) {
            const dispose = disposers.pop();
            try {
                dispose?.();
            } catch (error) {
                console.warn('移除功能注册失败', error);
            }
        }
    };
}
