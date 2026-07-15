/**
 * Untitled 文件控制器
 * 管理 untitled 文件的创建、保存和转换为真实文件
 */

export function createUntitledController({
    getTabManager,
    getCurrentFile,
    documentManager,
    getMarkdownEditor,
    getCodeEditor,
    getFileTree,
    getFileService,
    untitledFileManager,
    documentSessions,
    documentRegistry,
    normalizeFsPath,
    activateMarkdownView,
    activateCodeView,
    getUpdateWindowTitle,
    getSaveCurrentEditorContentToCache,
    getPersistWorkspaceState,
    getLoadFile,
    scheduleWorkspaceContextSync,
    scheduleDocumentSnapshotSync,
}) {
    async function handleCreateUntitled({ ext = 'md' } = {}) {
        getSaveCurrentEditorContentToCache()();

        const isMarkdown = ext === 'md';
        const untitledPath = untitledFileManager.createUntitledFile(ext);
        const displayName = untitledFileManager.getDisplayName(untitledPath);

        // 真源走 documentManager：派生事件会驱动 TabManager 重建 fileTabs 并渲染
        documentManager.openDocument(untitledPath, {
            kind: 'untitled',
            tabId: untitledPath,
            viewMode: isMarkdown ? 'markdown' : 'code',
            label: displayName,
            activate: true,
        });
        // 延迟 render 到下一帧，避免 pointerup 回调里重建 DOM 导致焦点丢失
        requestAnimationFrame(() => {
            getTabManager()?.render();
            setTimeout(() => {
                const ed = getMarkdownEditor()?.editor;
                if (ed?.view && !ed.view.hasFocus() && !ed.isDestroyed) {
                    ed.view.focus();
                }
            }, 0);
        });

        // 通过 fileOps.loadFile pipeline 加载，确保与其他加载（如关闭 tab 时的
        // fallback 加载）串行化，避免竞态导致焦点丢失。
        const pipelineLoad = getLoadFile?.();
        if (pipelineLoad) {
            await pipelineLoad(untitledPath, { tabId: untitledPath });
        }

        // 空白 tab 本身也是用户工作区状态，创建完成后立即落本地快照。
        getPersistWorkspaceState?.()?.();

        // updateWindowTitle / scheduleWorkspaceContextSync / scheduleDocumentSnapshotSync
        // 已由 pipeline loadFile → performLoad → setCurrentFile 内部调用，无需重复。
    }

    async function handleImportAsUntitled(content, suggestedName, originalFilePath, options = {}) {
        getSaveCurrentEditorContentToCache()();

        // 把原始文件从 open list 移除（安全兜底：正常流程中原文件不在 open list 里）
        if (originalFilePath) {
            const fileTree = getFileTree();
            fileTree?.closeFile?.(originalFilePath);
        }

        const untitledPath = untitledFileManager.createImportFile(suggestedName, options);
        untitledFileManager.setContent(untitledPath, content);
        const displayName = untitledFileManager.getDisplayName(untitledPath);
        const documentModel = documentRegistry.registerInMemoryDocument(untitledPath, {
            viewMode: 'markdown',
            content,
        });
        if (content.length > 0) documentModel.markUnpersisted();

        documentManager.openDocument(untitledPath, {
            activate: true,
            kind: 'import',
            tabId: untitledPath,
            viewMode: 'markdown',
            label: displayName,
        });
        requestAnimationFrame(() => {
            getTabManager()?.render();
            setTimeout(() => {
                const ed = getMarkdownEditor()?.editor;
                if (ed?.view && !ed.view.hasFocus() && !ed.isDestroyed) {
                    ed.view.focus();
                }
            }, 0);
        });

        // dm.openDocument(activate:true, dirty:...) 已经同步 appState.currentFile 与 hasUnsavedChanges
        const editor = getMarkdownEditor();
        if (editor) {
            // 让 ContentLoader 进入正确状态：保存上一个 tab 的状态，
            // 并把 currentSessionId/currentTabId 重置为此 untitled 文件，
            // 避免继承上一个已关闭 session 导致 setContent 提前退出。
            editor.prepareForDocument(null, untitledPath, untitledPath);
            activateMarkdownView();
            // 等浏览器完成 layout 后再设置内容，避免在尺寸未确定的容器里渲染
            await new Promise(resolve => requestAnimationFrame(resolve));
            await editor.attachDocument(documentModel, {
                session: null,
                tabId: untitledPath,
                autoFocus: true,
            });
            setTimeout(() => editor.focus?.(), 50);
        }

        void getUpdateWindowTitle()();
        // AI/导入文档不经过常规 loadFile 收尾，需在正文和 DocumentModel
        // 都就绪后主动持久化，避免应用重启前没有其他 UI 操作时丢失。
        getPersistWorkspaceState?.()?.();
        scheduleWorkspaceContextSync();
        scheduleDocumentSnapshotSync();

        // 返回创建的 untitled 路径,供调用方做"同源去重 / 聚焦已开 tab"
        return untitledPath;
    }

    async function saveUntitledFile(untitledPath, content) {
        try {
            const { save } = await import('@tauri-apps/plugin-dialog');
            const displayName = untitledFileManager.getDisplayName(untitledPath);

            const ext = displayName.split('.').pop() || 'md';
            const filterName = ext === 'md' ? 'Markdown' : 'Text';
            const targetPath = await save({
                title: '保存文件',
                defaultPath: displayName,
                filters: [{
                    name: filterName,
                    extensions: [ext],
                }],
            });

            if (!targetPath) return false;

            const normalizedPath = normalizeFsPath(targetPath);
            if (!normalizedPath) return false;

            await getFileService().writeText(normalizedPath, content);
            await convertUntitledToRealFile(untitledPath, normalizedPath);

            return true;
        } catch (error) {
            console.error('保存 untitled 文件失败:', error);
            alert('保存文件失败: ' + (error?.message || error));
            return false;
        }
    }

    async function convertUntitledToRealFile(untitledPath, realPath) {
        const fileTree = getFileTree();
        const currentFile = getCurrentFile();

        untitledFileManager.removeUntitledFile(untitledPath);

        // dm.closeDocument 会派生清理 fileTree.openFiles 与 tabManager.fileTabs
        documentManager.closeDocument(untitledPath);

        documentSessions.closeSessionForPath(untitledPath);
        const editor = getMarkdownEditor();
        const codeEditor = getCodeEditor();
        editor?.forgetViewStateForTab?.(untitledPath);
        codeEditor?.forgetViewStateForTab?.(untitledPath);
        documentRegistry.clearEntry(untitledPath);

        if (currentFile === untitledPath) {
            fileTree?.addToOpenFiles?.(realPath);
            fileTree?.selectFile?.(realPath);
        }
    }

    return {
        handleCreateUntitled,
        handleImportAsUntitled,
        saveUntitledFile,
        convertUntitledToRealFile,
    };
}
