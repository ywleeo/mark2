import { spreadsheetDataToCsv, parseCsvToSpreadsheetData } from '../utils/csvParser.js';
import { basename } from '../utils/pathUtils.js';

/**
 * CSV 表格模式切换控制器
 * 实现表格视图 <-> 代码编辑模式的切换
 */
export function createCsvTableMode({
    isCsvFilePath,
    view,
    detectLanguageForPath,
    saveCurrentEditorContentToCache = null,
    getFileContent = null,
}) {
    if (typeof isCsvFilePath !== 'function') {
        throw new Error('createCsvTableMode 需要提供 isCsvFilePath');
    }
    if (!view || typeof view.activate !== 'function') {
        throw new Error('createCsvTableMode 需要提供 view 协议');
    }
    if (typeof detectLanguageForPath !== 'function') {
        throw new Error('createCsvTableMode 需要提供 detectLanguageForPath');
    }

    let toggleState = null;

    /**
     * 从 DocumentRegistry 拿权威 CSV 文本。spreadsheetViewer 装的不是当前文件时
     * 不能信内存数据（其他 tab 残留），改从 DM nonTextCache 的 workbook 转出来。
     */
    async function readAuthoritativeCsv(currentFile) {
        if (typeof getFileContent !== 'function') return '';
        try {
            const fileData = await getFileContent(currentFile);
            if (!fileData) return '';
            // CSV 在 DM 里 viewMode=spreadsheet，content 是 workbook 对象
            if (fileData.content && typeof fileData.content === 'object') {
                return spreadsheetDataToCsv(fileData.content) || '';
            }
            if (typeof fileData.content === 'string') {
                return fileData.content;
            }
        } catch (error) {
            console.warn('[csvTableMode] getFileContent 失败', error);
        }
        return '';
    }

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
            // 只有 spreadsheetViewer 装着当前文件、且 sheets 已就绪时才信任它的内存数据
            const viewerMatchesFile = spreadsheetViewer.currentFile === currentFile
                && Array.isArray(spreadsheetViewer.sheets)
                && spreadsheetViewer.sheets.length > 0;

            let csvContent = '';
            if (viewerMatchesFile) {
                const spreadsheetData = {
                    sheets: [{
                        name: 'Sheet1',
                        rows: spreadsheetViewer.sheets[spreadsheetViewer.activeSheetIndex]?.rows || [],
                    }],
                };
                csvContent = spreadsheetDataToCsv(spreadsheetData) || '';
            }
            // 内存里没有可信内容 → 从 DocumentRegistry 真源读取，避免拿到其他 tab 残留
            if (!csvContent) {
                csvContent = await readAuthoritativeCsv(currentFile);
            }

            // 保存原始状态
            toggleState = {
                originalCsvContent: csvContent,
            };

            // 切换到代码视图
            spreadsheetViewer?.saveViewStateForTab?.(currentFile);
            view.activate('code');

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
            const codeMatchesFile = codeEditor.currentFile === currentFile && !codeEditor.isLoading?.();
            // 编辑器装的就是当前文件 → 用编辑器内容（含未保存编辑）；否则从 DM 真源读
            let csvContent = '';
            let hadUnsavedChanges = false;
            if (codeMatchesFile) {
                csvContent = typeof codeEditor.getValueForSave === 'function'
                    ? codeEditor.getValueForSave()
                    : codeEditor.getValue();
                hadUnsavedChanges = codeEditor.hasUnsavedChanges?.() || false;
                // 把 dirty 内容 flush 到 DM（带身份校验，校验失败会自动跳过）
                if (typeof saveCurrentEditorContentToCache === 'function') {
                    try {
                        saveCurrentEditorContentToCache({ currentFile, activeViewMode: 'code', editor: null, codeEditor });
                    } catch (error) {
                        console.warn('[csvTableMode] saveCache 失败', error);
                    }
                }
            } else {
                csvContent = await readAuthoritativeCsv(currentFile);
            }

            // 保存代码编辑器状态
            codeEditor?.saveViewStateForTab?.(currentFile);

            // 切换到表格视图
            view.activate('spreadsheet');

            // 解析 CSV 并加载到表格查看器
            const fileName = basename(currentFile) || 'Sheet1';
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
