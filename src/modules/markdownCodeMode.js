export function createMarkdownCodeMode({
    detectLanguageForPath,
    isMarkdownFilePath,
    activateMarkdownView,
    activateCodeView,
}) {
    if (typeof detectLanguageForPath !== 'function') {
        throw new Error('createMarkdownCodeMode 需要提供 detectLanguageForPath');
    }
    if (typeof isMarkdownFilePath !== 'function') {
        throw new Error('createMarkdownCodeMode 需要提供 isMarkdownFilePath');
    }
    if (typeof activateMarkdownView !== 'function' || typeof activateCodeView !== 'function') {
        throw new Error('createMarkdownCodeMode 需要提供视图切换方法');
    }

    let toggleState = null;

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
            const markdownContent = editor.getMarkdown() || '';
            const hadUnsavedChanges = editor.hasUnsavedChanges?.() || false;

            // 获取光标所在行
            const pos = editor.getCurrentSourcePosition?.();

            toggleState = {
                originalMarkdown: editor.originalMarkdown,
            };

            editor?.saveViewStateForTab?.(currentFile);
            activateCodeView();
            const language = detectLanguageForPath(currentFile) || 'plaintext';
            await codeEditor.show(currentFile, markdownContent, language, null, { tabId: currentFile });
            editor?.refreshSearch?.();

            // 恢复光标：定位到行尾（不滚动，滚动位置由视图状态恢复控制）
            if (pos) {
                const lines = markdownContent.split('\n');
                const line = lines[pos.lineNumber - 1] || '';
                requestAnimationFrame(() => {
                    codeEditor.setPositionOnly(pos.lineNumber, line.length + 1);
                });
            }

            if (hadUnsavedChanges) {
                codeEditor.isDirty = true;
                codeEditor.callbacks?.onContentChange?.();
            } else {
                codeEditor.markSaved();
            }

            return {
                changed: true,
                nextViewMode: 'code',
                hasUnsavedChanges: hadUnsavedChanges,
            };
        }

        if (activeViewMode === 'code') {
            const codeContent = typeof codeEditor.getValueForSave === 'function'
                ? codeEditor.getValueForSave()
                : codeEditor.getValue();
            const hadUnsavedChanges = codeEditor.hasUnsavedChanges?.() || false;

            // 获取光标所在行
            const pos = codeEditor.getCurrentPosition?.();

            codeEditor?.saveViewStateForTab?.(currentFile);
            activateMarkdownView();
            await editor.loadFile(currentFile, codeContent, undefined, { tabId: currentFile });
            editor?.refreshSearch?.();

            // 恢复光标：定位到行尾（不滚动，滚动位置由视图状态恢复控制）
            if (pos && editor.setSourcePositionOnly) {
                const lines = codeContent.split('\n');
                const line = lines[pos.lineNumber - 1] || '';
                // 去掉 markdown 符号后的行长度
                const renderedLine = line
                    .replace(/^#{1,6}\s+/, '')
                    .replace(/^>\s?/, '')
                    .replace(/^[-*+]\s+/, '')
                    .replace(/^\d+\.\s+/, '');
                requestAnimationFrame(() => {
                    editor.setSourcePositionOnly(pos.lineNumber, renderedLine.length + 1);
                });
            }

            if (hadUnsavedChanges && toggleState?.originalMarkdown !== undefined) {
                editor.originalMarkdown = toggleState.originalMarkdown;
            }

            editor.contentChanged = hadUnsavedChanges;
            toggleState = null;

            codeEditor.markSaved();

            return {
                changed: true,
                nextViewMode: 'markdown',
                hasUnsavedChanges: hadUnsavedChanges,
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
