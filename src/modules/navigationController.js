export function createNavigationController({
    getFileTree,
    getTabManager,
    getCurrentFile,
    documentSessions,
    saveCurrentEditorContentToCache,
    clearActiveFileView,
    loadFile,
    fileSession,
    persistWorkspaceState,
    saveFile,
    getActiveViewMode,
    getEditor,
    getCodeEditor,
    getWorkflowEditor,
    confirm,
    untitledFileManager,
    saveUntitledFile,
    eventBus,
}) {
    if (typeof getFileTree !== 'function') {
        throw new Error('navigationController 需要提供 getFileTree');
    }
    if (typeof getTabManager !== 'function') {
        throw new Error('navigationController 需要提供 getTabManager');
    }
    if (typeof getCurrentFile !== 'function') {
        throw new Error('navigationController 需要提供 getCurrentFile');
    }
    if (!documentSessions || typeof documentSessions.closeSessionForPath !== 'function') {
        throw new Error('navigationController 需要提供 documentSessions');
    }
    if (typeof saveCurrentEditorContentToCache !== 'function') {
        throw new Error('navigationController 需要提供 saveCurrentEditorContentToCache');
    }
    if (typeof clearActiveFileView !== 'function') {
        throw new Error('navigationController 需要提供 clearActiveFileView');
    }
    if (typeof loadFile !== 'function') {
        throw new Error('navigationController 需要提供 loadFile');
    }
    if (!fileSession) {
        throw new Error('navigationController 需要提供 fileSession');
    }
    if (typeof persistWorkspaceState !== 'function') {
        throw new Error('navigationController 需要提供 persistWorkspaceState');
    }
    if (typeof saveFile !== 'function') {
        throw new Error('navigationController 需要提供 saveFile');
    }
    if (typeof getActiveViewMode !== 'function') {
        throw new Error('navigationController 需要提供 getActiveViewMode');
    }
    if (typeof getEditor !== 'function') {
        throw new Error('navigationController 需要提供 getEditor');
    }
    if (typeof getCodeEditor !== 'function') {
        throw new Error('navigationController 需要提供 getCodeEditor');
    }
    if (typeof getWorkflowEditor !== 'function') {
        throw new Error('navigationController 需要提供 getWorkflowEditor');
    }

    let isOpeningFromLink = false;

    async function handleFileSelect(filePath, options = {}) {
        const { autoFocus = true } = options;
        const fileTree = getFileTree();
        const tabManager = getTabManager();
        const previousFile = getCurrentFile();
        const normalizePath = (value) => {
            if (!value) {
                return value;
            }
            if (typeof fileTree?.normalizePath === 'function') {
                return fileTree.normalizePath(value);
            }
            return value;
        };
        const normalizedPrevious = normalizePath(previousFile);
        const normalizedNext = normalizePath(filePath);

        if (previousFile) {
            const isSwitchingToDifferentFile = normalizedNext
                ? normalizedPrevious !== normalizedNext
                : true;
            if (isSwitchingToDifferentFile) {
                const saved = await autoSaveActiveFileIfNeeded(previousFile);
                if (!saved) {
                    if (normalizedPrevious) {
                        tabManager?.setActiveFileTab(previousFile, { silent: true });
                        const restoreSelection = () => {
                            const nextTree = getFileTree();
                            nextTree?.selectFile(previousFile);
                        };
                        if (typeof window !== 'undefined' && typeof window.setTimeout === 'function') {
                            window.setTimeout(restoreSelection, 0);
                        } else {
                            restoreSelection();
                        }
                    }
                    return;
                }
            }
        }

        if (!filePath) {
            saveCurrentEditorContentToCache();

            const sharedTab = tabManager?.sharedTab;
            if (sharedTab && sharedTab.path) {
                try {
                    await loadFile(sharedTab.path, { tabId: tabManager?.sharedTabId || null });
                    tabManager?.setActiveTab(sharedTab.id, { silent: true });
                } catch (error) {
                    console.error('切换到 shared tab 失败:', error);
                    clearActiveFileView();
                }
            } else {
                clearActiveFileView();
            }
            return;
        }

        try {
            saveCurrentEditorContentToCache();

            const shouldForceReload = Boolean(fileTree?.consumeExternalModification?.(filePath));

            const tabId = normalizedNext || filePath || null;
            await loadFile(filePath, { forceReload: shouldForceReload, autoFocus, tabId });

            const isOpenTab = fileTree?.isInOpenList?.(filePath);
            // untitled 文件已经在 fileTabs 中，直接激活
            const isUntitledInFileTabs = untitledFileManager?.isUntitledPath?.(filePath)
                && tabManager?.fileTabs?.some(tab => tab.path === filePath);

            if (isOpeningFromLink) {
                tabManager?.showSharedTab(filePath);
                isOpeningFromLink = false;
            } else if (isOpenTab || isUntitledInFileTabs) {
                tabManager?.setActiveFileTab(filePath, { silent: true });
            } else {
                tabManager?.showSharedTab(filePath);
            }
        } catch (error) {
            console.error('文件选择失败，保持当前 tab 状态', { filePath, error });
            isOpeningFromLink = false;
        }
    }

    function handleOpenFilesChange(openFilePaths) {
        const tabManager = getTabManager();
        const fileTree = getFileTree();
        tabManager?.syncFileTabs(openFilePaths, fileTree?.currentFile || null);
        persistWorkspaceState({ openFiles: openFilePaths });
    }

    function handleTabSelect(tab) {
        // 发出 tab 切换事件，用于通知其他模块（如 AI 工具栏）
        eventBus?.emit('tab:switch', { tab });

        if (!tab) return;
        if ((tab.type === 'file' || tab.type === 'shared') && tab.path) {
            getFileTree()?.selectFile(tab.path);
        }
    }

    async function confirmDiscardAfterFailedSave(filePath) {
        if (!confirm) {
            return false;
        }
        const fileName = (filePath ? filePath.split('/').pop() : '') || filePath || '当前文件';
        try {
            return await confirm(
                `保存 "${fileName}" 失败，是否放弃更改并关闭？`,
                {
                    title: '保存失败',
                    kind: 'warning',
                    okLabel: '放弃并关闭',
                    cancelLabel: '取消',
                }
            );
        } catch (error) {
            console.warn('确认放弃更改弹窗失败', error);
            return false;
        }
    }

    async function handleTabClose(tab) {
        const fileTree = getFileTree();
        const tabManager = getTabManager();
        if (!tab) return;

        // 处理 untitled 文件的关闭
        if (tab.path && untitledFileManager?.isUntitledPath?.(tab.path)) {
            return handleUntitledTabClose(tab);
        }

        if (tab.type === 'file' && tab.path) {
            const targetPath = tab.path;

            // 清除自动保存定时器
            const editor = getEditor();
            editor?.clearAutoSaveTimer?.();

            const hasChanges = await checkFileHasUnsavedChanges(targetPath);

            if (hasChanges) {
                // 直接保存；如失败则询问是否放弃更改
                const saved = await saveFile(targetPath);
                if (!saved) {
                    const shouldDiscard = await confirmDiscardAfterFailedSave(targetPath);
                    if (!shouldDiscard) {
                        return;
                    }
                }
            }

            const normalizedTarget = typeof fileTree?.normalizePath === 'function'
                ? fileTree.normalizePath(tab.path)
                : tab.path;
            const currentNormalized = typeof fileTree?.normalizePath === 'function'
                ? fileTree.normalizePath(fileTree?.currentFile)
                : fileTree?.currentFile;
            const wasActive = normalizedTarget && normalizedTarget === currentNormalized;

            if (wasActive) {
                tabManager?.setActiveTab(null, { silent: true });
                clearActiveFileView();
            }

            let fallbackPath = null;
            if (wasActive) {
                const openPaths = Array.isArray(fileTree?.getOpenFilePaths?.())
                    ? [...fileTree.getOpenFilePaths()]
                    : [];
                const normalizedPairs = openPaths.map(path => ({
                    raw: path,
                    normalized: typeof fileTree?.normalizePath === 'function'
                        ? fileTree.normalizePath(path)
                        : path,
                }));
                const targetIndex = normalizedPairs.findIndex(item => item.normalized === normalizedTarget);
                if (targetIndex !== -1) {
                    const remaining = normalizedPairs.filter(item => item.normalized !== normalizedTarget);
                    if (remaining.length > 0) {
                        const fallbackIndex = Math.min(targetIndex, remaining.length - 1);
                        fallbackPath = remaining[fallbackIndex]?.raw || null;
                    }
                }
            }

            fileTree?.closeFile(tab.path, { suppressActivate: wasActive });

            if (wasActive) {
                if (fallbackPath) {
                    tabManager?.setActiveFileTab(fallbackPath, { silent: true });
                    fileTree?.selectFile(fallbackPath);
                } else {
                    fileTree?.selectFile(null);
                }
            }
            documentSessions.closeSessionForPath(targetPath);
            const codeEditor = getCodeEditor();
            const markdownEditor = getEditor();
            codeEditor?.forgetViewStateForTab?.(normalizedTarget);
            markdownEditor?.forgetViewStateForTab?.(normalizedTarget);
            fileSession.clearEntry(targetPath);
            return;
        }

        if (tab.type === 'shared') {
            if (tab.path) {
                const targetPath = tab.path;

                // 清除自动保存定时器
                const editor = getEditor();
                editor?.clearAutoSaveTimer?.();
                const workflowEditor = getWorkflowEditor();
                workflowEditor?.clearAutoSaveTimer?.();

                const hasChanges = await checkFileHasUnsavedChanges(targetPath);

                if (hasChanges) {
                    // 直接保存，不弹确认框
                    const saved = await saveFile(targetPath);
                    if (!saved) {
                        return;
                    }
                }

                if (!fileTree?.isInOpenList(targetPath)) {
                    fileTree?.stopWatchingFile(targetPath);
                }
                documentSessions.closeSessionForPath(targetPath);
                const codeEditor = getCodeEditor();
                const markdownEditor = getEditor();
                codeEditor?.forgetViewStateForTab?.(tab.id || null);
                markdownEditor?.forgetViewStateForTab?.(tab.id || null);
                fileSession.clearEntry(targetPath);
            }

            if (!tab.fallbackPath) {
                fileTree?.selectFile(null);
            }
            return;
        }

        tabManager?.handleTabClose?.(tab);
    }

    async function checkFileHasUnsavedChanges(filePath) {
        const currentFile = getCurrentFile();
        if (filePath === currentFile) {
            const activeViewMode = getActiveViewMode();
            const editor = getEditor();
            const codeEditor = getCodeEditor();
            const workflowEditor = getWorkflowEditor();

            if (activeViewMode === 'markdown' && editor) {
                return editor.hasUnsavedChanges();
            }
            if (activeViewMode === 'code' && codeEditor) {
                return codeEditor.hasUnsavedChanges();
            }
            if (activeViewMode === 'workflow' && workflowEditor) {
                return workflowEditor.hasUnsavedChanges();
            }
        }

        const cached = fileSession.getCachedEntry(filePath);
        return cached ? cached.hasChanges : false;
    }

    async function autoSaveActiveFileIfNeeded(targetPath = null) {
        const currentPath = targetPath ?? getCurrentFile();
        if (!currentPath) {
            return true;
        }
        // untitled 文件不自动保存
        if (untitledFileManager?.isUntitledPath?.(currentPath)) {
            return true;
        }
        const hasChanges = await checkFileHasUnsavedChanges(currentPath);
        if (!hasChanges) {
            return true;
        }
        try {
            const saved = await saveFile(currentPath);
            return Boolean(saved);
        } catch (error) {
            console.error('自动保存当前文件失败:', error);
            return false;
        }
    }

    async function closeActiveTab() {
        const tabManager = getTabManager();
        if (!tabManager || !tabManager.activeTabId) {
            return;
        }
        await tabManager.handleTabClose(tabManager.activeTabId);
    }

    /**
     * 处理 untitled 文件的关闭
     * untitled 文件不自动保存，关闭时询问用户是否保存
     */
    async function handleUntitledTabClose(tab) {
        const tabManager = getTabManager();
        const targetPath = tab.path;

        // 清除自动保存定时器
        const editor = getEditor();
        editor?.clearAutoSaveTimer?.();

        // 获取当前编辑器内容
        const activeViewMode = getActiveViewMode();
        let content = '';
        if (activeViewMode === 'markdown' && editor) {
            content = editor.getMarkdown?.() || '';
        } else if (activeViewMode === 'code') {
            const codeEditor = getCodeEditor();
            content = codeEditor?.getValue?.() || '';
        }

        // 更新 untitledFileManager 中的内容
        untitledFileManager?.setContent?.(targetPath, content);

        // 检查是否有内容需要保存
        const hasContent = content.trim().length > 0;

        if (hasContent && confirm) {
            const displayName = untitledFileManager?.getDisplayName?.(targetPath) || 'untitled.md';
            try {
                const shouldSave = await confirm(
                    `"${displayName}" 尚未保存，是否保存？`,
                    {
                        title: '保存文件',
                        kind: 'warning',
                        okLabel: '保存',
                        cancelLabel: '不保存',
                    }
                );

                if (shouldSave) {
                    // 调用 saveUntitledFile 弹出保存对话框
                    const saved = await saveUntitledFile?.(targetPath, content);
                    if (!saved) {
                        // 用户取消了保存对话框，不关闭 tab
                        return;
                    }
                }
            } catch (error) {
                console.warn('确认保存弹窗失败', error);
            }
        }

        // 清理 untitled 文件资源
        untitledFileManager?.removeUntitledFile?.(targetPath);

        // 清理视图状态
        const currentFile = getCurrentFile();
        const wasActive = currentFile === targetPath;

        // 从 tabManager.fileTabs 中移除 untitled tab
        if (tabManager && Array.isArray(tabManager.fileTabs)) {
            const tabIndex = tabManager.fileTabs.findIndex(t => t.path === targetPath);
            if (tabIndex !== -1) {
                tabManager.fileTabs.splice(tabIndex, 1);
            }
        }

        // 找到备选 tab
        let fallbackTab = null;
        if (wasActive && tabManager) {
            const remainingTabs = tabManager.getAllTabs() || [];
            if (remainingTabs.length > 0) {
                fallbackTab = remainingTabs[remainingTabs.length - 1];
            }
        }

        if (wasActive) {
            tabManager?.setActiveTab(null, { silent: true });
            clearActiveFileView();
        }

        // 重新渲染 tab bar
        tabManager?.render?.();

        // 切换到备选 tab
        if (wasActive && fallbackTab) {
            tabManager?.setActiveTab(fallbackTab.id);
        }

        // 清理 session
        documentSessions.closeSessionForPath(targetPath);
        const codeEditor = getCodeEditor();
        const markdownEditor = getEditor();
        codeEditor?.forgetViewStateForTab?.(targetPath);
        markdownEditor?.forgetViewStateForTab?.(targetPath);
        fileSession.clearEntry(targetPath);
    }

    function setupLinkNavigationListener() {
        window.addEventListener('open-file', async (event) => {
            const { path } = event.detail || {};
            if (!path) {
                console.error('open-file 事件缺少 path');
                return;
            }

            const fileTree = getFileTree();
            const tabManager = getTabManager();

            if (!fileTree) {
                console.error('fileTree 未初始化');
                return;
            }

            const activeTab = tabManager?.getAllTabs().find(tabItem => tabItem.id === tabManager?.activeTabId);

            if (activeTab && activeTab.type === 'file' && activeTab.path) {
                const oldPath = activeTab.path;
                fileTree.addToOpenFiles(path);
                fileTree.selectFile(path);
                fileTree.closeFile(oldPath);
            } else {
                isOpeningFromLink = true;
                fileTree.selectFile(path);
            }
        });
    }

    return {
        handleFileSelect,
        handleOpenFilesChange,
        handleTabSelect,
        handleTabClose,
        checkFileHasUnsavedChanges,
        closeActiveTab,
        setupLinkNavigationListener,
    };
}
