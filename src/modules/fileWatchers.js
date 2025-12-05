export function createFileWatcherController({
    fileTree,
    normalizeFsPath,
    getCurrentFile,
    getActiveViewMode,
    getEditor,
    getCodeEditor,
    scheduleLoadFile,
    fileSession,
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
            if (shouldIgnoreLocalWrite(changedPath)) {
                return;
            }
            shouldRefreshRoot = true;
            if (fileTree?.isFileOpen?.(changedPath)) {
                const editor = getEditor();
                const editorPath = editor ? normalizeFsPath(editor.currentFile) : null;
                if (editor && editorPath === changedPath) {
                    if (typeof editor.hasUnsavedChanges === 'function' && editor.hasUnsavedChanges()) {
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

        const isOpenFile = fileTree?.isFileOpen?.(normalizedPath);
        if (!isOpenFile) {
            return;
        }

        const editor = getEditor();
        const codeEditor = getCodeEditor();
        const editorPath = editor ? normalizeFsPath(editor.currentFile) : null;
        const currentFilePath = normalizeFsPath(getCurrentFile());
        const isMarkdownActive = editor && editorPath === normalizedPath;
        const isCodeActive = getActiveViewMode() === 'code' && currentFilePath === normalizedPath;

        const cachedEntry = fileSession?.getCachedEntry?.(normalizedPath);
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
            if (!fileTree?.isFileOpen?.(normalizedPath)) {
                return;
            }

            const currentFilePath = normalizeFsPath(getCurrentFile());
            if (currentFilePath !== normalizedPath) {
                fileSession.clearEntry(normalizedPath);
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
