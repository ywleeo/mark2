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
                fileService,
                editorRegistry,
                htmlViewer,
                activateHtmlView,
            } = ctx;

            let htmlContent = typeof fileData?.content === 'string' ? fileData.content : '';
            if (!htmlContent && fileService?.readText) {
                console.log('[HtmlRenderer] fileData empty, reading from disk', { filePath });
                htmlContent = await fileService.readText(filePath);
            }

            activateHtmlView?.();
            editorRegistry?.getMarkdownEditor?.()?.clear?.();
            editorRegistry?.getCodeEditor?.()?.hide?.();
            await htmlViewer?.loadHtml?.(filePath, htmlContent);
            return true;
        },
    };
}
