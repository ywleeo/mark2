import { appendLogEntries, getAppLogFilePath } from '../../api/filesystem.js';

/**
 * 文件日志本地开关键。
 * 默认启用；仅在显式写入 `0` 时关闭磁盘落盘。
 */
export const FILE_LOG_STORAGE_KEY = 'mark2_debug_file_logging';

const FLUSH_DELAY_MS = 300;
const MAX_BATCH_SIZE = 50;

/**
 * 判断值是否为纯对象。
 * @param {unknown} value - 待判断值
 * @returns {boolean}
 */
function isPlainObject(value) {
    return Object.prototype.toString.call(value) === '[object Object]';
}

/**
 * 将任意上下文裁剪为可序列化对象，避免循环引用或复杂实例导致日志写盘失败。
 * @param {unknown} value - 原始值
 * @param {WeakSet<object>} seen - 循环引用保护
 * @param {number} depth - 当前递归深度
 * @returns {unknown}
 */
function toSerializable(value, seen = new WeakSet(), depth = 0) {
    if (value === null || value === undefined) {
        return value ?? null;
    }
    if (depth >= 4) {
        return '[MaxDepth]';
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'bigint') {
        return value.toString();
    }
    if (value instanceof Error) {
        return {
            name: value.name,
            message: value.message,
            stack: value.stack,
        };
    }
    if (Array.isArray(value)) {
        return value.map(item => toSerializable(item, seen, depth + 1));
    }
    if (value instanceof Date) {
        return value.toISOString();
    }
    if (typeof value === 'object') {
        if (seen.has(value)) {
            return '[Circular]';
        }
        seen.add(value);
        if (isPlainObject(value)) {
            return Object.fromEntries(
                Object.entries(value).map(([key, item]) => [key, toSerializable(item, seen, depth + 1)])
            );
        }
        return {
            type: value.constructor?.name || 'Object',
            value: String(value),
        };
    }
    return String(value);
}

/**
 * 读取文件日志是否开启。
 * @returns {boolean}
 */
function isFileLoggingEnabled() {
    try {
        return localStorage.getItem(FILE_LOG_STORAGE_KEY) !== '0';
    } catch {
        return true;
    }
}

/**
 * 创建文件日志写入器。
 * 使用批量 flush 降低频繁 IPC 的成本。
 * @returns {{enqueue: Function, isEnabled: Function, getLogFilePath: Function}}
 */
export function createFileLogSink() {
    let queue = [];
    let flushTimer = null;
    let flushInFlight = null;
    let cachedLogFilePath = null;

    async function getLogFilePath() {
        if (cachedLogFilePath) {
            return cachedLogFilePath;
        }
        cachedLogFilePath = await getAppLogFilePath();
        return cachedLogFilePath;
    }

    async function flush() {
        if (flushInFlight || queue.length === 0 || !isFileLoggingEnabled()) {
            return flushInFlight;
        }

        const batch = queue.slice(0, MAX_BATCH_SIZE);
        queue = queue.slice(batch.length);

        flushInFlight = appendLogEntries(batch)
            .then((logFilePath) => {
                if (logFilePath) {
                    cachedLogFilePath = logFilePath;
                }
            })
            .catch(() => {})
            .finally(() => {
                flushInFlight = null;
                if (queue.length > 0) {
                    scheduleFlush(0);
                }
            });

        return flushInFlight;
    }

    /**
     * 安排下一次批量刷盘。
     * @param {number} delayMs - 延迟毫秒数
     */
    function scheduleFlush(delayMs = FLUSH_DELAY_MS) {
        if (flushTimer !== null) {
            return;
        }
        flushTimer = globalThis.setTimeout(() => {
            flushTimer = null;
            void flush();
        }, delayMs);
    }

    return {
        /**
         * 推入一条日志。
         * @param {Object} entry - 结构化日志条目
         * @param {{immediate?: boolean}} options - 写盘控制选项
         */
        enqueue(entry, options = {}) {
            const { immediate = false } = options;
            if (!isFileLoggingEnabled()) {
                return;
            }
            queue.push({
                ...entry,
                context: toSerializable(entry.context),
            });
            if (immediate || queue.length >= MAX_BATCH_SIZE) {
                scheduleFlush(0);
                return;
            }
            scheduleFlush();
        },
        isEnabled: isFileLoggingEnabled,
        getLogFilePath,
    };
}
