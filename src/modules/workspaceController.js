import { normalizeFsPath, getPathIdentityKey } from '../utils/pathUtils.js';

export function createWorkspaceController({
    getCurrentFile,
    getFileTree,
    getTabManager,
    fileService,
    workspaceManager,
    untitledFileManager,
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
    if (!fileService) {
        throw new Error('workspaceController 需要提供 fileService');
    }
    if (!workspaceManager || typeof workspaceManager.persistWorkspaceState !== 'function') {
        throw new Error('workspaceController 需要提供 workspaceManager');
    }
    if (!untitledFileManager || typeof untitledFileManager.isUntitledPath !== 'function') {
        throw new Error('workspaceController 需要提供 untitledFileManager');
    }

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim().length > 0;
    }

    function getDefaultSidebarState() {
        return workspaceManager.getSnapshot().sidebar;
    }

    function canonicalizeWorkspacePath(value) {
        if (!isNonEmptyString(value)) {
            return null;
        }

        const canonical = normalizeFsPath(value.trim());
        return isNonEmptyString(canonical) ? canonical : null;
    }

    function getCanonicalDedupedPaths(values) {
        if (!Array.isArray(values) || values.length === 0) {
            return [];
        }

        const deduped = new Map();
        values.forEach((value) => {
            const canonical = canonicalizeWorkspacePath(value);
            if (!canonical) {
                return;
            }

            const identity = getPathIdentityKey(canonical) ?? canonical;
            if (!deduped.has(identity)) {
                deduped.set(identity, canonical);
            }
        });

        return Array.from(deduped.values());
    }

    function extractPathFromFolderKey(folderKey) {
        if (!folderKey) {
            return '';
        }

        const segments = String(folderKey).split('::');
        return segments[segments.length - 1] || '';
    }

    function canonicalizeFolderKey(folderKey) {
        if (!isNonEmptyString(folderKey)) {
            return null;
        }

        const segments = folderKey.trim().split('::');
        if (segments.length < 2) {
            return null;
        }

        const folderPath = canonicalizeWorkspacePath(segments[segments.length - 1]);
        if (!folderPath) {
            return null;
        }

        const parentSegment = segments.slice(0, -1).join('::');
        if (parentSegment === 'root') {
            return `root::${folderPath}`;
        }

        const parentPath = canonicalizeWorkspacePath(parentSegment);
        if (!parentPath) {
            return null;
        }

        return `${parentPath}::${folderPath}`;
    }

    function getCanonicalDedupedFolderKeys(values) {
        if (!Array.isArray(values) || values.length === 0) {
            return [];
        }

        const deduped = new Map();
        values.forEach((value) => {
            const canonical = canonicalizeFolderKey(value);
            if (!canonical) {
                return;
            }

            const [parentSegment] = canonical.split('::');
            const folderIdentity = getPathIdentityKey(extractPathFromFolderKey(canonical)) ?? canonical;
            const parentIdentity = canonical.startsWith('root::')
                ? 'root'
                : (getPathIdentityKey(parentSegment) ?? parentSegment);
            const identity = `${parentIdentity}::${folderIdentity}`;

            if (!deduped.has(identity)) {
                deduped.set(identity, canonical);
            }
        });

        return Array.from(deduped.values());
    }

    function folderKeyBelongsToRoot(folderKey, rootPath) {
        const rootCanonical = canonicalizeWorkspacePath(rootPath);
        if (!rootCanonical) {
            return false;
        }

        const folderCanonical = canonicalizeWorkspacePath(extractPathFromFolderKey(folderKey));
        if (!folderCanonical) {
            return false;
        }

        const rootIdentity = getPathIdentityKey(rootCanonical);
        const folderIdentity = getPathIdentityKey(folderCanonical);
        if (!rootIdentity || !folderIdentity) {
            return false;
        }

        if (rootIdentity === folderIdentity) {
            return true;
        }

        const separator = rootIdentity.includes('\\') ? '\\' : '/';
        const rootPrefix = rootIdentity.endsWith(separator) ? rootIdentity : `${rootIdentity}${separator}`;
        return folderIdentity.startsWith(rootPrefix);
    }

    function filterExpandedFoldersByRoots(expandedFolders, rootPaths) {
        if (!Array.isArray(expandedFolders) || expandedFolders.length === 0) {
            return [];
        }

        if (!Array.isArray(rootPaths) || rootPaths.length === 0) {
            return [];
        }

        return expandedFolders.filter((folderKey) => {
            return rootPaths.some(rootPath => folderKeyBelongsToRoot(folderKey, rootPath));
        });
    }

    function resolveCanonicalCurrentFile(currentFile, openFiles) {
        const canonicalCurrentFile = canonicalizeWorkspacePath(currentFile);
        if (!canonicalCurrentFile) {
            return null;
        }

        const currentIdentity = getPathIdentityKey(canonicalCurrentFile) ?? canonicalCurrentFile;
        const matchedOpenFile = openFiles.find((path) => {
            return (getPathIdentityKey(path) ?? path) === currentIdentity;
        });

        return matchedOpenFile ?? canonicalCurrentFile;
    }

    /**
     * 从 tabManager 和 untitledFileManager 采集可持久化的 untitled tab 数据
     */
    function collectUntitledTabsForPersistence() {
        const tabManager = getTabManager();
        const tabs = Array.isArray(tabManager?.fileTabs) ? tabManager.fileTabs : [];
        const snapshotMap = new Map();

        tabs.forEach((tab) => {
            const path = typeof tab?.path === 'string' ? tab.path : null;
            if (!path || !untitledFileManager.isUntitledPath(path)) {
                return;
            }

            const content = untitledFileManager.getContent?.(path) || '';
            // 空 untitled tab 不持久化——下次启动没必要恢复一个空编辑器
            if (!content.trim()) {
                return;
            }
            snapshotMap.set(path, {
                path,
                label: typeof tab.label === 'string'
                    ? tab.label
                    : (untitledFileManager.getDisplayName?.(path) || path),
                content,
                hasChanges: untitledFileManager.hasUnsavedChanges?.(path) || false,
            });
        });

        return Array.from(snapshotMap.values());
    }

    /**
     * 采集 shared tab 路径用于持久化
     */
    function collectSharedTabPathForPersistence() {
        const tabManager = getTabManager();
        const sharedPath = tabManager?.sharedTab?.path;
        if (!isNonEmptyString(sharedPath) || untitledFileManager.isUntitledPath(sharedPath)) {
            return null;
        }
        return canonicalizeWorkspacePath(sharedPath);
    }

    function persistWorkspaceState(overrides = {}, options = {}) {
        try {
            const fileTree = getFileTree();
            const currentFile = getCurrentFile();
            const currentWorkspaceState = workspaceManager.getSnapshot();

            const sidebarState = overrides.sidebar
                ?? fileTree?.getPersistedState?.()
                ?? currentWorkspaceState.sidebar;

            const openFilesState = Array.isArray(overrides.openFiles)
                ? [...overrides.openFiles]
                : fileTree?.getOpenFilePaths?.()
                    ? [...fileTree.getOpenFilePaths()]
                    : [...currentWorkspaceState.openFiles];

            const nextState = {
                currentFile,
                sidebar: sidebarState,
                openFiles: openFilesState,
                untitledTabs: collectUntitledTabsForPersistence(),
                sharedTabPath: collectSharedTabPathForPersistence(),
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
            if (!Object.prototype.hasOwnProperty.call(overrides, 'untitledTabs')) {
                nextState.untitledTabs = collectUntitledTabsForPersistence();
            }
            if (!Object.prototype.hasOwnProperty.call(overrides, 'sharedTabPath')) {
                nextState.sharedTabPath = collectSharedTabPathForPersistence();
            }

            workspaceManager.persistWorkspaceState(nextState, options);
        } catch (error) {
            console.warn('保存工作区状态失败', error);
        }
    }

    function handleSidebarStateChange(sidebarState) {
        if (workspaceManager.isRestoring()) {
            return;
        }
        workspaceManager.handleSidebarStateChange(sidebarState);
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
                sanitized.rootPaths = getCanonicalDedupedPaths(rawSidebar.rootPaths);
            }

            if (Array.isArray(rawSidebar.expandedFolders)) {
                sanitized.expandedFolders = getCanonicalDedupedFolderKeys(rawSidebar.expandedFolders);
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
                const isDir = await fileService.isDirectory(rootPath);
                if (isDir) {
                    validRoots.push(rootPath);
                }
            } catch (error) {
                console.warn('跳过无效的根目录', rootPath, error);
            }
        }

        sanitized.rootPaths = validRoots;
        sanitized.expandedFolders = filterExpandedFoldersByRoots(sanitized.expandedFolders, validRoots);

        return sanitized;
    }

    async function sanitizeOpenFiles(rawOpenFiles) {
        if (!Array.isArray(rawOpenFiles) || rawOpenFiles.length === 0) {
            return [];
        }

        const uniquePaths = getCanonicalDedupedPaths(rawOpenFiles);

        const validFiles = [];
        for (const path of uniquePaths) {
            try {
                const isDirPath = await fileService.isDirectory(path);
                if (isDirPath) {
                    continue;
                }
                await fileService.metadata(path);
                validFiles.push(path);
            } catch (error) {
                console.warn('跳过无效的标签页文件', path, error);
            }
        }

        return validFiles;
    }

    async function restoreWorkspaceStateFromStorage() {
        const stored = workspaceManager.loadPersistedState();
        if (!stored) {
            return;
        }

        const fileTree = getFileTree();
        const tabManager = getTabManager();

        const sanitizedSidebar = await sanitizeSidebarState(stored.sidebar);
        const sanitizedOpenFiles = await sanitizeOpenFiles(stored.openFiles);
        const sanitizedUntitledTabs = Array.isArray(stored.untitledTabs)
            ? stored.untitledTabs
                .filter((tab) => {
                    return tab
                        && typeof tab === 'object'
                        && typeof tab.path === 'string'
                        && untitledFileManager.isUntitledPath(tab.path);
                })
                .map((tab) => ({
                    path: tab.path,
                    label: typeof tab.label === 'string'
                        ? tab.label
                        : (untitledFileManager.getDisplayName?.(tab.path) || tab.path),
                    content: typeof tab.content === 'string' ? tab.content : '',
                    hasChanges: typeof tab.hasChanges === 'boolean'
                        ? tab.hasChanges
                        : (typeof tab.content === 'string' && tab.content.trim().length > 0),
                }))
            : [];
        const storedSharedTabPath = !untitledFileManager.isUntitledPath(stored.sharedTabPath)
            ? canonicalizeWorkspacePath(stored.sharedTabPath)
            : null;
        let sanitizedSharedTabPath = null;
        if (storedSharedTabPath) {
            const inOpenFiles = sanitizedOpenFiles.some((path) => {
                return (getPathIdentityKey(path) ?? path) === (getPathIdentityKey(storedSharedTabPath) ?? storedSharedTabPath);
            });
            if (!inOpenFiles) {
                try {
                    await fileService.metadata(storedSharedTabPath);
                    const directory = await fileService.isDirectory(storedSharedTabPath);
                    if (!directory) {
                        sanitizedSharedTabPath = storedSharedTabPath;
                    }
                } catch (error) {
                    console.warn('跳过无效的 shared 标签页文件', storedSharedTabPath, error);
                }
            }
        }
        const storedCurrentFile = resolveCanonicalCurrentFile(stored.currentFile, sanitizedOpenFiles);

        workspaceManager.setRestoring(true);
        try {
            if (fileTree) {
                await fileTree.restoreState(sanitizedSidebar);
                if (typeof fileTree.restoreOpenFiles === 'function') {
                    fileTree.restoreOpenFiles(sanitizedOpenFiles);
                }
            }
        } finally {
            workspaceManager.setRestoring(false);
        }

        // 恢复 untitled 内容和 tab 列表（Sublime 类似 hot-exit）
        untitledFileManager.restoreFromSnapshot?.(sanitizedUntitledTabs);
        if (tabManager && Array.isArray(tabManager.fileTabs)) {
            tabManager.fileTabs = tabManager.fileTabs.filter(tab => !untitledFileManager.isUntitledPath(tab.path));
            tabManager.fileTabs.push(...sanitizedUntitledTabs.map(tab => ({
                id: tab.path,
                type: 'file',
                path: tab.path,
                label: tab.label,
            })));
            tabManager.render?.();
        }
        if (sanitizedSharedTabPath) {
            tabManager?.showSharedTab?.(sanitizedSharedTabPath);
        } else {
            tabManager?.clearSharedTab?.();
        }

        let targetFileToRestore = null;
        const untitledCurrentFile = typeof stored.currentFile === 'string'
            && untitledFileManager.isUntitledPath(stored.currentFile)
            ? stored.currentFile
            : null;
        const hasUntitledCurrent = Boolean(
            untitledCurrentFile
            && sanitizedUntitledTabs.some(tab => tab.path === untitledCurrentFile)
        );

        if (hasUntitledCurrent) {
            targetFileToRestore = untitledCurrentFile;
        } else if (storedCurrentFile) {
            try {
                await fileService.metadata(storedCurrentFile);
                const directory = await fileService.isDirectory(storedCurrentFile);
                if (!directory) {
                    targetFileToRestore = storedCurrentFile;
                }
            } catch (error) {
                console.warn('恢复上次打开的文件失败', error);
            }
        }

        if (!targetFileToRestore && sanitizedOpenFiles.length > 0) {
            targetFileToRestore = sanitizedOpenFiles[sanitizedOpenFiles.length - 1];
        }
        if (!targetFileToRestore && sanitizedUntitledTabs.length > 0) {
            targetFileToRestore = sanitizedUntitledTabs[sanitizedUntitledTabs.length - 1].path;
        }
        if (!targetFileToRestore && sanitizedSharedTabPath) {
            targetFileToRestore = sanitizedSharedTabPath;
        }

        if (targetFileToRestore) {
            fileTree?.selectFile(targetFileToRestore);
        }

        const sidebarSnapshot = fileTree?.getPersistedState?.() ?? sanitizedSidebar;
        const openFilesSnapshot = fileTree?.getOpenFilePaths?.() ?? sanitizedOpenFiles;
        persistWorkspaceState({
            currentFile: targetFileToRestore,
            sidebar: sidebarSnapshot,
            openFiles: openFilesSnapshot,
            untitledTabs: sanitizedUntitledTabs,
            sharedTabPath: sanitizedSharedTabPath,
        }, { force: true });
    }

    return {
        persistWorkspaceState,
        handleSidebarStateChange,
        restoreWorkspaceStateFromStorage,
        isRestoring: () => workspaceManager.isRestoring(),
    };
}
