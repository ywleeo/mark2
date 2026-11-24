/** 文件操作入口，负责在 macOS 上处理用户文稿的访问授权。 */
import * as filesystem from '../api/filesystem.js';
import { withFileAccess } from './securityScopeService.js';
import { isFileAccessPermissionError } from '../utils/fileAccessErrors.js';

function ensurePath(path, method) {
    if (typeof path !== 'string' || !path.trim()) {
        throw new Error(`[fileService] ${method} 需要合法的路径`);
    }
}

function extractName(path) {
    if (typeof path !== 'string') {
        return '';
    }
    const segments = path.split(/[/\\]/);
    return segments.pop() || path;
}

/** 将真实文件操作与授权重试集中在同一边界。 */
export function createFileService({ fileApi = filesystem, requestAccess, canRequestAccess } = {}) {
    /** 探测候选名称是否存在。权限申请留给后续实际读写操作。 */
    async function pathExists(path, { requirePermission = false } = {}) {
        try {
            await fileApi.getFileMetadata(path);
            return true;
        } catch (error) {
            if (requirePermission && isFileAccessPermissionError(error)) throw error;
            return false;
        }
    }

    /** 复用统一授权流程，并允许独立测试磁盘操作与授权交互。 */
    function withAccess(targets, operation) {
        return withFileAccess(targets, operation, { requestAccess, canRequestAccess });
    }

    /** 从 macOS 路径取得创建、移动和移除目录项所需的目录。 */
    function parentPath(path) {
        const index = path.lastIndexOf('/');
        return index === -1 ? path : path.slice(0, index) || '/';
    }

    /** 主动读取走授权；恢复检测等后台探测只比较当前已可读的文件。 */
    async function readText(path, { requestAuthorization = true } = {}) {
        ensurePath(path, 'readText');
        if (!requestAuthorization) return fileApi.readFile(path);
        return withAccess([{ path }], () => fileApi.readFile(path));
    }

    async function readBinaryBase64(path) {
        ensurePath(path, 'readBinaryBase64');
        return withAccess([{ path }], () => fileApi.readBinaryBase64(path));
    }

    async function readImageBase64(path) {
        ensurePath(path, 'readImageBase64');
        return withAccess([{ path }], () => fileApi.readImageBase64(path));
    }

    async function readSpreadsheet(path) {
        ensurePath(path, 'readSpreadsheet');
        return withAccess([{ path }], () => fileApi.readSpreadsheet(path));
    }

    async function readBinary(path, { as = 'base64' } = {}) {
        ensurePath(path, 'readBinary');
        if (as === 'image') {
            const content = await readImageBase64(path);
            return { path, encoding: 'base64', content };
        }
        const content = await readBinaryBase64(path);
        return { path, encoding: 'base64', content };
    }

    async function writeText(path, content) {
        ensurePath(path, 'writeText');
        const text = typeof content === 'string' ? content : '';
        await withAccess([{ path }], () => fileApi.writeFile(path, text));
        return { path, bytes: text.length };
    }

    /** 文稿附件可要求其所在的工作区目录权限，以便同时创建资源子目录。 */
    async function writeBinary(path, data, { directory } = {}) {
        ensurePath(path, 'writeBinary');
        const target = directory ? { path: directory, scope: 'directory' } : { path };
        return withAccess([target], () => fileApi.writeBinaryFile(path, data));
    }

    /** 授权后重新检查文件是否已经存在，避免把权限不足误当成可覆盖的空路径。 */
    async function createFile(path, options = {}) {
        const { content = '', overwrite = false } = options;
        ensurePath(path, 'createFile');
        return withAccess([{ path }], async () => {
            const exists = await pathExists(path, { requirePermission: true });
            if (exists && !overwrite) throw new Error(`文件已存在：${path}`);
            await fileApi.writeFile(path, typeof content === 'string' ? content : '');
            return { path, overwritten: exists && overwrite };
        });
    }

    async function remove(path) {
        ensurePath(path, 'remove');
        await withAccess([{ path: parentPath(path), scope: 'directory' }], () => fileApi.deleteEntry(path));
        return { path };
    }

    async function removePermanent(path) {
        ensurePath(path, 'removePermanent');
        await withAccess([{ path: parentPath(path), scope: 'directory' }], () => fileApi.deleteEntryPermanent(path));
        return { path };
    }

    async function move(source, destination, options = {}) {
        const { overwrite = false } = options;
        ensurePath(source, 'move');
        ensurePath(destination, 'move');
        const folders = [...new Set([parentPath(source), parentPath(destination)])];
        await withAccess(folders.map(path => ({ path, scope: 'directory' })), async () => {
            if (!overwrite) {
                const exists = await pathExists(destination, { requirePermission: true });
                // 不区分大小写的系统允许仅修改文件名大小写。
                const isCaseOnlyChange = source.toLowerCase() === destination.toLowerCase() && source !== destination;
                if (exists && !isCaseOnlyChange) throw new Error(`目标路径已存在：${destination}`);
            }
            await fileApi.renameEntry(source, destination);
        });
        return { source, destination };
    }

    async function list(path) {
        ensurePath(path, 'list');
        const rawEntries = await withAccess([{ path, scope: 'directory' }], () => fileApi.listDirectory(path));
        const entries = rawEntries.map((entry) => ({
            path: entry.path,
            name: entry.name || extractName(entry.path),
            type: entry.isDir ? 'directory' : 'file',
        }));

        return {
            path,
            entries,
            directories: entries.filter((item) => item.type === 'directory'),
            files: entries.filter((item) => item.type === 'file'),
        };
    }

    async function reveal(path) {
        ensurePath(path, 'reveal');
        await filesystem.revealInFileManager(path);
    }

    async function pick(options) {
        return await filesystem.pickPaths(options);
    }

    async function isDirectory(path) {
        ensurePath(path, 'isDirectory');
        return withAccess([{ path }], () => fileApi.isDirectory(path));
    }

    async function metadata(path) {
        ensurePath(path, 'metadata');
        return await fileApi.getFileMetadata(path);
    }

    /** 主动恢复时允许申请访问，后台存在性探测继续在已有权限内运行。 */
    async function exists(path, { requestAuthorization = false } = {}) {
        return requestAuthorization
            ? withAccess([{ path }], () => pathExists(path, { requirePermission: true }))
            : pathExists(path);
    }

    async function createDirectory(path) {
        ensurePath(path, 'createDirectory');
        await withAccess([{ path: parentPath(path), scope: 'directory' }], () => fileApi.createDirectory(path));
        return { path };
    }

    async function ipcHealthCheck() {
        if (typeof filesystem.ipcHealthCheck === 'function') {
            return await filesystem.ipcHealthCheck();
        }
        return null;
    }

    return {
        readText,
        readFile: readText,
        readBinary,
        readBinaryBase64,
        readImageBase64,
        readSpreadsheet,
        writeText,
        writeBinary,
        createFile,
        createDirectory,
        remove,
        removePermanent,
        move,
        list,
        reveal,
        pick,
        exists,
        isDirectory,
        metadata,
        ipcHealthCheck,
    };
}
