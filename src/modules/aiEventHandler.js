/**
 * AI 事件处理器
 * 处理来自后端的AI任务事件，如光标插入等
 */

export function createAiEventHandler() {
    let editor = null;
    let codeEditor = null;
    let activeViewMode = 'markdown';
    let updateWindowTitleFn = null;
    let markDocumentDirtyFn = null;
    let unlistenFn = null;

    /**
     * 初始化AI事件监听器
     */
    async function initialize({
        getEditor,
        getCodeEditor,
        getActiveViewMode,
        updateWindowTitle,
        markDocumentDirty
    }) {
        updateWindowTitleFn = updateWindowTitle;
        markDocumentDirtyFn = markDocumentDirty;

        // 定期更新编辑器引用和视图模式
        const updateReferences = () => {
            if (typeof getEditor === 'function') {
                editor = getEditor();
            }
            if (typeof getCodeEditor === 'function') {
                codeEditor = getCodeEditor();
            }
            if (typeof getActiveViewMode === 'function') {
                activeViewMode = getActiveViewMode();
            }
        };

        // 初始化引用
        updateReferences();

        // 监听光标插入事件
        const { listen } = await import('@tauri-apps/api/event');
        unlistenFn = await listen('ai-task-insert-at-cursor', (event) => {
            // 更新引用以确保使用最新的编辑器实例
            updateReferences();
            handleInsertAtCursor(event.payload);
        });
    }

    /**
     * 处理在光标位置插入内容
     */
    function handleInsertAtCursor(payload) {
        const { content } = payload;
        if (!content) {
            console.warn('[AI] 插入内容为空');
            return;
        }

        let inserted = false;

        // 根据当前激活的视图模式选择对应的编辑器
        if (activeViewMode === 'markdown' && editor?.insertTextAtCursor) {
            editor.insertTextAtCursor(content);
            inserted = true;
        } else if (activeViewMode === 'code' && codeEditor?.insertTextAtCursor) {
            codeEditor.insertTextAtCursor(content);
            inserted = true;
        }

        if (inserted) {
            // 标记文档为已修改
            if (typeof markDocumentDirtyFn === 'function') {
                markDocumentDirtyFn();
            }
            // 更新窗口标题
            if (typeof updateWindowTitleFn === 'function') {
                updateWindowTitleFn();
            }
            console.log('[AI] 已在光标位置插入内容');
        } else {
            console.warn('[AI] 无法插入内容，编辑器不可用或视图模式不匹配');
        }
    }

    /**
     * 清理资源
     */
    function destroy() {
        if (unlistenFn) {
            unlistenFn();
            unlistenFn = null;
        }
        editor = null;
        codeEditor = null;
        updateWindowTitleFn = null;
        markDocumentDirtyFn = null;
    }

    return {
        initialize,
        destroy,
    };
}
