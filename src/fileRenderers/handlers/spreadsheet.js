/**
 * 创建只读电子表格原内容预览渲染器。
 * @returns {Object} RendererRegistry 可注册的电子表格 handler。
 */
export function createSpreadsheetRenderer() {
    return {
        id: 'spreadsheet',
        extensions: ['xls', 'xlsx', 'xlsm', 'xlt', 'xltx', 'xltm', 'csv'],
        /**
         * 返回电子表格视图模式。
         * @returns {string} 电子表格视图模式。
         */
        getViewMode() {
            return 'spreadsheet';
        },
        /**
         * 将完整工作簿交给 SpreadsheetViewer，保留所有 Sheet 并避免 Markdown 中转。
         * @param {Object} ctx - 文件渲染上下文。
         * @returns {Promise<boolean>} 是否完成渲染。
         */
        async load(ctx) {
            const {
                filePath,
                fileData,
                editorRegistry,
                spreadsheetViewer,
                view,
                forceReload,
            } = ctx;
            const sheets = fileData?.content?.sheets;
            if (!Array.isArray(sheets) || sheets.length === 0 || !spreadsheetViewer) {
                return false;
            }

            view?.activate?.('spreadsheet');
            editorRegistry?.getMarkdownEditor?.()?.clear?.();
            editorRegistry?.getCodeEditor?.()?.hide?.();
            await spreadsheetViewer.loadWorkbook(
                filePath,
                fileData.content,
                { forceReload },
            );
            return true;
        },
    };
}
