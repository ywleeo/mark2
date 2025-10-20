export function createWorkspaceController({
    getCurrentFile,
    getFileTree,
    getTabManager,
    isDirectory,
    getFileMetadata,
    createDefaultWorkspaceState,
    loadWorkspaceState,
    saveWorkspaceState,
}) {
    if (typeof getCurrentFile !== 'function') {
        throw new Error('workspaceController 需要提供 getCurrentFile');
    }
    if (typeof getFileTree !== 'function') {
        throw new Error('workspaceController 需要提供 getFileTree');
    }
    if (typeof getTabManager !== 'function') {
        throw new Error('workspaceController 需要提供 getTabManager');
    }
    if (typeof isDirectory !== 'function') {
        throw new Error('workspaceController 需要提供 isDirectory');
    }
    if (typeof getFileMetadata !== 'function') {
        throw new Error('workspaceController 需要提供 getFileMetadata');
    }
    if (typeof createDefaultWorkspaceState !== 'function') {
        throw new Error('workspaceController 需要提供 createDefaultWorkspaceState');
    }
    if (typeof loadWorkspaceState !== 'function') {
        throw new Error('workspaceController 需要提供 loadWorkspaceState');
    }
    if (typeof saveWorkspaceState !== 'function') {
        throw new Error('workspaceController 需要提供 saveWorkspaceState');
    }

    let isRestoring = false;

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim().length > 0;
    }

    function getDefaultSidebarState() {
        return createDefaultWorkspaceState().sidebar;
    }

    function persistWorkspaceState(overrides = {}, options = {}) {
        const forcePersist = options.force === true;
        if (isRestoring && !forcePersist) {
            return;
        }

        try {
            const defaultState = createDefaultWorkspaceState();
            const fileTree = getFileTree();
            const currentFile = getCurrentFile();

            const sidebarState = overrides.sidebar
                ?? fileTree?.getPersistedState?.()
                ?? defaultState.sidebar;

            const openFilesState = Array.isArray(overrides.openFiles)
                ? [...overrides.openFiles]
                : fileTree?.getOpenFilePaths?.()
                    ? [...fileTree.getOpenFilePaths()]
                    : [...defaultState.openFiles];

            const nextState = {
                currentFile,
                sidebar: sidebarState,
                openFiles: openFilesState,
                ...overrides,
            };

            if (!Object.prototype.hasOwnProperty.call(overrides, 'currentFile')) {
                nextState.currentFile = currentFile;
            }

            if (!Object.prototype.hasOwnProperty.call(overrides, 'sidebar')) {
                nextState.sidebar = sidebarState;
            }

            if (!Object.prototype.hasOwnProperty.call(overrides, 'openFiles')) {
                nextState.openFiles = openFilesState;
            }

            saveWorkspaceState(nextState);
        } catch (error) {
            console.warn('保存工作区状态失败', error);
        }
    }

    function handleSidebarStateChange(sidebarState) {
        if (isRestoring) {
            return;
        }
        persistWorkspaceState({ sidebar: sidebarState });
    }

    async function sanitizeSidebarState(rawSidebar) {
        const defaultSidebar = getDefaultSidebarState();
        const sanitized = {
            rootPaths: [],
            expandedFolders: [],
            sectionStates: { ...defaultSidebar.sectionStates },
        };

        if (rawSidebar && typeof rawSidebar === 'object') {
            if (Array.isArray(rawSidebar.rootPaths)) {
                sanitized.rootPaths = Array.from(
                    new Set(
                        rawSidebar.rootPaths
                            .filter(isNonEmptyString)
                            .map(path => path.trim())
                    )
                );
            }

            if (Array.isArray(rawSidebar.expandedFolders)) {
                sanitized.expandedFolders = Array.from(
                    new Set(
                        rawSidebar.expandedFolders
                            .filter(isNonEmptyString)
                            .map(key => key.trim())
                    )
                );
            }

            if (rawSidebar.sectionStates && typeof rawSidebar.sectionStates === 'object') {
                if (typeof rawSidebar.sectionStates.openFilesCollapsed === 'boolean') {
                    sanitized.sectionStates.openFilesCollapsed = rawSidebar.sectionStates.openFilesCollapsed;
                }
                if (typeof rawSidebar.sectionStates.foldersCollapsed === 'boolean') {
                    sanitized.sectionStates.foldersCollapsed = rawSidebar.sectionStates.foldersCollapsed;
                }
            }
        }

        const validRoots = [];
        for (const rootPath of sanitized.rootPaths) {
            try {
                const isDir = await isDirectory(rootPath);
                if (isDir) {
                    validRoots.push(rootPath);
                }
            } catch (error) {
                console.warn('跳过无效的根目录', rootPath, error);
            }
        }

        sanitized.rootPaths = validRoots;
        if (sanitized.expandedFolders.length > 0 && validRoots.length > 0) {
            sanitized.expandedFolders = sanitized.expandedFolders.filter((key) => {
                return validRoots.some(root => key.includes(root));
            });
        } else if (validRoots.length === 0) {
            sanitized.expandedFolders = [];
        }

        return sanitized;
    }

    async function sanitizeOpenFiles(rawOpenFiles) {
        if (!Array.isArray(rawOpenFiles) || rawOpenFiles.length === 0) {
            return [];
        }

        const uniquePaths = Array.from(
            new Set(
                rawOpenFiles
                    .filter(isNonEmptyString)
                    .map(path => path.trim())
            )
        );

        const validFiles = [];
        for (const path of uniquePaths) {
            try {
                const isDirPath = await isDirectory(path);
                if (isDirPath) {
                    continue;
                }
                await getFileMetadata(path);
                validFiles.push(path);
            } catch (error) {
                console.warn('跳过无效的标签页文件', path, error);
            }
        }

        return validFiles;
    }

    async function restoreWorkspaceStateFromStorage() {
        const stored = loadWorkspaceState();
        if (!stored) {
            return;
        }

        const fileTree = getFileTree();
        const tabManager = getTabManager();

        const sanitizedSidebar = await sanitizeSidebarState(stored.sidebar);
        const sanitizedOpenFiles = await sanitizeOpenFiles(stored.openFiles);

        isRestoring = true;
        try {
            if (fileTree) {
                await fileTree.restoreState(sanitizedSidebar);
                if (typeof fileTree.restoreOpenFiles === 'function') {
                    fileTree.restoreOpenFiles(sanitizedOpenFiles);
                }
            }
        } finally {
            isRestoring = false;
        }

        let targetFileToRestore = null;
        if (stored.currentFile && isNonEmptyString(stored.currentFile)) {
            try {
                await getFileMetadata(stored.currentFile);
                const directory = await isDirectory(stored.currentFile);
                if (!directory) {
                    targetFileToRestore = stored.currentFile;
                }
            } catch (error) {
                console.warn('恢复上次打开的文件失败', error);
            }
        }

        if (!targetFileToRestore && sanitizedOpenFiles.length > 0) {
            targetFileToRestore = sanitizedOpenFiles[sanitizedOpenFiles.length - 1];
        }

        if (targetFileToRestore) {
            fileTree?.selectFile(targetFileToRestore);
        } else {
            tabManager?.clearSharedTab?.();
        }

        const sidebarSnapshot = fileTree?.getPersistedState?.() ?? sanitizedSidebar;
        const openFilesSnapshot = fileTree?.getOpenFilePaths?.() ?? sanitizedOpenFiles;
        persistWorkspaceState({
            sidebar: sidebarSnapshot,
            openFiles: openFilesSnapshot,
        });
    }

    return {
        persistWorkspaceState,
        handleSidebarStateChange,
        restoreWorkspaceStateFromStorage,
        isRestoring: () => isRestoring,
    };
}
