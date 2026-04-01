/**
 * Toolbar 控制器
 * 管理 Markdown 工具栏和卡片导出侧边栏的显示/隐藏/同步
 */

export function createToolbarController({
    getMarkdownEditor,
    getCodeEditor,
    getCurrentFile,
    getActiveViewMode,
    executeCommand,
    getMarkdownToolbarManager,
    setMarkdownToolbarManager,
    getCardExportSidebar,
    getAppServices,
    getToggleMarkdownCodeMode,
    isMarkdownFilePath,
    MarkdownToolbarManager,
}) {
    let modeWarningElement = null;
    let modeWarningTimeout = null;

    function getToolbarEditorInstance() {
        const editor = getMarkdownEditor();
        if (!editor) return null;
        if (typeof editor.getTipTapEditor === 'function') {
            const tiptapEditor = editor.getTipTapEditor();
            if (tiptapEditor) return tiptapEditor;
        }
        if (editor.editor) return editor.editor;
        return editor;
    }

    function showModeWarning(message) {
        if (modeWarningElement) {
            modeWarningElement.remove();
            modeWarningElement = null;
        }
        if (modeWarningTimeout) {
            clearTimeout(modeWarningTimeout);
            modeWarningTimeout = null;
        }

        modeWarningElement = document.createElement('div');
        modeWarningElement.className = 'toc-mode-warning';
        modeWarningElement.textContent = message;
        document.body.appendChild(modeWarningElement);

        setTimeout(() => {
            if (modeWarningElement) {
                modeWarningElement.classList.add('toc-mode-warning--visible');
            }
        }, 10);

        modeWarningTimeout = setTimeout(() => {
            if (modeWarningElement) {
                modeWarningElement.classList.remove('toc-mode-warning--visible');
                setTimeout(() => {
                    modeWarningElement?.remove();
                    modeWarningElement = null;
                }, 200);
            }
            modeWarningTimeout = null;
        }, 2000);
    }

    function showCardExportSidebar() {
        const sidebar = getCardExportSidebar();
        if (!sidebar) {
            console.warn('Card sidebar 未初始化');
            return;
        }

        const currentFile = getCurrentFile();
        if (!currentFile || !isMarkdownFilePath(currentFile)) {
            console.log('Card sidebar 仅支持 Markdown 文件');
            return;
        }

        const activeViewMode = getActiveViewMode();
        if (activeViewMode !== 'markdown' && activeViewMode !== 'split') {
            showModeWarning('卡片功能仅在 Markdown 预览模式下可用');
            return;
        }

        sidebar.showSidebar?.();
    }

    function syncToolbarWithCurrentContext(options = {}) {
        const markdownToolbarManager = getMarkdownToolbarManager();
        if (!markdownToolbarManager) return;
        markdownToolbarManager.executeCommand = executeCommand;

        const activeViewMode = getActiveViewMode();
        const currentFile = getCurrentFile();
        const effectiveMode = options.mode ?? activeViewMode;
        const hasMarkdownFile = currentFile && isMarkdownFilePath(currentFile);
        const isMarkdownView = effectiveMode === 'markdown' || effectiveMode === 'split';
        const isCodeView = effectiveMode === 'code';

        if (!hasMarkdownFile || (!isMarkdownView && !isCodeView)) {
            markdownToolbarManager.hide({ persist: false });
            return;
        }

        const editorType = isCodeView ? 'codemirror' : 'tiptap';
        const codeEditor = getCodeEditor();
        const targetEditor = isCodeView ? codeEditor : getToolbarEditorInstance();

        if (!targetEditor) return;

        const toggleMarkdownCodeMode = getToggleMarkdownCodeMode();
        markdownToolbarManager.setToggleViewModeCallback?.(toggleMarkdownCodeMode);
        markdownToolbarManager.setCardExportCallback?.(() => showCardExportSidebar());

        if (!markdownToolbarManager.isInitialized) {
            markdownToolbarManager.initialize(targetEditor, editorType);
        } else {
            markdownToolbarManager.updateEditor(targetEditor, editorType);
        }

        if (markdownToolbarManager.isVisible) {
            markdownToolbarManager.show({ persist: false });
        } else {
            markdownToolbarManager.hide({ persist: false });
        }
    }

    function toggleMarkdownToolbar() {
        const currentFile = getCurrentFile();
        const markdownToolbarManager = getMarkdownToolbarManager();

        if (!currentFile || !isMarkdownFilePath(currentFile)) return;

        if (markdownToolbarManager) {
            markdownToolbarManager.executeCommand = executeCommand;
            const toggleMarkdownCodeMode = getToggleMarkdownCodeMode();
            markdownToolbarManager.setToggleViewModeCallback(toggleMarkdownCodeMode);
            markdownToolbarManager.setCardExportCallback?.(() => showCardExportSidebar());
            markdownToolbarManager.toggle();
        } else {
            const services = getAppServices();
            if (services) {
                const toggleMarkdownCodeMode = getToggleMarkdownCodeMode();
                const newManager = new MarkdownToolbarManager(services, {
                    executeCommand,
                    onToggleViewMode: toggleMarkdownCodeMode,
                    onCardExport: () => showCardExportSidebar(),
                });
                setMarkdownToolbarManager(newManager);

                const activeViewMode = getActiveViewMode();
                const codeEditor = getCodeEditor();

                if (activeViewMode === 'code') {
                    if (codeEditor) newManager.initialize(codeEditor, 'codemirror');
                } else {
                    const tiptapEditor = getToolbarEditorInstance();
                    if (tiptapEditor) newManager.initialize(tiptapEditor, 'tiptap');
                }
            }
        }
    }

    function handleToolbarOnViewModeChange(nextMode) {
        syncToolbarWithCurrentContext({ mode: nextMode });
    }

    function handleToolbarOnFileChange(nextPath) {
        const markdownToolbarManager = getMarkdownToolbarManager();
        if (!markdownToolbarManager) return;

        if (!nextPath || !isMarkdownFilePath(nextPath)) {
            markdownToolbarManager.hide({ persist: false });
            return;
        }

        syncToolbarWithCurrentContext();
    }

    function handleCardSidebarOnFileChange(nextPath) {
        const sidebar = getCardExportSidebar();
        if (!sidebar) return;
        if (!nextPath || !isMarkdownFilePath(nextPath)) {
            sidebar.hideSidebar?.();
        }
    }

    return {
        getToolbarEditorInstance,
        toggleMarkdownToolbar,
        showCardExportSidebar,
        handleToolbarOnViewModeChange,
        handleToolbarOnFileChange,
        handleCardSidebarOnFileChange,
        syncToolbarWithCurrentContext,
    };
}
