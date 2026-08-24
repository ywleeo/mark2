/**
 * 文档栏 Runtime 注册表。
 * 将每栏的编辑器、视图模式和会话封装在 Pane 作用域，避免副栏实例污染全局 EditorRegistry。
 */
export class PaneRuntimeRegistry {
    constructor() {
        this.runtimes = new Map();
    }

    /**
     * 注册一个 Pane Runtime。
     * @param {'primary'|'secondary'} paneId - Pane 标识。
     * @param {Object} runtime - Runtime 实例或适配器。
     */
    register(paneId, runtime) {
        if (!paneId || !runtime) {
            throw new Error('PaneRuntimeRegistry.register 需要 paneId 与 runtime');
        }
        this.runtimes.set(paneId, runtime);
    }

    /**
     * 返回指定 Pane Runtime。
     * @param {'primary'|'secondary'} paneId - Pane 标识。
     * @returns {Object|null} Runtime。
     */
    get(paneId) {
        return this.runtimes.get(paneId) || null;
    }

    /**
     * 注销一个 Pane Runtime。
     * @param {'primary'|'secondary'} paneId - Pane 标识。
     * @returns {boolean} 是否存在并成功删除。
     */
    unregister(paneId) {
        return this.runtimes.delete(paneId);
    }

    /**
     * 销毁并移除全部 Runtime。
     */
    destroyAll() {
        for (const runtime of this.runtimes.values()) {
            runtime?.destroy?.();
        }
        this.runtimes.clear();
    }
}
