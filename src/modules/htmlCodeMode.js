export function createHtmlCodeMode({
    isHtmlFilePath,
    detectLanguageForPath,
    activateHtmlView,
    activateCodeView,
}) {
    if (typeof isHtmlFilePath !== 'function') {
        throw new Error('createHtmlCodeMode 需要提供 isHtmlFilePath');
    }
    if (typeof activateHtmlView !== 'function' || typeof activateCodeView !== 'function') {
        throw new Error('createHtmlCodeMode 需要提供视图切换方法');
    }

    let toggleState = null;

    async function toggle({
        currentFile,
        activeViewMode,
        htmlViewer,
        codeEditor,
        fileService,
    }) {
        if (!currentFile || !htmlViewer || !codeEditor) {
            return { changed: false, nextViewMode: activeViewMode, hasUnsavedChanges: false };
        }
        if (!isHtmlFilePath(currentFile)) {
            return { changed: false, nextViewMode: activeViewMode, hasUnsavedChanges: false };
        }

        if (activeViewMode === 'html') {
            let htmlContent = toggleState?.lastCodeContent || htmlViewer.getHtml?.() || '';
            if (!htmlContent && fileService?.readText) {
                htmlContent = await fileService.readText(currentFile);
            }

            activateCodeView();
            const language = detectLanguageForPath?.(currentFile) || 'html';
            await codeEditor.show(currentFile, htmlContent, language, null, { tabId: currentFile });

            const hadUnsavedChanges = toggleState?.hadUnsavedChanges || false;
            if (hadUnsavedChanges) {
                codeEditor.isDirty = true;
                codeEditor.callbacks?.onContentChange?.();
            } else {
                codeEditor.markSaved();
            }

            toggleState = null;

            return {
                changed: true,
                nextViewMode: 'code',
                hasUnsavedChanges: hadUnsavedChanges,
            };
        }

        if (activeViewMode === 'code') {
            const codeContent = typeof codeEditor.getValueForSave === 'function'
                ? codeEditor.getValueForSave()
                : codeEditor.getValue();
            const hadUnsavedChanges = codeEditor.hasUnsavedChanges?.() || false;

            codeEditor?.saveViewStateForTab?.(currentFile);
            activateHtmlView();
            await htmlViewer.loadHtml(currentFile, codeContent);

            toggleState = {
                lastCodeContent: codeContent,
                hadUnsavedChanges,
            };

            return {
                changed: true,
                nextViewMode: 'html',
                hasUnsavedChanges: hadUnsavedChanges,
            };
        }

        return { changed: false, nextViewMode: activeViewMode, hasUnsavedChanges: false };
    }

    function reset() {
        toggleState = null;
    }

    return {
        toggle,
        reset,
    };
}
