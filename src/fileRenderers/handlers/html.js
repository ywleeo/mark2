export function createHtmlRenderer() {
    return {
        id: 'html',
        extensions: ['html', 'htm'],
        getViewMode() {
            return 'html';
        },
        async load(ctx) {
            const {
                filePath,
                fileData,
                editorRegistry,
                htmlViewer,
                activateHtmlView,
            } = ctx;

            activateHtmlView?.();
            editorRegistry?.getMarkdownEditor?.()?.clear?.();
            editorRegistry?.getCodeEditor?.()?.hide?.();
            await htmlViewer?.loadHtml?.(filePath, fileData.content);
            return true;
        },
    };
}
