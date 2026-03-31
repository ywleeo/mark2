import { parseCsvToSpreadsheetData } from '../utils/csvParser.js';
import { basename } from '../utils/pathUtils.js';

const UTF8_ERROR_SNIPPETS = [
    'valid utf-8',
    'invalid utf-8',
    'utf8 error',
];

function isLikelyBinaryReadError(error) {
    if (!error) {
        return false;
    }
    const message = typeof error === 'string'
        ? error
        : (error.message || error.error || '');
    if (!message) {
        return false;
    }
    const normalized = message.toLowerCase();
    return UTF8_ERROR_SNIPPETS.some(snippet => normalized.includes(snippet));
}

export function createFileSession({
    fileService,
    readFile,
    readSpreadsheet,
    readBinaryBase64,
    getViewModeForPath,
    isCsvFilePath,
}) {
    if (typeof getViewModeForPath !== 'function') {
        throw new Error('createFileSession 需要提供 getViewModeForPath 函数');
    }

    const readText = fileService?.readText || readFile;
    const readSpreadsheetFn = fileService?.readSpreadsheet || readSpreadsheet;
    const readBinaryBase64Fn = fileService?.readBinaryBase64 || readBinaryBase64;

    if (typeof readText !== 'function') {
        throw new Error('createFileSession 需要提供 readText 函数');
    }
    if (typeof readSpreadsheetFn !== 'function') {
        throw new Error('createFileSession 需要提供 readSpreadsheet 函数');
    }
    if (typeof readBinaryBase64Fn !== 'function') {
        throw new Error('createFileSession 需要提供 readBinaryBase64 函数');
    }

    const cache = new Map();

    async function getFileModifiedTime(filePath) {
        if (!filePath || typeof fileService?.metadata !== 'function') {
            return null;
        }
        try {
            const metadata = await fileService.metadata(filePath);
            if (!metadata || !metadata.modified_time) {
                return null;
            }
            return metadata.modified_time;
        } catch {
            return null;
        }
    }

    function saveCurrentEditorContentToCache({
        currentFile,
        activeViewMode,
        editor,
        codeEditor,
    }) {
        if (!currentFile) return;

        const viewMode = activeViewMode;
        const defaultViewMode = currentFile ? getViewModeForPath(currentFile) : null;
        const viewModeToStore = defaultViewMode === 'markdown' ? 'markdown' : viewMode;
        const existing = cache.get(currentFile);
        let content = null;
        let originalContent = null;
        let hasChanges = false;

        if (viewMode === 'markdown' && editor) {
            content = editor.getMarkdown();
            originalContent = editor.originalMarkdown;
            hasChanges = editor.hasUnsavedChanges();
        } else if (viewMode === 'code' && codeEditor) {
            content = typeof codeEditor.getValueForSave === 'function'
                ? codeEditor.getValueForSave()
                : codeEditor.getValue();
            hasChanges = codeEditor.hasUnsavedChanges();
        }

        if (content !== null) {
            cache.set(currentFile, {
                content,
                originalContent,
                hasChanges,
                viewMode: viewModeToStore,
                modifiedTime: existing?.modifiedTime ?? null,
            });
        }
    }

    async function getFileContent(filePath, options = {}) {
        const { skipCache = false } = options;

        if (!skipCache) {
            const cached = cache.get(filePath);
            if (cached) {
                if (!cached.hasChanges) {
                    const latestModifiedTime = await getFileModifiedTime(filePath);
                    if (latestModifiedTime !== null) {
                        if (cached.modifiedTime === null || cached.modifiedTime === undefined) {
                            cache.delete(filePath);
                        } else if (latestModifiedTime !== cached.modifiedTime) {
                            cache.delete(filePath);
                        }
                    }
                }
            }

            const refreshed = cache.get(filePath);
            if (refreshed) {
                const defaultViewMode = getViewModeForPath(filePath);
                if (defaultViewMode === 'markdown' && refreshed.viewMode !== 'markdown') {
                    const coerced = {
                        ...refreshed,
                        viewMode: 'markdown',
                    };
                    cache.set(filePath, coerced);
                    return coerced;
                }
                return refreshed;
            }
        }

        const viewMode = getViewModeForPath(filePath);
        const modifiedTime = await getFileModifiedTime(filePath);

        try {
            if (viewMode === 'spreadsheet') {
                let workbook;
                // CSV 文件使用 JavaScript 解析器
                if (isCsvFilePath && isCsvFilePath(filePath)) {
                    const csvText = await readText(filePath);
                    const fileName = basename(filePath) || 'Sheet1';
                    workbook = parseCsvToSpreadsheetData(csvText, fileName);
                } else {
                    // Excel 文件使用 Rust 后端解析
                    workbook = await readSpreadsheetFn(filePath);
                }
                const result = {
                    content: workbook,
                    hasChanges: false,
                    viewMode,
                    modifiedTime,
                };
                cache.set(filePath, result);
                return result;
            }

            if (viewMode === 'pdf' || viewMode === 'docx' || viewMode === 'pptx') {
                const base64 = await readBinaryBase64Fn(filePath);
                const result = {
                    content: base64,
                    hasChanges: false,
                    viewMode,
                    modifiedTime,
                };
                cache.set(filePath, result);
                return result;
            }

            if (viewMode === 'media') {
                const result = {
                    content: null,
                    hasChanges: false,
                    viewMode,
                    modifiedTime,
                };
                cache.set(filePath, result);
                return result;
            }

            const content = await readText(filePath);
            const result = {
                content,
                hasChanges: false,
                viewMode,
                modifiedTime,
            };
            cache.set(filePath, result);
            return result;
        } catch (error) {
            if (viewMode === 'spreadsheet' || viewMode === 'pdf' || viewMode === 'docx' || viewMode === 'pptx' || isLikelyBinaryReadError(error)) {
                return {
                    content: null,
                    hasChanges: false,
                    viewMode: 'unsupported',
                    error,
                    modifiedTime,
                };
            }
            throw error;
        }
    }

    function getCachedEntry(filePath) {
        return cache.get(filePath) || null;
    }

    async function refreshModifiedTime(filePath) {
        if (!filePath) {
            return null;
        }
        const modifiedTime = await getFileModifiedTime(filePath);
        if (modifiedTime === null) {
            return null;
        }
        const existing = cache.get(filePath);
        if (existing) {
            cache.set(filePath, {
                ...existing,
                modifiedTime,
            });
        }
        return modifiedTime;
    }

    function clearEntry(filePath) {
        cache.delete(filePath);
    }

    function clearAll() {
        cache.clear();
    }

    function renameEntry(oldPath, newPath) {
        if (!oldPath || !newPath || oldPath === newPath) {
            return;
        }
        const existing = cache.get(oldPath);
        if (!existing) {
            return;
        }
        cache.delete(oldPath);
        const defaultViewMode = getViewModeForPath(newPath);
        let nextViewMode = existing.viewMode;
        if (defaultViewMode === 'markdown') {
            nextViewMode = 'markdown';
        } else if (defaultViewMode === 'code') {
            nextViewMode = 'code';
        } else if (defaultViewMode) {
            nextViewMode = defaultViewMode;
        }
        cache.set(newPath, {
            ...existing,
            viewMode: nextViewMode,
        });
    }

    return {
        saveCurrentEditorContentToCache,
        getFileContent,
        getCachedEntry,
        refreshModifiedTime,
        clearEntry,
        clearAll,
        renameEntry,
    };
}
