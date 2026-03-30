import { normalizeFsPath, getPathIdentityKey } from './pathUtils.js';

export const WORKSPACE_STATE_STORAGE_KEY = 'mark2:workspaceState';
const UNTITLED_PROTOCOL = 'untitled://';

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

function canonicalizeWorkspacePath(value) {
    if (!isNonEmptyString(value)) {
        return null;
    }

    const canonical = normalizeFsPath(value.trim());
    return isNonEmptyString(canonical) ? canonical : null;
}

function isUntitledPath(value) {
    return typeof value === 'string' && value.startsWith(UNTITLED_PROTOCOL);
}

/**
 * 规范化 untitled 标签页快照
 */
function normalizeUntitledTabs(values) {
    if (!Array.isArray(values) || values.length === 0) {
        return [];
    }

    const deduped = new Map();
    values.forEach((value) => {
        if (!value || typeof value !== 'object') {
            return;
        }

        const path = typeof value.path === 'string' ? value.path.trim() : '';
        if (!isUntitledPath(path)) {
            return;
        }

        if (deduped.has(path)) {
            return;
        }

        deduped.set(path, {
            path,
            label: typeof value.label === 'string' ? value.label : path.slice(UNTITLED_PROTOCOL.length),
            content: typeof value.content === 'string' ? value.content : '',
            hasChanges: typeof value.hasChanges === 'boolean'
                ? value.hasChanges
                : (typeof value.content === 'string' && value.content.trim().length > 0),
        });
    });

    return Array.from(deduped.values());
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

        const folderIdentity = getPathIdentityKey(extractPathFromFolderKey(canonical)) ?? canonical;
        const identity = canonical.startsWith('root::')
            ? `root::${folderIdentity}`
            : `${getPathIdentityKey(canonical.split('::')[0]) ?? canonical.split('::')[0]}::${folderIdentity}`;

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

export function createDefaultWorkspaceState() {
    return {
        currentFile: null,
        sidebar: createDefaultSidebarState(),
        openFiles: [],
        untitledTabs: [],
        sharedTabPath: null,
    };
}

export function normalizeWorkspaceState(candidate) {
    const normalized = createDefaultWorkspaceState();

    if (!candidate || typeof candidate !== 'object') {
        return normalized;
    }

    if (candidate.sidebar && typeof candidate.sidebar === 'object') {
        const { sidebar } = candidate;
        if (Array.isArray(sidebar.rootPaths)) {
            normalized.sidebar.rootPaths = getCanonicalDedupedPaths(sidebar.rootPaths);
        }

        if (Array.isArray(sidebar.expandedFolders)) {
            normalized.sidebar.expandedFolders = getCanonicalDedupedFolderKeys(sidebar.expandedFolders);
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

    if (Array.isArray(candidate.openFiles)) {
        normalized.openFiles = getCanonicalDedupedPaths(candidate.openFiles);
    }
    if (Array.isArray(candidate.untitledTabs)) {
        normalized.untitledTabs = normalizeUntitledTabs(candidate.untitledTabs);
    }
    if (typeof candidate.sharedTabPath === 'string' && !isUntitledPath(candidate.sharedTabPath)) {
        normalized.sharedTabPath = canonicalizeWorkspacePath(candidate.sharedTabPath);
    }

    const candidateCurrentFile = typeof candidate.currentFile === 'string'
        ? candidate.currentFile
        : null;
    if (candidateCurrentFile && isUntitledPath(candidateCurrentFile)) {
        const matchedUntitled = normalized.untitledTabs.find(tab => tab.path === candidateCurrentFile);
        normalized.currentFile = matchedUntitled?.path || null;
    } else {
        normalized.currentFile = resolveCanonicalCurrentFile(candidate.currentFile, normalized.openFiles);
    }
    normalized.sidebar.expandedFolders = filterExpandedFoldersByRoots(
        normalized.sidebar.expandedFolders,
        normalized.sidebar.rootPaths
    );

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
