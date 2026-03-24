/**
 * Tab 视图状态管理器
 * 保存和恢复每个 tab 的编辑器状态（含撤销历史、滚动位置）
 */
export class TabStateManager {
    /**
     * @param {Object} opts
     * @param {() => import('@tiptap/core').Editor} opts.getEditor
     * @param {() => Element} opts.getScrollContainer
     * @param {() => string} opts.getOriginalMarkdown
     * @param {(v: string) => void} opts.setOriginalMarkdown
     * @param {(v: boolean) => void} opts.setContentChanged
     */
    constructor({ getEditor, getScrollContainer, getOriginalMarkdown, setOriginalMarkdown, setContentChanged }) {
        this._getEditor = getEditor;
        this._getScrollContainer = getScrollContainer;
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
            markdown: this._getOriginalMarkdown(),
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

        const { editorState, markdown: savedMarkdown } = snapshot;

        if (editorState && savedMarkdown === currentMarkdown) {
            editor.view.updateState(editorState);
            this._setOriginalMarkdown(savedMarkdown);
            this._setContentChanged(false);
            return true;
        }

        return false;
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
