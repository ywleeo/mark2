/**
 * 写作模式偏好控制器。
 * 统一负责 AppState、运行时编辑器状态与持久化设置三者的一致性。
 */

import {
    applyEditorSettings,
    normalizeEditorSettings,
    saveEditorSettings,
} from '../../utils/editorSettings.js';

const WRITING_MODE_KEYS = new Set(['focusMode', 'typewriterMode']);

/**
 * 切换一个写作模式偏好并立即持久化。
 * @param {object} appState - 应用状态容器。
 * @param {'focusMode'|'typewriterMode'} key - 要切换的模式字段。
 * @returns {boolean} 切换后的启用状态。
 */
export function toggleWritingModePreference(appState, key) {
    if (!WRITING_MODE_KEYS.has(key)) {
        throw new Error(`不支持的写作模式: ${key}`);
    }

    const currentSettings = normalizeEditorSettings(appState?.getEditorSettings?.());
    const nextSettings = normalizeEditorSettings({
        ...currentSettings,
        [key]: currentSettings[key] !== true,
    });

    appState?.setEditorSettings?.(nextSettings);
    applyEditorSettings(nextSettings);
    saveEditorSettings(nextSettings);
    return nextSettings[key];
}
