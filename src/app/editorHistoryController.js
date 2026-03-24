/**
 * 编辑器历史命令（undo/redo）、焦点检测、设置提交
 */
import {
    applyEditorSettings,
    normalizeEditorSettings,
    saveEditorSettings,
} from '../utils/editorSettings.js';

export function createEditorHistoryController({
    getMarkdownEditor,
    getCodeEditor,
    getActiveViewMode,
    getEditorSettings,
    setEditorSettings,
}) {
    function isMarkdownEditorFocused() {
        const activeElement = document?.activeElement;
        if (!activeElement) return false;
        const editor = getMarkdownEditor();
        const tiptapRoot = editor?.editor?.view?.dom;
        return Boolean(tiptapRoot && (tiptapRoot === activeElement || tiptapRoot.contains(activeElement)));
    }

    function isCodeEditorFocused() {
        const activeElement = document?.activeElement;
        if (!activeElement) return false;
        const codeEditor = getCodeEditor();
        const codeHost = codeEditor?.editorHost;
        return Boolean(codeHost && (codeHost === activeElement || codeHost.contains(activeElement)));
    }

    function invokeEditorHistoryAction(action) {
        const editor = getMarkdownEditor();
        const codeEditor = getCodeEditor();

        const attemptMarkdown = () => {
            if (typeof editor?.[action] !== 'function') return false;
            return editor[action]();
        };
        const attemptCode = () => {
            if (typeof codeEditor?.[action] !== 'function') return false;
            return codeEditor[action]();
        };

        if (isMarkdownEditorFocused()) {
            return attemptMarkdown() || attemptCode();
        }

        if (isCodeEditorFocused()) {
            return attemptCode() || attemptMarkdown();
        }

        const activeViewMode = getActiveViewMode();
        if (activeViewMode === 'code') {
            return attemptCode() || attemptMarkdown();
        }

        if (activeViewMode === 'markdown' || activeViewMode === 'split') {
            return attemptMarkdown() || attemptCode();
        }

        return attemptMarkdown() || attemptCode();
    }

    function handleUndoCommand() {
        invokeEditorHistoryAction('undo');
    }

    function handleRedoCommand() {
        invokeEditorHistoryAction('redo');
    }

    async function handleSettingsSubmit(nextSettings) {
        const currentSettings = getEditorSettings();
        const merged = { ...currentSettings, ...nextSettings };
        const normalizedSettings = normalizeEditorSettings(merged);
        setEditorSettings(normalizedSettings);
        applyEditorSettings(normalizedSettings);
        getCodeEditor()?.applyPreferences?.(normalizedSettings);
        saveEditorSettings(normalizedSettings);
    }

    return {
        handleSettingsSubmit,
        handleUndoCommand,
        handleRedoCommand,
        isMarkdownEditorFocused,
        isCodeEditorFocused,
    };
}
