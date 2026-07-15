export function createMarkdownCodeMode({
    detectLanguageForPath,
    isMarkdownFilePath,
    view,
    saveCurrentEditorContentToCache = null,
    getFileContent = null,
    getDocument = null,
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

    function getElementScrollRatio(element) {
        if (!element) return null;
        const maxScroll = (element.scrollHeight ?? 0) - (element.clientHeight ?? 0);
        if (maxScroll <= 0) return 0;
        return Math.min(1, Math.max(0, (element.scrollTop || 0) / maxScroll));
    }

    function applyElementScrollRatio(element, ratio) {
        if (!element || !Number.isFinite(ratio)) return;
        const maxScroll = (element.scrollHeight ?? 0) - (element.clientHeight ?? 0);
        if (maxScroll <= 0) return;
        element.scrollTop = Math.min(1, Math.max(0, ratio)) * maxScroll;
    }

    function applyElementScrollRatioWhenStable(element, ratio, maxRetries = 8) {
        if (!element || !Number.isFinite(ratio)) return;

        let lastHeight = -1;
        let retries = 0;
        const tick = () => {
            const height = element.scrollHeight ?? 0;
            if (height > 0 && height === lastHeight) {
                applyElementScrollRatio(element, ratio);
                return;
            }
            if (retries >= maxRetries) {
                applyElementScrollRatio(element, ratio);
                return;
            }
            lastHeight = height;
            retries += 1;
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    }

    function getCodeScrollRatio(codeEditor) {
        if (!codeEditor) return null;
        const maxScroll = codeEditor.getScrollHeight() - codeEditor.getClientHeight();
        if (maxScroll <= 0) return 0;
        return Math.min(1, Math.max(0, codeEditor.getScrollTop() / maxScroll));
    }

    function applyCodeScrollRatio(codeEditor, ratio) {
        if (!codeEditor || !Number.isFinite(ratio)) return;
        const maxScroll = codeEditor.getScrollHeight() - codeEditor.getClientHeight();
        if (maxScroll <= 0) return;
        codeEditor.setScrollTop(Math.min(1, Math.max(0, ratio)) * maxScroll);
    }

    function applyCodeScrollRatioWhenStable(codeEditor, ratio, maxRetries = 8) {
        if (!codeEditor || !Number.isFinite(ratio)) return;

        let lastHeight = -1;
        let retries = 0;
        const tick = () => {
            const height = codeEditor.getScrollHeight();
            if (height > 0 && height === lastHeight) {
                applyCodeScrollRatio(codeEditor, ratio);
                return;
            }
            if (retries >= maxRetries) {
                applyCodeScrollRatio(codeEditor, ratio);
                return;
            }
            lastHeight = height;
            retries += 1;
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    }

    /**
     * 从 DocumentModel 拿"权威"内容。先 saveCache 把当前编辑器同步过来（带身份校验，
     * 拿不到就跳过保存——比如另一个 tab 残留），然后从 DocumentModel 读。
     * 这样切换不再依赖编辑器内存，杜绝跨 tab 内容污染。
     */
    async function loadAuthoritativeContent({
        currentFile,
        activeViewMode,
        editor,
        codeEditor,
        trustedSourceContent = null,
        sourceHasChanges = false,
    }) {
        if (typeof saveCurrentEditorContentToCache === 'function') {
            try {
                saveCurrentEditorContentToCache({ currentFile, activeViewMode, editor, codeEditor });
            } catch (error) {
                console.warn('[markdownCodeMode] saveCache 失败，仍尝试从 DM 读取', error);
            }
        }
        // 当前可见编辑器且文件身份匹配时，它产生的精确快照就是本次切换输入。
        // 不能再异步回读缓存/磁盘，否则旧 TipTap 状态可能覆盖刚在 CodeMirror 中完成的结构修改。
        if (typeof trustedSourceContent === 'string') {
            return { content: trustedSourceContent, hasChanges: Boolean(sourceHasChanges) };
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
        return { content: '', hasChanges: false };
    }

    /**
     * 在目标编辑器绑定前确认 DocumentModel 与来源编辑器快照一致。
     * @param {object|null} documentModel - 当前文档模型
     * @param {string} content - 来源编辑器的精确内容
     * @param {boolean} hasChanges - 来源编辑器是否有未保存修改
     */
    function synchronizeDocumentModel(documentModel, content, hasChanges) {
        if (!documentModel || typeof content !== 'string') return;
        if (documentModel.getContent?.() === content) return;
        if (hasChanges || documentModel.dirty) {
            documentModel.applyEditorChange?.(content, { source: 'view-mode-switch' });
            return;
        }
        documentModel.applyEditorSnapshot?.({
            content,
            originalContent: content,
            dirty: false,
        });
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
            const sourceContent = editorMatchesFile ? (editor.getMarkdown() || '') : null;
            const sourceHasChanges = editorMatchesFile ? Boolean(editor.hasUnsavedChanges?.()) : false;
            const { content: markdownContent, hasChanges } = await loadAuthoritativeContent({
                currentFile,
                activeViewMode: 'markdown',
                editor,
                codeEditor,
                trustedSourceContent: sourceContent,
                sourceHasChanges,
            });

            // 光标位置同样只在编辑器装的就是当前文件时才取
            const pos = editorMatchesFile ? editor.getCurrentSourcePosition?.() : null;
            const sourceScrollRatio = editorMatchesFile
                ? getElementScrollRatio(editor.getScrollContainer?.())
                : null;
            const cursorRatio = editorMatchesFile ? editor.getCursorViewportRatio?.() : null;

            editor?.saveViewStateForTab?.(currentFile);
            view.activate('code');
            const language = detectLanguageForPath(currentFile) || 'plaintext';
            const documentModel = getDocument?.(currentFile) || null;
            synchronizeDocumentModel(documentModel, markdownContent, hasChanges);
            if (documentModel) {
                await codeEditor.attachDocument(documentModel, {
                    session: null,
                    tabId: currentFile,
                    autoFocus: true,
                    language,
                });
            } else {
                await codeEditor.show(currentFile, markdownContent, language, null, { tabId: currentFile });
            }
            editor?.refreshSearch?.();

            // md/code 切换时，源视图当前 scroll ratio 优先于目标视图历史 scroll；光标只作为定位兜底。
            if (pos || Number.isFinite(sourceScrollRatio)) {
                const lines = markdownContent.split('\n');
                const line = pos ? (lines[pos.lineNumber - 1] || '') : '';
                requestAnimationFrame(() => {
                    if (Number.isFinite(sourceScrollRatio)) {
                        if (pos) {
                            codeEditor.setPositionOnly?.(pos.lineNumber, line.length + 1);
                        }
                        applyCodeScrollRatioWhenStable(codeEditor, sourceScrollRatio);
                    } else if (pos) {
                        codeEditor.setPositionAtRatio(pos.lineNumber, line.length + 1, cursorRatio);
                    }
                });
            }

            return {
                changed: true,
                nextViewMode: 'code',
                hasUnsavedChanges: documentModel?.dirty ?? hasChanges,
            };
        }

        if (activeViewMode === 'code') {
            const codeMatchesFile = codeEditor.currentFile === currentFile && !codeEditor.isLoading?.();
            const sourceContent = codeMatchesFile
                ? codeEditor.getValue()
                : null;
            const sourceHasChanges = codeMatchesFile ? Boolean(codeEditor.hasUnsavedChanges?.()) : false;
            const { content: codeContent, hasChanges } = await loadAuthoritativeContent({
                currentFile,
                activeViewMode: 'code',
                editor,
                codeEditor,
                trustedSourceContent: sourceContent,
                sourceHasChanges,
            });

            const pos = codeMatchesFile ? codeEditor.getCurrentPosition?.() : null;
            const sourceScrollRatio = codeMatchesFile ? getCodeScrollRatio(codeEditor) : null;
            const cursorRatio = codeMatchesFile ? codeEditor.getCursorViewportRatio?.() : null;

            codeEditor?.saveViewStateForTab?.(currentFile);
            view.activate('markdown');
            const documentModel = getDocument?.(currentFile) || null;
            synchronizeDocumentModel(documentModel, codeContent, hasChanges);
            if (documentModel) {
                await editor.attachDocument(documentModel, {
                    session: null,
                    tabId: currentFile,
                    autoFocus: true,
                    // CodeMirror 的当前源码是模式切换的真源；不能恢复切换前缓存的
                    // TipTap EditorState，否则已删除的 Markdown 标记会在下次保存时复活。
                    discardViewState: true,
                });
            } else {
                await editor.loadFile(currentFile, codeContent, undefined, { tabId: currentFile });
            }
            editor?.refreshSearch?.();

            // md/code 切换时，源视图当前 scroll ratio 优先于目标视图历史 scroll；光标只作为定位兜底。
            if (pos || Number.isFinite(sourceScrollRatio)) {
                const lines = codeContent.split('\n');
                const line = pos ? (lines[pos.lineNumber - 1] || '') : '';
                // 去掉 markdown 符号后的行长度
                const renderedLine = line
                    .replace(/^#{1,6}\s+/, '')
                    .replace(/^>\s?/, '')
                    .replace(/^[-*+]\s+/, '')
                    .replace(/^\d+\.\s+/, '');
                requestAnimationFrame(() => {
                    if (Number.isFinite(sourceScrollRatio)) {
                        if (pos) {
                            editor.setSourcePositionOnly?.(pos.lineNumber, renderedLine.length + 1);
                        }
                        applyElementScrollRatioWhenStable(editor.getScrollContainer?.(), sourceScrollRatio);
                    } else if (pos && editor.setSourcePositionAtRatio) {
                        editor.setSourcePositionAtRatio(pos.lineNumber, renderedLine.length + 1, cursorRatio);
                    }
                });
            }

            return {
                changed: true,
                nextViewMode: 'markdown',
                hasUnsavedChanges: documentModel?.dirty ?? hasChanges,
            };
        }

        return { changed: false, nextViewMode: activeViewMode, hasUnsavedChanges: false };
    }

    function reset() {
        // 模式切换不再维护独立快照，DocumentModel 持有唯一内容和 dirty 状态。
    }

    return {
        toggle,
        reset,
    };
}
