/**
 * Untitled 文件控制器
 * 管理 untitled 文件的创建、保存和转换为真实文件
 */

export function createUntitledController({
    getTabManager,
    getCurrentFile,
    setCurrentFile,
    setHasUnsavedChanges,
    getMarkdownEditor,
    getCodeEditor,
    getFileTree,
    getFileService,
    untitledFileManager,
    documentSessions,
    fileSession,
    normalizeFsPath,
    activateMarkdownView,
    getUpdateWindowTitle,
    getSaveCurrentEditorContentToCache,
    scheduleWorkspaceContextSync,
    scheduleDocumentSnapshotSync,
}) {
    async function handleCreateUntitled() {
        getSaveCurrentEditorContentToCache()();

        const untitledPath = untitledFileManager.createUntitledFile();
        const displayName = untitledFileManager.getDisplayName(untitledPath);

        const tabManager = getTabManager();
        if (tabManager) {
            tabManager.fileTabs.push({
                id: untitledPath,
                type: 'file',
                path: untitledPath,
                label: displayName,
            });
            tabManager.setActiveTab(untitledPath, { silent: true });
            tabManager.render();
        }

        setCurrentFile(untitledPath);
        setHasUnsavedChanges(false);

        const editor = getMarkdownEditor();
        if (editor) {
            editor.setContent?.('');
            editor.currentFile = untitledPath;
            activateMarkdownView();
            setTimeout(() => {
                editor.focus?.();
            }, 50);
        }

        void getUpdateWindowTitle()();
        scheduleWorkspaceContextSync();
        scheduleDocumentSnapshotSync();
    }

    async function handleImportAsUntitled(content, suggestedName, originalFilePath) {
        getSaveCurrentEditorContentToCache()();

        // 把原始文件从 open list 移除（安全兜底：正常流程中原文件不在 open list 里）
        if (originalFilePath) {
            const fileTree = getFileTree();
            fileTree?.closeFile?.(originalFilePath);
        }

        const untitledPath = untitledFileManager.createImportFile(suggestedName);
        untitledFileManager.setContent(untitledPath, content);
        const displayName = untitledFileManager.getDisplayName(untitledPath);

        const tabManager = getTabManager();
        if (tabManager) {
            tabManager.fileTabs.push({
                id: untitledPath,
                type: 'file',
                path: untitledPath,
                label: displayName,
            });
            tabManager.setActiveTab(untitledPath, { silent: true });
            tabManager.render();
        }

        setCurrentFile(untitledPath);
        setHasUnsavedChanges(content.length > 0);

        const editor = getMarkdownEditor();
        if (editor) {
            // 让 ContentLoader 进入正确状态：保存上一个 tab 的状态，
            // 并把 currentSessionId/currentTabId 重置为此 untitled 文件，
            // 避免继承上一个已关闭 session 导致 setContent 提前退出。
            editor.prepareForDocument(null, untitledPath, untitledPath);
            activateMarkdownView();
            // 等浏览器完成 layout 后再设置内容，避免在尺寸未确定的容器里渲染
            await new Promise(resolve => requestAnimationFrame(resolve));
            await editor.loadFile(untitledPath, content, undefined, { tabId: untitledPath });
            setTimeout(() => editor.focus?.(), 50);
        }

        void getUpdateWindowTitle()();
        scheduleWorkspaceContextSync();
        scheduleDocumentSnapshotSync();
    }

    async function saveUntitledFile(untitledPath, content) {
        try {
            const { save } = await import('@tauri-apps/plugin-dialog');
            const displayName = untitledFileManager.getDisplayName(untitledPath);

            const targetPath = await save({
                title: '保存文件',
                defaultPath: displayName,
                filters: [{
                    name: 'Markdown',
                    extensions: ['md'],
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
        const tabManager = getTabManager();
        const fileTree = getFileTree();
        const currentFile = getCurrentFile();

        untitledFileManager.removeUntitledFile(untitledPath);

        if (tabManager && Array.isArray(tabManager.fileTabs)) {
            const tabIndex = tabManager.fileTabs.findIndex(tab => tab.path === untitledPath);
            if (tabIndex !== -1) {
                tabManager.fileTabs.splice(tabIndex, 1);
                tabManager.render();
            }
        }

        documentSessions.closeSessionForPath(untitledPath);
        const editor = getMarkdownEditor();
        const codeEditor = getCodeEditor();
        editor?.forgetViewStateForTab?.(untitledPath);
        codeEditor?.forgetViewStateForTab?.(untitledPath);
        fileSession.clearEntry(untitledPath);

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
