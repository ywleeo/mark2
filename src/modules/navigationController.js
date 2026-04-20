import { basename, getPathIdentityKey, normalizeFsPath } from '../utils/pathUtils.js';
import { EVENT_IDS } from '../core/eventIds.js';
import { t } from '../i18n/index.js';

function normalizeComparablePath(fileTree, value) {
    if (!value) {
        return value;
    }
    if (typeof fileTree?.normalizePath === 'function') {
        return fileTree.normalizePath(value);
    }
    return normalizeFsPath(value);
}

function getCanonicalOpenFilePaths(fileTree, openFilePaths = []) {
    const canonicalPaths = [];
    const seen = new Set();

    openFilePaths.forEach((path) => {
        const normalizedPath = normalizeComparablePath(fileTree, path);
        const identityKey = getPathIdentityKey(normalizedPath);
        if (!normalizedPath || !identityKey || seen.has(identityKey)) {
            return;
        }
        seen.add(identityKey);
        canonicalPaths.push(normalizedPath);
    });

    return canonicalPaths;
}

export function createNavigationController({
    logger,
    getFileTree,
    getTabManager,
    getCurrentFile,
    documentSessions,
    saveCurrentEditorContentToCache,
    documentManager,
    clearActiveFileView,
    loadFile,
    fileSession,
    persistWorkspaceState,
    saveFile,
    getActiveViewMode,
    getEditor,
    getCodeEditor,
    confirm,
    untitledFileManager,
    saveUntitledFile,
    eventBus,
    rememberScrollPosition,
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

    let isOpeningFromLink = false;

    /**
     * 从当前 TabManager 快照中计算关闭某个 tab 后的备选 tab。
     * 关闭流程统一使用这个函数，避免每种 tab 关闭逻辑各算一遍。
     * @param {Object|null} tab - 即将关闭的 tab
     * @returns {Object|null}
     */
    function resolveFallbackTab(tab) {
        const tabManager = getTabManager();
        const tabs = tabManager?.getAllTabs?.() || [];
        const closingTabId = tab?.id || null;
        const currentIndex = tabs.findIndex(candidate => candidate?.id === closingTabId);

        if (currentIndex === -1) {
            return tabs.length > 0 ? tabs[tabs.length - 1] : null;
        }

        const remainingTabs = tabs.filter(candidate => candidate?.id !== closingTabId);
        if (remainingTabs.length === 0) {
            return null;
        }

        const fallbackIndex = Math.min(currentIndex, remainingTabs.length - 1);
        return remainingTabs[fallbackIndex] || null;
    }

    /**
     * 事务化提交 tab 激活切换。
     * 先同步 tab/fileTree 选中态，再直接触发文档加载，避免依赖 onTabSelect 间接驱动。
     * @param {Object|null} targetTab - 目标 tab
     * @param {{autoFocus?: boolean}} options - 切换选项
     */
    async function activateTabTransition(targetTab, options = {}) {
        const { autoFocus = true } = options;
        const fileTree = getFileTree();
        const tabManager = getTabManager();
        const currentPath = getCurrentFile?.() || null;
        const currentTabId = tabManager?.activeTabId || null;
        const normalizedCurrent = normalizeComparablePath(fileTree, currentPath);
        const normalizedTarget = normalizeComparablePath(fileTree, targetTab?.path || null);
        const currentIdentity = getPathIdentityKey(normalizedCurrent);
        const targetIdentity = getPathIdentityKey(normalizedTarget);
        logger?.info?.('tabTransition:start', {
            autoFocus,
            targetTabId: targetTab?.id || null,
            targetPath: targetTab?.path || null,
            targetType: targetTab?.type || null,
        });

        if (!targetTab || !targetTab.path) {
            tabManager?.setActiveTab(null, { silent: true, force: true });
            fileTree?.selectFile?.(null, { autoFocus, silent: true });
            clearActiveFileView();
            logger?.info?.('tabTransition:done', {
                autoFocus,
                targetTabId: null,
                targetPath: null,
                targetType: null,
            });
            return;
        }

        if (currentTabId === targetTab.id && currentIdentity && currentIdentity === targetIdentity) {
            logger?.info?.('tabTransition:skip', {
                autoFocus,
                reason: 'already-active',
                targetTabId: targetTab.id,
                targetPath: targetTab.path,
                targetType: targetTab.type || null,
            });
            return;
        }

        tabManager?.setActiveTab(targetTab.id, { silent: true, force: true });
        fileTree?.selectFile?.(targetTab.path, { autoFocus, silent: true });
        await handleFileSelect(targetTab.path, { autoFocus });
        logger?.info?.('tabTransition:done', {
            autoFocus,
            targetTabId: targetTab.id,
            targetPath: targetTab.path,
            targetType: targetTab.type || null,
        });
    }

    async function handleFileSelect(filePath, options = {}) {
        const { autoFocus = true } = options;
        const fileTree = getFileTree();
        const tabManager = getTabManager();
        const previousFile = getCurrentFile();
        const normalizePath = (value) => normalizeComparablePath(fileTree, value);
        const normalizedPrevious = normalizePath(previousFile);
        const normalizedNext = normalizePath(filePath);
        const previousIdentity = getPathIdentityKey(normalizedPrevious);
        const nextIdentity = getPathIdentityKey(normalizedNext);
        const shouldForceReload = filePath
            ? Boolean(fileTree?.consumeExternalModification?.(filePath))
            : false;
        logger?.info?.('handleFileSelect:start', {
            filePath,
            autoFocus,
            previousFile,
            normalizedPrevious,
            normalizedNext,
        });

        if (filePath && previousIdentity && previousIdentity === nextIdentity && !shouldForceReload) {
            logger?.info?.('handleFileSelect:skip', {
                autoFocus,
                filePath,
                reason: 'same-file-noop',
            });
            return;
        }

        if (previousFile) {
            const isSwitchingToDifferentFile = nextIdentity
                ? previousIdentity !== nextIdentity
                : true;
            if (isSwitchingToDifferentFile) {
                // 切换 tab 前保存当前滚动位置
                rememberScrollPosition?.(previousFile, getActiveViewMode?.());
                const saved = await autoSaveActiveFileIfNeeded(previousFile);
                if (!saved) {
                    logger?.warn?.('handleFileSelect:blocked', {
                        filePath,
                        previousFile,
                        reason: 'auto-save-failed',
                    });
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
            logger?.info?.('handleFileSelect:clear', {
                reason: 'no-file-path',
            });

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
                if (!previousFile && !tabManager?.activeTabId) {
                    logger?.debug?.('handleFileSelect:skip', {
                        filePath,
                        reason: 'already-cleared',
                    });
                    return;
                }
                clearActiveFileView();
            }
            return;
        }

        try {
            const newFileWillUseSharedTab = !fileTree?.isInOpenList?.(filePath)
                && !(untitledFileManager?.isUntitledPath?.(filePath) && tabManager?.fileTabs?.some(t => t.path === filePath));
            const isCurrentFileInSharedTab = previousFile && !fileTree?.isInOpenList?.(previousFile);

            saveCurrentEditorContentToCache();

            const tabId = normalizedNext || filePath || null;
            logger?.info?.('handleFileSelect:load', {
                filePath,
                tabId,
                shouldForceReload,
                newFileWillUseSharedTab,
                isCurrentFileInSharedTab,
            });
            await loadFile(filePath, { forceReload: shouldForceReload, autoFocus, tabId });
            getEditor?.()?.refreshSearch?.();

            // 检查 importAsUntitled 是否已将当前文件切换到 untitled 路径（如 docx/xlsx 导入）
            const currentFileAfterLoad = getCurrentFile?.();
            const wasImportedAsUntitled = currentFileAfterLoad !== filePath
                && untitledFileManager?.isUntitledPath?.(currentFileAfterLoad)
                && tabManager?.fileTabs?.some(tab => tab.path === currentFileAfterLoad);
            if (wasImportedAsUntitled) {
                // 文件已作为 untitled 导入，直接激活 untitled tab，不更新 shared tab
                tabManager?.setActiveTab(currentFileAfterLoad, { silent: true });
                logger?.info?.('handleFileSelect:done', {
                    filePath,
                    resolvedPath: currentFileAfterLoad,
                    tabStrategy: 'imported-untitled',
                });
                return;
            }

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
            logger?.info?.('handleFileSelect:done', {
                filePath,
                resolvedPath: getCurrentFile?.(),
                tabStrategy: isOpeningFromLink
                    ? 'shared-from-link'
                    : (isOpenTab || isUntitledInFileTabs ? 'existing-tab' : 'shared-tab'),
            });
        } catch (error) {
            console.error('文件选择失败，保持当前 tab 状态', { filePath, error });
            logger?.error?.('handleFileSelect:failed', {
                filePath,
                error,
            });
            isOpeningFromLink = false;
        }
    }

    function handleOpenFilesChange(openFilePaths) {
        // fileTree 与 tabManager 都订阅 DocumentManager，无需再做桥接。
        // 这里只负责同步 sidebar 选中态与持久化。
        const tabManager = getTabManager();
        const fileTree = getFileTree();
        const canonicalOpenFilePaths = getCanonicalOpenFilePaths(fileTree, Array.isArray(openFilePaths) ? openFilePaths : []);
        const canonicalCurrentFile = normalizeComparablePath(fileTree, fileTree?.currentFile || null) || null;

        const activeTab = tabManager?.getAllTabs().find(t => t.id === tabManager.activeTabId);
        if (activeTab?.path) {
            fileTree?.selectFile?.(activeTab.path, { autoFocus: false, silent: true });
        }

        persistWorkspaceState({ openFiles: canonicalOpenFilePaths });
        logger?.info?.('handleOpenFilesChange', {
            openFiles: canonicalOpenFilePaths,
            currentFile: canonicalCurrentFile,
        });
    }

    /**
     * 处理用户点击 tab 的激活。
     * 普通切换也统一走事务化激活，避免再依赖 fileTree.selectFile 间接触发。
     * @param {Object|null} tab - 被点击的 tab
     */
    function handleTabSelect(tab) {
        // 发出 tab 切换事件，用于通知其他模块（如 AI 工具栏）
        eventBus?.emit(EVENT_IDS.TAB_SWITCH, { tab });

        if (!tab) {
            return;
        }
        if ((tab.type === 'file' || tab.type === 'shared') && tab.path) {
            void activateTabTransition(tab, { autoFocus: true });
        }
    }

    async function confirmDiscardAfterFailedSave(filePath) {
        if (!confirm) {
            return false;
        }
        const fileName = (filePath ? basename(filePath) : '') || filePath || '';
        try {
            return await confirm(
                t('tabClose.saveFailed.message', { name: fileName }),
                {
                    title: t('tabClose.saveFailed.title'),
                    kind: 'warning',
                    okLabel: t('tabClose.saveFailed.discard'),
                    cancelLabel: t('common.cancel'),
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

            const normalizedTarget = normalizeComparablePath(fileTree, tab.path);
            const currentNormalized = normalizeComparablePath(fileTree, fileTree?.currentFile);
            const targetIdentity = getPathIdentityKey(normalizedTarget);
            const currentIdentity = getPathIdentityKey(currentNormalized);
            const wasActive = Boolean(targetIdentity) && targetIdentity === currentIdentity;

            const fallbackTab = wasActive ? resolveFallbackTab(tab) : null;

            // dm 是真源：TabManager.removeFileTab → dm.closeDocument → fileTree/tabManager 双方自行派生
            tabManager?.removeFileTab(targetPath);
            if (wasActive) {
                tabManager?.setActiveTab(fallbackTab?.id || null, { silent: true, force: true });
                await activateTabTransition(fallbackTab, { autoFocus: true });
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
            const currentNormalized = normalizeComparablePath(fileTree, fileTree?.currentFile);
            const targetNormalized = normalizeComparablePath(fileTree, tab.path);
            const wasActive = Boolean(getPathIdentityKey(currentNormalized))
                && getPathIdentityKey(currentNormalized) === getPathIdentityKey(targetNormalized);
            const fallbackTab = wasActive ? resolveFallbackTab(tab) : null;

            if (tab.path) {
                const targetPath = tab.path;

                // 清除自动保存定时器
                const editor = getEditor();
                editor?.clearAutoSaveTimer?.();

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
                documentManager?.closeDocument?.(targetPath);
                const codeEditor = getCodeEditor();
                const markdownEditor = getEditor();
                codeEditor?.forgetViewStateForTab?.(tab.id || null);
                markdownEditor?.forgetViewStateForTab?.(tab.id || null);
                fileSession.clearEntry(targetPath);
            }

            // shared tab 的移除与后续激活拆开，统一交给事务层提交。
            tabManager?.removeSharedTab?.({ nextActiveTabId: fallbackTab?.id || null });

            if (wasActive) {
                await activateTabTransition(fallbackTab, { autoFocus: true });
            } else if (!fallbackTab) {
                fileTree?.selectFile(null, { silent: true });
            }
            return;
        }

        tabManager?.handleTabClose?.(tab);
    }

    async function checkFileHasUnsavedChanges(filePath) {
        const fileTree = getFileTree();
        const currentFile = getCurrentFile();
        const normalizedTarget = normalizeComparablePath(fileTree, filePath);
        const normalizedCurrent = normalizeComparablePath(fileTree, currentFile);
        const targetIdentity = getPathIdentityKey(normalizedTarget);
        const currentIdentity = getPathIdentityKey(normalizedCurrent);
        if (targetIdentity && targetIdentity === currentIdentity) {
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

        if (typeof fileSession.isDirty === 'function') {
            return fileSession.isDirty(filePath);
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
            logger?.info?.('autoSaveActiveFileIfNeeded:skip', {
                path: currentPath,
                reason: 'clean',
            });
            return true;
        }
        try {
            const saved = await saveFile(currentPath);
            logger?.info?.('autoSaveActiveFileIfNeeded:done', {
                path: currentPath,
                saved: Boolean(saved),
            });
            return Boolean(saved);
        } catch (error) {
            console.error('自动保存当前文件失败:', error);
            logger?.error?.('autoSaveActiveFileIfNeeded:failed', {
                path: currentPath,
                error,
            });
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

        if (hasContent) {
            const displayName = untitledFileManager?.getDisplayName?.(targetPath) || 'untitled.md';
            try {
                const { message } = await import('@tauri-apps/plugin-dialog');
                const saveLabel = t('tabClose.untitled.save');
                const cancelLabel = t('common.cancel');
                const choice = await message(
                    t('tabClose.untitled.message', { name: displayName }),
                    {
                        title: t('tabClose.untitled.title'),
                        kind: 'warning',
                        buttons: {
                            yes: saveLabel,
                            no: t('tabClose.untitled.dontSave'),
                            cancel: cancelLabel,
                        },
                    }
                );

                if (choice === saveLabel || choice === 'Yes') {
                    // 调用 saveUntitledFile 弹出保存对话框
                    const saved = await saveUntitledFile?.(targetPath, content);
                    if (!saved) {
                        // 用户取消了保存对话框，不关闭 tab
                        return;
                    }
                } else if (choice === cancelLabel || choice === 'Cancel') {
                    // 用户取消关闭，不移除 tab
                    return;
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
        const fallbackTab = wasActive ? resolveFallbackTab(tab) : null;
        tabManager?.removeFileTab?.(targetPath);
        if (wasActive) {
            tabManager?.setActiveTab?.(fallbackTab?.id || null, { silent: true, force: true });
        }

        // 切换到备选 tab
        if (wasActive) {
            await activateTabTransition(fallbackTab, { autoFocus: true });
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
        activateTabTransition,
        resolveFallbackTab,
    };
}
