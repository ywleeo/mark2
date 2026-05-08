import { dirname } from '../utils/pathUtils.js';

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

        // watchedPath 现在可能是 root 或任意已展开子目录（recursive:false per-folder watch）
        const normalizedWatched = normalizeFsPath(watchedPath);
        if (!normalizedWatched) return;

        const eventPaths = Array.isArray(event?.paths) ? event.paths.map(normalizeFsPath) : [];
        // 受影响的目录集合：每个 event path 的父目录（mkdir / rm 在该父目录下发生）。
        // 老逻辑无脑 refresh root，root.entries 没变时签名命中跳过 → 子目录里的 mkdir 不刷新。
        const dirsToRefresh = new Set();

        if (eventPaths.length === 0) {
            dirsToRefresh.add(normalizedWatched);
        }

        eventPaths.forEach((changedPath) => {
            if (!changedPath) return;
            // 把发生变化路径的父目录加入待刷新集合
            const parentDir = normalizeFsPath(dirname(changedPath));
            if (parentDir) dirsToRefresh.add(parentDir);

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

        // 触发各父目录的 refresh —— refreshFolder 内部会判断是 root 还是子节点，
        // 走对应的刷新路径
        dirsToRefresh.forEach((dirPath) => scheduleFolderRefresh(dirPath));
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

    // 接收 root 或任意已展开子目录路径。refreshFolder 内部按 isRootPath 决定走哪条
    // 刷新路径，子目录通过 querySelector(`.tree-folder[data-path="..."]`) 找到对应节点。
    function scheduleFolderRefresh(folderPath) {
        const normalizedPath = normalizeFsPath(folderPath);
        if (!normalizedPath) return;

        const existing = folderRefreshTimers.get(normalizedPath);
        if (existing) {
            clearTimeout(existing);
        }

        const timer = setTimeout(async () => {
            folderRefreshTimers.delete(normalizedPath);

            try {
                await fileTree.refreshFolder(normalizedPath);
            } catch (error) {
                console.error('刷新目录失败:', error);
            }
        }, 100);

        folderRefreshTimers.set(normalizedPath, timer);
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
