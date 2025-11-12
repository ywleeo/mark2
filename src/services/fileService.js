import * as filesystem from '../api/filesystem.js';

function ensurePath(path, method) {
    if (typeof path !== 'string' || !path.trim()) {
        throw new Error(`[fileService] ${method} 需要合法的路径`);
    }
}

async function pathExists(path) {
    try {
        await filesystem.getFileMetadata(path);
        return true;
    } catch {
        return false;
    }
}

function extractName(path) {
    if (typeof path !== 'string') {
        return '';
    }
    const segments = path.split(/[/\\]/);
    return segments.pop() || path;
}

export function createFileService() {
    async function readText(path) {
        ensurePath(path, 'readText');
        return await filesystem.readFile(path);
    }

    async function readBinaryBase64(path) {
        ensurePath(path, 'readBinaryBase64');
        return await filesystem.readBinaryBase64(path);
    }

    async function readImageBase64(path) {
        ensurePath(path, 'readImageBase64');
        return await filesystem.readImageBase64(path);
    }

    async function readSpreadsheet(path) {
        ensurePath(path, 'readSpreadsheet');
        return await filesystem.readSpreadsheet(path);
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
        await filesystem.writeFile(path, text);
        return { path, bytes: text.length };
    }

    async function createFile(path, options = {}) {
        const { content = '', overwrite = false } = options;
        ensurePath(path, 'createFile');
        const exists = await pathExists(path);
        if (exists && !overwrite) {
            throw new Error(`文件已存在：${path}`);
        }
        await filesystem.writeFile(path, typeof content === 'string' ? content : '');
        return {
            path,
            overwritten: exists && overwrite,
        };
    }

    async function remove(path) {
        ensurePath(path, 'remove');
        await filesystem.deleteEntry(path);
        return { path };
    }

    async function move(source, destination, options = {}) {
        const { overwrite = false } = options;
        ensurePath(source, 'move');
        ensurePath(destination, 'move');
        if (!overwrite) {
            const exists = await pathExists(destination);
            if (exists) {
                throw new Error(`目标路径已存在：${destination}`);
            }
        }
        await filesystem.renameEntry(source, destination);
        return { source, destination };
    }

    async function list(path) {
        ensurePath(path, 'list');
        const rawEntries = await filesystem.listDirectory(path);
        const entries = await Promise.all(
            rawEntries.map(async (entryPath) => {
                const isDir = await filesystem.isDirectory(entryPath);
                return {
                    path: entryPath,
                    name: extractName(entryPath),
                    type: isDir ? 'directory' : 'file',
                };
            })
        );

        return {
            path,
            entries,
            directories: entries.filter(item => item.type === 'directory'),
            files: entries.filter(item => item.type === 'file'),
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
        return await filesystem.isDirectory(path);
    }

    async function metadata(path) {
        ensurePath(path, 'metadata');
        return await filesystem.getFileMetadata(path);
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
        createFile,
        remove,
        move,
        list,
        reveal,
        pick,
        exists: pathExists,
        isDirectory,
        metadata,
        ipcHealthCheck,
    };
}
