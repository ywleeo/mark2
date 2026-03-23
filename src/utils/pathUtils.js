export function basename(path) {
    if (!path) return path;
    return path.split(/[/\\]/).pop() || path;
}

export function dirname(path) {
    if (!path) return path;
    const parts = path.split(/[/\\]/);
    if (parts.length <= 1) return '';
    parts.pop();
    return parts.join(path.includes('\\') ? '\\' : '/');
}

function isWindowsDrivePath(path) {
    // C:\foo or C:/foo or /C:/foo (Windows file URL pathname)
    return /^[a-zA-Z]:[\\/]/.test(path) || /^\/[a-zA-Z]:[\\/]/.test(path);
}

function isUncPath(path) {
    // \\server\share or //server/share
    return /^\\\\/.test(path) || /^\/\//.test(path);
}

function canonicalizeWindowsPath(path) {
    if (!path) return path;

    let value = String(path);

    // Strip file:// URL prefix first so downstream callers don't have to
    if (value.startsWith('file://')) {
        try {
            const url = new URL(value);
            value = decodeURI(url.pathname);
        } catch (error) {
            console.warn('无法解析文件路径 URL:', value, error);
            return path;
        }
    }

    // If decoded Windows URL becomes /C:/..., remove the artificial leading slash
    if (/^\/[a-zA-Z]:[\\/]/.test(value)) {
        value = value.slice(1);
    }

    // Convert all forward slashes to backslashes
    value = value.replace(/\//g, '\\');

    // Trim trailing separators except for drive root (C:\) or UNC root (\\server\share)
    const isDriveRoot = () => /^[a-zA-Z]:\\$/.test(value);
    const isUncRoot = () => /^\\\\[^\\]+\\[^\\]+\\?$/.test(value);

    while (value.length > 0 && (value.endsWith('\\') || value.endsWith('/'))) {
        if (isDriveRoot() || isUncRoot()) {
            break;
        }
        value = value.slice(0, -1);
    }

    return value;
}

export function normalizeFsPath(path) {
    if (!path) return path;

    if (typeof path === 'string' && path.startsWith('file://')) {
        try {
            const url = new URL(path);
            const decoded = decodeURI(url.pathname);

            // POSIX-style paths remain as-is; Windows-style paths get full canonicalization
            if (isWindowsDrivePath(decoded) || isUncPath(decoded)) {
                return canonicalizeWindowsPath(decoded);
            }
            return decoded;
        } catch (error) {
            console.warn('无法解析文件路径 URL:', path, error);
            return path;
        }
    }

    // For non-URL inputs, only apply Windows canonicalization when the path clearly looks Windows-like.
    if (typeof path === 'string' && (isWindowsDrivePath(path) || isUncPath(path))) {
        return canonicalizeWindowsPath(path);
    }

    // Preserve previous behavior for POSIX-style paths.
    return path;
}

export function normalizeSelectedPaths(selected) {
    if (!selected) return [];

    const extractPath = (entry) => {
        if (!entry) return null;
        if (typeof entry === 'string') return entry;
        if (typeof entry === 'object') {
            if ('path' in entry && typeof entry.path === 'string') {
                return entry.path;
            }
            if ('uri' in entry && typeof entry.uri === 'string') {
                return entry.uri;
            }
        }
        return null;
    };

    if (Array.isArray(selected)) {
        return selected.map(extractPath).filter(Boolean);
    }

    const single = extractPath(selected);
    return single ? [single] : [];
}

/**
 * Generate a stable identity key for path comparisons.
 *
 * - Windows: use lowercased canonical path for case-insensitive dedupe
 * - Non-Windows / POSIX-like paths: preserve original case semantics
 */
export function getPathIdentityKey(path) {
    if (!path) return path;

    const normalized = normalizeFsPath(path);
    if (!normalized) return normalized;

    if (typeof normalized === 'string' && (isWindowsDrivePath(normalized) || isUncPath(normalized))) {
        return normalized.toLowerCase();
    }

    return normalized;
}

