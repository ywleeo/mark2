export function createFileWatcherController({
    fileTree,
    normalizeFsPath,
    getCurrentFile,
    getActiveViewMode,
    getEditor,
    getCodeEditor,
    scheduleLoadFile,
    documentRegistry,
    documentSessions,
}) {
    const folderRefreshTimers = new Map();
    const fileRefreshTimers = new Map();
    const shouldIgnoreLocalWrite = (filePath) => {
        if (!filePath || !documentSessions || typeof documentSessions.shouldIgnoreWatcherEvent !== 'function') {
            return false;
        }
        return documentSessions.shouldIgnoreWatcherEvent(filePath);
    };

    function handleFolderWatcherEvent(watchedPath, event) {
        if (!fileTree) return;

        const normalizedRoot = normalizeFsPath(watchedPath);
        if (!normalizedRoot || !fileTree?.hasRoot?.(normalizedRoot)) {
            return;
        }

        const eventPaths = Array.isArray(event?.paths) ? event.paths.map(normalizeFsPath) : [];
        let shouldRefreshRoot = eventPaths.length === 0;

        eventPaths.forEach((changedPath) => {
            if (!changedPath) return;
            shouldRefreshRoot = true;
            if (shouldIgnoreLocalWrite(changedPath)) {
                return;
            }
            if (fileTree?.isFileOpen?.(changedPath)) {
                const editor = getEditor();
                const codeEditor = getCodeEditor?.();
                const editorPath = editor ? normalizeFsPath(editor.currentFile) : null;
                if (editor && editorPath === changedPath) {
                    if (typeof editor.hasUnsavedChanges === 'function' && editor.hasUnsavedChanges()) {
                        return;
                    }
                }
                if (codeEditor && normalizeFsPath(codeEditor.currentFile) === changedPath) {
                    if (typeof codeEditor.hasUnsavedChanges === 'function' && codeEditor.hasUnsavedChanges()) {
                        return;
                    }
                }
                handleFileRefresh(changedPath);
            }
        });

        if (shouldRefreshRoot) {
            scheduleFolderRefresh(normalizedRoot);
        }
    }

    function handleFileWatcherEvent(filePath) {
        const normalizedPath = normalizeFsPath(filePath);
        if (!normalizedPath) return;
        if (shouldIgnoreLocalWrite(normalizedPath)) {
            return;
        }

        const editor = getEditor();
        const codeEditor = getCodeEditor();
        const editorPath = editor ? normalizeFsPath(editor.currentFile) : null;
        const currentFilePath = normalizeFsPath(getCurrentFile());
        const isMarkdownActive = editor && editorPath === normalizedPath;
        const activeViewMode = getActiveViewMode();
        const isCodeActive = (activeViewMode === 'code' || activeViewMode === 'html') && currentFilePath === normalizedPath;

        const cachedEntry = documentRegistry?.getCachedEntry?.(normalizedPath);
        const hasCachedChanges = cachedEntry?.hasChanges;

        if (isMarkdownActive && typeof editor?.hasUnsavedChanges === 'function' && editor.hasUnsavedChanges()) {
            return;
        }

        if (isCodeActive && codeEditor?.hasUnsavedChanges?.()) {
            return;
        }

        if (!isMarkdownActive && !isCodeActive && hasCachedChanges) {
            return;
        }

        handleFileRefresh(normalizedPath);
    }

    function handleFileRefresh(filePath) {
        scheduleFileRefresh(filePath);
    }

    function scheduleFolderRefresh(rootPath) {
        const normalizedRoot = normalizeFsPath(rootPath);
        if (!normalizedRoot) return;

        const existing = folderRefreshTimers.get(normalizedRoot);
        if (existing) {
            clearTimeout(existing);
        }

        const timer = setTimeout(async () => {
            folderRefreshTimers.delete(normalizedRoot);
            if (!fileTree?.hasRoot?.(normalizedRoot)) {
                return;
            }

            try {
                await fileTree.refreshFolder(normalizedRoot);
            } catch (error) {
                console.error('刷新目录失败:', error);
            }
        }, 100);

        folderRefreshTimers.set(normalizedRoot, timer);
    }

    function scheduleFileRefresh(filePath) {
        const normalizedPath = normalizeFsPath(filePath);
        if (!normalizedPath) return;

        const existing = fileRefreshTimers.get(normalizedPath);
        if (existing) {
            clearTimeout(existing);
        }

        const timer = setTimeout(async () => {
            fileRefreshTimers.delete(normalizedPath);
            const currentFilePath = normalizeFsPath(getCurrentFile());
            const isTrackedOpenFile = typeof fileTree?.isFileOpen === 'function'
                ? fileTree.isFileOpen(normalizedPath)
                : false;
            const isActiveFile = currentFilePath === normalizedPath;

            if (!isTrackedOpenFile && !isActiveFile) {
                documentRegistry.clearEntry(normalizedPath);
                return;
            }

            if (!isActiveFile) {
                documentRegistry.clearEntry(normalizedPath);
                return;
            }

            try {
                await scheduleLoadFile(normalizedPath);
            } catch (error) {
                console.error('刷新文件失败:', error);
            }
        }, 50);

        fileRefreshTimers.set(normalizedPath, timer);
    }

    function cleanup() {
        folderRefreshTimers.forEach((timer) => clearTimeout(timer));
        folderRefreshTimers.clear();
        fileRefreshTimers.forEach((timer) => clearTimeout(timer));
        fileRefreshTimers.clear();
    }

    return {
        handleFolderWatcherEvent,
        handleFileWatcherEvent,
        cleanup,
    };
}
