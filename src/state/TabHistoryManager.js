/**
 * Tab 级共享历史管理器。
 * 同一个 tab 在不同编辑器视图之间共用一条 undo/redo 历史。
 */
export class TabHistoryManager {
    /**
     * @param {Object} options - 管理器选项
     * @param {number} [options.mergeWindowMs=700] - 同一来源历史的合并窗口
     */
    constructor(options = {}) {
        this.mergeWindowMs = Number.isFinite(options.mergeWindowMs)
            ? Math.max(100, options.mergeWindowMs)
            : 700;
        this.tabs = new Map();
    }

    /**
     * 确保 tab 已初始化为可跟踪状态。
     * @param {string} tabId - 标签页标识
     * @param {string} content - 当前内容
     * @param {Object} [options] - 同步选项
     * @param {boolean} [options.reset=false] - 是否重置历史为新基线
     */
    syncContent(tabId, content, options = {}) {
        if (!tabId) return;
        const normalizedContent = typeof content === 'string' ? content : '';
        const reset = options?.reset === true;
        const existing = this.tabs.get(tabId);

        if (!existing || reset) {
            this.tabs.set(tabId, {
                entries: [this._createEntry(normalizedContent, 'load')],
                index: 0,
            });
            return;
        }

        const currentEntry = existing.entries[existing.index];
        if (currentEntry?.content === normalizedContent) {
            currentEntry.timestamp = Date.now();
            return;
        }

        this._pushEntry(existing, normalizedContent, options?.source || 'sync');
    }

    /**
     * 记录用户编辑产生的新内容。
     * @param {string} tabId - 标签页标识
     * @param {string} content - 编辑后的内容
     * @param {Object} [options] - 记录选项
     * @param {string} [options.source='unknown'] - 变更来源
     */
    recordChange(tabId, content, options = {}) {
        if (!tabId) return;
        const normalizedContent = typeof content === 'string' ? content : '';
        const source = options?.source || 'unknown';
        const state = this.tabs.get(tabId);

        if (!state) {
            this.tabs.set(tabId, {
                entries: [this._createEntry(normalizedContent, source)],
                index: 0,
            });
            return;
        }

        const currentEntry = state.entries[state.index];
        if (currentEntry?.content === normalizedContent) {
            currentEntry.timestamp = Date.now();
            return;
        }

        if (state.index < state.entries.length - 1) {
            state.entries.splice(state.index + 1);
        }

        const now = Date.now();
        if (currentEntry && currentEntry.source === source && (now - currentEntry.timestamp) <= this.mergeWindowMs) {
            currentEntry.content = normalizedContent;
            currentEntry.timestamp = now;
            return;
        }

        state.entries.push(this._createEntry(normalizedContent, source, now));
        state.index = state.entries.length - 1;
    }

    /**
     * 执行 undo，返回目标内容。
     * @param {string} tabId - 标签页标识
     * @returns {string|null} 撤销后的内容
     */
    undo(tabId) {
        const state = this.tabs.get(tabId);
        if (!state || state.index <= 0) return null;
        state.index -= 1;
        state.entries[state.index].timestamp = Date.now();
        return state.entries[state.index].content;
    }

    /**
     * 执行 redo，返回目标内容。
     * @param {string} tabId - 标签页标识
     * @returns {string|null} 重做后的内容
     */
    redo(tabId) {
        const state = this.tabs.get(tabId);
        if (!state || state.index >= state.entries.length - 1) return null;
        state.index += 1;
        state.entries[state.index].timestamp = Date.now();
        return state.entries[state.index].content;
    }

    /**
     * 重命名 tab 历史。
     * @param {string} oldTabId - 旧标签页标识
     * @param {string} newTabId - 新标签页标识
     */
    renameTab(oldTabId, newTabId) {
        if (!oldTabId || !newTabId || oldTabId === newTabId) return;
        const state = this.tabs.get(oldTabId);
        if (!state) return;
        this.tabs.delete(oldTabId);
        this.tabs.set(newTabId, state);
    }

    /**
     * 清理指定 tab 的历史。
     * @param {string} tabId - 标签页标识
     */
    forgetTab(tabId) {
        if (!tabId) return;
        this.tabs.delete(tabId);
    }

    /**
     * 返回指定 tab 当前历史项内容。
     * @param {string} tabId - 标签页标识
     * @returns {string|null} 当前内容
     */
    getCurrentContent(tabId) {
        const state = this.tabs.get(tabId);
        if (!state) return null;
        return state.entries[state.index]?.content ?? null;
    }

    /**
     * 判断 tab 是否可撤销。
     * @param {string} tabId - 标签页标识
     * @returns {boolean} 是否可撤销
     */
    canUndo(tabId) {
        const state = this.tabs.get(tabId);
        return Boolean(state && state.index > 0);
    }

    /**
     * 判断 tab 是否可重做。
     * @param {string} tabId - 标签页标识
     * @returns {boolean} 是否可重做
     */
    canRedo(tabId) {
        const state = this.tabs.get(tabId);
        return Boolean(state && state.index < state.entries.length - 1);
    }

    /**
     * 创建历史记录项。
     * @param {string} content - 内容
     * @param {string} source - 来源
     * @param {number} [timestamp=Date.now()] - 时间戳
     * @returns {{content: string, source: string, timestamp: number}} 历史项
     */
    _createEntry(content, source, timestamp = Date.now()) {
        return {
            content,
            source,
            timestamp,
        };
    }

    /**
     * 直接向历史末尾压入新记录。
     * @param {Object} state - tab 历史状态
     * @param {string} content - 内容
     * @param {string} source - 来源
     */
    _pushEntry(state, content, source) {
        if (state.index < state.entries.length - 1) {
            state.entries.splice(state.index + 1);
        }
        state.entries.push(this._createEntry(content, source));
        state.index = state.entries.length - 1;
    }
}
