/**
 * 自定义快捷键的持久化存储。
 * 存储格式：{ [commandId]: shortcut }
 */

const STORAGE_KEY = 'mark2:keybindings';

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
 * @param {Object<string, string>} keybindings - commandId → shortcut 映射
 */
export function saveCustomKeybindings(keybindings) {
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(keybindings));
    } catch (error) {
        console.warn('保存自定义快捷键失败', error);
    }
}
