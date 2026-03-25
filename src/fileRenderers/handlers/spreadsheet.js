import { showSheetPickerDialog } from '../../components/SheetPickerDialog.js';
import { stringifyCSV } from '../../utils/csvParser.js';

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
                session,
                editorRegistry,
                activateMarkdownView,
                shouldAutoFocus,
            } = ctx;

            const editor = editorRegistry?.getMarkdownEditor?.();
            if (!editor) return false;

            const sheets = fileData?.content?.sheets;
            if (!Array.isArray(sheets) || sheets.length === 0) return false;

            let sheetIndex = 0;
            if (sheets.length > 1) {
                const picked = await showSheetPickerDialog(sheets);
                if (picked === null) return false;
                sheetIndex = picked;
            }

            const sheet = sheets[sheetIndex];
            const csvContent = stringifyCSV(sheet?.rows ?? []);

            activateMarkdownView?.({ skipScrollSync: true });
            await editor.loadCsvFile(session, filePath, csvContent, { autoFocus: shouldAutoFocus });

            return true;
        },
    };
}
