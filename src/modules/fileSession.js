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
        const defaultViewMode = currentFile ? getViewModeForPath(currentFile) : null;
        const viewModeToStore = defaultViewMode === 'markdown' ? 'markdown' : viewMode;
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
                viewMode: viewModeToStore,
            });
        }
    }

    async function getFileContent(filePath, options = {}) {
        const { skipCache = false } = options;

        if (!skipCache) {
            const cached = cache.get(filePath);
            if (cached) {
                const defaultViewMode = getViewModeForPath(filePath);
                if (defaultViewMode === 'markdown' && cached.viewMode !== 'markdown') {
                    const coerced = {
                        ...cached,
                        viewMode: 'markdown',
                    };
                    cache.set(filePath, coerced);
                    return coerced;
                }
                return cached;
            }
        }

        try {
            const content = await readFile(filePath);
            const viewMode = getViewModeForPath(filePath);
            return {
                content,
                hasChanges: false,
                viewMode,
            };
        } catch (error) {
            if (isLikelyBinaryReadError(error)) {
                return {
                    content: null,
                    hasChanges: false,
                    viewMode: 'unsupported',
                    error,
                };
            }
            throw error;
        }
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
