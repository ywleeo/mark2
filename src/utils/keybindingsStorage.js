/**
 * 自定义快捷键的持久化存储。
 * 存储格式：{ [commandId]: shortcut }
 */

const STORAGE_KEY = 'mark2:keybindings';
const KEYBINDINGS_UPDATED_EVENT = 'mark2:keybindings-updated';

/**
 * 加载用户自定义快捷键。
 * @returns {Object<string, string>} commandId → shortcut 映射
 */
export function loadCustomKeybindings() {
    try {
        const stored = window.localStorage.getItem(STORAGE_KEY);
        if (!stored) return {};
        const parsed = JSON.parse(stored);
        if (!parsed || typeof parsed !== 'object') return {};
        return parsed;
    } catch {
        return {};
    }
}

/**
 * 保存用户自定义快捷键。
 * 同时写入 localStorage（JS 侧使用）和 appDataDir 文件（Rust 菜单使用）。
 * @param {Object<string, string>} keybindings - commandId → shortcut 映射
 */
export async function saveCustomKeybindings(keybindings) {
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(keybindings));
    } catch (error) {
        console.warn('保存自定义快捷键失败', error);
    }

    // 同步到文件供 Rust 侧读取
    try {
        const { appDataDir, join } = await import('@tauri-apps/api/path');
        const { writeTextFile, mkdir } = await import('@tauri-apps/plugin-fs');
        const dir = await appDataDir();
        await mkdir(dir, { recursive: true }).catch(() => {});
        const filePath = await join(dir, 'keybindings.json');
        await writeTextFile(filePath, JSON.stringify(keybindings));
    } catch (error) {
        console.warn('同步快捷键文件失败', error);
    }

    // 通知 Rust 重建菜单
    try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('rebuild_menu');
    } catch (error) {
        console.warn('重建菜单失败', error);
    }

    // 通知前端菜单更新（跨标签页用 storage 事件，同标签页用自定义事件）
    window.dispatchEvent(new CustomEvent(KEYBINDINGS_UPDATED_EVENT, { detail: keybindings }));
}
