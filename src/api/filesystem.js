import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';

function ensurePath(path, method) {
    if (typeof path !== 'string' || !path.trim()) {
        throw new Error(`[filesystem] ${method} 需要合法的路径`);
    }
}

function normalizeDialogOptions(options = {}) {
    const wantsDirectoriesOnly = options.directory === true;
    return {
        directory: wantsDirectoriesOnly,
        multiple: options.multiple ?? true,
        defaultPath: options.defaultPath,
        filters: options.filters,
        allowDirectories: options.allowDirectories ?? true,
        allowFiles: options.allowFiles ?? !wantsDirectoriesOnly,
    };
}

function toSelectionArray(selection) {
    if (!selection) {
        return [];
    }
    return Array.isArray(selection) ? selection : [selection];
}

function mapSelectionEntries(selection) {
    return toSelectionArray(selection)
        .map((entry) => {
            if (!entry) {
                return null;
            }
            if (typeof entry === 'string') {
                return { path: entry };
            }
            if (typeof entry === 'object' && typeof entry.path === 'string') {
                return entry;
            }
            return null;
        })
        .filter(Boolean);
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

/**
 * 追加结构化日志到应用日志文件。
 * @param {Array<Object>} entries - 日志条目数组
 * @returns {Promise<string>}
 */
export async function appendLogEntries(entries) {
    const normalizedEntries = Array.isArray(entries) ? entries.filter(Boolean) : [];
    return await invoke('append_log_entries', { entries: normalizedEntries });
}

/**
 * 读取应用日志文件的固定路径。
 * @returns {Promise<string>}
 */
export async function getAppLogFilePath() {
    return await invoke('get_app_log_file_path');
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
    const normalizedOptions = normalizeDialogOptions(options);
    try {
        const result = await invoke('pick_path', { options: normalizedOptions });
        return mapSelectionEntries(result);
    } catch (error) {
        const message = typeof error === 'string' ? error : error?.message;
        if (message === 'unsupported') {
            const fallbackOptions = {
                directory: normalizedOptions.directory,
                multiple: normalizedOptions.multiple,
                defaultPath: normalizedOptions.defaultPath,
                filters: normalizedOptions.filters,
            };
            const selection = await openDialog(fallbackOptions);
            return mapSelectionEntries(selection);
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
