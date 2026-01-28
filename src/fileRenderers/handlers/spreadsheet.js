export function createSpreadsheetRenderer() {
    return {
        id: 'spreadsheet',
        extensions: ['xls', 'xlsx', 'xlsm', 'xlt', 'xltx', 'xltm', 'csv'],
        getViewMode() {
            return 'spreadsheet';
        },
        async load(ctx) {
            const {
                filePath,
                fileData,
                editorRegistry,
                spreadsheetViewer,
                imageViewer,
                mediaViewer,
                unsupportedViewer,
                activateSpreadsheetView,
                forceReload,
            } = ctx;

            activateSpreadsheetView?.();
            editorRegistry?.getMarkdownEditor?.()?.clear?.();
            editorRegistry?.getCodeEditor?.()?.hide?.();
            imageViewer?.hide?.();
            mediaViewer?.hide?.();
            unsupportedViewer?.hide?.();
            await spreadsheetViewer?.loadWorkbook?.(filePath, fileData.content, { forceReload });
            return true;
        },
    };
}
