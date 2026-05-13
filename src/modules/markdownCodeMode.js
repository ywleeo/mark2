export function createMarkdownCodeMode({
    detectLanguageForPath,
    isMarkdownFilePath,
    view,
    saveCurrentEditorContentToCache = null,
    getFileContent = null,
}) {
    if (typeof detectLanguageForPath !== 'function') {
        throw new Error('createMarkdownCodeMode 需要提供 detectLanguageForPath');
    }
    if (typeof isMarkdownFilePath !== 'function') {
        throw new Error('createMarkdownCodeMode 需要提供 isMarkdownFilePath');
    }
    if (!view || typeof view.activate !== 'function') {
        throw new Error('createMarkdownCodeMode 需要提供 view 协议');
    }

    let toggleState = null;

    /**
     * 从 DocumentModel 拿"权威"内容。先 saveCache 把当前编辑器同步过来（带身份校验，
     * 拿不到就跳过保存——比如另一个 tab 残留），然后从 DocumentModel 读。
     * 这样切换不再依赖编辑器内存，杜绝跨 tab 内容污染。
     */
    async function loadAuthoritativeContent({ currentFile, activeViewMode, editor, codeEditor, fallback }) {
        if (typeof saveCurrentEditorContentToCache === 'function') {
            try {
                saveCurrentEditorContentToCache({ currentFile, activeViewMode, editor, codeEditor });
            } catch (error) {
                console.warn('[markdownCodeMode] saveCache 失败，仍尝试从 DM 读取', error);
            }
        }
        if (typeof getFileContent === 'function') {
            try {
                const fileData = await getFileContent(currentFile);
                if (fileData && typeof fileData.content === 'string') {
                    return { content: fileData.content, hasChanges: !!fileData.hasChanges };
                }
            } catch (error) {
                console.warn('[markdownCodeMode] getFileContent 失败，回退到内存内容', error);
            }
        }
        return { content: typeof fallback === 'string' ? fallback : '', hasChanges: false };
    }

    async function toggle({
        currentFile,
        activeViewMode,
        editor,
        codeEditor,
    }) {
        if (!currentFile || !editor || !codeEditor) {
            return { changed: false, nextViewMode: activeViewMode, hasUnsavedChanges: false };
        }
        if (!isMarkdownFilePath(currentFile)) {
            return { changed: false, nextViewMode: activeViewMode, hasUnsavedChanges: false };
        }

        if (activeViewMode === 'markdown') {
            // 编辑器只有真的装着 currentFile 才信任它的内存内容做 fallback
            const editorMatchesFile = editor.currentFile === currentFile && !editor.isLoading?.();
            const inMemoryFallback = editorMatchesFile ? (editor.getMarkdown() || '') : '';
            const { content: markdownContent, hasChanges } = await loadAuthoritativeContent({
                currentFile,
                activeViewMode: 'markdown',
                editor,
                codeEditor,
                fallback: inMemoryFallback,
            });

            // 光标位置同样只在编辑器装的就是当前文件时才取
            const pos = editorMatchesFile ? editor.getCurrentSourcePosition?.() : null;
            // 切前抓光标在 viewport 的相对位置，切后保持同样的相对高度（位置继承）
            const cursorRatio = editorMatchesFile ? editor.getCursorViewportRatio?.() : null;

            toggleState = {
                originalMarkdown: editorMatchesFile ? editor.originalMarkdown : markdownContent,
            };

            editor?.saveViewStateForTab?.(currentFile);
            view.activate('code');
            const language = detectLanguageForPath(currentFile) || 'plaintext';
            await codeEditor.show(currentFile, markdownContent, language, null, { tabId: currentFile });
            editor?.refreshSearch?.();

            // 恢复光标：定位到行尾，按切前的 viewport 相对位置摆放该行
            if (pos) {
                const lines = markdownContent.split('\n');
                const line = lines[pos.lineNumber - 1] || '';
                requestAnimationFrame(() => {
                    codeEditor.setPositionAtRatio(pos.lineNumber, line.length + 1, cursorRatio);
                });
            }

            if (hasChanges) {
                codeEditor.isDirty = true;
                codeEditor.callbacks?.onContentChange?.();
            } else {
                codeEditor.markSaved();
            }

            return {
                changed: true,
                nextViewMode: 'code',
                hasUnsavedChanges: hasChanges,
            };
        }

        if (activeViewMode === 'code') {
            const codeMatchesFile = codeEditor.currentFile === currentFile && !codeEditor.isLoading?.();
            const inMemoryFallback = codeMatchesFile
                ? (typeof codeEditor.getValueForSave === 'function'
                    ? codeEditor.getValueForSave()
                    : codeEditor.getValue())
                : '';
            const { content: codeContent, hasChanges } = await loadAuthoritativeContent({
                currentFile,
                activeViewMode: 'code',
                editor,
                codeEditor,
                fallback: inMemoryFallback,
            });

            const pos = codeMatchesFile ? codeEditor.getCurrentPosition?.() : null;
            const cursorRatio = codeMatchesFile ? codeEditor.getCursorViewportRatio?.() : null;

            codeEditor?.saveViewStateForTab?.(currentFile);
            view.activate('markdown');
            await editor.loadFile(currentFile, codeContent, undefined, { tabId: currentFile });
            editor?.refreshSearch?.();

            // 恢复光标：定位到行尾，按切前的 viewport 相对位置摆放该行
            if (pos && editor.setSourcePositionAtRatio) {
                const lines = codeContent.split('\n');
                const line = lines[pos.lineNumber - 1] || '';
                // 去掉 markdown 符号后的行长度
                const renderedLine = line
                    .replace(/^#{1,6}\s+/, '')
                    .replace(/^>\s?/, '')
                    .replace(/^[-*+]\s+/, '')
                    .replace(/^\d+\.\s+/, '');
                requestAnimationFrame(() => {
                    editor.setSourcePositionAtRatio(pos.lineNumber, renderedLine.length + 1, cursorRatio);
                });
            }

            if (hasChanges && toggleState?.originalMarkdown !== undefined) {
                editor.originalMarkdown = toggleState.originalMarkdown;
            }

            editor.contentChanged = hasChanges;
            toggleState = null;

            codeEditor.markSaved();

            return {
                changed: true,
                nextViewMode: 'markdown',
                hasUnsavedChanges: hasChanges,
            };
        }

        return { changed: false, nextViewMode: activeViewMode, hasUnsavedChanges: false };
    }

    function reset() {
        toggleState = null;
    }

    function handleCodeSaved(content) {
        if (toggleState) {
            toggleState.originalMarkdown = content;
        }
    }

    return {
        toggle,
        reset,
        handleCodeSaved,
    };
}
