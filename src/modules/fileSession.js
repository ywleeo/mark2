export function createFileSession({ readFile, getViewModeForPath }) {
    if (typeof readFile !== 'function') {
        throw new Error('createFileSession 需要提供 readFile 函数');
    }
    if (typeof getViewModeForPath !== 'function') {
        throw new Error('createFileSession 需要提供 getViewModeForPath 函数');
    }

    const cache = new Map();

    function saveCurrentEditorContentToCache({ currentFile, activeViewMode, editor, codeEditor }) {
        if (!currentFile) return;

        const viewMode = activeViewMode;
        let content = null;
        let originalContent = null;
        let hasChanges = false;

        if (viewMode === 'markdown' && editor) {
            content = editor.getMarkdown();
            originalContent = editor.originalMarkdown;
            hasChanges = editor.hasUnsavedChanges();
        } else if (viewMode === 'code' && codeEditor) {
            content = codeEditor.getValue();
            hasChanges = codeEditor.hasUnsavedChanges();
        }

        if (content !== null) {
            cache.set(currentFile, {
                content,
                originalContent,
                hasChanges,
                viewMode,
            });
        }
    }

    async function getFileContent(filePath, options = {}) {
        const { skipCache = false } = options;

        if (!skipCache) {
            const cached = cache.get(filePath);
            if (cached) {
                return cached;
            }
        }

        const content = await readFile(filePath);
        const viewMode = getViewModeForPath(filePath);
        return {
            content,
            hasChanges: false,
            viewMode,
        };
    }

    function getCachedEntry(filePath) {
        return cache.get(filePath) || null;
    }

    function clearEntry(filePath) {
        cache.delete(filePath);
    }

    function clearAll() {
        cache.clear();
    }

    return {
        saveCurrentEditorContentToCache,
        getFileContent,
        getCachedEntry,
        clearEntry,
        clearAll,
    };
}

