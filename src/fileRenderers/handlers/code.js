export function createCodeRenderer() {
    return {
        id: 'code',
        extensions: [],
        getViewMode() {
            return 'code';
        },
        async load(ctx) {
            const {
                filePath,
                session,
                fileData,
                editorRegistry,
                detectLanguageForPath,
                activateCodeView,
                setHasUnsavedChanges,
                updateWindowTitle,
                shouldAutoFocus,
                tabId,
            } = ctx;

            const codeEditor = editorRegistry?.getCodeEditor?.();
            const markdownEditor = editorRegistry?.getMarkdownEditor?.();
            if (!codeEditor) {
                return false;
            }

            activateCodeView?.();
            markdownEditor?.clear?.();
            const language = detectLanguageForPath?.(filePath) || null;
            await codeEditor.show(filePath, fileData.content, language, session, {
                autoFocus: shouldAutoFocus,
                tabId,
            });

            if (fileData.hasChanges) {
                codeEditor.isDirty = true;
            }
            markdownEditor?.refreshSearch?.();

            setHasUnsavedChanges?.(fileData.hasChanges);
            await updateWindowTitle?.();

            return true;
        },
    };
}
