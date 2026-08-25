import { invoke } from '@tauri-apps/api/core';

/**
 * 从系统剪贴板读取文本
 * @returns {Promise<string>} 剪贴板文本内容
 */
export async function readClipboardText() {
    return await invoke('read_clipboard_text');
}

/**
 * 读取 Finder / Explorer 复制的原生文件路径。
 * @returns {Promise<string[]>} 系统剪贴板中的文件或文件夹路径。
 */
export async function readClipboardFilePaths() {
    const paths = await invoke('read_clipboard_file_paths');
    return Array.isArray(paths) ? paths.filter(path => typeof path === 'string' && path.trim()) : [];
}
