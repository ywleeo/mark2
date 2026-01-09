import { spreadsheetDataToCsv, parseCsvToSpreadsheetData } from '../utils/csvParser.js';

/**
 * CSV 表格模式切换控制器
 * 实现表格视图 <-> 代码编辑模式的切换
 */
export function createCsvTableMode({
    isCsvFilePath,
    activateSpreadsheetView,
    activateCodeView,
    detectLanguageForPath,
}) {
    if (typeof isCsvFilePath !== 'function') {
        throw new Error('createCsvTableMode 需要提供 isCsvFilePath');
    }
    if (typeof activateSpreadsheetView !== 'function') {
        throw new Error('createCsvTableMode 需要提供 activateSpreadsheetView');
    }
    if (typeof activateCodeView !== 'function') {
        throw new Error('createCsvTableMode 需要提供 activateCodeView');
    }
    if (typeof detectLanguageForPath !== 'function') {
        throw new Error('createCsvTableMode 需要提供 detectLanguageForPath');
    }

    let toggleState = null;

    /**
     * 切换 CSV 文件的视图模式
     * @param {Object} options
     * @param {string} options.currentFile - 当前文件路径
     * @param {string} options.activeViewMode - 当前视图模式 ('spreadsheet' 或 'code')
     * @param {Object} options.spreadsheetViewer - 表格查看器实例
     * @param {Object} options.codeEditor - 代码编辑器实例
     * @returns {Promise<{ changed: boolean, nextViewMode: string, hasUnsavedChanges: boolean }>}
     */
    async function toggle({
        currentFile,
        activeViewMode,
        spreadsheetViewer,
        codeEditor,
    }) {
        if (!currentFile || !spreadsheetViewer || !codeEditor) {
            return { changed: false, nextViewMode: activeViewMode, hasUnsavedChanges: false };
        }

        // 只处理 CSV 文件
        if (!isCsvFilePath(currentFile)) {
            return { changed: false, nextViewMode: activeViewMode, hasUnsavedChanges: false };
        }

        // 从表格视图切换到代码编辑模式
        if (activeViewMode === 'spreadsheet') {
            // 获取表格数据并转换为 CSV 文本
            const spreadsheetData = spreadsheetViewer.currentFile === currentFile
                ? { sheets: [{ name: 'Sheet1', rows: spreadsheetViewer.sheets?.[spreadsheetViewer.activeSheetIndex]?.rows || [] }] }
                : null;

            let csvContent = '';
            if (spreadsheetData && spreadsheetData.sheets && spreadsheetData.sheets.length > 0) {
                csvContent = spreadsheetDataToCsv(spreadsheetData);
            }

            // 保存原始状态
            toggleState = {
                originalCsvContent: csvContent,
            };

            // 切换到代码视图
            spreadsheetViewer?.saveViewStateForTab?.(currentFile);
            activateCodeView();

            const language = detectLanguageForPath(currentFile) || 'csv';
            await codeEditor.show(currentFile, csvContent, language, null, { tabId: currentFile });

            // 标记为未修改（因为刚从表格视图切换过来）
            codeEditor.markSaved();

            return {
                changed: true,
                nextViewMode: 'code',
                hasUnsavedChanges: false,
            };
        }

        // 从代码编辑模式切换回表格视图
        if (activeViewMode === 'code') {
            const csvContent = typeof codeEditor.getValueForSave === 'function'
                ? codeEditor.getValueForSave()
                : codeEditor.getValue();
            const hadUnsavedChanges = codeEditor.hasUnsavedChanges?.() || false;

            // 保存代码编辑器状态
            codeEditor?.saveViewStateForTab?.(currentFile);

            // 切换到表格视图
            activateSpreadsheetView();

            // 解析 CSV 并加载到表格查看器
            const fileName = currentFile.split(/[/\\]/).pop() || 'Sheet1';
            const spreadsheetData = parseCsvToSpreadsheetData(csvContent, fileName);
            await spreadsheetViewer.loadWorkbook(currentFile, spreadsheetData, { forceReload: true });

            // 标记为未修改（如果代码编辑器没有未保存的更改）
            if (!hadUnsavedChanges) {
                codeEditor.markSaved();
            }

            toggleState = null;

            return {
                changed: true,
                nextViewMode: 'spreadsheet',
                hasUnsavedChanges: hadUnsavedChanges,
            };
        }

        return { changed: false, nextViewMode: activeViewMode, hasUnsavedChanges: false };
    }

    function reset() {
        toggleState = null;
    }

    function handleCodeSaved(content) {
        if (toggleState) {
            toggleState.originalCsvContent = content;
        }
    }

    return {
        toggle,
        reset,
        handleCodeSaved,
    };
}
