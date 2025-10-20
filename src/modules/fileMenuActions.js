export function createFileMenuActions(options = {}) {
    const {
        confirm,
        normalizeFsPath,
        normalizeSelectedPaths,
        checkFileHasUnsavedChanges,
        deleteEntry,
        writeFile,
        renameEntry,
        getCurrentFile,
        setCurrentFile,
        getHasUnsavedChanges,
        setHasUnsavedChanges,
        clearActiveFileView,
        updateWindowTitle,
        persistWorkspaceState,
        fileSession,
        getFileTree,
        getTabManager,
        getEditor,
        getCodeEditor,
        getImageViewer,
        getUnsupportedViewer,
        getFileMetadata,
        getStatusBarController,
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
    if (typeof deleteEntry !== 'function' || typeof renameEntry !== 'function'
        || typeof writeFile !== 'function') {
        throw new Error('createFileMenuActions 需要提供文件操作函数');
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
    if (typeof getFileTree !== 'function' || typeof getTabManager !== 'function') {
        throw new Error('createFileMenuActions 需要提供文件树和标签访问方法');
    }
    if (typeof getEditor !== 'function' || typeof getCodeEditor !== 'function') {
        throw new Error('createFileMenuActions 需要提供编辑器访问方法');
    }
    if (typeof getImageViewer !== 'function' || typeof getUnsupportedViewer !== 'function') {
        throw new Error('createFileMenuActions 需要提供预览器访问方法');
    }
    if (typeof getFileMetadata !== 'function') {
        throw new Error('createFileMenuActions 需要提供 getFileMetadata 方法');
    }
    if (typeof getStatusBarController !== 'function') {
        throw new Error('createFileMenuActions 需要提供状态栏访问方法');
    }

    async function createNewFile() {
        try {
            const { save } = await import('@tauri-apps/plugin-dialog');
            const targetPath = await save({
                title: '创建文件',
                defaultPath: '',
            });

            if (!targetPath) {
                return;
            }

            const normalizedPath = normalizeFsPath(targetPath);
            if (!normalizedPath) {
                return;
            }

            let exists = false;
            try {
                await getFileMetadata(normalizedPath);
                exists = true;
            } catch {
                exists = false;
            }

            if (exists) {
                const fileName = normalizedPath.split('/').pop() || normalizedPath;
                const shouldOverride = await confirm(
                    `文件 "${fileName}" 已存在，覆盖后将丢失原内容，是否继续？`,
                    {
                        title: '覆盖确认',
                        kind: 'warning',
                        okLabel: '覆盖',
                        cancelLabel: '取消',
                    }
                );
                if (!shouldOverride) {
                    return;
                }
            }

            await writeFile(normalizedPath, '');
            fileSession.clearEntry(normalizedPath);

            const fileTree = getFileTree();
            if (fileTree) {
                fileTree.addToOpenFiles(normalizedPath);
                fileTree.selectFile(normalizedPath);
            }
        } catch (error) {
            console.error('新建文件失败:', error);
            alert('新建文件失败: ' + (error?.message || error));
        }
    }

    async function deleteActiveFile() {
        const currentFile = normalizeFsPath(getCurrentFile());
        if (!currentFile) {
            return;
        }

        const fileName = currentFile.split('/').pop() || currentFile;
        const shouldDelete = await confirm(`确认删除文件 "${fileName}" 吗？`, {
            title: '删除文件',
            kind: 'warning',
            okLabel: '删除',
            cancelLabel: '取消',
        });

        if (!shouldDelete) {
            return;
        }

        try {
            const hasChanges = await checkFileHasUnsavedChanges(currentFile);
            if (hasChanges) {
                const confirmDiscard = await confirm(
                    `文件 "${fileName}" 有未保存的更改，删除后将无法恢复，是否继续？`,
                    {
                        title: '未保存的更改',
                        kind: 'warning',
                        okLabel: '继续删除',
                        cancelLabel: '取消',
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
            await deleteEntry(currentFile);
        } catch (error) {
            console.error('删除文件失败:', error);
            alert('删除文件失败: ' + (error?.message || error));
            return;
        }

        const fileTree = getFileTree();
        const tabManager = getTabManager();

        const wasOpenInList = fileTree?.isInOpenList?.(currentFile);
        const wasSharedTab = tabManager?.sharedTab?.path === currentFile;

        fileSession.clearEntry(currentFile);
        fileTree?.stopWatchingFile?.(currentFile);

        if (wasOpenInList) {
            setCurrentFile(null);
            setHasUnsavedChanges(false);
            fileTree.closeFile(currentFile);
        } else if (wasSharedTab) {
            tabManager?.clearSharedTab();
            clearActiveFileView();
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
            const { open } = await import('@tauri-apps/plugin-dialog');
            const selection = await open({
                directory: true,
                multiple: false,
            });
            const [targetDirectory] = normalizeSelectedPaths(selection);
            if (!targetDirectory) {
                return;
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

            await renameEntry(currentFile, normalizedDestination);
            await applyPathChange(currentFile, normalizedDestination);
        } catch (error) {
            console.error('移动文件失败:', error);
            alert('移动文件失败: ' + (error?.message || error));
        }
    }

    function renameActiveFile() {
        const currentFile = normalizeFsPath(getCurrentFile());
        if (!currentFile) {
            return;
        }

        const tabManager = getTabManager();
        if (!tabManager) {
            return;
        }

        const targetTab = tabManager.getAllTabs().find(tab => tab.path === currentFile);
        if (!targetTab) {
            return;
        }

        tabManager.setActiveTab(targetTab.id, { silent: true });
        tabManager.startRenamingTab(targetTab.id);
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

            await renameEntry(normalizedCurrent, normalizedDestination);
            await applyPathChange(normalizedCurrent, normalizedDestination, { tabLabel: trimmedLabel });
            return true;
        } catch (error) {
            console.error('重命名文件失败:', error);
            alert('重命名文件失败: ' + (error?.message || error));
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
            : (normalizedNew.split('/').pop() || normalizedNew);

        fileSession.renameEntry(normalizedOld, normalizedNew);

        const tabManager = getTabManager();
        tabManager?.updateTabPath(normalizedOld, normalizedNew, tabLabel);

        const fileTree = getFileTree();
        fileTree?.replaceOpenFilePath?.(normalizedOld, normalizedNew);

        const editor = getEditor();
        if (editor && editor.currentFile === normalizedOld) {
            editor.currentFile = normalizedNew;
        }
        const codeEditor = getCodeEditor();
        if (codeEditor && codeEditor.currentFile === normalizedOld) {
            codeEditor.currentFile = normalizedNew;
        }
        const imageViewer = getImageViewer();
        if (imageViewer && imageViewer.currentFile === normalizedOld) {
            imageViewer.currentFile = normalizedNew;
        }
        const unsupportedViewer = getUnsupportedViewer();
        if (unsupportedViewer && unsupportedViewer.currentFile === normalizedOld) {
            unsupportedViewer.currentFile = normalizedNew;
        }

        if (normalizeFsPath(getCurrentFile()) === normalizedOld) {
            setCurrentFile(normalizedNew);
        }

        const statusBarController = getStatusBarController();
        statusBarController?.updateStatusBar({
            filePath: getCurrentFile(),
            isDirty: getHasUnsavedChanges(),
        });

        persistWorkspaceState({ currentFile: getCurrentFile() });
        await updateWindowTitle();
    }

    return {
        createNewFile,
        deleteActiveFile,
        moveActiveFile,
        renameActiveFile,
        handleTabRenameConfirm,
        handleTabRenameCancel,
    };
}
