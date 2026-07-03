/**
 * Feature 装配模块。
 * 将现有侧边栏和面板能力按统一协议注册到 FeatureManager。
 */

import { createTranslatorPanel } from '../modules/translator/translatorPanel.js';
import { initCardExport } from '../modules/card-export/index.js';

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
        title: '卡片导出',
        mount() {
            return initCardExport({
                getMarkdownEditor: () => context.getEditorRegistry?.()?.getMarkdownEditor?.(),
            });
        },
        unmount(api) {
            api?.destroy?.();
        },
    });

    register({
        id: 'translator',
        title: '翻译面板',
        contributes: { panel: true },
        mount() {
            const panel = createTranslatorPanel();
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
