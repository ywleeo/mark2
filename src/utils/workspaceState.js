export const WORKSPACE_STATE_STORAGE_KEY = 'mark2:workspaceState';

function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function createDefaultSidebarState() {
    return {
        rootPaths: [],
        expandedFolders: [],
        sectionStates: {
            openFilesCollapsed: false,
            foldersCollapsed: false,
        },
    };
}

export function createDefaultWorkspaceState() {
    return {
        currentFile: null,
        sidebar: createDefaultSidebarState(),
    };
}

export function normalizeWorkspaceState(candidate) {
    const normalized = createDefaultWorkspaceState();

    if (!candidate || typeof candidate !== 'object') {
        return normalized;
    }

    if (isNonEmptyString(candidate.currentFile)) {
        normalized.currentFile = candidate.currentFile.trim();
    }

    if (candidate.sidebar && typeof candidate.sidebar === 'object') {
        const { sidebar } = candidate;
        if (Array.isArray(sidebar.rootPaths)) {
            normalized.sidebar.rootPaths = Array.from(
                new Set(
                    sidebar.rootPaths
                        .filter(isNonEmptyString)
                        .map(path => path.trim())
                )
            );
        }

        if (Array.isArray(sidebar.expandedFolders)) {
            normalized.sidebar.expandedFolders = Array.from(
                new Set(
                    sidebar.expandedFolders
                        .filter(isNonEmptyString)
                        .map(key => key.trim())
                )
            );
        }

        if (sidebar.sectionStates && typeof sidebar.sectionStates === 'object') {
            const { sectionStates } = sidebar;
            if (typeof sectionStates.openFilesCollapsed === 'boolean') {
                normalized.sidebar.sectionStates.openFilesCollapsed = sectionStates.openFilesCollapsed;
            }
            if (typeof sectionStates.foldersCollapsed === 'boolean') {
                normalized.sidebar.sectionStates.foldersCollapsed = sectionStates.foldersCollapsed;
            }
        }
    }

    return normalized;
}

export function loadWorkspaceState(storageKey = WORKSPACE_STATE_STORAGE_KEY) {
    try {
        const raw = window.localStorage.getItem(storageKey);
        if (!raw) {
            return createDefaultWorkspaceState();
        }
        const parsed = JSON.parse(raw);
        return normalizeWorkspaceState(parsed);
    } catch (error) {
        console.warn('加载工作区状态失败，使用默认值', error);
        return createDefaultWorkspaceState();
    }
}

export function saveWorkspaceState(state, storageKey = WORKSPACE_STATE_STORAGE_KEY) {
    try {
        const normalized = normalizeWorkspaceState(state);
        window.localStorage.setItem(storageKey, JSON.stringify(normalized));
    } catch (error) {
        console.warn('保存工作区状态失败', error);
    }
}
