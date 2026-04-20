/**
 * appBootstrap 使用的一组闭包 helper。
 * 原本内联在 initializeApplication 之上,占了 ~120 行,
 * 抽出来让 appBootstrap 只保留初始化主脉络。
 */

import { setExportMenuEnabled } from '../api/native.js';
import { restoreStoredSecurityScopes } from '../services/securityScopeService.js';
import { isMarkdownFilePath } from '../utils/fileTypeUtils.js';

export function createBootstrapHelpers(deps) {
    const {
        appState,
        documentManager,
        workspaceManager,
        workspaceController,
        editorRegistry,
        documentSessions,
        fileSession,
        untitledFileManager,
        featureManager,
        scheduleWorkspaceContextSync,
        scheduleDocumentSnapshotSync,
        updateWindowTitle,
        activateMarkdownView,
        handleToolbarOnFileChange,
        handleCardSidebarOnFileChange,
    } = deps;

    async function updateExportMenuState() {
        const currentFile = appState.getCurrentFile();
        const activeViewMode = appState.getActiveViewMode();
        const hasMarkdownFile = typeof currentFile === 'string' && isMarkdownFilePath(currentFile);
        const shouldEnable = activeViewMode === 'markdown' && hasMarkdownFile;

        if (appState.getExportMenuEnabledState() === shouldEnable) return;

        appState.setExportMenuEnabledState(shouldEnable);
        try {
            await setExportMenuEnabled(shouldEnable);
        } catch (error) {
            console.warn('更新导出菜单状态失败:', error);
        }
    }

    function persistWorkspaceState(overrides = {}, options = {}) {
        workspaceController?.persistWorkspaceState(overrides, options);
        scheduleWorkspaceContextSync();
        return workspaceManager?.getSnapshot?.();
    }

    function clearActiveFileView() {
        documentManager?.clearActiveDocument?.();
        appState.setHasUnsavedChanges(false);
        handleToolbarOnFileChange(null);
        handleCardSidebarOnFileChange(null);
        documentSessions.closeActiveSession();
        editorRegistry.clearAllContents();
        editorRegistry.blurAll();
        activateMarkdownView();
        appState.getMarkdownCodeMode()?.reset();
        updateWindowTitle();
        persistWorkspaceState({ currentFile: null });
        scheduleWorkspaceContextSync();
        scheduleDocumentSnapshotSync();
    }

    function handleSidebarStateChange(sidebarState) {
        workspaceController?.handleSidebarStateChange(sidebarState);
        return workspaceManager?.getSnapshot?.();
    }

    async function handleRunFile(filePath) {
        if (!filePath) return;
        const lowerPath = filePath.toLowerCase();
        let command = '';
        if (lowerPath.endsWith('.sh')) {
            command = `sh "${filePath}"`;
        } else if (lowerPath.endsWith('.py')) {
            command = `python3 "${filePath}"`;
        } else {
            return;
        }
        try {
            await featureManager?.getFeatureApi?.('terminal')?.runCommand?.(command);
        } catch (error) {
            console.error('[Run] 执行命令失败:', error);
        }
    }

    async function restoreWorkspaceStateFromStorage() {
        if (!workspaceController) return;
        try {
            await restoreStoredSecurityScopes();
        } catch (error) {
            console.warn('[main] 恢复文件权限失败', error);
        }
        await workspaceController.restoreWorkspaceStateFromStorage();
        scheduleWorkspaceContextSync();
    }

    function saveCurrentEditorContentToCache() {
        const currentFile = documentManager?.getActivePath?.() || appState.getCurrentFile();
        const activeViewMode = appState.getActiveViewMode();
        const editor = editorRegistry.getMarkdownEditor();
        const codeEditor = editorRegistry.getCodeEditor();

        if (currentFile && untitledFileManager.isUntitledPath(currentFile)) {
            let content = '';
            if (activeViewMode === 'markdown' && editor) {
                content = editor.getMarkdown?.() || '';
            } else if (activeViewMode === 'code' && codeEditor) {
                content = codeEditor.getValue?.() || '';
            }
            untitledFileManager.setContent(currentFile, content);
            return;
        }

        fileSession.saveCurrentEditorContentToCache({
            currentFile,
            activeViewMode,
            editor,
            codeEditor,
        });
    }

    return {
        updateExportMenuState,
        clearActiveFileView,
        persistWorkspaceState,
        handleSidebarStateChange,
        handleRunFile,
        restoreWorkspaceStateFromStorage,
        saveCurrentEditorContentToCache,
    };
}
