import { rememberSecurityScopes } from '../services/securityScopeService.js';
import { getPathIdentityKey } from '../utils/pathUtils.js';
import { isSpreadsheetFilePath, isCsvFilePath } from '../utils/fileTypeUtils.js';

let sharedExternalDropOpener = null;
let lastExternalDropKey = null;
let lastExternalDropTime = 0;

const EXTERNAL_DROP_DEDUPE_TTL_MS = 750;

export function getExternalDropOpener() {
    return typeof sharedExternalDropOpener === 'function'
        ? sharedExternalDropOpener
        : null;
}

function isMissingFileError(error) {
    if (!error) {
        return false;
    }
    if (typeof error === 'object' && typeof error.code === 'string') {
        if (error.code.toUpperCase() === 'ENOENT') {
            return true;
        }
    }
    const message = typeof error === 'string'
        ? error
        : (error.message || error.error || '');
    if (!message) {
        return false;
    }
    const normalized = message.toLowerCase();
    return normalized.includes('no such file')
        || normalized.includes('not found')
        || normalized.includes('does not exist')
        || normalized.includes('不存在')
        || normalized.includes('找不到');
}

function getReadableErrorMessage(error) {
    if (typeof error === 'string') {
        return error;
    }
    if (error && typeof error.message === 'string') {
        return error.message;
    }
    if (error && typeof error.toString === 'function') {
        return error.toString();
    }
    return '未知错误';
}

export function createFileOperations({
    logger,
    getFileTree,
    getEditor,
    getCodeEditor,
    getImageViewer,
    getMediaViewer,
    getSpreadsheetViewer,
    getPdfViewer,
    getUnsupportedViewer,
    getMarkdownCodeMode,
    getCurrentFile,
    setCurrentFile,
    documentManager,
    getActiveViewMode,
    setHasUnsavedChanges,
    fileSession,
    documentSessions,
    detectLanguageForPath,
    viewManager,
    normalizeFsPath,
    normalizeSelectedPaths,
    fileService,
    persistWorkspaceState,
    updateWindowTitle,
    saveCurrentEditorContentToCache,
    rememberMarkdownScrollPosition,
    restoreMarkdownScrollPosition,
    restoreScrollPosition,
    recentFilesService,
    updateRecentMenuFn,
    untitledFileManager,
    saveUntitledFile,
    importAsUntitled,
    getStatusBarController,
}) {
    if (typeof getFileTree !== 'function') throw new Error('fileOperations 需要 getFileTree');
    if (typeof getEditor !== 'function') throw new Error('fileOperations 需要 getEditor');
    if (typeof getCodeEditor !== 'function') throw new Error('fileOperations 需要 getCodeEditor');
    if (typeof getImageViewer !== 'function') throw new Error('fileOperations 需要 getImageViewer');
    if (typeof getMediaViewer !== 'function') throw new Error('fileOperations 需要 getMediaViewer');
    if (typeof getSpreadsheetViewer !== 'function') throw new Error('fileOperations 需要 getSpreadsheetViewer');
    if (typeof getPdfViewer !== 'function') throw new Error('fileOperations 需要 getPdfViewer');
    if (typeof getUnsupportedViewer !== 'function') throw new Error('fileOperations 需要 getUnsupportedViewer');
    if (typeof getMarkdownCodeMode !== 'function') throw new Error('fileOperations 需要 getMarkdownCodeMode');
    if (typeof getCurrentFile !== 'function') throw new Error('fileOperations 需要 getCurrentFile');
    if (typeof setCurrentFile !== 'function') throw new Error('fileOperations 需要 setCurrentFile');
    if (typeof getActiveViewMode !== 'function') throw new Error('fileOperations 需要 getActiveViewMode');
    if (typeof setHasUnsavedChanges !== 'function') throw new Error('fileOperations 需要 setHasUnsavedChanges');
    if (!fileSession) throw new Error('fileOperations 需要 fileSession');
    if (!documentSessions || typeof documentSessions.beginSession !== 'function') {
        throw new Error('fileOperations 需要 documentSessions');
    }
    if (typeof detectLanguageForPath !== 'function') throw new Error('fileOperations 需要 detectLanguageForPath');
    if (!viewManager || typeof viewManager.resolveViewMode !== 'function') {
        throw new Error('fileOperations 需要 viewManager');
    }
    if (typeof normalizeFsPath !== 'function') throw new Error('fileOperations 需要 normalizeFsPath');
    if (typeof normalizeSelectedPaths !== 'function') throw new Error('fileOperations 需要 normalizeSelectedPaths');
    if (!fileService) throw new Error('fileOperations 需要 fileService');
    if (typeof persistWorkspaceState !== 'function') throw new Error('fileOperations 需要 persistWorkspaceState');
    if (typeof updateWindowTitle !== 'function') throw new Error('fileOperations 需要 updateWindowTitle');
    if (typeof saveCurrentEditorContentToCache !== 'function')
        throw new Error('fileOperations 需要 saveCurrentEditorContentToCache');
    if (typeof rememberMarkdownScrollPosition !== 'function')
        throw new Error('fileOperations 需要 rememberMarkdownScrollPosition');
    if (typeof restoreMarkdownScrollPosition !== 'function')
        throw new Error('fileOperations 需要 restoreMarkdownScrollPosition');

    const getSessionPathKey = (path) => {
        const normalized = normalizeFsPath(path);
        return normalized || path;
    };

    const rendererViewContext = viewManager.createRendererLoadContext?.() || {};
    const viewProtocol = rendererViewContext.view || viewManager.createViewProtocol?.() || null;

    const getIdentityKeyForPath = (path) => {
        if (!path) {
            return null;
        }
        const normalized = normalizeFsPath(path);
        const basePath = normalized || path;
        const identityKey = getPathIdentityKey(basePath);
        return identityKey || basePath;
    };

    async function openPathsFromSelection(rawPaths, options = {}) {
        const { source } = options || {};
        const selectionEntries = Array.isArray(rawPaths)
            ? rawPaths.filter(Boolean)
            : rawPaths
                ? [rawPaths]
                : [];

        if (selectionEntries.length > 0) {
            try {
                await rememberSecurityScopes(selectionEntries);
            } catch (error) {
                console.warn('[fileOperations] 记录文件权限失败', error);
            }
        }

        const selections = normalizeSelectedPaths(selectionEntries)
            .map(normalizeFsPath)
            .filter(Boolean);

        if (selections.length === 0) {
            return;
        }

        if (source === 'external-drop') {
            const identityKeys = selections
                .map((path) => getPathIdentityKey(path))
                .filter(Boolean);

            if (identityKeys.length === 0) {
                return;
            }

            const dedupeKey = identityKeys.slice().sort().join('|');
            const now = Date.now();
            const delta = now - lastExternalDropTime;
            const isDuplicate = lastExternalDropKey === dedupeKey
                && delta < EXTERNAL_DROP_DEDUPE_TTL_MS;

            if (isDuplicate) {
                return;
            }

            lastExternalDropKey = dedupeKey;
            lastExternalDropTime = now;
        }

        const fileTree = getFileTree();
        if (!fileTree) {
            console.warn('文件树尚未初始化，无法打开拖入的路径');
            return;
        }

        const uniqueSelections = Array.from(new Set(selections));

        for (const resolvedPath of uniqueSelections) {
            try {
                const isDir = await fileService.isDirectory(resolvedPath);

                if (isDir) {
                    await fileTree.loadFolder(resolvedPath);
                    // 记录文件夹打开历史
                    if (recentFilesService && typeof recentFilesService.recordOpen === 'function') {
                        try {
                            recentFilesService.recordOpen(resolvedPath, 'folder');
                            // 更新菜单
                            if (updateRecentMenuFn && typeof updateRecentMenuFn === 'function') {
                                void updateRecentMenuFn();
                            }
                        } catch (error) {
                            console.warn('[fileOperations] 记录最近文件夹失败:', error);
                        }
                    }
                } else {
                    // docx/spreadsheet 等导入型文件不加入 open list，直接触发文件选择
                    // 这类文件会被渲染器转成 untitled tab，不应在文件树中留下持久 tab
                    const viewMode = viewManager.resolveViewMode(resolvedPath);
                    const isImportType = viewMode === 'docx' || viewMode === 'pptx' || viewMode === 'spreadsheet';
                    if (!isImportType) {
                        fileTree.addToOpenFiles(resolvedPath);
                    }
                    fileTree.selectFile(resolvedPath);
                }
            } catch (error) {
                console.error('处理路径失败:', { resolvedPath, error });
            }
        }
    }

    sharedExternalDropOpener = openPathsFromSelection;

    async function openFileOrFolder() {
        try {
            const selected = await fileService.pick();
            await openPathsFromSelection(selected);
        } catch (error) {
            console.error('打开失败:', error);
            alert('打开失败: ' + error);
        }
    }

    async function openFileOnly() {
        try {
            const selected = await fileService.pick({ allowDirectories: false, allowFiles: true });
            await openPathsFromSelection(selected);
        } catch (error) {
            console.error('打开文件失败:', error);
            alert('打开文件失败: ' + error);
        }
    }

    async function openFolderOnly() {
        try {
            const selected = await fileService.pick({ directory: true, allowDirectories: true, allowFiles: false });
            await openPathsFromSelection(selected);
        } catch (error) {
            console.error('打开文件夹失败:', error);
            alert('打开文件夹失败: ' + error);
        }
    }

    async function saveExcelAsCsv(excelPath, editor) {
        try {
            const { save } = await import('@tauri-apps/plugin-dialog');
            const defaultPath = excelPath.replace(/\.[^.]+$/, '.csv');
            const targetPath = await save({
                title: '另存为 CSV',
                defaultPath,
                filters: [{ name: 'CSV', extensions: ['csv'] }],
            });
            if (!targetPath) return false;
            const csvContent = editor.getMarkdown?.() || '';
            await fileService.writeText(targetPath, csvContent);
            editor.markSaved?.();
            setHasUnsavedChanges(false);
            await updateWindowTitle();
            return true;
        } catch (err) {
            console.error('[SaveExcel] 另存 CSV 失败:', err);
            return false;
        }
    }

    async function saveCurrentFile() {
        const currentFile = getCurrentFile();
        if (!currentFile) {
            logger?.info?.('saveCurrentFile:skip', { reason: 'no-current-file' });
            return false;
        }
        logger?.info?.('saveCurrentFile:start', {
            path: currentFile,
            activeViewMode: getActiveViewMode(),
        });

        // 处理 untitled 文件的保存
        if (untitledFileManager?.isUntitledPath?.(currentFile)) {
            return saveUntitledFileFromEditor(currentFile);
        }

        const activeSession = documentSessions.getActiveSession();
        if (!activeSession || activeSession.filePath !== currentFile) {
            logger?.warn?.('saveCurrentFile:skip', {
                reason: 'session-mismatch',
                path: currentFile,
                activeSessionPath: activeSession?.filePath || null,
            });
            return false;
        }

        const editor = getEditor();
        const codeEditor = getCodeEditor();
        const activeViewMode = getActiveViewMode();

        if (activeViewMode === 'markdown' && editor) {
            // Excel 文件在 csv-table 模式下：另存为新 CSV 文件，不覆盖原 Excel
            if (isSpreadsheetFilePath(currentFile) && !isCsvFilePath(currentFile)) {
                return await saveExcelAsCsv(currentFile, editor);
            }
            const result = await editor.save();
            if (result) {
                setHasUnsavedChanges(false);
                documentManager?.markDirty?.(currentFile, false);
                fileSession.clearEntry(currentFile);
                await updateWindowTitle();
                logger?.info?.('saveCurrentFile:done', {
                    path: currentFile,
                    activeViewMode,
                    writer: 'markdown-editor',
                });
            }
            return result;
        }

        if (activeViewMode === 'code' && codeEditor) {
            const localWriteKey = getSessionPathKey(currentFile);
            try {
                const raw = codeEditor.getValue();
                const content = typeof codeEditor.getValueForSave === 'function'
                    ? codeEditor.getValueForSave()
                    : raw;
                if (localWriteKey && documentSessions.markLocalWrite) {
                    documentSessions.markLocalWrite(localWriteKey);
                }
                await fileService.writeText(currentFile, content);
                // 如果内容被格式化了，同步更新编辑器内容
                if (content !== raw && codeEditor.editor) {
                    const position = codeEditor.getCurrentPosition();
                    codeEditor.suppressChange = true;
                    codeEditor.editor.dispatch({
                        changes: { from: 0, to: codeEditor.editor.state.doc.length, insert: content }
                    });
                    codeEditor.suppressChange = false;
                    if (position) {
                        codeEditor.setPositionOnly(position.lineNumber, position.column);
                    }
                }
                const markdownCodeMode = getMarkdownCodeMode();
                markdownCodeMode?.handleCodeSaved(content);
                codeEditor.markSaved();
                setHasUnsavedChanges(false);
                documentManager?.markDirty?.(currentFile, false);
                fileSession.clearEntry(currentFile);
                await updateWindowTitle();
                logger?.info?.('saveCurrentFile:done', {
                    path: currentFile,
                    activeViewMode,
                    writer: 'code-editor',
                    contentLength: typeof content === 'string' ? content.length : 0,
                });
                return true;
            } catch (error) {
                if (localWriteKey && documentSessions.clearLocalWriteSuppression) {
                    documentSessions.clearLocalWriteSuppression(localWriteKey);
                }
                console.error('保存失败:', error);
                logger?.error?.('saveCurrentFile:failed', {
                    path: currentFile,
                    activeViewMode,
                    error,
                });
                alert('保存失败: ' + error);
                return false;
            }
        }

        logger?.warn?.('saveCurrentFile:skip', {
            reason: 'unsupported-view-mode',
            path: currentFile,
            activeViewMode,
        });
        return false;
    }

    /**
     * 保存 untitled 文件 - 获取编辑器内容并弹出保存对话框
     */
    async function saveUntitledFileFromEditor(untitledPath) {
        const editor = getEditor();
        const codeEditor = getCodeEditor();
        const activeViewMode = getActiveViewMode();

        let content = '';
        if (activeViewMode === 'markdown' && editor) {
            content = editor.getMarkdown?.() || '';
        } else if (activeViewMode === 'code' && codeEditor) {
            content = codeEditor.getValue?.() || '';
        }

        if (typeof saveUntitledFile === 'function') {
            logger?.info?.('saveUntitledFile:start', {
                path: untitledPath,
                activeViewMode,
                contentLength: typeof content === 'string' ? content.length : 0,
            });
            const saved = await saveUntitledFile(untitledPath, content);
            if (saved) {
                setHasUnsavedChanges(false);
                documentManager?.markDirty?.(untitledPath, false);
                await updateWindowTitle();
                logger?.info?.('saveUntitledFile:done', {
                    path: untitledPath,
                    activeViewMode,
                });
            }
            return saved;
        }
        return false;
    }

    async function saveFile(filePath) {
        const currentFile = getCurrentFile();
        logger?.info?.('saveFile:start', {
            requestedPath: filePath,
            currentPath: currentFile,
        });

        const requestedKey = getIdentityKeyForPath(filePath);
        const currentKey = getIdentityKeyForPath(currentFile);
        const cached = fileSession.getCachedEntry(filePath);

        if (requestedKey && currentKey && requestedKey === currentKey) {
            return await saveCurrentFile();
        }

        if (!cached || !cached.hasChanges) {
            logger?.info?.('saveFile:skip', {
                requestedPath: filePath,
                reason: 'no-cache-or-clean',
            });
            return true;
        }

        const localWriteKey = getSessionPathKey(filePath);
        try {
            if (localWriteKey && documentSessions.markLocalWrite) {
                documentSessions.markLocalWrite(localWriteKey);
            }
            await fileService.writeText(filePath, cached.content);
            fileSession.clearEntry(filePath);
            logger?.info?.('saveFile:done', {
                requestedPath: filePath,
                writer: 'cached-session',
                contentLength: typeof cached.content === 'string' ? cached.content.length : 0,
            });
            return true;
        } catch (error) {
            if (localWriteKey && documentSessions.clearLocalWriteSuppression) {
                documentSessions.clearLocalWriteSuppression(localWriteKey);
            }
            console.error('保存文件失败:', error);
            logger?.error?.('saveFile:failed', {
                requestedPath: filePath,
                writer: 'cached-session',
                error,
            });
            return false;
        }
    }

    let loadPipeline = Promise.resolve();

    async function performLoad(filePath, options = {}) {
        const {
            skipWatchSetup = false,
            forceReload = false,
            autoFocus = true,
            suppressMissingFileErrors = false,
        } = options;
        const session = documentSessions.beginSession(filePath);
        const sessionId = session?.id ?? null;
        logger?.info?.('loadFile:start', {
            path: filePath,
            sessionId,
            skipWatchSetup,
            forceReload,
            autoFocus,
        });
        const shouldAbort = (phase) => {
            if (!sessionId) {
                return false;
            }
            if (!documentSessions.isSessionActive(sessionId)) {
                console.debug('[DocumentSession] 跳过已过期的 loadFile 调用', {
                    filePath,
                    phase,
                    sessionId,
                });
                return true;
            }
            return false;
        };
        const markSessionReady = () => {
            if (sessionId) {
                documentSessions.markSessionReady(sessionId);
            }
        };

        try {
            // 计算目标文件的视图模式
            const initialViewMode = viewManager.resolveViewMode(filePath);
            const renderer = viewManager.getRendererForPath(filePath);

            // 导入型文件（docx/spreadsheet）：不影响当前编辑器状态，只读文件并触发导入
            if (importAsUntitled && (initialViewMode === 'docx' || initialViewMode === 'pptx' || initialViewMode === 'spreadsheet')) {
                const statusBar = getStatusBarController?.();
                statusBar?.showProgress?.('正在读取文件…');
                try {
                    const fileData = await fileSession.getFileContent(filePath, { skipCache: forceReload });
                    if (shouldAbort('import-read')) return;
                    await renderer?.load({
                        filePath,
                        fileData,
                        fileService,
                        importAsUntitled: (content, suggestedName) => {
                            if (sessionId) documentSessions.closeSession(sessionId);
                            return importAsUntitled(content, suggestedName, filePath);
                        },
                    });
                } finally {
                    statusBar?.hideProgress?.();
                }
                return;
            }

            const previousFile = getCurrentFile();
            const previousViewMode = getActiveViewMode();
            if (previousFile) {
                rememberMarkdownScrollPosition(previousFile, previousViewMode);
            }
            if (previousFile !== filePath) {
                const markdownCodeMode = getMarkdownCodeMode();
                markdownCodeMode?.reset();
            }
            const normalizedTargetPath = typeof filePath === 'string'
                ? normalizeFsPath(filePath) || filePath
                : null;
            const fileTree = getFileTree();
            const providedTabId = typeof options.tabId === 'string' && options.tabId.length > 0
                ? options.tabId
                : null;
            const hasPersistentTab = normalizedTargetPath
                ? Boolean(fileTree?.isInOpenList?.(normalizedTargetPath))
                : false;
            const tabId = providedTabId
                || (hasPersistentTab ? normalizedTargetPath : null);

            setCurrentFile(filePath, {
                tabId,
                kind: untitledFileManager?.isUntitledPath?.(filePath) ? 'untitled' : 'file',
                viewMode: initialViewMode,
                sessionId,
                dirty: false,
            });
            logger?.info?.('loadFile:setCurrentFile', {
                path: filePath,
                tabId,
                sessionId,
                initialViewMode,
            });

            const rendererViewMode = renderer?.getViewMode?.(filePath) || null;

            const editor = getEditor();
            const codeEditor = getCodeEditor();
            const imageViewer = getImageViewer();
            const mediaViewer = getMediaViewer();
            const spreadsheetViewer = getSpreadsheetViewer();
            const pdfViewer = getPdfViewer();
            const unsupportedViewer = getUnsupportedViewer();
            editor?.prepareForDocument?.(session, filePath, tabId);
            codeEditor?.prepareForDocument?.(session, filePath, tabId);
            // 关闭旧文件可能仍在等待自动保存，提前清除避免写入到新文件
            editor?.clearAutoSaveTimer?.();

            // 处理 untitled 虚拟文件：不监听文件，不从磁盘读取，直接显示编辑器
            if (untitledFileManager?.isUntitledPath?.(filePath)) {
                viewProtocol?.activate?.('markdown');
                const untitledContent = untitledFileManager.getContent?.(filePath) || '';
                if (editor) {
                    await editor.loadFile(session, filePath, untitledContent, { autoFocus });
                    if (shouldAbort('untitled-editor-load')) {
                        return;
                    }
                }
                setHasUnsavedChanges(untitledContent.trim().length > 0);
                await updateWindowTitle();
                if (shouldAbort('untitled-title')) {
                    return;
                }
                markSessionReady();
                logger?.info?.('loadFile:done', {
                    path: filePath,
                    sessionId,
                    targetViewMode: 'markdown',
                    source: 'untitled',
                });
                return;
            }

            if (initialViewMode === 'image') {
                if (!renderer || rendererViewMode !== 'image') {
                    throw new Error('缺少 image 渲染器');
                }
                await renderer.load({
                    filePath,
                    editorRegistry: {
                        getMarkdownEditor: () => editor,
                        getCodeEditor: () => codeEditor,
                    },
                    imageViewer,
                    view: viewProtocol,
                });
                if (shouldAbort('image-load')) {
                    return;
                }
                setHasUnsavedChanges(false);
                await updateWindowTitle();
                if (shouldAbort('image-title')) {
                    return;
                }
                if (!skipWatchSetup) {
                    try {
                        await fileTree?.watchFile(filePath);
                        if (shouldAbort('image-watch')) {
                            return;
                        }
                    } catch (error) {
                        console.error('无法监听文件:', error);
                    }
                }
                if (shouldAbort('image-finalize')) {
                    return;
                }
                fileTree?.clearExternalModification?.(filePath);
                persistWorkspaceState();
                markSessionReady();
                logger?.info?.('loadFile:done', {
                    path: filePath,
                    sessionId,
                    targetViewMode: 'image',
                });
                return;
            }

            if (initialViewMode === 'media') {
                if (!renderer || rendererViewMode !== 'media') {
                    throw new Error('缺少 media 渲染器');
                }
                await renderer.load({
                    filePath,
                    editorRegistry: {
                        getMarkdownEditor: () => editor,
                        getCodeEditor: () => codeEditor,
                    },
                    mediaViewer,
                    view: viewProtocol,
                });
                if (shouldAbort('media-load')) {
                    return;
                }
                setHasUnsavedChanges(false);
                await updateWindowTitle();
                if (shouldAbort('media-title')) {
                    return;
                }
                if (!skipWatchSetup) {
                    try {
                        await fileTree?.watchFile(filePath);
                        if (shouldAbort('media-watch')) {
                            return;
                        }
                    } catch (error) {
                        console.error('无法监听文件:', error);
                    }
                }
                if (shouldAbort('media-finalize')) {
                    return;
                }
                fileTree?.clearExternalModification?.(filePath);
                persistWorkspaceState();
                markSessionReady();
                logger?.info?.('loadFile:done', {
                    path: filePath,
                    sessionId,
                    targetViewMode: 'media',
                });
                return;
            }

            const fileData = await fileSession.getFileContent(filePath, { skipCache: forceReload });
            if (shouldAbort('after-read')) {
                return;
            }
            const targetViewMode = fileData.viewMode || initialViewMode;
            // 判断是否应该自动聚焦编辑器：
            // 只有在 markdown 和 code 编辑器之间切换时才自动聚焦
            const isEditorMode = (mode) => mode === 'markdown' || mode === 'code';
            const shouldAutoFocus = autoFocus
                && isEditorMode(previousViewMode)
                && isEditorMode(targetViewMode)
                && previousViewMode !== targetViewMode;

            if (targetViewMode === 'unsupported') {
                viewProtocol?.activate?.('unsupported');
                unsupportedViewer?.show(filePath, fileData.error);
                setHasUnsavedChanges(false);
                await updateWindowTitle();
                if (shouldAbort('unsupported-title')) {
                    return;
                }
                if (!skipWatchSetup) {
                    fileTree?.stopWatchingFile?.(filePath);
                }
                if (shouldAbort('unsupported-finalize')) {
                    return;
                }
                fileTree?.clearExternalModification?.(filePath);
                persistWorkspaceState();
                markSessionReady();
                logger?.info?.('loadFile:done', {
                    path: filePath,
                    sessionId,
                    targetViewMode: 'unsupported',
                });
                return;
            }

            let effectiveRenderer = renderer;
            if (!effectiveRenderer || rendererViewMode !== targetViewMode) {
                effectiveRenderer = viewManager.resolveRenderer(filePath, targetViewMode);
            }
            if (!effectiveRenderer) {
                throw new Error(`缺少 ${targetViewMode} 渲染器`);
            }

            const handled = await effectiveRenderer.load({
                filePath,
                session,
                fileData,
                editorRegistry: {
                    getMarkdownEditor: () => editor,
                    getCodeEditor: () => codeEditor,
                },
                view: viewProtocol,
                detectLanguageForPath,
                restoreMarkdownScrollPosition,
                restoreScrollPosition,
                setHasUnsavedChanges,
                updateWindowTitle,
                shouldAutoFocus,
                tabId,
                imageViewer,
                mediaViewer,
                spreadsheetViewer,
                pdfViewer,
                unsupportedViewer,
                fileService,
                importAsUntitled: importAsUntitled
                    ? (content, suggestedName) => {
                        if (sessionId) documentSessions.closeSession(sessionId);
                        return importAsUntitled(content, suggestedName, filePath);
                    }
                    : undefined,
                forceReload,
            });
            if (shouldAbort('renderer-load')) {
                return;
            }
            if (targetViewMode !== 'markdown' && targetViewMode !== 'code') {
                setHasUnsavedChanges(false);
                await updateWindowTitle();
            }

            if (!skipWatchSetup) {
                try {
                    await fileTree?.watchFile(filePath);
                    if (shouldAbort('watch-file')) {
                        return;
                    }
                } catch (error) {
                    console.error('无法监听文件:', error);
                }
            }
            if (shouldAbort('finalize')) {
                return;
            }
            fileTree?.clearExternalModification?.(filePath);
            persistWorkspaceState();

            // 记录文件打开历史
            if (recentFilesService && typeof recentFilesService.recordOpen === 'function') {
                try {
                    recentFilesService.recordOpen(filePath, 'file');
                    // 更新菜单
                    if (updateRecentMenuFn && typeof updateRecentMenuFn === 'function') {
                        void updateRecentMenuFn();
                    }
                } catch (error) {
                    console.warn('[fileOperations] 记录最近文件失败:', error);
                }
            }

            markSessionReady();
            logger?.info?.('loadFile:done', {
                path: filePath,
                sessionId,
                targetViewMode,
                forceReload,
            });
        } catch (error) {
            if (sessionId) {
                documentSessions.closeSession(sessionId);
            }
            // 如果读取失败，清理缓存，避免下次仍然返回旧内容
            if (fileSession?.clearEntry && filePath) {
                fileSession.clearEntry(filePath);
            }

            if (suppressMissingFileErrors && isMissingFileError(error)) {
                return;
            }

            const readableMessage = getReadableErrorMessage(error);
            console.error('读取文件失败:', readableMessage, error);
            logger?.error?.('loadFile:failed', {
                path: filePath,
                sessionId,
                error: readableMessage,
            });
            alert('读取文件失败: ' + readableMessage);
            throw error;
        }
    }

    async function loadFile(filePath, options = {}) {
        const previous = loadPipeline.catch(() => {});
        const next = (async () => {
            await previous;
            return performLoad(filePath, options);
        })();
        loadPipeline = next.catch(() => {});
        return next;
    }

    return {
        openPathsFromSelection,
        openFileOrFolder,
        openFileOnly,
        openFolderOnly,
        saveCurrentFile,
        saveFile,
        loadFile,
    };
}
