import { basename, getPathIdentityKey, normalizeFsPath } from '../utils/pathUtils.js';
import { EVENT_IDS } from '../core/eventIds.js';
import { PANE_IDS } from '../core/layout/PaneManager.js';
import { navigationHistory } from './navigationHistory.js';
import { isActiveContentTab } from './navigation/tabActivity.js';
import { isDocumentWorkspace, resolveLinkPreviewReturnPath } from './document-library/documentNavigation.js';
import { getUntitledCloseContent } from './navigation/untitledClose.js';
import { askDocumentClose, confirmDiscardAfterSaveFailure } from './navigation/documentCloseDialog.js';
import { isFileAccessPermissionError } from '../utils/fileAccessErrors.js';

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
    documentRegistry,
    persistWorkspaceState,
    saveFile,
    getActiveViewMode,
    getEditor,
    getCodeEditor,
    confirm,
    showMessage,
    untitledFileManager,
    saveUntitledFile,
    eventBus,
    rememberScrollPosition,
    openInSecondary,
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
    if (!documentRegistry) {
        throw new Error('navigationController 需要提供 documentRegistry');
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

    const closedTabsStack = [];

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
     * 判断待关闭标签是否仍承载当前内容视图。
     * 文件被外部删除时，侧边栏选中态可能先于标签和文档状态清空，因此不能只依赖 fileTree.currentFile。
     * @param {Object|null} tab - 待判断的标签。
     * @returns {boolean} 标签是否为当前活动内容。
     */
    function isCurrentContentTab(tab) {
        const tabManager = getTabManager();
        const fileTree = getFileTree();
        return isActiveContentTab({
            tab,
            activeTabId: tabManager?.activeTabId || null,
            activePaths: [
                getCurrentFile?.(),
                documentManager?.getActivePath?.(),
                fileTree?.currentFile,
            ],
            normalizePath: value => normalizeComparablePath(fileTree, value),
        });
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

    /** 切换文件前尝试保存；写入失败时，可将有修改的文稿保留在原标签中。 */
    async function handleFileSelect(filePath, options = {}) {
        const { autoFocus = true, replaceTabPath = null, previewReturnPath = null } = options;
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
            if (!previewReturnPath && documentManager?.getDocumentByPath?.(filePath)?.previewReturnPath) {
                documentManager.openDocument(filePath, { previewReturnPath: null });
                persistWorkspaceState();
            }
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
                if (!saved && replaceTabPath) return;
                if (!saved) {
                    saveCurrentEditorContentToCache();
                    const preserved = filePath && documentRegistry.getCachedEntry?.(previousFile)?.hasChanges
                        && documentManager?.pinDocument?.(previousFile, { activate: false });
                    logger?.warn?.('handleFileSelect:saveFailed', {
                        filePath,
                        previousFile,
                        preserved: Boolean(preserved),
                    });
                    if (!preserved && normalizedPrevious) {
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
                    if (!preserved) return;
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
            if (replaceTabPath) {
                navigationHistory.rekeyLane(replaceTabPath, filePath);
                fileTree.addToOpenFiles(filePath, { previewReturnPath });
            }
            const newFileWillUseSharedTab = documentManager?.getDocumentByPath?.(filePath)?.pinned !== true;
            const isCurrentFileInSharedTab = previousFile && documentManager?.getDocumentByPath?.(previousFile)?.pinned !== true;

            saveCurrentEditorContentToCache();

            const tabId = normalizedNext || filePath || null;
            logger?.info?.('handleFileSelect:load', {
                filePath,
                tabId,
                shouldForceReload,
                newFileWillUseSharedTab,
                isCurrentFileInSharedTab,
            });
            await loadFile(filePath, { forceReload: shouldForceReload, autoFocus, tabId, previewReturnPath });
            getEditor?.()?.refreshSearch?.();

            // 检查导入型文件是否已切换到 untitled 路径（当前仅 PPTX 保留该流程）。
            const currentFileAfterLoad = getCurrentFile?.();
            const wasImportedAsUntitled = currentFileAfterLoad !== filePath
                && untitledFileManager?.isUntitledPath?.(currentFileAfterLoad)
                && documentManager?.getDocumentByPath?.(currentFileAfterLoad)?.pinned === true;
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

            const isOpenTab = documentManager?.getDocumentByPath?.(filePath)?.pinned === true;

            if (isOpenTab) {
                tabManager?.setActiveFileTab(filePath, { silent: true });
            } else {
                tabManager?.showSharedTab(filePath);
            }
            logger?.info?.('handleFileSelect:done', {
                filePath,
                resolvedPath: getCurrentFile?.(),
                tabStrategy: isOpenTab ? 'existing-tab' : 'shared-tab',
            });
        } catch (error) {
            console.error('文件选择失败，保持当前 tab 状态', { filePath, error });
            logger?.error?.('handleFileSelect:failed', {
                filePath,
                error,
            });
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

    /** 无法完成保存时再次确认放弃，弹窗失败默认停止关闭。 */
    async function confirmDiscardAfterFailedSave(filePath) {
        if (!confirm) {
            return false;
        }
        const fileName = (filePath ? basename(filePath) : '') || filePath || '';
        try {
            return await confirmDiscardAfterSaveFailure(fileName, confirm);
        } catch (error) {
            console.warn('确认放弃更改弹窗失败', error);
            return false;
        }
    }

    /** 关闭时一次询问覆盖、放弃或取消。普通保存继续使用原来的确认流程。 */
    async function resolveFileClose(filePath) {
        if (!await checkFileHasUnsavedChanges(filePath)) return 'close';
        const conflict = Boolean(documentSessions.hasExternalConflict?.(filePath));
        let decision;
        try {
            decision = await askDocumentClose(basename(filePath), { conflict, showMessage });
        } catch (error) {
            logger?.warn?.('resolveFileClose:dialogFailed', { path: filePath, error });
            return 'cancel';
        }
        if (decision !== 'save') return decision;

        try {
            if (await saveFile(filePath, { overwriteExternalConflict: conflict })) {
                return documentRegistry.getDocument?.(filePath)?.dirty ? 'cancel' : 'close';
            }
        } catch (error) {
            logger?.warn?.('resolveFileClose:saveFailed', { path: filePath, error });
        }
        return await confirmDiscardAfterFailedSave(filePath) ? 'discard' : 'cancel';
    }

    /** 丢弃草稿后解除冲突和文件树标记，重新打开时读取磁盘版本。 */
    async function discardChangesForClose(filePath) {
        if (await documentRegistry.discardChanges?.(filePath) === false) return false;
        documentSessions.clearExternalConflict?.(filePath);
        getFileTree()?.clearExternalModification?.(filePath);
        return true;
    }

    /** 确认窗口打开前停掉待执行的自动保存，确保放弃决策不会变成落盘。 */
    function pauseAutoSaveForClose(tab) {
        if (!isCurrentContentTab(tab)) return;
        getEditor()?.clearAutoSaveTimer?.();
        getCodeEditor()?.cancelAutoSave?.();
    }

    /** 统一保存和关闭；文档列表可自行选择邻居，避免先加载一个无关的备选 tab。 */
    async function handleTabClose(tab, { suppressFallback = false } = {}) {
        const fileTree = getFileTree();
        const tabManager = getTabManager();
        if (!tab) return;

        // 处理 untitled 文件的关闭
        if (tab.path && untitledFileManager?.isUntitledPath?.(tab.path)) {
            return handleUntitledTabClose(tab, { suppressFallback });
        }

        if (tab.type === 'file' && tab.path) {
            const targetPath = tab.path;

            pauseAutoSaveForClose(tab);

            const decision = await resolveFileClose(targetPath);
            if (decision === 'cancel') return;
            if (decision === 'discard' && !await discardChangesForClose(targetPath)) return;

            const normalizedTarget = normalizeComparablePath(fileTree, tab.path);
            const wasActive = isCurrentContentTab(tab);

            const fallbackTab = wasActive && !suppressFallback ? resolveFallbackTab(tab) : null;

            closedTabsStack.push({ path: targetPath, type: 'file' });
            if (closedTabsStack.length > 20) closedTabsStack.shift();

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
            documentRegistry.clearEntry(targetPath);
            navigationHistory.dropLane(targetPath);
            return;
        }

        if (tab.type === 'shared') {
            let wasActive = isCurrentContentTab(tab);
            let fallbackTab = wasActive && !suppressFallback ? resolveFallbackTab(tab) : null;

            if (tab.path) {
                const targetPath = tab.path;

                pauseAutoSaveForClose(tab);

                const decision = await resolveFileClose(targetPath);
                if (decision === 'cancel') return;
                if (decision === 'discard' && !await discardChangesForClose(targetPath)) return;

                // 保存期间预览位可能已经被另一篇文档复用，不能移除新预览或清空其视图。
                const currentPreview = (tabManager?.getAllTabs?.() || []).find(candidate => candidate?.type === 'shared');
                if (currentPreview && getPathIdentityKey(currentPreview.path) !== getPathIdentityKey(targetPath)) return;
                wasActive = isCurrentContentTab(tab);
                fallbackTab = wasActive && !suppressFallback ? resolveFallbackTab(tab) : null;

                closedTabsStack.push({ path: targetPath, type: 'shared' });
                if (closedTabsStack.length > 20) closedTabsStack.shift();

                if (documentManager?.getDocumentByPath?.(targetPath)?.pinned !== true) {
                    fileTree?.stopWatchingFile(targetPath);
                }
                documentSessions.closeSessionForPath(targetPath);
                documentManager?.closeDocument?.(targetPath);
                const codeEditor = getCodeEditor();
                const markdownEditor = getEditor();
                codeEditor?.forgetViewStateForTab?.(tab.id || null);
                markdownEditor?.forgetViewStateForTab?.(tab.id || null);
                documentRegistry.clearEntry(targetPath);
            }

            // shared tab 的移除与后续激活拆开，统一交给事务层提交。
            tabManager?.removeSharedTab?.({ nextActiveTabId: fallbackTab?.id || null });
            navigationHistory.dropLane(tabManager?.sharedTabId);

            if (wasActive) {
                await activateTabTransition(fallbackTab, { autoFocus: true });
            } else if (!fallbackTab && !getCurrentFile()) {
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

        if (typeof documentRegistry.isDirty === 'function') {
            return documentRegistry.isDirty(filePath);
        }
        const cached = documentRegistry.getCachedEntry(filePath);
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
        // 若用户已经取消过授权，允许切换文件，并保留原文稿，不用导航再次触发授权。
        const mode = getActiveViewMode();
        if (mode === 'markdown' && getEditor()?.hasPermissionSaveFailure?.(currentPath)) return false;
        if (mode === 'code' && isFileAccessPermissionError(getCodeEditor()?.getLastSaveError?.())) return false;
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

    async function reopenLastClosedTab() {
        if (closedTabsStack.length === 0) return;
        const { path, type } = closedTabsStack.pop();
        const fileTree = getFileTree();
        if (type === 'file') {
            fileTree?.addToOpenFiles?.(path);
        }
        fileTree?.selectFile?.(path, { autoFocus: true, silent: true });
        await handleFileSelect(path, { autoFocus: true });
    }

    /** 草稿关闭复用保存确认，允许文档列表自行选择相邻文档。 */
    async function handleUntitledTabClose(tab, { suppressFallback = false } = {}) {
        const tabManager = getTabManager();
        const targetPath = tab.path;
        const wasActive = isCurrentContentTab(tab);

        // 清除自动保存定时器
        const editor = getEditor();
        if (wasActive) editor?.clearAutoSaveTimer?.();

        // 获取目标草稿快照；后台条目只读取自己的模型或缓存。
        const activeViewMode = getActiveViewMode();
        const content = getUntitledCloseContent({ path: targetPath, isActive: wasActive,
            documentRegistry, untitledFileManager,
            getActiveContent: () => activeViewMode === 'markdown'
                ? editor?.getMarkdown?.() || '' : getCodeEditor()?.getValue?.() || '' });

        // 更新 untitledFileManager 中的内容
        untitledFileManager?.setContent?.(targetPath, content);

        // 判断关闭时是否需要提示保存
        const hasContent = content.trim().length > 0;
        const displayName = untitledFileManager?.getDisplayName?.(targetPath) || 'untitled.md';

        if (hasContent) {
            try {
                const choice = await askDocumentClose(displayName, { showMessage });
                if (choice === 'cancel') return;
                if (choice === 'save' && !await saveUntitledFile?.(targetPath, content)) return;
            } catch (error) {
                console.warn('确认保存弹窗失败', error);
                return;
            }
        }

        // 清理 untitled 文件资源
        untitledFileManager?.removeUntitledFile?.(targetPath);

        // 清理视图状态
        const fallbackTab = wasActive && !suppressFallback ? resolveFallbackTab(tab) : null;
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
        documentRegistry.clearEntry(targetPath);
        navigationHistory.dropLane(targetPath);
    }

    /** 链接和历史共用同一切换流程，保存并加载成功后再关闭被替换的标签。 */
    async function navigateInPrimary(targetPath, historyEntry) {
        const tabManager = getTabManager();
        const fileTree = getFileTree();
        if (!tabManager || !fileTree) return false;

        const target = normalizeComparablePath(fileTree, targetPath);
        const targetIdentity = getPathIdentityKey(target);
        const sourcePath = getCurrentFile();
        const sourceIdentity = getPathIdentityKey(sourcePath);
        if (!targetIdentity) return false;
        if (targetIdentity === sourceIdentity) return true;

        const tabs = tabManager.getAllTabs();
        const activeTab = tabs.find(tab => tab.id === tabManager.activeTabId);
        const existingFileTab = tabs.find(tab =>
            tab.type === 'file' && getPathIdentityKey(tab.path) === targetIdentity);
        const writing = isDocumentWorkspace();
        const replaceTabPath = !writing && !existingFileTab && activeTab?.type === 'file'
            ? activeTab.path
            : null;
        const sourceDocument = documentManager?.getDocumentByPath?.(sourcePath);
        if (writing) {
            // 刚切换皮肤时，来源文稿可能还只记录在 Classic 的固定标签历史中。
            navigationHistory.setActiveLane(tabManager.sharedTabId);
            navigationHistory.record(sourcePath, { previewReturnPath: sourceDocument?.previewReturnPath });
        }
        // 两套皮肤使用同一种链接来源；既有标签保留其原来的打开方式。
        const previewReturnPath = existingFileTab
            ? documentManager?.getDocumentByPath?.(target)?.previewReturnPath ?? null
            : historyEntry
                ? historyEntry.previewReturnPath
                : resolveLinkPreviewReturnPath(sourcePath, sourceDocument, target);

        await handleFileSelect(target, { replaceTabPath, previewReturnPath });
        const loaded = getPathIdentityKey(getCurrentFile()) === targetIdentity;
        if (loaded) {
            await fileTree.selectFile(target, { silent: true });
            const oldPreviewTab = writing && sourceDocument?.pinned && sourceDocument.previewReturnPath
                ? sourcePath
                : null;
            const replacedTab = replaceTabPath || oldPreviewTab;
            if (replacedTab) fileTree.closeFile(replacedTab, { suppressActivate: true });
        } else if (replaceTabPath) {
            navigationHistory.rekeyLane(target, replaceTabPath);
            fileTree.closeFile(target, { suppressActivate: true });
        }
        return loaded;
    }

    /** 监听 Markdown 本地链接，保留链接来源所在的文档栏。 */
    function setupLinkNavigationListener() {
        window.addEventListener('open-file', async (event) => {
            const { path, paneId } = event.detail || {};
            if (!path) {
                console.error('open-file 事件缺少 path');
                return;
            }

            // 副栏文档里的链接在副栏内跳转：主栏的标签和当前文档不受影响。
            if (paneId === PANE_IDS.SECONDARY) {
                await openInSecondary?.(path);
                return;
            }
            await navigateInPrimary(path);
        });
    }

    // 把后退 / 前进的实际跳转能力注入 navigationHistory
    navigationHistory.setNavigator(navigateInPrimary);

    return {
        handleFileSelect,
        handleOpenFilesChange,
        handleTabSelect,
        handleTabClose,
        checkFileHasUnsavedChanges,
        closeActiveTab,
        reopenLastClosedTab,
        setupLinkNavigationListener,
        activateTabTransition,
        resolveFallbackTab,
    };
}
