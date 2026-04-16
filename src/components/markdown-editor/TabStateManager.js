/**
 * Tab 视图状态管理器
 * 保存和恢复每个 tab 的编辑器状态（含撤销历史、滚动位置）
 */
export class TabStateManager {
    /**
     * @param {Object} opts
     * @param {() => import('@tiptap/core').Editor} opts.getEditor
     * @param {() => Element} opts.getScrollContainer
     * @param {() => string} opts.getCurrentMarkdown
     * @param {() => string} opts.getOriginalMarkdown
     * @param {(v: string) => void} opts.setOriginalMarkdown
     * @param {(v: boolean) => void} opts.setContentChanged
     */
    constructor({
        getEditor,
        getScrollContainer,
        getCurrentMarkdown,
        getOriginalMarkdown,
        setOriginalMarkdown,
        setContentChanged,
    }) {
        this._getEditor = getEditor;
        this._getScrollContainer = getScrollContainer;
        this._getCurrentMarkdown = getCurrentMarkdown;
        this._getOriginalMarkdown = getOriginalMarkdown;
        this._setOriginalMarkdown = setOriginalMarkdown;
        this._setContentChanged = setContentChanged;
        this._states = new Map();
    }

    has(tabId) {
        return !!tabId && this._states.has(tabId);
    }

    save(tabId) {
        const editor = this._getEditor();
        if (!tabId || !editor) return;

        const scrollContainer = this._getScrollContainer();
        this._states.set(tabId, {
            editorState: editor.state,
            currentMarkdown: this._getCurrentMarkdown(),
            originalMarkdown: this._getOriginalMarkdown(),
            contentChanged: this._getCurrentMarkdown() !== this._getOriginalMarkdown(),
            scrollTop: scrollContainer?.scrollTop ?? 0,
            lastActive: Date.now(),
        });
    }

    /**
     * 尝试恢复 tab 状态
     * @returns {boolean} true 表示恢复成功，调用方可跳过 setContent
     */
    restore(tabId, currentMarkdown) {
        const editor = this._getEditor();
        if (!tabId || !editor) return false;

        const snapshot = this._states.get(tabId);
        if (!snapshot) return false;

        const {
            editorState,
            currentMarkdown: savedMarkdown,
            originalMarkdown,
            contentChanged,
            scrollTop,
        } = snapshot;

        if (editorState && savedMarkdown === currentMarkdown) {
            try {
                editor.view.updateState(editorState);
            } catch (err) {
                // EditorState 可能因插件变更而过期，丢弃并走 setContent 重建路径
                console.warn('[TabStateManager] 恢复 EditorState 失败，丢弃缓存:', err);
                this._states.delete(tabId);
                return false;
            }
            this._setOriginalMarkdown(originalMarkdown);
            this._setContentChanged(Boolean(contentChanged));
            const scrollContainer = this._getScrollContainer();
            if (scrollContainer && typeof scrollTop === 'number') {
                scrollContainer.scrollTop = scrollTop;
            }
            snapshot.lastActive = Date.now();
            return true;
        }

        return false;
    }

    trimStaleEditorStates(maxAge, currentTabId = null) {
        const now = Date.now();
        for (const [tabId, snapshot] of this._states) {
            if (tabId === currentTabId) continue;
            if (!snapshot?.editorState) continue;
            const lastActive = snapshot.lastActive ?? 0;
            if (now - lastActive < maxAge) continue;
            snapshot.editorState = null;
        }
    }

    forget(tabId) {
        if (tabId) this._states.delete(tabId);
    }

    rename(oldTabId, newTabId) {
        if (!oldTabId || !newTabId || oldTabId === newTabId) return;
        const state = this._states.get(oldTabId);
        if (!state) return;
        this._states.delete(oldTabId);
        this._states.set(newTabId, state);
    }

    destroy() {
        this._states.clear();
    }
}
