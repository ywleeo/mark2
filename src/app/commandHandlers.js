/**
 * 命令处理器工厂。
 * 汇集 CommandManager 所需的全部 handlers,appBootstrap 只负责调用工厂并传入依赖。
 *
 * 拆出来的理由:这份 handlers map 原先塞在 initializeApplication 中间,
 * 占了 appBootstrap 近 130 行,把初始化流程的主脉络淹没了。
 */

import { manualCheckUpdate } from '../modules/autoUpdater.js';
import { shareCurrentDocument } from '../modules/share/shareDocument.js';
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
        toggleEmbedCodeMode,
        toggleCsvTableMode,
        toggleMarkdownToolbar,
        toggleAppTheme,
        getActivePaneContext,
        openInSecondary,
        closeSecondary,
        promoteSecondary,
        toggleFocusedSourceView,
        saveFocusedDocument,
        saveFocusedDocumentAs,
        closeFocusedDocument,
        deleteFocusedDocument,
        moveFocusedDocument,
        renameFocusedDocument,
        // file operations
        openFileOrFolder,
        openFileOnly,
        openFolderOnly,
        saveCurrentFile,
        saveCurrentFileAs,
        closeActiveTab,
        reopenLastClosedTab,
        handleSettingsSubmit: _unusedHandleSettingsSubmit, // reserved for future
        // file menu actions
        handleCreateNewFile,
        handleCreateUntitled,
        handleDeleteActiveFile,
        handleMoveActiveFile,
        handleRenameActiveFile,
        // card export
        showCardExportSidebar,
        // recent
        handleRecentItemClick,
        clearRecent,
        // vault
        toggleVault,
    } = deps;

    // ── cut / copy / paste 共享的 editor 选择逻辑 ──
    const getActiveEditor = () => {
        const context = getActivePaneContext?.();
        const viewMode = context?.viewMode || appState.getActiveViewMode();
        const activeRegistry = context?.editorRegistry || editorRegistry;
        if (viewMode === 'markdown') return activeRegistry.getMarkdownEditor();
        if (viewMode === 'code') return activeRegistry.getCodeEditor();
        return null;
    };

    /**
     * 返回当前焦点栏的编辑器注册表。
     * @returns {Object} Pane 作用域 EditorRegistry。
     */
    const getActiveEditorRegistry = () => getActivePaneContext?.()?.editorRegistry || editorRegistry;

    return {
        onAbout: showAboutDialog,
        onQuit: async () => {
            const { getCurrentWindow } = await import('@tauri-apps/api/window');
            await getCurrentWindow().close();
        },
        onUndo: () => getActiveEditor()?.undo?.() ?? false,
        onRedo: () => getActiveEditor()?.redo?.() ?? false,
        onSelectAll: () => getActiveEditor()?.selectAll?.(),
        onCut: async () => {
            const editor = getActiveEditor();
            if (editor) {
                const text = editor.getSelectionText?.() || editor.getSelectedMarkdown?.() || '';
                if (text) {
                    await navigator.clipboard.writeText(text);
                    const viewMode = getActivePaneContext?.()?.viewMode || appState.getActiveViewMode();
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
        onExportImageMobile: () => exportManager.executeExport(EXPORT_IDS.CURRENT_VIEW_IMAGE_MOBILE),
        onExportPdf: () => exportManager.executeExport(EXPORT_IDS.CURRENT_VIEW_PDF),
        onToggleSidebar: toggleSidebarVisibility,
        onToggleStatusBar: toggleStatusBarVisibility,
        onOpenInSecondary: ({ path } = {}) => openInSecondary?.(path),
        onCloseSecondary: closeSecondary,
        onPromoteSecondary: promoteSecondary,
        onToggleFocusedSourceView: toggleFocusedSourceView,
        onToggleMarkdownCodeView: toggleMarkdownCodeMode,
        // embed 视图(HTML 等)下 ⌘E 在渲染预览 ↔ CodeMirror 源码间切换
        onToggleHtmlEmbedView: toggleEmbedCodeMode,
        onToggleMarkdownToolbar: toggleMarkdownToolbar,
        onToggleTheme: () => toggleAppTheme(appState),
        onCopyMarkdown: () => appState.getMarkdownToolbarManager()?.copyMarkdown?.(),
        onCopyPlainText: () => appState.getMarkdownToolbarManager()?.copyPlainText?.(),
        onShareLink: () => {
            const context = getActivePaneContext?.();
            const activeRegistry = context?.editorRegistry || editorRegistry;
            const viewMode = context?.viewMode || appState.getActiveViewMode();
            return shareCurrentDocument({
            // 源码模式必须读取 CodeEditor，避免分享尚未同步回预览编辑器的旧内容。
                getMarkdown: () => viewMode === 'code'
                    ? activeRegistry.getCodeEditor()?.getValue?.() || ''
                    : activeRegistry.getMarkdownEditor()?.getMarkdown?.() || '',
                getCurrentFile: () => context?.documentPath || appState.getCurrentFile(),
            });
        },
        onNewUntitled: handleCreateUntitled,
        onNewFile: handleCreateNewFile,
        onDeleteActiveFile: deleteFocusedDocument || handleDeleteActiveFile,
        onMoveActiveFile: moveFocusedDocument || handleMoveActiveFile,
        onRenameActiveFile: renameFocusedDocument || handleRenameActiveFile,
        onFind: () => getActiveEditorRegistry().getMarkdownEditor()?.showSearch?.(),
        onSelectSearchMatches: () => getActiveEditorRegistry().getMarkdownEditor()?.selectAllSearchMatches?.(),
        onSave: saveFocusedDocument || saveCurrentFile,
        onSaveAs: saveFocusedDocumentAs || saveCurrentFileAs,
        onCloseTab: closeFocusedDocument || closeActiveTab,
        onReopenTab: reopenLastClosedTab,
        onToggleSvgCodeView: toggleSvgCodeMode,
        onToggleCsvTableView: toggleCsvTableMode,
        onToggleTranslator: () => featureManager?.getFeatureApi?.('translator')?.toggle?.(),
        onToggleToc: () => appState.getMarkdownToolbarManager()?.toggleToc?.(),
        onCreateWorkspaceFile: ({ path }) => appState.getFileTree()?.createFileInFolder?.(path),
        onCreateWorkspaceFolder: ({ path }) => appState.getFileTree()?.createFolderInFolder?.(path),
        onRenameWorkspaceEntry: ({ path, targetType }) => appState.getFileTree()?.startRenaming?.(path, { targetType }),
        onMoveWorkspaceEntry: ({ path, targetType }) => appState.getFileTree()?.promptMoveTo?.(path, { targetType }),
        onDeleteWorkspaceEntry: ({ path }) => appState.getFileTree()?.confirmAndDelete?.(path),
        onRevealWorkspaceEntry: ({ path }) => appState.getFileTree()?.revealInFinder?.(path),
        onCopyWorkspacePath: async ({ path }) => {
            if (!path) return;
            await navigator.clipboard.writeText(path);
        },
        onRecentItemClick: handleRecentItemClick,
        onClearRecent: clearRecent,
        onCheckUpdate: manualCheckUpdate,
        onToggleVault: toggleVault,
    };
}
