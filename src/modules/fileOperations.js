export function createFileOperations({
    getFileTree,
    getEditor,
    getCodeEditor,
    getImageViewer,
    getSpreadsheetViewer,
    getPdfViewer,
    getUnsupportedViewer,
    getMarkdownCodeMode,
    getCurrentFile,
    setCurrentFile,
    getActiveViewMode,
    setHasUnsavedChanges,
    fileSession,
    documentSessions,
    detectLanguageForPath,
    getViewModeForPath,
    normalizeFsPath,
    normalizeSelectedPaths,
    fileService,
    persistWorkspaceState,
    updateWindowTitle,
    saveCurrentEditorContentToCache,
    rememberMarkdownScrollPosition,
    restoreMarkdownScrollPosition,
    activateMarkdownView,
    activateCodeView,
    activateImageView,
    activateSpreadsheetView,
    activatePdfView,
    activateUnsupportedView,
}) {
    if (typeof getFileTree !== 'function') throw new Error('fileOperations 需要 getFileTree');
    if (typeof getEditor !== 'function') throw new Error('fileOperations 需要 getEditor');
    if (typeof getCodeEditor !== 'function') throw new Error('fileOperations 需要 getCodeEditor');
    if (typeof getImageViewer !== 'function') throw new Error('fileOperations 需要 getImageViewer');
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
    if (typeof getViewModeForPath !== 'function') throw new Error('fileOperations 需要 getViewModeForPath');
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
    if (typeof activateMarkdownView !== 'function') throw new Error('fileOperations 需要 activateMarkdownView');
    if (typeof activateCodeView !== 'function') throw new Error('fileOperations 需要 activateCodeView');
    if (typeof activateImageView !== 'function') throw new Error('fileOperations 需要 activateImageView');
    if (typeof activateSpreadsheetView !== 'function') throw new Error('fileOperations 需要 activateSpreadsheetView');
    if (typeof activatePdfView !== 'function') throw new Error('fileOperations 需要 activatePdfView');
    if (typeof activateUnsupportedView !== 'function') throw new Error('fileOperations 需要 activateUnsupportedView');

    const getSessionPathKey = (path) => {
        const normalized = normalizeFsPath(path);
        return normalized || path;
    };


    async function openPathsFromSelection(rawPaths) {
        const selections = normalizeSelectedPaths(rawPaths)
            .map(normalizeFsPath)
            .filter(Boolean);

        if (selections.length === 0) {
            return;
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
                } else {
                    fileTree.addToOpenFiles(resolvedPath);
                    fileTree.selectFile(resolvedPath);
                }
            } catch (error) {
                console.error('处理路径失败:', { resolvedPath, error });
            }
        }
    }

    async function openFileOrFolder() {
        try {
            const selected = await fileService.pick();
            await openPathsFromSelection(selected);
        } catch (error) {
            console.error('打开失败:', error);
            alert('打开失败: ' + error);
        }
    }

    async function saveCurrentFile() {
        const currentFile = getCurrentFile();
        if (!currentFile) {
            return false;
        }
        const activeSession = documentSessions.getActiveSession();
        if (!activeSession || activeSession.filePath !== currentFile) {
            return false;
        }

        const editor = getEditor();
        const codeEditor = getCodeEditor();
        const activeViewMode = getActiveViewMode();

        if (activeViewMode === 'markdown' && editor) {
            const result = await editor.save();
            if (result) {
                setHasUnsavedChanges(false);
                fileSession.clearEntry(currentFile);
                await updateWindowTitle();
            }
            return result;
        }

        if (activeViewMode === 'code' && codeEditor) {
            const localWriteKey = getSessionPathKey(currentFile);
            try {
                const content = codeEditor.getValue();
                if (localWriteKey && documentSessions.markLocalWrite) {
                    documentSessions.markLocalWrite(localWriteKey);
                }
                await fileService.writeText(currentFile, content);
                const markdownCodeMode = getMarkdownCodeMode();
                markdownCodeMode?.handleCodeSaved(content);
                codeEditor.markSaved();
                setHasUnsavedChanges(false);
                fileSession.clearEntry(currentFile);
                await updateWindowTitle();
                return true;
            } catch (error) {
                if (localWriteKey && documentSessions.clearLocalWriteSuppression) {
                    documentSessions.clearLocalWriteSuppression(localWriteKey);
                }
                console.error('保存失败:', error);
                alert('保存失败: ' + error);
                return false;
            }
        }

        return false;
    }

    async function saveFile(filePath) {
        const currentFile = getCurrentFile();

        if (filePath === currentFile) {
            return await saveCurrentFile();
        }

        const cached = fileSession.getCachedEntry(filePath);
        if (!cached || !cached.hasChanges) {
            return true;
        }

        const localWriteKey = getSessionPathKey(filePath);
        try {
            if (localWriteKey && documentSessions.markLocalWrite) {
                documentSessions.markLocalWrite(localWriteKey);
            }
            await fileService.writeText(filePath, cached.content);
            fileSession.clearEntry(filePath);
            return true;
        } catch (error) {
            if (localWriteKey && documentSessions.clearLocalWriteSuppression) {
                documentSessions.clearLocalWriteSuppression(localWriteKey);
            }
            console.error('保存文件失败:', error);
            return false;
        }
    }

    let loadPipeline = Promise.resolve();

    async function performLoad(filePath, options = {}) {
        const { skipWatchSetup = false, forceReload = false } = options;
        const session = documentSessions.beginSession(filePath);
        const sessionId = session?.id ?? null;
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
            const previousFile = getCurrentFile();
            const previousViewMode = getActiveViewMode();
            if (previousFile) {
                rememberMarkdownScrollPosition(previousFile, previousViewMode);
            }
            if (previousFile !== filePath) {
                const markdownCodeMode = getMarkdownCodeMode();
                markdownCodeMode?.reset();
            }
            setCurrentFile(filePath);

            const editor = getEditor();
            const codeEditor = getCodeEditor();
            editor?.prepareForDocument?.(session, filePath);
            codeEditor?.prepareForDocument?.(session, filePath);

            const initialViewMode = getViewModeForPath(filePath);
            const imageViewer = getImageViewer();
            const spreadsheetViewer = getSpreadsheetViewer();
            const pdfViewer = getPdfViewer();
            const unsupportedViewer = getUnsupportedViewer();
            const fileTree = getFileTree();
            // 关闭旧文件可能仍在等待自动保存，提前清除避免写入到新文件
            editor?.clearAutoSaveTimer?.();

            if (initialViewMode === 'image') {
                activateImageView();
                editor?.clear?.();
                codeEditor?.clear?.();
                await imageViewer?.loadImage(filePath);
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
                return;
            }

            const fileData = await fileSession.getFileContent(filePath, { skipCache: forceReload });
            if (shouldAbort('after-read')) {
                return;
            }
            const targetViewMode = fileData.viewMode || initialViewMode;

            if (targetViewMode === 'spreadsheet') {
                activateSpreadsheetView();
                editor?.clear?.();
                codeEditor?.hide?.();
                imageViewer?.hide?.();
                unsupportedViewer?.hide?.();
                await spreadsheetViewer?.loadWorkbook?.(filePath, fileData.content, { forceReload });
                if (shouldAbort('spreadsheet-load')) {
                    return;
                }
                setHasUnsavedChanges(false);
                await updateWindowTitle();
                if (shouldAbort('spreadsheet-title')) {
                    return;
                }
                if (!skipWatchSetup) {
                    try {
                        await fileTree?.watchFile(filePath);
                        if (shouldAbort('spreadsheet-watch')) {
                            return;
                        }
                    } catch (error) {
                        console.error('无法监听文件:', error);
                    }
                }
                if (shouldAbort('spreadsheet-finalize')) {
                    return;
                }
                fileTree?.clearExternalModification?.(filePath);
                persistWorkspaceState();
                markSessionReady();
                return;
            }

            if (targetViewMode === 'pdf') {
                activatePdfView();
                editor?.clear?.();
                codeEditor?.hide?.();
                imageViewer?.hide?.();
                spreadsheetViewer?.hide?.();
                unsupportedViewer?.hide?.();
                await pdfViewer?.loadDocument?.(filePath, fileData.content, { forceReload });
                if (shouldAbort('pdf-load')) {
                    return;
                }
                setHasUnsavedChanges(false);
                await updateWindowTitle();
                if (shouldAbort('pdf-title')) {
                    return;
                }
                if (!skipWatchSetup) {
                    try {
                        await fileTree?.watchFile(filePath);
                        if (shouldAbort('pdf-watch')) {
                            return;
                        }
                    } catch (error) {
                        console.error('无法监听文件:', error);
                    }
                }
                if (shouldAbort('pdf-finalize')) {
                    return;
                }
                fileTree?.clearExternalModification?.(filePath);
                persistWorkspaceState();
                markSessionReady();
                return;
            }

            if (targetViewMode === 'unsupported') {
                activateUnsupportedView();
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
                return;
            }

            if (targetViewMode === 'markdown') {
                activateMarkdownView();
                if (editor) {
                    await editor.loadFile(session, filePath, fileData.content);
                    if (shouldAbort('markdown-editor-load')) {
                        return;
                    }
                    restoreMarkdownScrollPosition(filePath);
                    if (fileData.hasChanges) {
                        editor.contentChanged = true;
                        if (fileData.originalContent) {
                            editor.originalMarkdown = fileData.originalContent;
                        }
                    }
                }
            } else {
                activateCodeView();
                editor?.clear?.();
                const language = detectLanguageForPath(filePath);
                await codeEditor?.show(filePath, fileData.content, language, session);
                if (shouldAbort('code-editor-load')) {
                    return;
                }
                if (fileData.hasChanges) {
                    codeEditor.isDirty = true;
                }
                editor?.refreshSearch?.();
            }

            if (shouldAbort('before-unsaved-state')) {
                return;
            }
            setHasUnsavedChanges(fileData.hasChanges);
            await updateWindowTitle();
            if (shouldAbort('after-title-update')) {
                return;
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
            markSessionReady();
        } catch (error) {
            if (sessionId) {
                documentSessions.closeSession(sessionId);
            }
            console.error('读取文件失败:', error);
            alert('读取文件失败: ' + error);
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
        saveCurrentFile,
        saveFile,
        loadFile,
    };
}
