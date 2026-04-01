/**
 * 导出管理器。
 * 负责注册和执行导出能力，不直接感知菜单或具体视图控件。
 */

/**
 * 创建导出管理器。
 * @param {{logger?: Object, traceRecorder?: Object}} options - 调试依赖
 * @returns {{registerExport: Function, executeExport: Function, hasExport: Function, listExports: Function}}
 */
export function createExportManager(options = {}) {
    const { logger, traceRecorder } = options;
    const exporters = new Map();

    /**
     * 注册导出实现。
     * @param {{id: string, handler: Function, title?: string}} definition - 导出定义
     * @returns {Function}
     */
    function registerExport(definition) {
        const id = typeof definition?.id === 'string' ? definition.id.trim() : '';
        const handler = definition?.handler;
        if (!id) {
            throw new Error('ExportManager.registerExport 需要合法的 id');
        }
        if (typeof handler !== 'function') {
            throw new Error(`导出 "${id}" 缺少 handler`);
        }

        exporters.set(id, {
            id,
            title: definition?.title || id,
            handler,
        });
        logger?.debug?.('export:registered', { id });

        return () => {
            exporters.delete(id);
            logger?.debug?.('export:unregistered', { id });
        };
    }

    /**
     * 执行指定导出。
     * @param {string} id - 导出 ID
     * @param {Object} payload - 导出输入
     * @returns {Promise<unknown>}
     */
    async function executeExport(id, payload = {}) {
        const normalizedId = typeof id === 'string' ? id.trim() : '';
        const entry = exporters.get(normalizedId);
        if (!entry) {
            throw new Error(`未注册导出能力: ${normalizedId || '<empty>'}`);
        }

        logger?.info?.('export:execute:start', { id: normalizedId, payload });
        traceRecorder?.record?.('export', 'execute:start', { id: normalizedId });

        try {
            const result = await entry.handler(payload);
            logger?.info?.('export:execute:done', { id: normalizedId });
            traceRecorder?.record?.('export', 'execute:done', { id: normalizedId });
            return result;
        } catch (error) {
            logger?.error?.('export:execute:failed', { id: normalizedId, payload, error });
            traceRecorder?.record?.('export', 'execute:failed', { id: normalizedId });
            throw error;
        }
    }

    return {
        registerExport,
        executeExport,
        hasExport(id) {
            return exporters.has(id);
        },
        listExports() {
            return Array.from(exporters.keys());
        },
    };
}
