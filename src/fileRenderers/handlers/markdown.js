export function createMarkdownRenderer() {
    return {
        id: 'markdown',
        extensions: ['md', 'markdown', 'mdx'],
        getViewMode() {
            return 'markdown';
        },
        async load(ctx) {
            const {
                filePath,
                session,
                fileData,
                editorRegistry,
                view,
                restoreMarkdownScrollPosition,
                setHasUnsavedChanges,
                updateWindowTitle,
                shouldAutoFocus,
            } = ctx;

            const editor = editorRegistry?.getMarkdownEditor?.();
            if (!editor) {
                return false;
            }

            view?.activate?.('markdown', { skipScrollSync: true });
            await editor.loadFile(session, filePath, fileData.content, {
                autoFocus: shouldAutoFocus,
                onReady: () => restoreMarkdownScrollPosition?.(filePath),
            });

            if (fileData.hasChanges) {
                editor.contentChanged = true;
                if (fileData.originalContent) {
                    editor.originalMarkdown = fileData.originalContent;
                }
            }

            setHasUnsavedChanges?.(fileData.hasChanges);
            await updateWindowTitle?.();

            return true;
        },
    };
}
