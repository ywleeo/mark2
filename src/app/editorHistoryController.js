/**
 * 编辑器设置提交控制器。
 */
import {
    applyEditorSettings,
    normalizeEditorSettings,
    saveEditorSettings,
} from '../utils/editorSettings.js';

export function createEditorHistoryController({
    getCodeEditor,
    getEditorSettings,
    setEditorSettings,
    reloadKeybindings,
}) {
    async function handleSettingsSubmit(nextSettings) {
        const currentSettings = getEditorSettings();
        const merged = { ...currentSettings, ...nextSettings };
        const normalizedSettings = normalizeEditorSettings(merged);
        setEditorSettings(normalizedSettings);
        applyEditorSettings(normalizedSettings);
        getCodeEditor()?.applyPreferences?.(normalizedSettings);
        saveEditorSettings(normalizedSettings);
        reloadKeybindings?.();
    }

    return {
        handleSettingsSubmit,
    };
}
