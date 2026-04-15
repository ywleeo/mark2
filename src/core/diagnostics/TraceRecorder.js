/**
 * 最小 Trace 记录器。
 * 用于阶段 0/1 追踪关键链路，后续可以扩展为更完整的状态快照系统。
 */

import { createStore } from '../../services/storage.js';

const store = createStore('diagnostics');
store.migrateFrom('mark2_trace_enabled', 'traceEnabled', { parse: (raw) => raw === '1' });

const TRACE_LIMIT = 200;

/**
 * 创建 TraceRecorder 实例。
 * @returns {{record: Function, getRecords: Function, clear: Function, isEnabled: Function}}
 */
export function createTraceRecorder() {
    const records = [];

    const isEnabled = () => Boolean(store.get('traceEnabled', false));

    return {
        /**
         * 记录一条 trace 事件。
         * @param {string} domain - 事件域
         * @param {string} event - 事件名
         * @param {Object} payload - 事件载荷
         */
        record(domain, event, payload = {}) {
            if (!isEnabled()) {
                return;
            }
            records.push({
                at: Date.now(),
                domain,
                event,
                payload,
            });
            if (records.length > TRACE_LIMIT) {
                records.shift();
            }
        },

        /**
         * 获取当前内存中的 trace 记录。
         * @returns {Array<Object>}
         */
        getRecords() {
            return [...records];
        },

        /**
         * 清空 trace 记录。
         */
        clear() {
            records.length = 0;
        },

        isEnabled,
    };
}
