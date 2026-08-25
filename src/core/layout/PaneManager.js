/**
 * 文档栏标识。
 * 主栏承接现有标签与文件树导航，副栏只承载一个对比文档。
 */
export const PANE_IDS = Object.freeze({
    PRIMARY: 'primary',
    SECONDARY: 'secondary',
});

/**
 * 工作区内容布局模式。
 * 项目只支持单栏与左右双栏，不引入布局方向抽象。
 */
export const PANE_LAYOUT_MODES = Object.freeze({
    SINGLE: 'single',
    DUAL: 'dual',
});

export const DEFAULT_SPLIT_RATIO = 0.5;
export const MIN_SPLIT_RATIO = 0.25;
export const MAX_SPLIT_RATIO = 0.75;

/**
 * 将分栏比例限制在产品允许的范围内。
 * @param {unknown} value - 外部传入的比例。
 * @returns {number} 可安全用于布局的比例。
 */
function normalizeSplitRatio(value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
        return DEFAULT_SPLIT_RATIO;
    }
    return Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, numericValue));
}

/**
 * 规范化可选的文档路径。
 * @param {unknown} value - 原始路径。
 * @returns {string|null} 规范化后的路径。
 */
function normalizeDocumentPath(value) {
    if (typeof value !== 'string') {
        return null;
    }
    const normalized = value.trim();
    return normalized || null;
}

/**
 * 创建一份不会暴露内部引用的 Pane 快照。
 * @param {Object} state - PaneManager 内部状态。
 * @returns {Object} 只读语义的普通对象快照。
 */
function createSnapshot(state) {
    return {
        mode: state.mode,
        focusedPaneId: state.focusedPaneId,
        splitRatio: state.splitRatio,
        panes: {
            primary: { ...state.panes.primary },
            secondary: { ...state.panes.secondary },
        },
    };
}

/**
 * 判断两个 Pane 快照是否一致，避免无变化时广播事件。
 * @param {Object} left - 旧快照。
 * @param {Object} right - 新快照。
 * @returns {boolean} 是否完全一致。
 */
function areSnapshotsEqual(left, right) {
    return left.mode === right.mode
        && left.focusedPaneId === right.focusedPaneId
        && left.splitRatio === right.splitRatio
        && left.panes.primary.documentPath === right.panes.primary.documentPath
        && left.panes.primary.viewMode === right.panes.primary.viewMode
        && left.panes.secondary.documentPath === right.panes.secondary.documentPath
        && left.panes.secondary.viewMode === right.panes.secondary.viewMode;
}

/**
 * 创建左右文档栏状态管理器。
 *
 * PaneManager 只管理布局与文档分配，不创建 DOM、不加载文件，也不持有编辑器实例。
 * 所有涉及保存确认、文档加载和视图激活的事务均由上层 PaneCoordinator 承接。
 * @param {{logger?:Object}} options - 可选依赖。
 * @returns {Object} PaneManager 公共 API。
 */
export function createPaneManager({ logger } = {}) {
    const listeners = new Set();
    const state = {
        mode: PANE_LAYOUT_MODES.SINGLE,
        focusedPaneId: PANE_IDS.PRIMARY,
        splitRatio: DEFAULT_SPLIT_RATIO,
        panes: {
            primary: {
                documentPath: null,
                viewMode: null,
            },
            secondary: {
                documentPath: null,
                viewMode: null,
            },
        },
    };

    /**
     * 广播一次有实际变化的状态提交。
     * @param {string} type - 变化类型。
     * @param {Object} previous - 提交前快照。
     * @param {Object} [details] - 事件补充信息。
     * @returns {boolean} 是否发生了状态变化。
     */
    function commit(type, previous, details = {}) {
        const snapshot = createSnapshot(state);
        if (areSnapshotsEqual(previous, snapshot)) {
            return false;
        }
        logger?.info?.(`pane:${type}`, {
            mode: snapshot.mode,
            focusedPaneId: snapshot.focusedPaneId,
            primaryPath: snapshot.panes.primary.documentPath,
            secondaryPath: snapshot.panes.secondary.documentPath,
            splitRatio: snapshot.splitRatio,
            ...details,
        });
        const event = { type, snapshot, ...details };
        for (const listener of Array.from(listeners)) {
            try {
                listener(event);
            } catch (error) {
                logger?.warn?.('PaneManager listener error', error);
            }
        }
        return true;
    }

    /**
     * 返回指定栏的状态副本。
     * @param {'primary'|'secondary'} paneId - 栏标识。
     * @returns {Object|null} 栏状态。
     */
    function getPane(paneId) {
        const pane = state.panes[paneId];
        return pane ? { ...pane, id: paneId } : null;
    }

    return {
        /** @returns {Object} 当前完整快照。 */
        getSnapshot() {
            return createSnapshot(state);
        },

        /** @returns {Object} 主栏状态。 */
        getPrimaryPane() {
            return getPane(PANE_IDS.PRIMARY);
        },

        /** @returns {Object} 副栏状态。 */
        getSecondaryPane() {
            return getPane(PANE_IDS.SECONDARY);
        },

        /** @returns {Object} 当前获得焦点的栏状态。 */
        getFocusedPane() {
            return getPane(state.focusedPaneId);
        },

        /** @returns {'single'|'dual'} 当前布局模式。 */
        getMode() {
            return state.mode;
        },

        /** @returns {number} 当前主栏宽度比例。 */
        getSplitRatio() {
            return state.splitRatio;
        },

        /**
         * 同步由标签系统选中的主栏文档。
         * @param {string|null} documentPath - 主栏文档路径。
         * @param {{viewMode?:string|null}} options - 文档展示信息。
         * @returns {boolean} 是否发生变化。
         */
        syncPrimaryDocument(documentPath, options = {}) {
            const previous = createSnapshot(state);
            state.panes.primary.documentPath = normalizeDocumentPath(documentPath);
            if (Object.prototype.hasOwnProperty.call(options, 'viewMode')) {
                state.panes.primary.viewMode = options.viewMode || null;
            }
            return commit('primary-document', previous, {
                paneId: PANE_IDS.PRIMARY,
                documentPath: state.panes.primary.documentPath,
            });
        },

        /**
         * 打开副栏并分配文档；主副栏可共享同一路径的 DocumentModel。
         * @param {string} documentPath - 副栏文档路径。
         * @param {{viewMode?:string|null,focus?:boolean}} options - 打开选项。
         * @returns {{opened:boolean,reason?:string}} 打开结果。
         */
        openSecondary(documentPath, options = {}) {
            const normalizedPath = normalizeDocumentPath(documentPath);
            if (!normalizedPath) {
                return { opened: false, reason: 'invalid-path' };
            }
            const previous = createSnapshot(state);
            state.mode = PANE_LAYOUT_MODES.DUAL;
            state.panes.secondary.documentPath = normalizedPath;
            state.panes.secondary.viewMode = options.viewMode || null;
            if (options.focus !== false) {
                state.focusedPaneId = PANE_IDS.SECONDARY;
            }
            commit('secondary-open', previous, {
                paneId: PANE_IDS.SECONDARY,
                documentPath: normalizedPath,
            });
            return { opened: true };
        },

        /**
         * 关闭副栏并把焦点还给主栏。
         * 保存确认必须在调用本方法前由上层完成。
         * @returns {boolean} 是否发生变化。
         */
        closeSecondary() {
            const previous = createSnapshot(state);
            state.mode = PANE_LAYOUT_MODES.SINGLE;
            state.focusedPaneId = PANE_IDS.PRIMARY;
            state.panes.secondary.documentPath = null;
            state.panes.secondary.viewMode = null;
            return commit('secondary-close', previous, { paneId: PANE_IDS.SECONDARY });
        },

        /**
         * 切换当前命令和工具栏的目标栏。
         * @param {'primary'|'secondary'} paneId - 目标栏。
         * @returns {boolean} 是否成功切换。
         */
        focusPane(paneId) {
            if (!state.panes[paneId]) {
                return false;
            }
            if (paneId === PANE_IDS.SECONDARY
                && (state.mode !== PANE_LAYOUT_MODES.DUAL || !state.panes.secondary.documentPath)) {
                return false;
            }
            const previous = createSnapshot(state);
            state.focusedPaneId = paneId;
            return commit('focus', previous, { paneId });
        },

        /**
         * 更新指定栏当前使用的视图模式。
         * @param {'primary'|'secondary'} paneId - 目标栏。
         * @param {string|null} viewMode - 新视图模式。
         * @returns {boolean} 是否发生变化。
         */
        setPaneViewMode(paneId, viewMode) {
            if (!state.panes[paneId]) {
                return false;
            }
            const previous = createSnapshot(state);
            state.panes[paneId].viewMode = viewMode || null;
            return commit('view-mode', previous, { paneId, viewMode: viewMode || null });
        },

        /**
         * 更新主栏宽度比例。
         * @param {number} ratio - 主栏占内容区宽度的比例。
         * @returns {boolean} 是否发生变化。
         */
        setSplitRatio(ratio) {
            const previous = createSnapshot(state);
            state.splitRatio = normalizeSplitRatio(ratio);
            return commit('split-ratio', previous, { splitRatio: state.splitRatio });
        },

        /**
         * 从工作区快照恢复固定左右布局。
         * 恢复后始终聚焦主栏，避免启动时命令意外作用于副栏。
         * @param {Object|null} layout - 已规范化的布局快照。
         * @returns {boolean} 是否发生变化。
         */
        restoreLayout(layout) {
            const previous = createSnapshot(state);
            const secondaryPath = normalizeDocumentPath(layout?.secondaryDocumentPath);
            const canRestoreDual = layout?.mode === PANE_LAYOUT_MODES.DUAL
                && secondaryPath;

            state.splitRatio = normalizeSplitRatio(layout?.splitRatio);
            state.focusedPaneId = PANE_IDS.PRIMARY;
            state.mode = canRestoreDual ? PANE_LAYOUT_MODES.DUAL : PANE_LAYOUT_MODES.SINGLE;
            state.panes.secondary.documentPath = canRestoreDual ? secondaryPath : null;
            state.panes.secondary.viewMode = canRestoreDual
                ? (layout?.secondaryViewMode || null)
                : null;
            return commit('restore', previous);
        },

        /**
         * 迁移两栏内引用的文档路径。
         * @param {string} oldPath - 原路径。
         * @param {string} newPath - 新路径。
         * @returns {boolean} 是否发生变化。
         */
        renameDocumentPath(oldPath, newPath) {
            const normalizedOld = normalizeDocumentPath(oldPath);
            const normalizedNew = normalizeDocumentPath(newPath);
            if (!normalizedOld || !normalizedNew || normalizedOld === normalizedNew) {
                return false;
            }
            const previous = createSnapshot(state);
            for (const pane of Object.values(state.panes)) {
                if (pane.documentPath === normalizedOld) {
                    pane.documentPath = normalizedNew;
                }
            }
            return commit('document-rename', previous, { oldPath: normalizedOld, newPath: normalizedNew });
        },

        /**
         * 订阅 Pane 状态变化。
         * @param {(event:Object)=>void} listener - 监听函数。
         * @returns {Function} 取消订阅函数。
         */
        subscribe(listener) {
            if (typeof listener !== 'function') {
                return () => {};
            }
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
}
