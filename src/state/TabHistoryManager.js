/**
 * Tab 级共享历史管理器。
 * 同一个 tab 在不同编辑器视图之间共用一条 undo/redo 历史。
 */
export class TabHistoryManager {
    /**
     * @param {Object} options - 管理器选项
     * @param {number} [options.idleMergeMs=500]  - 空闲打断阈值：距离上次合并超过此时长即新建 entry
     * @param {number} [options.maxMergeMs=2000] - 单条 entry 累积合并上限，防止长时间连续输入挤进一条
     */
    constructor(options = {}) {
        this.idleMergeMs = Number.isFinite(options.idleMergeMs)
            ? Math.max(100, options.idleMergeMs)
            : 500;
        this.maxMergeMs = Number.isFinite(options.maxMergeMs)
            ? Math.max(this.idleMergeMs, options.maxMergeMs)
            : 2000;
        this.tabs = new Map();
    }

    /**
     * 确保 tab 已初始化为可跟踪状态。
     * @param {string} tabId - 标签页标识
     * @param {string} content - 当前内容
     * @param {Object} [options] - 同步选项
     * @param {boolean} [options.reset=false] - 是否重置历史为新基线
     * @param {Object|null} [options.selection=null] - 当前编辑器选区快照
     */
    syncContent(tabId, content, options = {}) {
        if (!tabId) return;
        const normalizedContent = typeof content === 'string' ? content : '';
        const selection = this._normalizeSelection(options?.selection);
        const reset = options?.reset === true;
        const existing = this.tabs.get(tabId);

        if (!existing || reset) {
            this.tabs.set(tabId, {
                entries: [this._createEntry(normalizedContent, 'load', Date.now(), selection)],
                index: 0,
            });
            return;
        }

        const currentEntry = existing.entries[existing.index];
        if (currentEntry?.content === normalizedContent) {
            // 同内容：仅作存在性确认，不刷新时间戳（避免污染合并窗口）
            return;
        }

        this._pushEntry(existing, normalizedContent, options?.source || 'sync', selection);
    }

    /**
     * 记录用户编辑产生的新内容。
     * @param {string} tabId - 标签页标识
     * @param {string} content - 编辑后的内容
     * @param {Object} [options] - 记录选项
     * @param {string} [options.source='unknown'] - 变更来源
     * @param {Object|null} [options.selection=null] - 变更后的编辑器选区快照
     */
    recordChange(tabId, content, options = {}) {
        if (!tabId) return;
        const normalizedContent = typeof content === 'string' ? content : '';
        const source = options?.source || 'unknown';
        const selection = this._normalizeSelection(options?.selection);
        const state = this.tabs.get(tabId);

        if (!state) {
            this.tabs.set(tabId, {
                entries: [this._createEntry(normalizedContent, source, Date.now(), selection)],
                index: 0,
            });
            return;
        }

        const currentEntry = state.entries[state.index];
        if (currentEntry?.content === normalizedContent) return;

        if (state.index < state.entries.length - 1) {
            state.entries.splice(state.index + 1);
        }

        const now = Date.now();
        if (this._shouldMerge(currentEntry, source, now)) {
            currentEntry.content = normalizedContent;
            currentEntry.selection = selection;
            currentEntry.lastChangeAt = now;
            return;
        }

        state.entries.push(this._createEntry(normalizedContent, source, now, selection));
        state.index = state.entries.length - 1;
    }

    /**
     * 更新当前历史项的选区，不创建新的 undo entry。
     * 这用于记录“编辑前用户把光标移动到了哪里”，让下一次 undo 能回到合理位置。
     * @param {string} tabId - 标签页标识
     * @param {Object|null} selection - 当前编辑器选区快照
     */
    updateSelection(tabId, selection) {
        if (!tabId) return;
        const state = this.tabs.get(tabId);
        if (!state) return;
        const currentEntry = state.entries[state.index];
        if (!currentEntry) return;
        currentEntry.selection = this._normalizeSelection(selection);
    }

    /**
     * 判断新变更是否应合并到当前 entry。
     *
     * 合并需同时满足：
     *   - 同一来源（markdown / code / sync）
     *   - 距离上次合并未超过 idleMergeMs（空闲窗口）
     *   - 距离 entry 创建时间未超过 maxMergeMs（累积上限）
     *   - 当前 entry 内容不以换行结尾（换行是强语义边界，下一次编辑作为新 entry）
     */
    _shouldMerge(currentEntry, source, now) {
        if (!currentEntry) return false;
        if (currentEntry.sealed) return false;
        if (currentEntry.source !== source) return false;
        const lastChangeAt = currentEntry.lastChangeAt ?? currentEntry.timestamp;
        if (now - lastChangeAt > this.idleMergeMs) return false;
        if (now - currentEntry.timestamp > this.maxMergeMs) return false;
        if (typeof currentEntry.content === 'string' && /\n$/.test(currentEntry.content)) return false;
        return true;
    }

    /**
     * 执行 undo，返回目标内容。
     * 停留点被封存（sealed），下一次编辑必然新建 entry，而不是合并。
     * @param {string} tabId - 标签页标识
     * @returns {Object|null} 撤销后的历史项
     */
    undo(tabId) {
        const state = this.tabs.get(tabId);
        if (!state || state.index <= 0) return null;
        state.index -= 1;
        const entry = state.entries[state.index];
        entry.sealed = true;
        return this._cloneEntry(entry);
    }

    /**
     * 执行 redo，返回目标内容。
     * @param {string} tabId - 标签页标识
     * @returns {Object|null} 重做后的历史项
     */
    redo(tabId) {
        const state = this.tabs.get(tabId);
        if (!state || state.index >= state.entries.length - 1) return null;
        state.index += 1;
        const entry = state.entries[state.index];
        entry.sealed = true;
        return this._cloneEntry(entry);
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
     * - timestamp：entry 创建时间（不会被合并刷新，用于判断累积窗口）
     * - lastChangeAt：最近一次合并时间（用于判断空闲窗口）
     * - sealed：是否为 undo/redo 的停留点（停留点不接受合并）
     * - selection：与 content 同步记录的编辑器选区快照
     */
    _createEntry(content, source, timestamp = Date.now(), selection = null) {
        return {
            content,
            source,
            selection: this._normalizeSelection(selection),
            timestamp,
            lastChangeAt: timestamp,
            sealed: false,
        };
    }

    /**
     * 直接向历史末尾压入新记录。
     * @param {Object} state - tab 历史状态
     * @param {string} content - 内容
     * @param {string} source - 来源
     * @param {Object|null} selection - 当前编辑器选区快照
     */
    _pushEntry(state, content, source, selection = null) {
        if (state.index < state.entries.length - 1) {
            state.entries.splice(state.index + 1);
        }
        state.entries.push(this._createEntry(content, source, Date.now(), selection));
        state.index = state.entries.length - 1;
    }

    /**
     * 克隆历史项，避免调用方误改内部历史状态。
     */
    _cloneEntry(entry, overrides = {}) {
        if (!entry) return null;
        return {
            content: entry.content,
            source: entry.source,
            selection: this._normalizeSelection(
                Object.prototype.hasOwnProperty.call(overrides, 'selection')
                    ? overrides.selection
                    : entry.selection
            ),
            timestamp: entry.timestamp,
            lastChangeAt: entry.lastChangeAt,
            sealed: Boolean(entry.sealed),
        };
    }

    /**
     * 归一化 selection，只保留可序列化的数字位置。
     */
    _normalizeSelection(selection) {
        if (!selection || typeof selection !== 'object') return null;
        const type = typeof selection.type === 'string' ? selection.type : null;
        if (type === 'markdown') {
            const from = Number(selection.from);
            const to = Number(selection.to);
            if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
            return { type, from, to };
        }
        if (type === 'code') {
            const anchor = Number(selection.anchor);
            const head = Number(selection.head);
            if (!Number.isFinite(anchor) || !Number.isFinite(head)) return null;
            return { type, anchor, head };
        }
        return null;
    }
}
