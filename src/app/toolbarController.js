/**
 * Toolbar 控制器
 * 管理 Markdown 工具栏和卡片导出侧边栏的显示/隐藏/同步
 */
import { navigationHistory } from '../modules/navigationHistory.js';

export function createToolbarController({
    getMarkdownEditor,
    getCodeEditor,
    getCurrentFile,
    getNavLaneId,
    getPreviewReturnPath,
    getFocusedPaneId,
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

    function getCurrentSelectionHtml() {
        const selection = window.getSelection?.();
        if (!selection || selection.isCollapsed || selection.rangeCount === 0) return '';

        const getElement = (node) => {
            if (!node) return null;
            return node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
        };

        const host = getElement(selection.anchorNode)?.closest?.('[data-markdown-editor-host]')
            || getElement(selection.focusNode)?.closest?.('[data-markdown-editor-host]');
        if (!host) return '';

        const div = document.createElement('div');
        div.appendChild(selection.getRangeAt(0).cloneContents());
        return div.innerHTML;
    }

    function showCardExportSidebar() {
        const flow = getCardExportSidebar();
        if (!flow) return;

        if (getActiveViewMode() === 'code') {
            const codeEditor = getCodeEditor();
            const text = (codeEditor?.getSelectionText?.() || codeEditor?.getValue?.() || '').trim();
            if (text) flow.open?.({ text, html: '' });
            return;
        }

        const markdownEditor = getMarkdownEditor();
        if (!markdownEditor) return;

        const selectedText = markdownEditor.getSelectedMarkdown?.() || '';
        const text = (selectedText || markdownEditor.getMarkdown?.() || '').trim();
        if (!text) return;
        const html = selectedText
            ? getCurrentSelectionHtml()
            : (markdownEditor.getRenderedHtml?.() || '');

        flow.open?.({
            text,
            html,
        });
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

    /** 同步当前文件的导航历史和编辑工具栏，所有文件类型都进入历史。 */
    function syncToolbarWithCurrentContext(options = {}) {
        const activeViewMode = getActiveViewMode();
        const currentFile = getCurrentFile();
        const effectiveMode = options.mode ?? activeViewMode;
        const hasMarkdownFile = currentFile && isMarkdownFilePath(currentFile);
        const isMarkdownView = effectiveMode === 'markdown' || effectiveMode === 'split';
        const isCodeView = effectiveMode === 'code';

        // 文档状态先于标签栏投影更新，启动和切换时都用当前文档所属的导航位置。
        navigationHistory.setActiveLane(getNavLaneId?.() ?? null);
        navigationHistory.record(currentFile, { previewReturnPath: getPreviewReturnPath?.(currentFile) });

        const markdownToolbarManager = getMarkdownToolbarManager();
        if (!markdownToolbarManager) return;
        markdownToolbarManager.executeCommand = executeCommand;
        markdownToolbarManager.onCardExport = showCardExportSidebar;

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
                    getFocusedPaneId,
                    executeCommand,
                    onToggleViewMode: toggleMarkdownCodeMode,
                    onCardExport: showCardExportSidebar,
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

    /** 文件切换后立即同步，无需等待媒体完成加载。 */
    function handleToolbarOnFileChange() {
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
        showCardExportSidebar,
        toggleMarkdownToolbar,
        handleToolbarOnViewModeChange,
        handleToolbarOnFileChange,
        handleCardSidebarOnFileChange,
        syncToolbarWithCurrentContext,
    };
}
