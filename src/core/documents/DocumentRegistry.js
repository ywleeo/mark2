/**
 * DocumentRegistry —— 文档注册表,替代 fileSession。
 *
 * 职责:
 *   - 对文本类文件(markdown/code)创建 DocumentModel,作为内容/dirty 的真源。
 *   - 对二进制/不可编辑文件(spreadsheet/pdf/docx/pptx/media/image)维持轻量 cache。
 *   - 兼容 fileSession 的 API 形状,作为原地替换,调用方无需改动。
 *
 * 设计要点:
 *   - dirty 永远从 DocumentModel 读取,编辑器通过 applyEditorSnapshot 将自身 dirty
 *     与序列化后的内容同步到 Document,解决 TipTap 非幂等序列化带来的 dirty 误判。
 *   - saveCurrentEditorContentToCache 只是把编辑器内部状态同步到 Document,
 *     并保留原 fileSession 的行为语义(未变更时不写入内容)。
 */

import { parseCsvToSpreadsheetData } from '../../utils/csvParser.js';
import { basename } from '../../utils/pathUtils.js';
import { DocumentModel } from './DocumentModel.js';

const UTF8_ERROR_SNIPPETS = ['valid utf-8', 'invalid utf-8', 'utf8 error'];
const TEXT_VIEW_MODES = new Set(['markdown', 'code']);

function isLikelyBinaryReadError(error) {
    if (!error) return false;
    const message = typeof error === 'string' ? error : (error.message || error.error || '');
    if (!message) return false;
    const normalized = message.toLowerCase();
    return UTF8_ERROR_SNIPPETS.some(snippet => normalized.includes(snippet));
}

function snapshotFromDocument(doc) {
    if (!doc) return null;
    return {
        content: doc.getContent(),
        originalContent: doc.getOriginalContent(),
        hasChanges: doc.dirty,
        viewMode: doc.viewMode,
        modifiedTime: doc.getModifiedTime() || null,
    };
}

export function createDocumentRegistry({
    fileService,
    readFile,
    readSpreadsheet,
    readBinaryBase64,
    getViewModeForPath,
    isCsvFilePath,
}) {
    if (typeof getViewModeForPath !== 'function') {
        throw new Error('createDocumentRegistry 需要 getViewModeForPath');
    }
    const readText = fileService?.readText || readFile;
    const readSpreadsheetFn = fileService?.readSpreadsheet || readSpreadsheet;
    const readBinaryBase64Fn = fileService?.readBinaryBase64 || readBinaryBase64;

    if (typeof readText !== 'function') throw new Error('createDocumentRegistry 需要 readText');
    if (typeof readSpreadsheetFn !== 'function') throw new Error('createDocumentRegistry 需要 readSpreadsheet');
    if (typeof readBinaryBase64Fn !== 'function') throw new Error('createDocumentRegistry 需要 readBinaryBase64');

    /** @type {Map<string, DocumentModel>} */
    const documents = new Map();
    /** @type {Map<string, { content: any, hasChanges: boolean, viewMode: string, modifiedTime: number|null, error?: any }>} */
    const nonTextCache = new Map();

    async function fetchModifiedTime(path) {
        if (!path || typeof fileService?.metadata !== 'function') return null;
        try {
            const metadata = await fileService.metadata(path);
            return metadata?.modified_time ?? null;
        } catch {
            return null;
        }
    }

    /**
     * 将当前活跃编辑器的内容与 dirty 同步到对应 DocumentModel。
     * 保留原 fileSession.saveCurrentEditorContentToCache 的行为语义。
     */
    function saveCurrentEditorContentToCache({
        currentFile,
        activeViewMode,
        editor,
        codeEditor,
    }) {
        if (!currentFile) return;

        const defaultViewMode = getViewModeForPath(currentFile);
        const viewModeToStore = defaultViewMode === 'markdown' ? 'markdown' : activeViewMode;
        let content = null;
        let originalContent;
        let hasChanges = false;

        if (activeViewMode === 'markdown' && editor) {
            content = editor.getMarkdown();
            originalContent = editor.originalMarkdown;
            hasChanges = editor.hasUnsavedChanges();
        } else if (activeViewMode === 'code' && codeEditor) {
            content = typeof codeEditor.getValueForSave === 'function'
                ? codeEditor.getValueForSave()
                : codeEditor.getValue();
            hasChanges = codeEditor.hasUnsavedChanges();
        }

        if (content === null) return;

        const resolvedViewMode = TEXT_VIEW_MODES.has(viewModeToStore) ? viewModeToStore : 'code';
        let doc = documents.get(currentFile);
        if (!doc) {
            doc = new DocumentModel({
                uri: currentFile,
                viewMode: resolvedViewMode,
                content: typeof originalContent === 'string' ? originalContent : content,
            });
            documents.set(currentFile, doc);
        }
        doc.applyEditorSnapshot({
            content,
            originalContent,
            dirty: hasChanges,
        });
    }

    async function getFileContent(filePath, options = {}) {
        const { skipCache = false } = options;

        if (!skipCache) {
            const doc = documents.get(filePath);
            if (doc && TEXT_VIEW_MODES.has(doc.viewMode)) {
                // 未 dirty 时校验磁盘 mtime;与 fileSession 行为一致。
                if (!doc.dirty) {
                    const latest = await fetchModifiedTime(filePath);
                    if (latest !== null) {
                        const cachedMt = doc.getModifiedTime();
                        if (!cachedMt || cachedMt !== latest) {
                            documents.delete(filePath);
                        }
                    }
                }
                const stillThere = documents.get(filePath);
                if (stillThere) {
                    const defaultViewMode = getViewModeForPath(filePath);
                    if (defaultViewMode === 'markdown' && stillThere.viewMode !== 'markdown') {
                        stillThere.viewMode = 'markdown';
                    }
                    return snapshotFromDocument(stillThere);
                }
            }
            const cached = nonTextCache.get(filePath);
            if (cached) {
                const latest = await fetchModifiedTime(filePath);
                if (latest === null || latest === cached.modifiedTime) {
                    return { ...cached };
                }
                nonTextCache.delete(filePath);
            }
        } else {
            documents.delete(filePath);
            nonTextCache.delete(filePath);
        }

        const viewMode = getViewModeForPath(filePath);
        const modifiedTime = await fetchModifiedTime(filePath);

        try {
            if (viewMode === 'spreadsheet') {
                let workbook;
                if (isCsvFilePath && isCsvFilePath(filePath)) {
                    const csvText = await readText(filePath);
                    workbook = parseCsvToSpreadsheetData(csvText, basename(filePath) || 'Sheet1');
                } else {
                    workbook = await readSpreadsheetFn(filePath);
                }
                const entry = {
                    content: workbook,
                    hasChanges: false,
                    viewMode,
                    modifiedTime,
                };
                nonTextCache.set(filePath, entry);
                return { ...entry };
            }
            if (viewMode === 'pdf' || viewMode === 'docx' || viewMode === 'pptx') {
                const base64 = await readBinaryBase64Fn(filePath);
                const entry = {
                    content: base64,
                    hasChanges: false,
                    viewMode,
                    modifiedTime,
                };
                nonTextCache.set(filePath, entry);
                return { ...entry };
            }
            if (viewMode === 'media') {
                const entry = {
                    content: null,
                    hasChanges: false,
                    viewMode,
                    modifiedTime,
                };
                nonTextCache.set(filePath, entry);
                return { ...entry };
            }

            const content = await readText(filePath);
            const resolvedViewMode = TEXT_VIEW_MODES.has(viewMode) ? viewMode : 'code';
            const doc = new DocumentModel({
                uri: filePath,
                viewMode: resolvedViewMode,
                content,
                modifiedTime: modifiedTime || 0,
            });
            documents.set(filePath, doc);
            return snapshotFromDocument(doc);
        } catch (error) {
            if (
                viewMode === 'spreadsheet'
                || viewMode === 'pdf'
                || viewMode === 'docx'
                || viewMode === 'pptx'
                || isLikelyBinaryReadError(error)
            ) {
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
        const doc = documents.get(filePath);
        if (doc) return snapshotFromDocument(doc);
        const nonText = nonTextCache.get(filePath);
        return nonText ? { ...nonText } : null;
    }

    async function refreshModifiedTime(filePath) {
        if (!filePath) return null;
        const mt = await fetchModifiedTime(filePath);
        if (mt === null) return null;
        const doc = documents.get(filePath);
        if (doc) {
            doc._modifiedTime = mt;
        }
        const nonText = nonTextCache.get(filePath);
        if (nonText) {
            nonTextCache.set(filePath, { ...nonText, modifiedTime: mt });
        }
        return mt;
    }

    function clearEntry(filePath) {
        documents.delete(filePath);
        nonTextCache.delete(filePath);
    }

    function clearAll() {
        documents.clear();
        nonTextCache.clear();
    }

    function renameEntry(oldPath, newPath) {
        if (!oldPath || !newPath || oldPath === newPath) return;

        const doc = documents.get(oldPath);
        if (doc) {
            documents.delete(oldPath);
            const defaultViewMode = getViewModeForPath(newPath);
            if (defaultViewMode === 'markdown') {
                doc.viewMode = 'markdown';
            } else if (defaultViewMode === 'code') {
                doc.viewMode = 'code';
            } else if (defaultViewMode) {
                doc.viewMode = defaultViewMode;
            }
            doc.rename(newPath);
            documents.set(newPath, doc);
        }

        const nonText = nonTextCache.get(oldPath);
        if (nonText) {
            nonTextCache.delete(oldPath);
            const defaultViewMode = getViewModeForPath(newPath);
            nonTextCache.set(newPath, {
                ...nonText,
                viewMode: defaultViewMode || nonText.viewMode,
            });
        }
    }

    /**
     * 查询 DocumentModel(若存在)。
     */
    function getDocument(path) {
        return path ? (documents.get(path) || null) : null;
    }

    /**
     * 获取指定路径的 DocumentModel,若不存在则通过 getFileContent 懒加载。
     * 仅对可编辑的文本类视图(markdown/code)返回 Document;二进制/媒体类返回 null。
     * 调用方可通过返回值驱动视图 attachDocument 流程。
     *
     * 注意:当前 acquire 未启用 refCount 计数;tab 关闭仍用 clearEntry 销毁 Document,
     * 多视图共享场景(Phase 4+)再引入 release。
     */
    async function acquireDocument(path, options = {}) {
        if (!path) return null;
        const existing = documents.get(path);
        if (existing) return existing;
        await getFileContent(path, options);
        return documents.get(path) || null;
    }

    /**
     * 查询某路径的 dirty 状态,跨 active editor 也能回答。
     */
    function isDirty(path) {
        const doc = documents.get(path);
        return doc ? doc.dirty : false;
    }

    /**
     * 保存成功后调用:把 Document 锁定为"已保存"状态,重置 dirty。
     */
    function markSaved(path, content, modifiedTime) {
        const doc = documents.get(path);
        if (!doc) return;
        if (typeof content === 'string') {
            doc._content = content;
        }
        doc.markSaved(modifiedTime);
    }

    /**
     * 注册(或获取)一份内存中无磁盘对应的文档,如 untitled。
     */
    function registerInMemoryDocument(uri, { viewMode, content = '' }) {
        if (!uri || !viewMode) throw new Error('registerInMemoryDocument 需要 uri 与 viewMode');
        const resolvedViewMode = TEXT_VIEW_MODES.has(viewMode) ? viewMode : 'code';
        let doc = documents.get(uri);
        if (!doc) {
            doc = new DocumentModel({ uri, viewMode: resolvedViewMode, content });
            documents.set(uri, doc);
        }
        return doc;
    }

    return {
        // fileSession 兼容 API
        saveCurrentEditorContentToCache,
        getFileContent,
        getCachedEntry,
        refreshModifiedTime,
        clearEntry,
        clearAll,
        renameEntry,
        // 新增 API(DocumentModel 通道)
        getDocument,
        acquireDocument,
        isDirty,
        markSaved,
        registerInMemoryDocument,
    };
}
