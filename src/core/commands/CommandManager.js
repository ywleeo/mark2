/**
 * 命令管理器。
 * 负责注册和执行命令，不持有业务状态本身，只做分发、日志和 trace。
 */

/**
 * 创建命令管理器。
 * @param {{logger?: Object, traceRecorder?: Object}} options - 调试依赖
 * @returns {{registerCommand: Function, executeCommand: Function, hasCommand: Function, listCommands: Function}}
 */
export function createCommandManager(options = {}) {
    const { logger, traceRecorder } = options;
    const commands = new Map();

    /**
     * 注册命令。
     * @param {{id: string, handler: Function, title?: string}} definition - 命令定义
     * @returns {Function}
     */
    function registerCommand(definition) {
        const id = typeof definition?.id === 'string' ? definition.id.trim() : '';
        const handler = definition?.handler;
        if (!id) {
            throw new Error('CommandManager.registerCommand 需要合法的 id');
        }
        if (typeof handler !== 'function') {
            throw new Error(`命令 "${id}" 缺少 handler`);
        }

        commands.set(id, {
            id,
            title: definition?.title || id,
            handler,
        });

        logger?.debug?.('command:registered', { id });

        return () => {
            commands.delete(id);
            logger?.debug?.('command:unregistered', { id });
        };
    }

    /**
     * 执行指定命令。
     * @param {string} id - 命令 ID
     * @param {Object} payload - 命令输入
     * @param {Object} context - 执行上下文
     * @returns {Promise<unknown>}
     */
    async function executeCommand(id, payload = {}, context = {}) {
        const normalizedId = typeof id === 'string' ? id.trim() : '';
        const entry = commands.get(normalizedId);
        if (!entry) {
            const error = new Error(`未注册命令: ${normalizedId || '<empty>'}`);
            logger?.error?.('command:missing', { id: normalizedId, payload, context, error });
            throw error;
        }

        logger?.info?.('command:execute:start', {
            id: normalizedId,
            payload,
            source: context?.source || 'unknown',
        });
        traceRecorder?.record?.('commands', 'execute:start', {
            id: normalizedId,
            source: context?.source || 'unknown',
        });

        try {
            const result = await entry.handler(payload, context);
            logger?.info?.('command:execute:done', {
                id: normalizedId,
                source: context?.source || 'unknown',
            });
            traceRecorder?.record?.('commands', 'execute:done', {
                id: normalizedId,
                source: context?.source || 'unknown',
            });
            return result;
        } catch (error) {
            logger?.error?.('command:execute:failed', {
                id: normalizedId,
                payload,
                source: context?.source || 'unknown',
                error,
            });
            traceRecorder?.record?.('commands', 'execute:failed', {
                id: normalizedId,
                source: context?.source || 'unknown',
            });
            throw error;
        }
    }

    return {
        registerCommand,
        executeCommand,
        hasCommand(id) {
            return commands.has(id);
        },
        listCommands() {
            return Array.from(commands.keys());
        },
    };
}
