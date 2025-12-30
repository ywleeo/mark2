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
        console.log('[FileWatcherController] handleFileWatcherEvent 被调用:', normalizedPath);
        if (!normalizedPath) return;
        if (shouldIgnoreLocalWrite(normalizedPath)) {
            console.log('[FileWatcherController] 忽略本地写入事件:', normalizedPath);
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

        console.log('[FileWatcherController] 文件状态检查:', {
            normalizedPath,
            currentFilePath,
            isMarkdownActive,
            isCodeActive,
            hasCachedChanges
        });

        if (isMarkdownActive && typeof editor?.hasUnsavedChanges === 'function' && editor.hasUnsavedChanges()) {
            console.log('[FileWatcherController] Markdown 编辑器有未保存修改，跳过刷新');
            return;
        }

        if (isCodeActive && codeEditor?.hasUnsavedChanges?.()) {
            console.log('[FileWatcherController] 代码编辑器有未保存修改，跳过刷新');
            return;
        }

        if (!isMarkdownActive && !isCodeActive && hasCachedChanges) {
            console.log('[FileWatcherController] 文件未激活但有缓存修改，跳过刷新');
            return;
        }

        console.log('[FileWatcherController] 准备刷新文件:', normalizedPath);
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

            console.log('[FileWatcherController] scheduleFileRefresh 定时器触发:', {
                normalizedPath,
                currentFilePath,
                isTrackedOpenFile,
                isActiveFile
            });

            if (!isTrackedOpenFile && !isActiveFile) {
                console.log('[FileWatcherController] 文件未被追踪且未激活，仅清除缓存');
                fileSession.clearEntry(normalizedPath);
                return;
            }

            if (!isActiveFile) {
                console.log('[FileWatcherController] 文件未激活，仅清除缓存，不重新加载');
                fileSession.clearEntry(normalizedPath);
                return;
            }

            console.log('[FileWatcherController] 文件已激活，准备重新加载');
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
