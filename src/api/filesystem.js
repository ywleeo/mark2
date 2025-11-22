import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';

function ensurePath(path, method) {
    if (typeof path !== 'string' || !path.trim()) {
        throw new Error(`[filesystem] ${method} 需要合法的路径`);
    }
}

function normalizeDialogOptions(options = {}) {
    return {
        directory: options.directory ?? false,
        multiple: options.multiple ?? true,
        defaultPath: options.defaultPath,
        filters: options.filters,
    };
}

export async function readFile(path) {
    ensurePath(path, 'readFile');
    return await invoke('read_file', { path });
}

export async function readImageBase64(path) {
    ensurePath(path, 'readImageBase64');
    return await invoke('read_image_base64', { path });
}

export async function readBinaryBase64(path) {
    ensurePath(path, 'readBinaryBase64');
    return await invoke('read_binary_base64', { path });
}

export async function readSpreadsheet(path) {
    ensurePath(path, 'readSpreadsheet');
    return await invoke('read_spreadsheet', { path });
}

export async function writeFile(path, content) {
    ensurePath(path, 'writeFile');
    return await invoke('write_file', { path, content });
}

export async function isDirectory(path) {
    ensurePath(path, 'isDirectory');
    return await invoke('is_directory', { path });
}

export async function listDirectory(path) {
    ensurePath(path, 'listDirectory');
    const entries = await invoke('read_dir', { path });
    return Array.isArray(entries) ? entries : [];
}

export async function pickPaths(options) {
    try {
        return await invoke('pick_path');
    } catch (error) {
        const message = typeof error === 'string' ? error : error?.message;
        if (message === 'unsupported') {
            return await openDialog(normalizeDialogOptions(options));
        }
        throw error;
    }
}

export async function listFonts() {
    return await invoke('list_fonts');
}

export async function getFileMetadata(path) {
    ensurePath(path, 'getFileMetadata');
    return await invoke('get_file_metadata', { path });
}

export async function revealInFileManager(path) {
    ensurePath(path, 'revealInFileManager');
    return await invoke('reveal_in_file_manager', { path });
}

export async function deleteEntry(path) {
    ensurePath(path, 'deleteEntry');
    return await invoke('delete_entry', { path });
}

export async function renameEntry(source, destination) {
    ensurePath(source, 'renameEntry');
    ensurePath(destination, 'renameEntry');
    return await invoke('rename_entry', { source, destination });
}

export async function createDirectory(path) {
    ensurePath(path, 'createDirectory');
    return await invoke('create_directory', { path });
}

export async function ipcHealthCheck() {
    return await invoke('ipc_health_check');
}
