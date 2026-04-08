import {
    WORKSPACE_STATE_STORAGE_KEY,
    createDefaultWorkspaceState,
    normalizeWorkspaceState,
} from '../utils/workspaceState.js';

function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function readWorkspaceState(storageKey) {
    if (typeof window === 'undefined' || !window.localStorage) {
        return createDefaultWorkspaceState();
    }

    try {
        const raw = window.localStorage.getItem(storageKey);
        if (!raw) {
            return createDefaultWorkspaceState();
        }
        const parsed = JSON.parse(raw);
        return normalizeWorkspaceState(parsed);
    } catch (error) {
        console.warn('[workspaceService] 读取 workspaceState 失败，使用默认值', error);
        return createDefaultWorkspaceState();
    }
}

function normalizeDirectory(path) {
    if (!isNonEmptyString(path)) {
        return null;
    }
    const normalized = path.replace(/\\/g, '/');
    const lastSlash = normalized.lastIndexOf('/');
    if (lastSlash < 0) {
        return normalized || '/';
    }
    if (lastSlash === 0) {
        return '/';
    }
    return normalized.slice(0, lastSlash);
}

export function createWorkspaceService(options = {}) {
    const storageKey = options.storageKey || WORKSPACE_STATE_STORAGE_KEY;
    const getCurrentFileFn = typeof options.getCurrentFile === 'function'
        ? options.getCurrentFile
        : null;

    function getCurrentFile() {
        if (getCurrentFileFn) {
            try {
                const path = getCurrentFileFn();
                if (isNonEmptyString(path)) {
                    return path.trim();
                }
            } catch (error) {
                console.warn('[workspaceService] 读取 getCurrentFile 失败', error);
            }
        }

        const state = readWorkspaceState(storageKey);
        return isNonEmptyString(state.currentFile) ? state.currentFile.trim() : null;
    }

    function getWorkspaceState() {
        return readWorkspaceState(storageKey);
    }

    function getWorkspaceRoots() {
        const state = getWorkspaceState();
        if (!Array.isArray(state.sidebar?.rootPaths)) {
            return [];
        }
        return Array.from(
            new Set(
                state.sidebar.rootPaths
                    .filter(isNonEmptyString)
                    .map(path => path.trim())
            )
        );
    }

    function getCurrentDirectory() {
        const currentFile = getCurrentFile();
        if (currentFile) {
            return normalizeDirectory(currentFile);
        }
        const roots = getWorkspaceRoots();
        return roots[0] || null;
    }

    function getContext() {
        const currentFile = getCurrentFile();
        const workspaceRoots = getWorkspaceRoots();
        const currentDirectory = currentFile ? normalizeDirectory(currentFile) : (workspaceRoots[0] || null);
        return {
            currentFile,
            currentDirectory,
            workspaceRoots,
        };
    }

    return {
        getCurrentFile,
        getCurrentDirectory,
        getWorkspaceRoots,
        getWorkspaceState,
        getContext,
    };
}
