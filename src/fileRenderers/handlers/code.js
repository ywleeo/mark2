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
                doc,
                editorRegistry,
                detectLanguageForPath,
                view,
                restoreScrollPosition,
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

            view?.activate?.('code', { skipScrollSync: true });
            markdownEditor?.clear?.();
            const language = detectLanguageForPath?.(filePath) || null;

            if (doc && typeof codeEditor.attachDocument === 'function') {
                await codeEditor.attachDocument(doc, {
                    session,
                    tabId,
                    autoFocus: shouldAutoFocus,
                    language,
                });
            } else {
                await codeEditor.show(filePath, fileData.content, language, session, {
                    autoFocus: shouldAutoFocus,
                    tabId,
                });
                if (fileData.hasChanges) {
                    codeEditor.isDirty = true;
                }
            }

            restoreScrollPosition?.(filePath, 'code');
            markdownEditor?.refreshSearch?.();

            setHasUnsavedChanges?.(fileData.hasChanges);
            await updateWindowTitle?.();

            return true;
        },
    };
}
