/**
 * 编辑器历史命令（undo/redo）和设置提交。
 * 历史命令按当前 tab 的活动视图路由，不再依赖编辑器焦点。
 */
import {
    applyEditorSettings,
    normalizeEditorSettings,
    saveEditorSettings,
} from '../utils/editorSettings.js';

export function createEditorHistoryController({
    getMarkdownEditor,
    getCodeEditor,
    getCurrentTabId,
    getActiveViewMode,
    tabHistoryManager,
    getEditorSettings,
    setEditorSettings,
    reloadKeybindings,
}) {
    function invokeEditorHistoryAction(action) {
        const tabId = getCurrentTabId?.();
        if (!tabId || !tabHistoryManager) return false;

        const nextContent = action === 'undo'
            ? tabHistoryManager.undo(tabId)
            : tabHistoryManager.redo(tabId);
        if (typeof nextContent !== 'string') return false;

        const editor = getMarkdownEditor();
        const codeEditor = getCodeEditor();
        const activeViewMode = getActiveViewMode();
        if (activeViewMode === 'code') {
            return codeEditor?.applyHistoryContent?.(nextContent) ?? false;
        }
        if (activeViewMode === 'markdown' || activeViewMode === 'split') {
            return editor?.applyHistoryContent?.(nextContent) ?? false;
        }
        return false;
    }

    function handleUndoCommand() {
        return invokeEditorHistoryAction('undo');
    }

    function handleRedoCommand() {
        return invokeEditorHistoryAction('redo');
    }

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
        handleUndoCommand,
        handleRedoCommand,
    };
}
