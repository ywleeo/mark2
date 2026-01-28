export function createPdfRenderer() {
    return {
        id: 'pdf',
        extensions: ['pdf'],
        getViewMode() {
            return 'pdf';
        },
        async load(ctx) {
            const {
                filePath,
                fileData,
                editorRegistry,
                pdfViewer,
                imageViewer,
                mediaViewer,
                spreadsheetViewer,
                unsupportedViewer,
                activatePdfView,
                forceReload,
            } = ctx;

            activatePdfView?.();
            editorRegistry?.getMarkdownEditor?.()?.clear?.();
            editorRegistry?.getCodeEditor?.()?.hide?.();
            imageViewer?.hide?.();
            mediaViewer?.hide?.();
            spreadsheetViewer?.hide?.();
            unsupportedViewer?.hide?.();
            await pdfViewer?.loadDocument?.(filePath, fileData.content, { forceReload });
            return true;
        },
    };
}
