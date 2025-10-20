import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';

export async function readFile(path) {
    return await invoke('read_file', { path });
}

export async function writeFile(path, content) {
    return await invoke('write_file', { path, content });
}

export async function isDirectory(path) {
    return await invoke('is_directory', { path });
}

export async function pickPaths() {
    try {
        return await invoke('pick_path');
    } catch (error) {
        const message = typeof error === 'string' ? error : error?.message;
        if (message === 'unsupported') {
            return await open({ multiple: true, directory: false });
        }
        throw error;
    }
}

export async function listFonts() {
    return await invoke('list_fonts');
}

export async function getFileMetadata(path) {
    return await invoke('get_file_metadata', { path });
}

export async function revealInFileManager(path) {
    return await invoke('reveal_in_file_manager', { path });
}

export async function deleteEntry(path) {
    return await invoke('delete_entry', { path });
}

export async function renameEntry(source, destination) {
    return await invoke('rename_entry', { source, destination });
}
