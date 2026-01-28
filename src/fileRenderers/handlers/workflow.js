export function createWorkflowRenderer() {
    return {
        id: 'workflow',
        extensions: ['mflow'],
        getViewMode() {
            return 'workflow';
        },
        async load(ctx) {
            const {
                filePath,
                fileData,
                session,
                editorRegistry,
                workflowEditor,
                imageViewer,
                mediaViewer,
                spreadsheetViewer,
                pdfViewer,
                unsupportedViewer,
                activateWorkflowView,
                forceReload,
            } = ctx;

            activateWorkflowView?.();
            editorRegistry?.getMarkdownEditor?.()?.clear?.();
            editorRegistry?.getCodeEditor?.()?.hide?.();
            imageViewer?.hide?.();
            mediaViewer?.hide?.();
            spreadsheetViewer?.hide?.();
            pdfViewer?.hide?.();
            unsupportedViewer?.hide?.();
            await workflowEditor?.loadFile?.(session, filePath, fileData.content, { forceReload });
            return true;
        },
    };
}
