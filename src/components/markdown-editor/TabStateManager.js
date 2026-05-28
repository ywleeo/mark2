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
        getContentChanged,
        setOriginalMarkdown,
        setContentChanged,
    }) {
        this._getEditor = getEditor;
        this._getScrollContainer = getScrollContainer;
        this._getCurrentMarkdown = getCurrentMarkdown;
        this._getOriginalMarkdown = getOriginalMarkdown;
        this._getContentChanged = getContentChanged;
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
        // 脏判定:必须真正发生过编辑(contentChanged 标志为 true)才可能脏。
        // 仅靠 currentMarkdown !== originalMarkdown 字符串比较不可靠 —— 非 mark2 规范化
        // 格式的内容(如云端文件)解析→序列化不完全等价,会被误判脏。AND 上编辑标志后,
        // 未编辑过的文档(标志为 false)一定干净;同时保留「撤销回原内容→清除脏点」行为。
        const everEdited = this._getContentChanged ? Boolean(this._getContentChanged()) : true;
        const contentChanged = everEdited
            && this._getCurrentMarkdown() !== this._getOriginalMarkdown();
        this._states.set(tabId, {
            editorState: editor.state,
            currentMarkdown: this._getCurrentMarkdown(),
            originalMarkdown: this._getOriginalMarkdown(),
            contentChanged,
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
