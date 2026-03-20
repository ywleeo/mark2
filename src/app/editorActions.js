export function createEditorActions({
    getActiveViewMode,
    setActiveViewMode,
    getEditor,
    getCodeEditor,
    getMarkdownCodeMode,
    getSvgCodeMode,
    getCsvTableMode,
    getWorkflowCodeMode,
    getCurrentFile,
    setHasUnsavedChanges,
    saveCurrentEditorContentToCache,
    persistWorkspaceState,
    updateWindowTitle,
    fileSession,
    getImageViewer,
    getSpreadsheetViewer,
    getWorkflowEditor,
    getFileService,
    getLoadFile,
}) {
    function insertTextIntoActiveEditor(text, options = {}) {
        const nextText = typeof text === 'string' ? text : '';
        const position = options?.position || 'cursor';
        const mode = getActiveViewMode?.() || 'markdown';
        const editor = getEditor?.();
        const codeEditor = getCodeEditor?.();

        const tryInsertIntoMarkdownEditor = () => {
            const tiptapEditor = editor?.editor;
            if (!tiptapEditor) {
                return false;
            }

            if (position === 'replace') {
                if (typeof editor.insertTextAtCursor !== 'function') {
                    return false;
                }
                editor.insertTextAtCursor(nextText);
                return true;
            }

            if (position === 'end') {
                if (typeof tiptapEditor.commands.setTextSelection !== 'function') {
                    return false;
                }
                const docSize = tiptapEditor.state.doc?.content?.size ?? 0;
                tiptapEditor.commands.setTextSelection({
                    from: docSize,
                    to: docSize,
                });
                if (typeof editor.insertTextAtCursor !== 'function') {
                    return false;
                }
                editor.insertTextAtCursor(nextText);
                return true;
            }

            if (position === 'cursor') {
                if (typeof editor.insertTextAtCursor !== 'function') {
                    return false;
                }
                editor.insertTextAtCursor(nextText);
                return true;
            }

            return false;
        };

        const tryInsertIntoCodeEditor = () => {
            const codeInstance = codeEditor;
            if (!codeInstance) {
                return false;
            }

            if (position === 'replace') {
                if (typeof codeInstance.insertTextAtCursor !== 'function') {
                    return false;
                }
                codeInstance.insertTextAtCursor(nextText);
                return true;
            }

            if (position === 'end') {
                const view = codeInstance.editor;
                if (!view?.state) {
                    return false;
                }
                const endPos = view.state.doc.length;
                view.dispatch({
                    selection: { anchor: endPos },
                });
                if (typeof codeInstance.insertTextAtCursor !== 'function') {
                    return false;
                }
                codeInstance.insertTextAtCursor(nextText);
                return true;
            }

            if (position === 'cursor') {
                if (typeof codeInstance.insertTextAtCursor !== 'function') {
                    return false;
                }
                codeInstance.insertTextAtCursor(nextText);
                return true;
            }

            return false;
        };

        if (mode === 'code' && tryInsertIntoCodeEditor()) {
            return;
        }
        if (mode === 'markdown' && tryInsertIntoMarkdownEditor()) {
            return;
        }
        if (tryInsertIntoMarkdownEditor()) {
            return;
        }
        if (tryInsertIntoCodeEditor()) {
            return;
        }

        console.warn('[EditorActions] 插入文本失败：未找到可用编辑器', { position, mode });
    }

    async function toggleMarkdownCodeMode() {
        const activeViewMode = getActiveViewMode?.();
        const currentFile = getCurrentFile?.();
        const codeEditor = getCodeEditor?.();

        const markdownCodeMode = getMarkdownCodeMode?.();
        if (!markdownCodeMode) {
            return;
        }

        const editor = getEditor?.();
        const result = await markdownCodeMode.toggle({
            currentFile,
            activeViewMode: activeViewMode ?? getActiveViewMode?.(),
            editor,
            codeEditor,
        });

        if (!result?.changed) {
            return;
        }

        setActiveViewMode?.(result.nextViewMode);
        setHasUnsavedChanges?.(result.hasUnsavedChanges);

        saveCurrentEditorContentToCache?.();
        persistWorkspaceState?.();
        void updateWindowTitle?.();
    }

    async function toggleSvgCodeMode() {
        const svgCodeMode = getSvgCodeMode?.();
        if (!svgCodeMode) {
            return;
        }

        const imageViewer = getImageViewer?.();
        const codeEditor = getCodeEditor?.();
        const fileService = getFileService?.();
        const loadFile = getLoadFile?.();
        const result = await svgCodeMode.toggle({
            currentFile: getCurrentFile?.(),
            activeViewMode: getActiveViewMode?.(),
            imageViewer,
            codeEditor,
            fileService,
            loadFile,
        });

        if (!result?.changed) {
            return;
        }

        setActiveViewMode?.(result.nextViewMode);
        setHasUnsavedChanges?.(result.hasUnsavedChanges);

        saveCurrentEditorContentToCache?.();
        persistWorkspaceState?.();
        void updateWindowTitle?.();
    }

    async function toggleCsvTableMode() {
        const csvTableMode = getCsvTableMode?.();
        if (!csvTableMode) {
            return;
        }

        const spreadsheetViewer = getSpreadsheetViewer?.();
        const codeEditor = getCodeEditor?.();
        const result = await csvTableMode.toggle({
            currentFile: getCurrentFile?.(),
            activeViewMode: getActiveViewMode?.(),
            spreadsheetViewer,
            codeEditor,
        });

        if (!result?.changed) {
            return;
        }

        setActiveViewMode?.(result.nextViewMode);
        setHasUnsavedChanges?.(result.hasUnsavedChanges);

        saveCurrentEditorContentToCache?.();
        persistWorkspaceState?.();
        void updateWindowTitle?.();
    }

    async function toggleWorkflowCodeMode() {
        const workflowCodeMode = getWorkflowCodeMode?.();
        if (!workflowCodeMode) {
            return false;
        }

        const workflowEditor = getWorkflowEditor?.();
        const codeEditor = getCodeEditor?.();
        const result = await workflowCodeMode.toggle({
            currentFile: getCurrentFile?.(),
            activeViewMode: getActiveViewMode?.(),
            workflowEditor,
            codeEditor,
        });

        if (!result?.changed) {
            return false;
        }

        setActiveViewMode?.(result.nextViewMode);
        setHasUnsavedChanges?.(result.hasUnsavedChanges);

        saveCurrentEditorContentToCache?.();
        persistWorkspaceState?.();
        void updateWindowTitle?.();
        return true;
    }

    async function requestActiveEditorContext(options = {}) {
        const preferSelection = options?.preferSelection !== false;
        const normalize = (value) => (typeof value === 'string' ? value.trim() : '');
        const activeFile = getCurrentFile?.();
        const editor = getEditor?.();
        const codeEditor = getCodeEditor?.();
        const activeViewMode = getActiveViewMode?.() || 'markdown';

        if (!activeFile) {
            return '';
        }

        const readFromSession = async () => {
            if (!fileSession?.getFileContent) {
                return '';
            }
            try {
                const data = await fileSession.getFileContent(activeFile);
                return normalize(data?.content ?? '');
            } catch (_error) {
                return '';
            }
        };

        const readMarkdownSelection = () => {
            if (editor?.currentFile !== activeFile) {
                return '';
            }
            return normalize(editor?.getSelectedMarkdown?.());
        };

        const readMarkdownFull = () => {
            if (editor?.currentFile !== activeFile) {
                return '';
            }
            return normalize(editor?.getMarkdown?.());
        };

        const readCodeSelection = () => {
            if (codeEditor?.currentFile !== activeFile) {
                return '';
            }
            return normalize(codeEditor?.getSelectionText?.());
        };

        const readCodeFull = () => {
            if (codeEditor?.currentFile !== activeFile) {
                return '';
            }
            return normalize(codeEditor?.getValue?.());
        };

        if (activeViewMode === 'code') {
            if (preferSelection) {
                const codeSelection = readCodeSelection();
                if (codeSelection) {
                    return codeSelection;
                }
                const markdownSelection = readMarkdownSelection();
                if (markdownSelection) {
                    return markdownSelection;
                }
            }

            const fullCode = readCodeFull();
            if (fullCode) {
                return fullCode;
            }

            const markdownFallback = readMarkdownFull();
            if (markdownFallback) {
                return markdownFallback;
            }

            return await readFromSession();
        }

        if (preferSelection) {
            const markdownSelection = readMarkdownSelection();
            if (markdownSelection) {
                return markdownSelection;
            }
        }

        const fullMarkdown = readMarkdownFull();
        if (fullMarkdown) {
            return fullMarkdown;
        }

        if (preferSelection) {
            const codeSelection = readCodeSelection();
            if (codeSelection) {
                return codeSelection;
            }
        }

        const codeFallback = readCodeFull();
        if (codeFallback) {
            return codeFallback;
        }

        return await readFromSession();
    }

    return {
        insertTextIntoActiveEditor,
        toggleMarkdownCodeMode,
        toggleSvgCodeMode,
        toggleCsvTableMode,
        toggleWorkflowCodeMode,
        requestActiveEditorContext,
    };
}
