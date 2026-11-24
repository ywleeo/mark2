import { invoke } from '@tauri-apps/api/core';
import { basename, getPathIdentityKey, normalizeFsPath } from '../utils/pathUtils.js';
import { pickPaths } from '../api/filesystem.js';
import { isMac } from '../utils/platform.js';
import { isFileAccessPermissionError } from '../utils/fileAccessErrors.js';
import { createStore } from './storage.js';

const scopeStore = createStore('securityScopes');
scopeStore.migrateFrom('mark2:securityScopes', 'bookmarks');
const pendingAccessRequests = new Map();
let accessDialogQueue = Promise.resolve();

function readStore() {
    const parsed = scopeStore.get('bookmarks', {});
    return (parsed && typeof parsed === 'object') ? parsed : {};
}

function writeStore(store) {
    scopeStore.set('bookmarks', store);
}

function normalizePath(path) {
    const normalized = normalizeFsPath(path);
    if (typeof normalized !== 'string') {
        return null;
    }
    const trimmed = normalized.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function toArray(value) {
    if (!value) {
        return [];
    }
    return Array.isArray(value) ? value : [value];
}

function collectEntries(selections) {
    return toArray(selections)
        .map((entry) => {
            if (!entry || typeof entry !== 'object') {
                return null;
            }
            const path = normalizePath(entry.path);
            const bookmark = typeof entry.bookmark === 'string' ? entry.bookmark : null;
            if (!path || !bookmark) {
                return null;
            }
            return { path, bookmark };
        })
        .filter(Boolean);
}

function applyResolvedPaths(store, results) {
    if (!Array.isArray(results) || results.length === 0) {
        return false;
    }
    let changed = false;
    results.forEach((result) => {
        if (!result || typeof result !== 'object') {
            return;
        }
        const requested = normalizePath(result.requestedPath);
        const resolved = normalizePath(result.resolvedPath);
        if (!requested || !resolved || requested === resolved) {
            return;
        }
        const bookmark = store[requested];
        if (bookmark) {
            store[resolved] = bookmark;
            delete store[requested];
            changed = true;
        }
    });
    if (changed) {
        writeStore(store);
    }
    return changed;
}

async function invokeSecurity(entries) {
    if (!Array.isArray(entries) || entries.length === 0) {
        return [];
    }
    try {
        const result = await invoke('restore_security_scoped_access', { entries });
        return Array.isArray(result) ? result : [];
    } catch (error) {
        console.warn('[securityScopeService] 申请文件权限失败', error);
        return [];
    }
}

export async function rememberSecurityScopes(selections, options = {}) {
    const persist = options.persist !== false;
    const entries = collectEntries(selections);
    if (entries.length === 0) {
        return [];
    }

    let store = null;
    if (persist) {
        store = readStore();
        let updated = false;
        entries.forEach(({ path, bookmark }) => {
            if (store[path] !== bookmark) {
                store[path] = bookmark;
                updated = true;
            }
        });
        if (updated) {
            writeStore(store);
        }
    }

    const results = await invokeSecurity(entries);
    if (persist && results.length > 0) {
        store = store || readStore();
        applyResolvedPaths(store, results);
    }
    return results;
}

export async function restoreStoredSecurityScopes() {
    const store = readStore();
    const entries = Object.entries(store).map(([path, bookmark]) => ({ path, bookmark }));
    if (entries.length === 0) {
        return [];
    }
    const results = await invokeSecurity(entries);
    applyResolvedPaths(store, results);
    return results;
}

export async function captureSecurityScopeForPath(path, options = {}) {
    const normalized = normalizePath(path);
    if (!normalized) {
        return null;
    }
    try {
        const result = await invoke('capture_security_scope', { path: normalized });
        if (result && result.bookmark && options.persist !== false) {
            await rememberSecurityScopes([result]);
        }
        return result;
    } catch (error) {
        console.warn('[securityScopeService] 捕获安全权限失败', error);
        return null;
    }
}

/** 由 macOS 打开授权面板，验证选中的目标后再保存书签。并发请求共用或排队等待面板。 */
export function requestDocumentAccess(path, { scope = 'file' } = {}) {
    const normalized = normalizeFsPath(path);
    if (typeof normalized !== 'string' || !normalized.startsWith('/')) return Promise.resolve(false);
    const target = normalized.replace(/\/+$/, '') || '/';
    const parent = target.slice(0, target.lastIndexOf('/')) || '/';
    const key = JSON.stringify([scope, target]);
    const existing = pendingAccessRequests.get(key);
    if (existing) return existing;

    const request = accessDialogQueue.then(async () => {
        const { t } = await import('../i18n/index.js');
        const folderOnly = scope === 'directory';
        const [entry] = await pickPaths({
            directory: folderOnly,
            allowFiles: !folderOnly,
            allowDirectories: true,
            multiple: false,
            defaultPath: target,
            title: t('fileAccess.title'),
            message: t(folderOnly ? 'fileAccess.folder' : 'fileAccess.file', {
                name: basename(target) || target,
                folder: basename(parent) || parent,
            }),
            prompt: t('fileAccess.allow'),
        });
        if (!entry?.path) return false;
        const selected = getPathIdentityKey(entry.path.replace(/\/+$/, '') || '/');
        const expected = getPathIdentityKey(target);
        const selectedParent = !folderOnly && entry.isDirectory === true
            && selected === getPathIdentityKey(parent);
        if (selected !== expected && !selectedParent) return false;
        if (folderOnly && entry.isDirectory !== true) return false;
        await rememberSecurityScopes([entry]);
        return true;
    }).catch(error => {
        console.warn('[securityScopeService] 文稿授权失败', error);
        return false;
    }).finally(() => pendingAccessRequests.delete(key));
    pendingAccessRequests.set(key, request);
    accessDialogQueue = request;
    return request;
}

/** 遇到权限错误时统一授权；操作只在用户确认后重试一次。 */
export async function withFileAccess(targets, operation, { requestAccess = requestDocumentAccess, canRequestAccess = isMac } = {}) {
    try {
        return await operation();
    } catch (error) {
        if (!canRequestAccess || !isFileAccessPermissionError(error)) throw error;
        for (const target of targets) {
            if (!await requestAccess(target.path, target)) throw error;
        }
        return await operation();
    }
}
