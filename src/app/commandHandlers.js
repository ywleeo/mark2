/**
 * 命令处理器工厂。
 * 汇集 CommandManager 所需的全部 handlers,appBootstrap 只负责调用工厂并传入依赖。
 *
 * 拆出来的理由:这份 handlers map 原先塞在 initializeApplication 中间,
 * 占了 appBootstrap 近 130 行,把初始化流程的主脉络淹没了。
 */

import { isFeatureEnabled, getMASLimitationMessage } from '../config/features.js';
import { manualCheckUpdate } from '../modules/autoUpdater.js';
import { EXPORT_IDS } from './exportSetup.js';

/**
 * 构造 registerCoreCommands 所需的 handlers 字典。
 * 所有可变状态都来自闭包依赖,函数本身不持有状态。
 */
export function createCommandHandlers(deps) {
    const {
        appState,
        editorRegistry,
        exportManager,
        featureManager,
        // window / dialog
        showAboutDialog,
        openSettingsDialog,
        // view / layout toggles
        toggleSidebarVisibility,
        toggleStatusBarVisibility,
        toggleMarkdownCodeMode,
        toggleSvgCodeMode,
        toggleCsvTableMode,
        toggleMarkdownToolbar,
        toggleAppTheme,
        // file operations
        openFileOrFolder,
        openFileOnly,
        openFolderOnly,
        saveCurrentFile,
        closeActiveTab,
        // editor history
        handleUndoCommand,
        handleRedoCommand,
        handleSettingsSubmit: _unusedHandleSettingsSubmit, // reserved for future
        // file menu actions
        handleCreateNewFile,
        handleCreateUntitled,
        handleDeleteActiveFile,
        handleMoveActiveFile,
        handleRenameActiveFile,
        // card export
        showCardExportSidebar,
        // run script
        handleRunFile,
        // recent
        handleRecentItemClick,
        clearRecent,
    } = deps;

    // ── cut / copy / paste 共享的 editor 选择逻辑 ──
    const getActiveEditor = () => {
        const viewMode = appState.getActiveViewMode();
        if (viewMode === 'markdown') return editorRegistry.getMarkdownEditor();
        if (viewMode === 'code') return editorRegistry.getCodeEditor();
        return null;
    };

    return {
        onAbout: showAboutDialog,
        onQuit: async () => {
            const { getCurrentWindow } = await import('@tauri-apps/api/window');
            await getCurrentWindow().close();
        },
        onUndo: handleUndoCommand,
        onRedo: handleRedoCommand,
        onSelectAll: () => editorRegistry.getMarkdownEditor()?.selectAll?.(),
        onCut: async () => {
            const editor = getActiveEditor();
            if (editor) {
                const text = editor.getSelectionText?.() || editor.getSelectedMarkdown?.() || '';
                if (text) {
                    await navigator.clipboard.writeText(text);
                    const viewMode = appState.getActiveViewMode();
                    if (viewMode === 'markdown' && editor.editor) {
                        editor.editor.chain().focus().deleteSelection().run();
                    } else if (viewMode === 'code' && editor.replaceSelectionWithText) {
                        editor.replaceSelectionWithText('');
                    }
                }
                return;
            }
            document.execCommand('cut');
        },
        onCopy: async () => {
            const editor = getActiveEditor();
            if (editor) {
                const text = editor.getSelectionText?.() || editor.getSelectedMarkdown?.() || '';
                if (text) {
                    await navigator.clipboard.writeText(text);
                    return;
                }
            }
            document.execCommand('copy');
        },
        onPaste: async () => {
            const editor = getActiveEditor();
            if (editor && typeof editor.insertTextAtCursor === 'function') {
                try {
                    const { readClipboardText } = await import('../api/clipboard.js');
                    const text = await readClipboardText();
                    if (text) {
                        editor.insertTextAtCursor(text);
                        return;
                    }
                } catch {}
            }
            document.execCommand('paste');
        },
        onOpen: openFileOrFolder,
        onOpenFile: openFileOnly,
        onOpenFolder: openFolderOnly,
        onSettings: openSettingsDialog,
        onExportImage: () => exportManager.executeExport(EXPORT_IDS.CURRENT_VIEW_IMAGE),
        onExportPdf: () => exportManager.executeExport(EXPORT_IDS.CURRENT_VIEW_PDF),
        onToggleSidebar: toggleSidebarVisibility,
        onToggleStatusBar: toggleStatusBarVisibility,
        onToggleMarkdownCodeView: toggleMarkdownCodeMode,
        onToggleMarkdownToolbar: toggleMarkdownToolbar,
        onToggleTheme: () => toggleAppTheme(appState),
        onCopyMarkdown: () => appState.getMarkdownToolbarManager()?.copyMarkdown?.(),
        onToggleTerminal: () => {
            if (!isFeatureEnabled('terminal')) {
                alert(getMASLimitationMessage('terminal'));
                return;
            }
            featureManager?.getFeatureApi?.('terminal')?.toggle?.();
        },
        onToggleTerminalHistory: () => {
            if (!isFeatureEnabled('terminal')) return;
            featureManager?.getFeatureApi?.('terminal')?.showHistory?.();
        },
        onToggleAiSidebar: () => featureManager?.getFeatureApi?.('ai-sidebar')?.toggle?.(),
        onNewUntitled: handleCreateUntitled,
        onNewFile: handleCreateNewFile,
        onDeleteActiveFile: handleDeleteActiveFile,
        onMoveActiveFile: handleMoveActiveFile,
        onRenameActiveFile: handleRenameActiveFile,
        onFind: () => editorRegistry.getMarkdownEditor()?.showSearch?.(),
        onSelectSearchMatches: () => editorRegistry.getMarkdownEditor()?.selectAllSearchMatches?.(),
        onSave: saveCurrentFile,
        onCloseTab: closeActiveTab,
        onToggleSvgCodeView: toggleSvgCodeMode,
        onToggleCsvTableView: toggleCsvTableMode,
        onOpenCardExport: showCardExportSidebar,
        onToggleScratchpad: () => featureManager?.getFeatureApi?.('scratchpad')?.toggle?.(),
        onToggleToc: () => appState.getMarkdownToolbarManager()?.toggleToc?.(),
        onCreateWorkspaceFile: ({ path }) => appState.getFileTree()?.createFileInFolder?.(path),
        onCreateWorkspaceFolder: ({ path }) => appState.getFileTree()?.createFolderInFolder?.(path),
        onRenameWorkspaceEntry: ({ path, targetType }) => appState.getFileTree()?.startRenaming?.(path, { targetType }),
        onMoveWorkspaceEntry: ({ path, targetType }) => appState.getFileTree()?.promptMoveTo?.(path, { targetType }),
        onDeleteWorkspaceEntry: ({ path }) => appState.getFileTree()?.confirmAndDelete?.(path),
        onRevealWorkspaceEntry: ({ path }) => appState.getFileTree()?.revealInFinder?.(path),
        onRunWorkspaceEntry: ({ path }) => handleRunFile(path),
        onCopyWorkspacePath: async ({ path }) => {
            if (!path) return;
            await navigator.clipboard.writeText(path);
        },
        onRecentItemClick: handleRecentItemClick,
        onClearRecent: clearRecent,
        onCheckUpdate: manualCheckUpdate,
    };
}
