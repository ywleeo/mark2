import { invoke } from '@tauri-apps/api/core';

/**
 * 从系统剪贴板读取文本
 * @returns {Promise<string>} 剪贴板文本内容
 */
export async function readClipboardText() {
    return await invoke('read_clipboard_text');
}
