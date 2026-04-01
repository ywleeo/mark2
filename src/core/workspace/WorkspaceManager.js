/**
 * Workspace 管理器。
 * 负责维护工作区导航快照真源，并统一处理持久化。
 */

/**
 * 创建 Workspace 管理器。
 * @param {{createDefaultWorkspaceState: Function, loadWorkspaceState: Function, saveWorkspaceState: Function, logger?: Object, traceRecorder?: Object}} options - 初始化参数
 * @returns {{getState: Function, getSnapshot: Function, setState: Function, updateState: Function, persistWorkspaceState: Function, handleSidebarStateChange: Function, loadPersistedState: Function, setRestoring: Function, isRestoring: Function}}
 */
export function createWorkspaceManager(options = {}) {
    const {
        createDefaultWorkspaceState,
        loadWorkspaceState,
        saveWorkspaceState,
        logger,
        traceRecorder,
    } = options;

    if (typeof createDefaultWorkspaceState !== 'function') {
        throw new Error('WorkspaceManager 需要 createDefaultWorkspaceState');
    }
    if (typeof loadWorkspaceState !== 'function') {
        throw new Error('WorkspaceManager 需要 loadWorkspaceState');
    }
    if (typeof saveWorkspaceState !== 'function') {
        throw new Error('WorkspaceManager 需要 saveWorkspaceState');
    }

    let state = createDefaultWorkspaceState();
    let restoring = false;
    let lastPersistedSnapshot = null;

    /**
     * 判断两个数组是否按顺序完全相等。
     * @param {Array} left - 左侧数组
     * @param {Array} right - 右侧数组
     * @returns {boolean}
     */
    function areArraysEqual(left = [], right = []) {
        if (left === right) {
            return true;
        }
        if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
            return false;
        }
        return left.every((item, index) => item === right[index]);
    }

    /**
     * 判断两个对象的键值是否完全相等。
     * @param {Object|null|undefined} left - 左侧对象
     * @param {Object|null|undefined} right - 右侧对象
     * @returns {boolean}
     */
    function arePlainObjectsEqual(left, right) {
        if (left === right) {
            return true;
        }
        const leftValue = left && typeof left === 'object' ? left : {};
        const rightValue = right && typeof right === 'object' ? right : {};
        const leftKeys = Object.keys(leftValue);
        const rightKeys = Object.keys(rightValue);
        if (leftKeys.length !== rightKeys.length) {
            return false;
        }
        return leftKeys.every((key) => leftValue[key] === rightValue[key]);
    }

    /**
     * 判断两个 untitled tab 快照是否相等。
     * @param {Array} left - 左侧 untitled 快照
     * @param {Array} right - 右侧 untitled 快照
     * @returns {boolean}
     */
    function areUntitledTabsEqual(left = [], right = []) {
        if (left === right) {
            return true;
        }
        if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
            return false;
        }
        return left.every((tab, index) => {
            const nextTab = right[index];
            return Boolean(nextTab)
                && tab?.path === nextTab.path
                && tab?.label === nextTab.label
                && tab?.content === nextTab.content
                && Boolean(tab?.hasChanges) === Boolean(nextTab.hasChanges);
        });
    }

    /**
     * 判断两个工作区快照是否在语义上等价。
     * @param {Object|null|undefined} left - 左侧快照
     * @param {Object|null|undefined} right - 右侧快照
     * @returns {boolean}
     */
    function areWorkspaceSnapshotsEqual(left, right) {
        if (left === right) {
            return true;
        }
        if (!left || !right) {
            return false;
        }

        return left.currentFile === right.currentFile
            && left.sharedTabPath === right.sharedTabPath
            && areArraysEqual(left.openFiles, right.openFiles)
            && areUntitledTabsEqual(left.untitledTabs, right.untitledTabs)
            && areArraysEqual(left.sidebar?.rootPaths, right.sidebar?.rootPaths)
            && areArraysEqual(left.sidebar?.expandedFolders, right.sidebar?.expandedFolders)
            && arePlainObjectsEqual(left.sidebar?.sectionStates, right.sidebar?.sectionStates);
    }

    /**
     * 读取当前工作区状态。
     * @returns {Object}
     */
    function getState() {
        return state;
    }

    /**
     * 返回当前工作区快照副本，避免外部直接修改内部对象。
     * @returns {Object}
     */
    function getSnapshot() {
        return {
            ...state,
            sidebar: state?.sidebar
                ? {
                    ...state.sidebar,
                    sectionStates: { ...(state.sidebar.sectionStates || {}) },
                }
                : null,
            openFiles: Array.isArray(state?.openFiles) ? [...state.openFiles] : [],
            untitledTabs: Array.isArray(state?.untitledTabs) ? [...state.untitledTabs] : [],
        };
    }

    /**
     * 用完整状态替换当前工作区快照。
     * @param {Object} nextState - 新工作区状态
     * @returns {Object}
     */
    function setState(nextState) {
        const snapshotBeforeUpdate = getSnapshot();
        state = nextState || createDefaultWorkspaceState();
        const snapshotAfterUpdate = getSnapshot();

        if (!areWorkspaceSnapshotsEqual(snapshotBeforeUpdate, snapshotAfterUpdate)) {
            logger?.debug?.('workspace:setState', {
                currentFile: state?.currentFile || null,
                openFiles: Array.isArray(state?.openFiles) ? state.openFiles.length : 0,
                rootPaths: Array.isArray(state?.sidebar?.rootPaths) ? state.sidebar.rootPaths.length : 0,
            });
        }
        return snapshotAfterUpdate;
    }

    /**
     * 增量更新当前工作区状态。
     * @param {Object} patch - 状态补丁
     * @returns {Object}
     */
    function updateState(patch = {}) {
        const currentState = getSnapshot();
        const nextSidebarPatch = patch?.sidebar && typeof patch.sidebar === 'object'
            ? {
                ...currentState.sidebar,
                ...patch.sidebar,
                sectionStates: {
                    ...(currentState.sidebar?.sectionStates || {}),
                    ...(patch.sidebar.sectionStates || {}),
                },
            }
            : currentState.sidebar;

        return setState({
            ...currentState,
            ...patch,
            sidebar: nextSidebarPatch,
        });
    }

    /**
     * 将当前或指定快照持久化到本地存储。
     * @param {Object} overrides - 覆盖写入的工作区状态
     * @param {{force?: boolean}} persistOptions - 持久化选项
     * @returns {Object}
     */
    function persistWorkspaceState(overrides = {}, persistOptions = {}) {
        const forcePersist = persistOptions.force === true;
        if (restoring && !forcePersist) {
            return getSnapshot();
        }

        const nextState = updateState(overrides);
        if (!forcePersist && areWorkspaceSnapshotsEqual(lastPersistedSnapshot, nextState)) {
            logger?.debug?.('workspace:persist:skip', {
                reason: 'unchanged-snapshot',
                currentFile: nextState.currentFile || null,
                openFiles: Array.isArray(nextState.openFiles) ? nextState.openFiles.length : 0,
            });
            return nextState;
        }

        saveWorkspaceState(nextState);
        lastPersistedSnapshot = nextState;
        logger?.info?.('workspace:persist', {
            currentFile: nextState.currentFile || null,
            openFiles: Array.isArray(nextState.openFiles) ? nextState.openFiles.length : 0,
            sharedTabPath: nextState.sharedTabPath || null,
        });
        traceRecorder?.record?.('workspace', 'persist', {
            currentFile: nextState.currentFile || null,
        });
        return nextState;
    }

    /**
     * 处理侧边栏状态变更。
     * @param {Object} sidebarState - 侧边栏快照
     * @returns {Object}
     */
    function handleSidebarStateChange(sidebarState) {
        if (restoring) {
            return getSnapshot();
        }
        return persistWorkspaceState({ sidebar: sidebarState });
    }

    /**
     * 从持久化存储恢复工作区状态到真源。
     * @returns {Object}
     */
    function loadPersistedState() {
        const stored = loadWorkspaceState();
        const snapshot = setState(stored || createDefaultWorkspaceState());
        lastPersistedSnapshot = snapshot;
        return snapshot;
    }

    return {
        getState,
        getSnapshot,
        setState,
        updateState,
        persistWorkspaceState,
        handleSidebarStateChange,
        loadPersistedState,
        setRestoring(value) {
            restoring = Boolean(value);
        },
        isRestoring() {
            return restoring;
        },
    };
}
