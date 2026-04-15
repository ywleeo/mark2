/**
 * 统一日志器。
 * 通过本地存储控制日志级别和域过滤，避免在业务代码里散落 console 调用约定。
 * 当前阶段默认只写文件，不向控制台输出，便于用日志文件验收重构链路。
 */

import { createFileLogSink } from './FileLogSink.js';
import { createStore } from '../../services/storage.js';

const store = createStore('diagnostics');
store.migrateFrom('mark2_debug_log_level', 'logLevel', { parse: 'raw' });
store.migrateFrom('mark2_debug_domains', 'logDomains', { parse: 'raw' });

const LOG_LEVELS = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
};

const fileLogSink = createFileLogSink();

/**
 * 读取当前日志级别。
 * @returns {'debug'|'info'|'warn'|'error'}
 */
function getConfiguredLevel() {
    const value = store.get('logLevel');
    if (value && Object.prototype.hasOwnProperty.call(LOG_LEVELS, value)) {
        return value;
    }
    return 'info';
}

/**
 * 读取允许输出的日志域。
 * @returns {Set<string>|null}
 */
function getConfiguredDomains() {
    const value = store.get('logDomains');
    if (!value) return null;
    const domains = String(value)
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
    return domains.length > 0 ? new Set(domains) : null;
}

/**
 * 判断指定日志域和级别是否应输出。
 * @param {string} domain - 日志域
 * @param {'debug'|'info'|'warn'|'error'} level - 日志级别
 * @returns {boolean}
 */
function shouldLog(domain, level) {
    const currentLevel = LOG_LEVELS[getConfiguredLevel()] ?? LOG_LEVELS.info;
    const targetLevel = LOG_LEVELS[level] ?? LOG_LEVELS.info;
    if (targetLevel < currentLevel) {
        return false;
    }

    const domains = getConfiguredDomains();
    if (!domains || domains.size === 0) {
        return true;
    }
    return domains.has(domain);
}

/**
 * 归一化日志参数，收敛成适合写盘的 message/context 结构。
 * @param {Array<unknown>} args - 原始日志参数
 * @returns {{message: string, context: unknown}}
 */
function normalizeLogPayload(args) {
    if (!Array.isArray(args) || args.length === 0) {
        return {
            message: '',
            context: null,
        };
    }

    const [first, ...rest] = args;
    if (typeof first === 'string') {
        return {
            message: first,
            context: rest.length <= 1 ? (rest[0] ?? null) : rest,
        };
    }

    return {
        message: '',
        context: args.length === 1 ? first : args,
    };
}

/**
 * 创建具备域前缀的日志器。
 * @param {string} domain - 日志域名称
 * @returns {{debug: Function, info: Function, warn: Function, error: Function}}
 */
export function createLogger(domain) {
    const safeDomain = typeof domain === 'string' && domain.trim()
        ? domain.trim()
        : 'app';

    const log = (level, ...args) => {
        if (!shouldLog(safeDomain, level)) {
            return;
        }

        const { message, context } = normalizeLogPayload(args);
        fileLogSink.enqueue({
            ts: new Date().toISOString(),
            domain: safeDomain,
            level,
            message,
            context,
        }, {
            immediate: level === 'warn' || level === 'error',
        });
    };

    return {
        debug: (...args) => log('debug', ...args),
        info: (...args) => log('info', ...args),
        warn: (...args) => log('warn', ...args),
        error: (...args) => log('error', ...args),
    };
}

/**
 * 暴露日志文件状态，便于调试界面或手工排查读取。
 * @returns {{isFileLoggingEnabled: Function, getLogFilePath: Function}}
 */
export function getLoggerDiagnostics() {
    return {
        isFileLoggingEnabled: () => fileLogSink.isEnabled(),
        getLogFilePath: () => fileLogSink.getLogFilePath(),
    };
}
