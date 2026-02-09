// 图片路径解析和处理模块

// 检查是否是外部图片 URL
export function isExternalImageSrc(src) {
    const trimmed = src.trim();
    if (!trimmed) return true;
    return /^(?:https?:|data:|blob:|tauri:|asset:|about:|javascript:)/i.test(trimmed) || trimmed.startsWith('//');
}

// 检查是否是绝对路径
export function isAbsoluteLocalPath(path) {
    return /^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(path);
}

// 检查是否是 Windows 路径
export function isWindowsPath(path) {
    return /^[A-Za-z]:[\\/]/.test(path) || /\\/.test(path);
}

// 获取当前文件所在目录
export function getCurrentDirectory(currentFile) {
    if (!currentFile) return null;
    const normalized = currentFile.replace(/\\/g, '/');
    const lastSlash = normalized.lastIndexOf('/');
    if (lastSlash === -1) {
        return null;
    }
    return normalized.slice(0, lastSlash);
}

// 将路径转换为 file:// URL
export function pathToFileUrl(path) {
    const normalized = path.replace(/\\/g, '/');
    if (/^[A-Za-z]:/.test(normalized)) {
        return `file:///${normalized}`;
    }
    if (normalized.startsWith('//')) {
        return `file://${normalized.slice(2)}`;
    }
    if (normalized.startsWith('/')) {
        return `file://${normalized}`;
    }
    return `file://${normalized}`;
}

// 将 file:// URL 转换为文件系统路径
export function urlToFsPath(url, isWindows) {
    if (url.protocol !== 'file:') {
        return null;
    }

    let pathname = decodeURIComponent(url.pathname);

    if (url.host) {
        const networkPath = `${url.host}${pathname}`;
        if (isWindows) {
            return `\\\\${networkPath.replace(/\//g, '\\')}`;
        }
        return `//${networkPath}`;
    }

    if (isWindows && /^\/[A-Za-z]:/.test(pathname)) {
        pathname = pathname.slice(1);
    }

    if (isWindows) {
        return pathname.replace(/\//g, '\\');
    }
    return pathname;
}

// 将 file:// URL 字符串转换为路径
export function fileUrlToPath(urlString, isWindows) {
    try {
        const url = new URL(urlString);
        return urlToFsPath(url, isWindows);
    } catch (error) {
        console.error('解析 file:// 路径失败:', { urlString, error });
        return null;
    }
}

// 标准化绝对路径
export function normalizeAbsolutePath(path, isWindows) {
    if (isWindows) {
        if (/^\\\\/.test(path)) {
            return path;
        }
        if (/^file:/.test(path)) {
            return fileUrlToPath(path, true);
        }
        if (/^[A-Za-z]:/.test(path)) {
            return path.replace(/\//g, '\\');
        }
        if (path.startsWith('/')) {
            return path.replace(/\//g, '\\');
        }
        return path;
    }

    return path.replace(/\\/g, '/');
}

// 组合基础目录和相对路径
export function joinPaths(baseDir, relativePath, isWindows) {
    try {
        const sanitizedRelative = relativePath.replace(/\\/g, '/');
        const baseUrl = new URL(pathToFileUrl(baseDir) + '/');
        const resolvedUrl = new URL(sanitizedRelative, baseUrl);
        return urlToFsPath(resolvedUrl, isWindows);
    } catch (error) {
        console.error('组合图片路径失败:', { baseDir, relativePath, error });
        return null;
    }
}

function decodePercentEncodedPath(path, isWindows) {
    if (!path || !path.includes('%')) {
        return path;
    }
    try {
        if (isWindows) {
            const forwardSlashes = path.replace(/\\/g, '/');
            const decoded = decodeURI(forwardSlashes);
            return decoded.replace(/\//g, '\\');
        }
        return decodeURI(path);
    } catch (error) {
        console.warn('[imageResolver] 解码路径失败:', { path, error });
        return path;
    }
}

// 解析图片路径(相对路径转绝对路径)
export function resolveImagePath(src, currentFile) {
    const trimmed = src.trim();
    if (!trimmed) {
        return null;
    }

    const isWindows = isWindowsPath(currentFile);

    if (trimmed.startsWith('file://')) {
        return fileUrlToPath(trimmed, isWindows);
    }

    if (isAbsoluteLocalPath(trimmed)) {
        const normalized = normalizeAbsolutePath(trimmed, isWindows);
        return decodePercentEncodedPath(normalized, isWindows);
    }

    const baseDir = getCurrentDirectory(currentFile);
    if (!baseDir) {
        return null;
    }

    const joined = joinPaths(baseDir, trimmed, isWindows);
    return decodePercentEncodedPath(joined, isWindows);
}

// 检测图片 MIME 类型
export function detectMimeType(path) {
    const lowerPath = path.toLowerCase();
    if (lowerPath.endsWith('.png')) return 'image/png';
    if (lowerPath.endsWith('.jpg') || lowerPath.endsWith('.jpeg')) return 'image/jpeg';
    if (lowerPath.endsWith('.gif')) return 'image/gif';
    if (lowerPath.endsWith('.webp')) return 'image/webp';
    if (lowerPath.endsWith('.svg')) return 'image/svg+xml';
    if (lowerPath.endsWith('.bmp')) return 'image/bmp';
    if (lowerPath.endsWith('.ico')) return 'image/x-icon';
    return 'application/octet-stream';
}

// 从文件系统读取二进制文件
async function requestFileAccess(filePath) {
    if (typeof window === 'undefined' || !window.__TAURI__) {
        return null;
    }

    try {
        const { invoke } = window.__TAURI__.core;

        // 获取文件所在的目录
        const pathParts = filePath.split('/');
        const fileName = pathParts.pop() || '文件';
        const folderName = pathParts[pathParts.length - 1] || '文件夹';
        const folderPath = pathParts.join('/');

        // 弹出文件夹选择器，让用户授权访问该文件夹
        const selections = await invoke('pick_path', {
            options: {
                directory: true,
                multiple: false,
                allowDirectories: true,
                allowFiles: false,
                defaultPath: folderPath,
                title: '需要访问文件夹权限',
                message: `应用需要访问 "${fileName}" 文件，请选择 "${folderName}" 文件夹以授予访问权限。`,
                prompt: 'Allow'
            }
        });

        if (!selections || selections.length === 0) {
            return null;
        }

        // 保存 security-scoped bookmark（保存的是文件夹权限）
        const { rememberSecurityScopes } = await import('../services/securityScopeService.js');
        await rememberSecurityScopes(selections);

        return selections[0];
    } catch (error) {
        console.warn('[imageResolver] 请求文件访问权限失败', error);
        return null;
    }
}

export async function readBinaryFromFs(path, options = {}) {
    try {
        const { readFile } = await import('@tauri-apps/plugin-fs');
        return await readFile(path);
    } catch (error) {
        const maybeWindow = typeof window === 'undefined' ? undefined : window;
        const fsApi = maybeWindow?.__TAURI__?.fs;

        // 尝试使用备用 API
        if (fsApi?.readBinaryFile) {
            try {
                return await fsApi.readBinaryFile(path);
            } catch (fallbackError) {
                // 如果两次都失败，且允许请求权限，则请求用户授权
                if (options.requestAccessOnError && typeof window !== 'undefined' && window.__TAURI__) {
                    console.log('[imageResolver] 文件读取失败，请求用户授权:', path);
                    const granted = await requestFileAccess(path);
                    if (granted) {
                        // 重新尝试读取
                        try {
                            const { readFile } = await import('@tauri-apps/plugin-fs');
                            return await readFile(path);
                        } catch (retryError) {
                            if (fsApi?.readBinaryFile) {
                                return await fsApi.readBinaryFile(path);
                            }
                            throw retryError;
                        }
                    }
                }
                throw fallbackError;
            }
        }

        // 如果允许请求权限且在 Tauri 环境
        if (options.requestAccessOnError && typeof window !== 'undefined' && window.__TAURI__) {
            console.log('[imageResolver] 文件读取失败，请求用户授权:', path);
            const granted = await requestFileAccess(path);
            if (granted) {
                // 重新尝试读取
                const { readFile } = await import('@tauri-apps/plugin-fs');
                return await readFile(path);
            }
        }

        throw error;
    }
}

export function createImageObjectUrl(binary, path) {
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
        return null;
    }
    const bytes = binary instanceof Uint8Array ? binary : new Uint8Array(binary);
    const mime = detectMimeType(path);
    const blob = new Blob([bytes], { type: mime });
    return URL.createObjectURL(blob);
}

const imageObjectUrlRegistry = new Set();

export function releaseImageObjectUrls() {
    if (typeof URL === 'undefined' || typeof URL.revokeObjectURL !== 'function') {
        imageObjectUrlRegistry.clear();
        return;
    }
    for (const url of imageObjectUrlRegistry) {
        try {
            URL.revokeObjectURL(url);
        } catch (error) {
            console.warn('[imageResolver] 释放图片 URL 失败', error);
        }
    }
    imageObjectUrlRegistry.clear();
}

export function drainImageObjectUrls() {
    const urls = [...imageObjectUrlRegistry];
    imageObjectUrlRegistry.clear();
    return urls;
}

export function revokeUrls(urls) {
    if (!urls?.length || typeof URL === 'undefined' || typeof URL.revokeObjectURL !== 'function') {
        return;
    }
    for (const url of urls) {
        try {
            URL.revokeObjectURL(url);
        } catch (_) { /* ignore */ }
    }
}

export function registerImageObjectUrl(url) {
    if (typeof url === 'string' && url.length > 0) {
        imageObjectUrlRegistry.add(url);
    }
}

// 解析 HTML 中的图片源并转换为 Data URI
export async function resolveImageSources(html, currentFile) {
    if (!html || !currentFile) {
        return html;
    }

    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const images = Array.from(doc.querySelectorAll('img'));

        for (const img of images) {
            const originalSrc = img.getAttribute('src');
            if (!originalSrc) {
                continue;
            }

            // 保存原始 src 到 data-original-src 属性
            img.setAttribute('data-original-src', originalSrc);

            // 跳过外部图片
            if (isExternalImageSrc(originalSrc)) {
                continue;
            }

            // 解析图片路径
            const resolvedPath = resolveImagePath(originalSrc, currentFile);
            if (!resolvedPath) {
                continue;
            }

            try {
                // 启用权限请求，如果读取失败会自动请求用户授权
                const binary = await readBinaryFromFs(resolvedPath, { requestAccessOnError: true });
                const objectUrl = createImageObjectUrl(binary, resolvedPath);
                if (!objectUrl) {
                    continue;
                }
                registerImageObjectUrl(objectUrl);
                img.setAttribute('src', objectUrl);
                img.setAttribute('data-image-path', resolvedPath);
                img.setAttribute('data-image-object-url', objectUrl);
            } catch (error) {
                console.error('读取图片失败:', {
                    resolvedPath,
                    message: error?.message,
                    error,
                });
            }
        }

        return doc.body.innerHTML;
    } catch (error) {
        console.error('解析图片 HTML 失败:', error);
        return html;
    }
}
