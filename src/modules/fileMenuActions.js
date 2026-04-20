import { rememberSecurityScopes } from '../services/securityScopeService.js';
import { basename } from '../utils/pathUtils.js';
import { t } from '../i18n/index.js';

export function createFileMenuActions(options = {}) {
    const {
        confirm,
        normalizeFsPath,
        normalizeSelectedPaths,
        checkFileHasUnsavedChanges,
        fileService,
        getCurrentFile,
        setCurrentFile,
        getHasUnsavedChanges,
        setHasUnsavedChanges,
        clearActiveFileView,
        updateWindowTitle,
        persistWorkspaceState,
        fileSession,
        documentManager,
        getFileTree,
        getTabManager,
        getEditor,
        getCodeEditor,
        getImageViewer,
        getUnsupportedViewer,
        getStatusBarController,
        documentSessions,
        loadFile,
        viewManager,
        getActiveViewMode,
        activateTabTransition,
    } = options;

    if (typeof confirm !== 'function') {
        throw new Error('createFileMenuActions 需要提供 confirm 函数');
    }
    if (typeof normalizeFsPath !== 'function') {
        throw new Error('createFileMenuActions 需要提供 normalizeFsPath 函数');
    }
    if (typeof normalizeSelectedPaths !== 'function') {
        throw new Error('createFileMenuActions 需要提供 normalizeSelectedPaths 函数');
    }
    if (typeof checkFileHasUnsavedChanges !== 'function') {
        throw new Error('createFileMenuActions 需要提供 checkFileHasUnsavedChanges 函数');
    }
    if (!fileService) {
        throw new Error('createFileMenuActions 需要提供 fileService');
    }
    if (typeof getCurrentFile !== 'function' || typeof setCurrentFile !== 'function') {
        throw new Error('createFileMenuActions 需要提供文件状态访问方法');
    }
    if (typeof getHasUnsavedChanges !== 'function' || typeof setHasUnsavedChanges !== 'function') {
        throw new Error('createFileMenuActions 需要提供未保存状态访问方法');
    }
    if (typeof clearActiveFileView !== 'function') {
        throw new Error('createFileMenuActions 需要提供 clearActiveFileView');
    }
    if (typeof updateWindowTitle !== 'function') {
        throw new Error('createFileMenuActions 需要提供 updateWindowTitle');
    }
    if (typeof persistWorkspaceState !== 'function') {
        throw new Error('createFileMenuActions 需要提供 persistWorkspaceState');
    }
    if (!fileSession || typeof fileSession.renameEntry !== 'function') {
        throw new Error('createFileMenuActions 需要提供支持 renameEntry 的 fileSession');
    }
    if (!documentManager || typeof documentManager.renameDocument !== 'function') {
        throw new Error('createFileMenuActions 需要提供 documentManager');
    }
    if (typeof getFileTree !== 'function' || typeof getTabManager !== 'function') {
        throw new Error('createFileMenuActions 需要提供文件树和标签访问方法');
    }
    if (typeof getEditor !== 'function' || typeof getCodeEditor !== 'function') {
        throw new Error('createFileMenuActions 需要提供编辑器访问方法');
    }
    if (typeof getImageViewer !== 'function' || typeof getUnsupportedViewer !== 'function') {
        throw new Error('createFileMenuActions 需要提供预览器访问方法');
    }
    if (typeof getStatusBarController !== 'function') {
        throw new Error('createFileMenuActions 需要提供状态栏访问方法');
    }
    if (!documentSessions || typeof documentSessions.closeSessionForPath !== 'function') {
        throw new Error('createFileMenuActions 需要提供 documentSessions');
    }
    if (typeof loadFile !== 'function') {
        throw new Error('createFileMenuActions 需要提供 loadFile');
    }
    if (!viewManager || typeof viewManager.resolveViewMode !== 'function') {
        throw new Error('createFileMenuActions 需要提供 viewManager');
    }
    if (typeof getActiveViewMode !== 'function') {
        throw new Error('createFileMenuActions 需要提供 getActiveViewMode');
    }
    if (typeof activateTabTransition !== 'function') {
        throw new Error('createFileMenuActions 需要提供 activateTabTransition');
    }

    async function createNewFile() {
        try {
            const { save } = await import('@tauri-apps/plugin-dialog');
            // 默认定位到当前活动标签所在文件的父目录，辅助用户在相同目录下建新文件
            let defaultPath = '';
            try {
                const tabManager = getTabManager?.();
                const activeTabId = tabManager?.activeTabId;
                if (tabManager && activeTabId) {
                    const activeTab = tabManager.getAllTabs?.()
                        ?.find(tab => tab.id === activeTabId);
                    const normalizedActivePath = normalizeFsPath(activeTab?.path);
                    if (normalizedActivePath) {
                        const { dirname } = await import('@tauri-apps/api/path');
                        const parentDir = await dirname(normalizedActivePath);
                        const normalizedParent = normalizeFsPath(parentDir);
                        if (normalizedParent) {
                            defaultPath = normalizedParent;
                        }
                    }
                }
            } catch (pathError) {
                console.warn('获取新建文件默认目录失败:', pathError);
            }
            const targetPath = await save({
                title: t('fileMenu.createFile.title'),
                defaultPath: defaultPath || undefined,
            });

            if (!targetPath) {
                return;
            }

            const normalizedPath = normalizeFsPath(targetPath);
            if (!normalizedPath) {
                return;
            }

            const exists = await fileService.exists(normalizedPath);

            if (exists) {
                const fileName = basename(normalizedPath) || normalizedPath;
                const shouldOverride = await confirm(
                    t('fileMenu.overwrite.message', { name: fileName }),
                    {
                        title: t('fileMenu.overwrite.title'),
                        kind: 'warning',
                        okLabel: t('fileMenu.overwrite.ok'),
                        cancelLabel: t('common.cancel'),
                    }
                );
                if (!shouldOverride) {
                    return;
                }
            }

            await fileService.writeText(normalizedPath, '');
            fileSession.clearEntry(normalizedPath);

            const fileTree = getFileTree();
            if (fileTree) {
                fileTree.addToOpenFiles(normalizedPath);
                fileTree.selectFile(normalizedPath);
            }
        } catch (error) {
            console.error('新建文件失败:', error);
            alert(t('fileMenu.createFile.error', { error: error?.message || error }));
        }
    }

    async function deleteActiveFile() {
        const currentFile = normalizeFsPath(getCurrentFile());
        if (!currentFile) {
            return;
        }

        const fileName = basename(currentFile) || currentFile;
        const shouldDelete = await confirm(t('fileMenu.deleteFile.confirm', { name: fileName }), {
            title: t('fileMenu.deleteFile.title'),
            kind: 'warning',
            okLabel: t('fileMenu.deleteFile.ok'),
            cancelLabel: t('common.cancel'),
        });

        if (!shouldDelete) {
            return;
        }

        try {
            const hasChanges = await checkFileHasUnsavedChanges(currentFile);
            if (hasChanges) {
                const confirmDiscard = await confirm(
                    t('fileMenu.deleteFile.unsavedMessage', { name: fileName }),
                    {
                        title: t('fileMenu.deleteFile.unsavedTitle'),
                        kind: 'warning',
                        okLabel: t('fileMenu.deleteFile.unsavedOk'),
                        cancelLabel: t('common.cancel'),
                    }
                );
                if (!confirmDiscard) {
                    return;
                }
            }
        } catch (error) {
            console.error('检查未保存更改失败:', error);
        }

        try {
            await fileService.remove(currentFile);
        } catch (error) {
            console.error('删除文件失败:', error);
            alert(t('fileMenu.deleteFile.error', { error: error?.message || error }));
            return;
        }

        const fileTree = getFileTree();
        const tabManager = getTabManager();

        const fallbackTab = (() => {
            const tabs = tabManager?.getAllTabs?.() || [];
            const currentTabIndex = tabs.findIndex((tab) => tab?.path === currentFile);
            if (currentTabIndex === -1) {
                return tabs.length > 0 ? tabs[tabs.length - 1] : null;
            }
            if (tabs.length <= 1) {
                return null;
            }
            if (currentTabIndex < tabs.length - 1) {
                return tabs[currentTabIndex + 1] || null;
            }
            if (currentTabIndex > 0) {
                return tabs[currentTabIndex - 1] || null;
            }
            return null;
        })();

        const wasOpenInList = fileTree?.isInOpenList?.(currentFile);
        const wasSharedTab = tabManager?.sharedTab?.path === currentFile;

        fileSession.clearEntry(currentFile);
        fileTree?.stopWatchingFile?.(currentFile);
        documentSessions.closeSessionForPath(currentFile);
        // dm.closeDocument 会派生清理 fileTree.openFiles 与 tabManager.fileTabs
        documentManager.closeDocument(currentFile);

        if (wasOpenInList) {
            setHasUnsavedChanges(false);
            tabManager?.setActiveTab?.(fallbackTab?.id || null, { silent: true, force: true });
            await activateTabTransition(fallbackTab, { autoFocus: true });
            void updateWindowTitle();
            return;
        } else if (wasSharedTab) {
            tabManager?.removeSharedTab?.({ nextActiveTabId: fallbackTab?.id || null });
            await activateTabTransition(fallbackTab, { autoFocus: true });
        } else if (normalizeFsPath(getCurrentFile()) === currentFile) {
            clearActiveFileView();
        }

        void updateWindowTitle();
    }

    async function moveActiveFile() {
        const currentFile = normalizeFsPath(getCurrentFile());
        if (!currentFile) {
            return;
        }

        try {
            const selections = await fileService.pick({
                directory: true,
                multiple: false,
                allowFiles: false,
            });
            const selectionEntries = Array.isArray(selections) ? selections.filter(Boolean) : [];
            const [targetDirectory] = normalizeSelectedPaths(selectionEntries);
            if (!targetDirectory) {
                return;
            }
            if (selectionEntries.length > 0) {
                try {
                    await rememberSecurityScopes(selectionEntries, { persist: false });
                } catch (error) {
                    console.warn('[fileMenuActions] 申请目标目录权限失败', error);
                }
            }

            const { dirname, join, basename } = await import('@tauri-apps/api/path');
            const currentDir = await dirname(currentFile);
            const normalizedCurrentDir = normalizeFsPath(currentDir);
            const normalizedTargetDir = normalizeFsPath(targetDirectory);

            if (!normalizedTargetDir || normalizedTargetDir === normalizedCurrentDir) {
                return;
            }

            const fileName = await basename(currentFile);
            const destinationPath = await join(normalizedTargetDir, fileName);
            const normalizedDestination = normalizeFsPath(destinationPath);

            if (!normalizedDestination || normalizedDestination === currentFile) {
                return;
            }

            await fileService.move(currentFile, normalizedDestination);
            await applyPathChange(currentFile, normalizedDestination);
        } catch (error) {
            console.error('移动文件失败:', error);
            alert(t('fileMenu.moveFile.error', { error: error?.message || error }));
        }
    }

    function renameActiveFile() {
        const currentFile = normalizeFsPath(getCurrentFile());
        if (!currentFile) {
            return;
        }

        const fileTree = getFileTree();
        if (!fileTree) {
            return;
        }

        // 在文件树中触发重命名
        fileTree.startRenaming(currentFile);
        
        // 同时将焦点设置到文件树或打开文件列表的对应项上
        const focusTarget = fileTree.container.querySelector(`.tree-file[data-path="${currentFile}"]`)
            || fileTree.container.querySelector(`.open-file-item[data-path="${currentFile}"]`);
        if (focusTarget) {
            if (!focusTarget.hasAttribute('tabindex')) {
                focusTarget.tabIndex = -1;
            }
            try {
                focusTarget.focus();
            } catch (focusError) {
                console.warn('重命名时无法聚焦对应项:', focusError);
            }
        }
    }

    async function handleTabRenameConfirm(tab, nextLabel) {
        if (!tab || !tab.path) {
            return true;
        }

        const trimmedLabel = typeof nextLabel === 'string' ? nextLabel.trim() : '';
        if (trimmedLabel.length === 0) {
            return false;
        }

        try {
            const { dirname, join } = await import('@tauri-apps/api/path');
            const parentDir = await dirname(tab.path);
            const destinationPath = await join(parentDir, trimmedLabel);
            const normalizedCurrent = normalizeFsPath(tab.path);
            const normalizedDestination = normalizeFsPath(destinationPath);

            if (normalizedCurrent === normalizedDestination) {
                const tabManager = getTabManager();
                tabManager?.stopRenamingTab();
                return true;
            }

            await fileService.move(normalizedCurrent, normalizedDestination);
            await applyPathChange(normalizedCurrent, normalizedDestination, { tabLabel: trimmedLabel });
            return true;
        } catch (error) {
            console.error('重命名文件失败:', error);
            alert(t('fileMenu.renameFile.error', { error: error?.message || error }));
            return false;
        }
    }

    function handleTabRenameCancel() {
        // 取消重命名时无需额外操作
    }

    async function applyPathChange(oldPath, newPath, options = {}) {
        const normalizedOld = normalizeFsPath(oldPath);
        const normalizedNew = normalizeFsPath(newPath);
        if (!normalizedOld || !normalizedNew) {
            return;
        }

        const tabLabel = typeof options.tabLabel === 'string'
            ? options.tabLabel
            : (basename(normalizedNew) || normalizedNew);

        fileSession.renameEntry(normalizedOld, normalizedNew);

        const tabManager = getTabManager();
        tabManager?.updateTabPath(normalizedOld, normalizedNew, tabLabel);

        const fileTree = getFileTree();
        fileTree?.replaceOpenFilePath?.(normalizedOld, normalizedNew);

        const editor = getEditor();
        editor?.renameDocumentPath?.(normalizedOld, normalizedNew);
        if (editor?.renameViewStateForTab) {
            editor.renameViewStateForTab(normalizedOld, normalizedNew);
        }
        const codeEditor = getCodeEditor();
        if (codeEditor && codeEditor.currentFile === normalizedOld) {
            codeEditor.currentFile = normalizedNew;
        }
        if (codeEditor?.renameViewStateForTab) {
            codeEditor.renameViewStateForTab(normalizedOld, normalizedNew);
        }
        const imageViewer = getImageViewer();
        if (imageViewer && imageViewer.currentFile === normalizedOld) {
            imageViewer.currentFile = normalizedNew;
        }
        const unsupportedViewer = getUnsupportedViewer();
        if (unsupportedViewer && unsupportedViewer.currentFile === normalizedOld) {
            unsupportedViewer.currentFile = normalizedNew;
        }

        const isCurrentFile = normalizeFsPath(getCurrentFile()) === normalizedOld;
        documentManager.renameDocument(normalizedOld, normalizedNew, {
            tabId: normalizedNew,
            active: isCurrentFile,
        });
        if (isCurrentFile) {
            // 仅更新当前文件路径，不触发任何会导致编辑器聚焦的逻辑
            setCurrentFile(normalizedNew);
        }
        documentSessions.updateSessionPath(normalizedOld, normalizedNew);

        const statusBarController = getStatusBarController();
        statusBarController?.updateStatusBar({
            filePath: getCurrentFile(),
            isDirty: getHasUnsavedChanges(),
        });

        persistWorkspaceState({ currentFile: getCurrentFile() });
        await updateWindowTitle();

        // 检测文件类型是否变化，如果变了需要重新加载文件
        if (isCurrentFile) {
            const oldViewMode = viewManager.resolveViewMode(normalizedOld);
            const newViewMode = viewManager.resolveViewMode(normalizedNew);
            const currentViewMode = getActiveViewMode();

            // 如果新文件的视图模式与当前不一致，需要重新加载
            if (newViewMode !== currentViewMode || newViewMode !== oldViewMode) {
                try {
                    await loadFile(normalizedNew, { autoFocus: false, tabId: normalizedNew });
                } catch (error) {
                    console.error('重命名后重新加载文件失败:', error);
                }
            }
        }
    }

    return {
        createNewFile,
        deleteActiveFile,
        moveActiveFile,
        renameActiveFile,
        handleTabRenameConfirm,
        handleTabRenameCancel,
        applyPathChange,
    };
}
