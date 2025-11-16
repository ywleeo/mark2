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
    confirm,
    saveFile,
    getActiveViewMode,
    getEditor,
    getCodeEditor,
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
    if (typeof confirm !== 'function') {
        throw new Error('navigationController 需要提供 confirm');
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

    let isOpeningFromLink = false;

    async function handleFileSelect(filePath) {
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
                    await loadFile(sharedTab.path);
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

            await loadFile(filePath, { forceReload: shouldForceReload });

            const isOpenTab = fileTree?.isInOpenList?.(filePath);

            if (isOpeningFromLink) {
                tabManager?.showSharedTab(filePath);
                isOpeningFromLink = false;
            } else if (isOpenTab) {
                tabManager?.setActiveFileTab(filePath, { silent: true });
            } else {
                tabManager?.showSharedTab(filePath);
            }
        } catch (error) {
            console.error('文件选择失败，保持当前 tab 状态');
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
        if (!tab) return;
        if ((tab.type === 'file' || tab.type === 'shared') && tab.path) {
            getFileTree()?.selectFile(tab.path);
        }
    }

    async function handleTabClose(tab) {
        const fileTree = getFileTree();
        const tabManager = getTabManager();
        if (!tab) return;

        if (tab.type === 'file' && tab.path) {
            const targetPath = tab.path;
            const hasChanges = await checkFileHasUnsavedChanges(targetPath);

            if (hasChanges) {
                const fileName = targetPath.split('/').pop() || targetPath;
                const shouldSave = await confirm(
                    `文件 "${fileName}" 有未保存的更改，是否保存？`,
                    {
                        title: '保存确认',
                        kind: 'warning',
                        okLabel: '保存',
                        cancelLabel: '不保存',
                    }
                );

                if (shouldSave) {
                    const saved = await saveFile(targetPath);
                    if (!saved) {
                        return;
                    }
                }

                fileSession.clearEntry(targetPath);
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
            return;
        }

        if (tab.type === 'shared') {
            if (tab.path) {
                const targetPath = tab.path;
                const hasChanges = await checkFileHasUnsavedChanges(targetPath);

                if (hasChanges) {
                    const fileName = targetPath.split('/').pop() || targetPath;
                    const shouldSave = await confirm(
                        `文件 "${fileName}" 有未保存的更改，是否保存？`,
                        {
                            title: '保存确认',
                            kind: 'warning',
                            okLabel: '保存',
                            cancelLabel: '不保存',
                        }
                    );

                    if (shouldSave) {
                        const saved = await saveFile(targetPath);
                        if (!saved) {
                            return;
                        }
                    }

                    fileSession.clearEntry(targetPath);
                }

                if (!fileTree?.isInOpenList(targetPath)) {
                    fileTree?.stopWatchingFile(targetPath);
                }
                documentSessions.closeSessionForPath(targetPath);
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

            if (activeViewMode === 'markdown' && editor) {
                return editor.hasUnsavedChanges();
            }
            if (activeViewMode === 'code' && codeEditor) {
                return codeEditor.hasUnsavedChanges();
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
