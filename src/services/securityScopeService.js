import { invoke } from '@tauri-apps/api/core';
import { normalizeFsPath } from '../utils/pathUtils.js';
import { createStore } from './storage.js';

const scopeStore = createStore('securityScopes');
scopeStore.migrateFrom('mark2:securityScopes', 'bookmarks');

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
