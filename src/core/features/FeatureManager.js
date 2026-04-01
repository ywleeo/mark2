/**
 * Feature 管理器。
 * 负责统一注册、挂载、卸载功能模块，不持有具体业务逻辑。
 */

/**
 * 创建 Feature 管理器。
 * @param {{logger?: Object, traceRecorder?: Object}} options - 调试依赖
 * @returns {{registerFeature: Function, mountFeature: Function, mountAll: Function, unmountFeature: Function, unmountAll: Function, getFeatureApi: Function, listFeatures: Function}}
 */
export function createFeatureManager(options = {}) {
    const { logger, traceRecorder } = options;
    const features = new Map();

    /**
     * 注册功能定义。
     * @param {{id: string, title?: string, mount?: Function, unmount?: Function, contributes?: Object}} definition - 功能定义
     * @returns {Function}
     */
    function registerFeature(definition) {
        const id = typeof definition?.id === 'string' ? definition.id.trim() : '';
        if (!id) {
            throw new Error('FeatureManager.registerFeature 需要合法的 feature id');
        }

        const entry = {
            id,
            title: definition?.title || id,
            mount: typeof definition?.mount === 'function' ? definition.mount : null,
            unmount: typeof definition?.unmount === 'function' ? definition.unmount : null,
            contributes: definition?.contributes || {},
            api: null,
            cleanup: null,
            mounted: false,
        };

        features.set(id, entry);
        logger?.debug?.('feature:registered', { id });

        return () => {
            features.delete(id);
            logger?.debug?.('feature:unregistered', { id });
        };
    }

    /**
     * 挂载单个功能。
     * @param {string} id - 功能 ID
     * @param {Object} context - 挂载上下文
     * @returns {Promise<unknown>}
     */
    async function mountFeature(id, context = {}) {
        const entry = features.get(id);
        if (!entry) {
            throw new Error(`未注册功能: ${id}`);
        }
        if (entry.mounted) {
            return entry.api;
        }

        logger?.info?.('feature:mount:start', { id });
        traceRecorder?.record?.('features', 'mount:start', { id });

        const mountedResult = await entry.mount?.(context);
        if (mountedResult && typeof mountedResult === 'object' && ('api' in mountedResult || 'cleanup' in mountedResult)) {
            entry.api = mountedResult.api ?? null;
            entry.cleanup = typeof mountedResult.cleanup === 'function' ? mountedResult.cleanup : null;
        } else {
            entry.api = mountedResult ?? null;
            entry.cleanup = null;
        }
        entry.mounted = true;

        logger?.info?.('feature:mount:done', { id });
        traceRecorder?.record?.('features', 'mount:done', { id });
        return entry.api;
    }

    /**
     * 挂载全部功能。
     * @param {Object} context - 挂载上下文
     * @returns {Promise<void>}
     */
    async function mountAll(context = {}) {
        for (const id of features.keys()) {
            await mountFeature(id, context);
        }
    }

    /**
     * 卸载单个功能。
     * @param {string} id - 功能 ID
     * @param {Object} context - 卸载上下文
     * @returns {Promise<void>}
     */
    async function unmountFeature(id, context = {}) {
        const entry = features.get(id);
        if (!entry || !entry.mounted) {
            return;
        }

        logger?.info?.('feature:unmount:start', { id });
        traceRecorder?.record?.('features', 'unmount:start', { id });

        try {
            await entry.cleanup?.();
            await entry.unmount?.(entry.api, context);
        } finally {
            entry.api = null;
            entry.cleanup = null;
            entry.mounted = false;
        }

        logger?.info?.('feature:unmount:done', { id });
        traceRecorder?.record?.('features', 'unmount:done', { id });
    }

    /**
     * 卸载全部功能。
     * @param {Object} context - 卸载上下文
     * @returns {Promise<void>}
     */
    async function unmountAll(context = {}) {
        const ids = Array.from(features.keys()).reverse();
        for (const id of ids) {
            await unmountFeature(id, context);
        }
    }

    return {
        registerFeature,
        mountFeature,
        mountAll,
        unmountFeature,
        unmountAll,
        getFeatureApi(id) {
            return features.get(id)?.api ?? null;
        },
        listFeatures() {
            return Array.from(features.values()).map(entry => ({
                id: entry.id,
                title: entry.title,
                mounted: entry.mounted,
                contributes: entry.contributes,
            }));
        },
    };
}
