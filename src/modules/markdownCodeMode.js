export function createMarkdownCodeMode({
    detectLanguageForPath,
    isMarkdownFilePath,
    activateMarkdownView,
    activateCodeView,
}) {
    if (typeof detectLanguageForPath !== 'function') {
        throw new Error('createMarkdownCodeMode 需要提供 detectLanguageForPath');
    }
    if (typeof isMarkdownFilePath !== 'function') {
        throw new Error('createMarkdownCodeMode 需要提供 isMarkdownFilePath');
    }
    if (typeof activateMarkdownView !== 'function' || typeof activateCodeView !== 'function') {
        throw new Error('createMarkdownCodeMode 需要提供视图切换方法');
    }

    let toggleState = null;

    async function toggle({
        currentFile,
        activeViewMode,
        editor,
        codeEditor,
    }) {
        if (!currentFile || !editor || !codeEditor) {
            return { changed: false, nextViewMode: activeViewMode, hasUnsavedChanges: false };
        }
        if (!isMarkdownFilePath(currentFile)) {
            return { changed: false, nextViewMode: activeViewMode, hasUnsavedChanges: false };
        }

        if (activeViewMode === 'markdown') {
            const markdownContent = editor.getMarkdown() || '';
            const hadUnsavedChanges = editor.hasUnsavedChanges?.() || false;
            toggleState = {
                originalMarkdown: editor.originalMarkdown,
            };

            editor?.saveViewStateForTab?.(currentFile);
            activateCodeView();
            const language = detectLanguageForPath(currentFile) || 'plaintext';
            await codeEditor.show(currentFile, markdownContent, language, null, { tabId: currentFile });
            editor?.refreshSearch?.();

            if (hadUnsavedChanges) {
                codeEditor.isDirty = true;
                codeEditor.callbacks?.onContentChange?.();
            } else {
                codeEditor.markSaved();
            }

            return {
                changed: true,
                nextViewMode: 'code',
                hasUnsavedChanges: hadUnsavedChanges,
            };
        }

        if (activeViewMode === 'code') {
            const codeContent = codeEditor.getValue();
            const hadUnsavedChanges = codeEditor.hasUnsavedChanges?.() || false;

            codeEditor?.saveViewStateForTab?.(currentFile);
            activateMarkdownView();
            await editor.loadFile(currentFile, codeContent, undefined, { tabId: currentFile });
            editor?.refreshSearch?.();

            if (hadUnsavedChanges && toggleState?.originalMarkdown !== undefined) {
                editor.originalMarkdown = toggleState.originalMarkdown;
            }

            editor.contentChanged = hadUnsavedChanges;
            toggleState = null;

            codeEditor.markSaved();

            return {
                changed: true,
                nextViewMode: 'markdown',
                hasUnsavedChanges: hadUnsavedChanges,
            };
        }

        return { changed: false, nextViewMode: activeViewMode, hasUnsavedChanges: false };
    }

    function reset() {
        toggleState = null;
    }

    function handleCodeSaved(content) {
        if (toggleState) {
            toggleState.originalMarkdown = content;
        }
    }

    return {
        toggle,
        reset,
        handleCodeSaved,
    };
}
