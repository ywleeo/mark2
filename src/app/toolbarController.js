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
    getEditorRegistry,
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
            markdownToolbarManager.toggle();
        } else {
            const services = getAppServices();
            if (services) {
                const toggleMarkdownCodeMode = getToggleMarkdownCodeMode();
                const newManager = new MarkdownToolbarManager(services, {
                    executeCommand,
                    onToggleViewMode: toggleMarkdownCodeMode,
                    getEditorRegistry,
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
        const flow = getCardExportSidebar();
        if (!flow) return;
        if (!nextPath || !isMarkdownFilePath(nextPath)) {
            flow.hide?.();
        }
    }

    return {
        getToolbarEditorInstance,
        toggleMarkdownToolbar,
        handleToolbarOnViewModeChange,
        handleToolbarOnFileChange,
        handleCardSidebarOnFileChange,
        syncToolbarWithCurrentContext,
    };
}
