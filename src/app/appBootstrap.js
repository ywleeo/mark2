/**
 * 应用引导模块。
 * 包含应用初始化主流程和相关胶水函数。
 */

import { isFeatureEnabled, getMASLimitationMessage } from '../config/features.js';
import { MarkdownToolbarManager } from '../components/MarkdownToolbarManager.js';
import { createMarkdownCodeMode } from '../modules/markdownCodeMode.js';
import { createSvgCodeMode } from '../modules/svgCodeMode.js';
import { createCsvTableMode } from '../modules/csvTableMode.js';
import { createFileDropController } from '../modules/fileDropController.js';
import { createWindowFocusHandler } from '../modules/windowFocusHandler.js';
import { createFileWatcherController } from '../modules/fileWatchers.js';
import { restoreStoredSecurityScopes } from '../services/securityScopeService.js';
import { setExportMenuEnabled } from '../api/native.js';
import { loadEditorSettings, applyEditorSettings, saveEditorSettings } from '../utils/editorSettings.js';
import { isMarkdownFilePath, detectLanguageForPath, isCsvFilePath } from '../utils/fileTypeUtils.js';
import { normalizeFsPath } from '../utils/pathUtils.js';
import { setupSidebarResizer } from '../utils/sidebarResizer.js';
import { registerMenuListeners } from '../modules/menuListeners.js';
import { registerCoreCommands, registerDefaultKeybindings, registerWindowsKeybindings } from './commandSetup.js';
import { isWindows } from '../utils/platform.js';
import { registerCoreFeatures } from './featureSetup.js';
import { registerCoreExports, EXPORT_IDS } from './exportSetup.js';
import { loadAndRegisterModules } from './moduleLoader.js';
import { setupViewPanes } from './viewSetup.js';
import { createEditorCallbacks, setupEditors } from './editorSetup.js';
import { setupStatusBar, setupFileTree, setupTabManager } from './componentSetup.js';
import { setupToolbarEvents } from './eventSetup.js';
import { setupTitlebarControls, setupThemeToggle, toggleAppTheme } from './windowControls.js';
import { AppMenu } from '../components/AppMenu.js';
import { createTabStateTrimmer, registerIdleCleanup, startIdleGC } from '../utils/idleGC.js';

export function createAppBootstrap({
    // 核心状态/服务
    appState,
    documentManager,
    commandManager,
    keybindingManager,
    featureManager,
    exportManager,
    workspaceManager,
    editorRegistry,
    tabHistoryManager,
    documentSessions,
    fileSession,
    untitledFileManager,
    appServices,
    workspaceController,
    // 同步调度器
    scheduleWorkspaceContextSync,
    scheduleDocumentSnapshotSync,
    // windowLifecycle 导出
    updateWindowTitle,
    loadAvailableFonts,
    openSettingsDialog,
    showAboutDialog,
    setupOpenedFilesListener,
    setupCleanupHandlers,
    showWindow,
    setSettingsDialogCtor,
    // toolbarController 导出
    handleToolbarOnFileChange,
    handleCardSidebarOnFileChange,
    handleToolbarOnViewModeChange,
    syncToolbarWithCurrentContext,
    getToolbarEditorInstance,
    toggleMarkdownToolbar,
    showCardExportSidebar,
    // viewManager 导出
    viewManager,
    // viewController 导出
    activateMarkdownView,
    activateCodeView,
    activateImageView,
    activateMediaView,
    activateSpreadsheetView,
    activatePdfView,
    activateUnsupportedView,
    setContentZoom,
    updateZoomDisplayForActiveView,
    handleZoomControl,
    rememberMarkdownScrollPosition,
    restoreMarkdownScrollPosition,
    // editorActions 导出
    toggleMarkdownCodeMode,
    toggleSvgCodeMode,
    toggleCsvTableMode,
    // layoutControls 导出
    toggleSidebarVisibility,
    toggleStatusBarVisibility,
    // navigationController 导出
    handleFileSelect,
    handleOpenFilesChange,
    handleTabSelect,
    handleTabClose,
    checkFileHasUnsavedChanges,
    closeActiveTab,
    setupLinkNavigationListener,
    activateTabTransition,
    // fileMenuActions 导出
    handleCreateNewFile,
    handleDeleteActiveFile,
    handleMoveActiveFile,
    handleRenameActiveFile,
    handleTabRenameConfirm,
    handleTabRenameCancel,
    applyPathChange,
    // recentFilesActions 导出
    updateRecentMenu,
    handleRecentItemClick,
    clearRecent,
    // editorHistoryController 导出
    handleSettingsSubmit,
    handleUndoCommand,
    handleRedoCommand,
    // fileOperations 导出
    openPathsFromSelection,
    openFileOrFolder,
    openFileOnly,
    openFolderOnly,
    saveCurrentFile,
    loadFile,
    // untitledController 导出
    handleCreateUntitled,
    saveUntitledFile,
    // 其他
    confirm,
    eventBus,
}) {
    // ========== 导出菜单状态 ==========

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

    // ========== 清空活跃文件视图 ==========

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

    // ========== 持久化工作区状态 ==========

    function persistWorkspaceState(overrides = {}, options = {}) {
        workspaceController?.persistWorkspaceState(overrides, options);
        scheduleWorkspaceContextSync();
        return workspaceManager?.getSnapshot?.();
    }

    // ========== Tab 重排序 ==========

    function handleTabReorder(reorderPayload) {
        if (!reorderPayload || !Array.isArray(reorderPayload.storageOrder)) return;
        const fileTree = appState.getFileTree();
        if (typeof fileTree?.reorderOpenFiles === 'function') {
            fileTree.reorderOpenFiles(reorderPayload.storageOrder);
            return;
        }
        fileTree?.restoreOpenFiles(reorderPayload.storageOrder);
    }

    // ========== 侧边栏状态变化 ==========

    function handleSidebarStateChange(sidebarState) {
        workspaceController?.handleSidebarStateChange(sidebarState);
        return workspaceManager?.getSnapshot?.();
    }

    // ========== 运行脚本文件 ==========

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

    // ========== 恢复工作区状态 ==========

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

    // ========== 编辑器内容写入会话缓存 ==========

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

    // ========== 主初始化流程 ==========

    async function initializeApplication() {
        // windowFocusHandler 先声明，让 editorCallbacks 闭包可以捕获到该绑定
        let windowFocusHandler = null;

        const coreModules = await loadAndRegisterModules(editorRegistry);
        setSettingsDialogCtor(coreModules.SettingsDialog);

        setupViewPanes(appState);

        setupStatusBar({
            appState,
            appServices,
            editorRegistry,
            normalizeFsPath,
            handleZoomControl,
            updateZoomDisplayForActiveView,
        });

        const editorCallbacks = createEditorCallbacks({
            editorRegistry,
            appState,
            fileSession,
            documentManager,
            normalizeFsPath,
            updateWindowTitle,
            scheduleDocumentSnapshotSync,
            onUndoRequest: handleUndoCommand,
            onRedoRequest: handleRedoCommand,
            onFileSaved: async (filePath, modifiedTime) => {
                await windowFocusHandler?.syncFileModifiedTime?.(filePath, modifiedTime);
            },
        });

        const { editor, codeEditor } = setupEditors({
            constructors: coreModules,
            appState,
            editorRegistry,
            editorCallbacks,
            documentSessions,
            setContentZoom,
            tabHistoryManager,
        });

        eventBus.emit('editor:ready', { markdownEditor: editor, codeEditor });

        const tabStateTrimmer = createTabStateTrimmer(() => editorRegistry.getMarkdownEditor());
        registerIdleCleanup(() => tabStateTrimmer.trim());
        startIdleGC();

        appState.setCleanupFunction('exportContributions', registerCoreExports({
            exportManager,
            context: {
                getActiveViewMode: () => appState.getActiveViewMode(),
                getStatusBarController: () => appState.getStatusBarController(),
            },
        }));

        appState.setCleanupFunction('featureDefinitions', registerCoreFeatures({
            featureManager,
            context: {
                getAppState: () => appState,
                getEditorRegistry: () => editorRegistry,
                reloadCurrentFile: async (path) => {
                    const normalized = normalizeFsPath(path) || path;
                    await loadFile(normalized, {
                        skipWatchSetup: true,
                        forceReload: true,
                        autoFocus: false,
                        tabId: normalized,
                    });
                },
                confirm,
                getWorkspaceCwd: () => appState.getFileTree()?.rootPaths?.[0] || null,
            },
        }));
        appState.setCleanupFunction('featureManager', () => {
            void featureManager?.unmountAll?.();
        });
        await featureManager?.mountAll?.();
        console.log('[App] 功能模块已通过 FeatureManager 挂载');
        handleCardSidebarOnFileChange(appState.getCurrentFile());

        const markdownCodeMode = createMarkdownCodeMode({
            detectLanguageForPath,
            isMarkdownFilePath,
            view: viewManager.createViewProtocol(),
        });
        appState.setMarkdownCodeMode(markdownCodeMode);

        const svgCodeMode = createSvgCodeMode({ view: viewManager.createViewProtocol() });
        appState.setSvgCodeMode(svgCodeMode);

        const csvTableMode = createCsvTableMode({
            isCsvFilePath,
            view: viewManager.createViewProtocol(),
            detectLanguageForPath,
        });
        appState.setCsvTableMode(csvTableMode);

        const fileTree = setupFileTree({
            FileTreeCtor: coreModules.FileTree,
            appState,
            executeCommand: (commandId, payload, context) => commandManager.executeCommand(commandId, payload, context),
            beforeFileSelect: async (targetPath) => {
                return await featureManager?.getFeatureApi?.('ai-sidebar')?.confirmBeforeDocumentChange?.(targetPath) ?? true;
            },
            handleFileSelect,
            handleOpenFilesChange,
            handleSidebarStateChange,
            applyPathChange,
            handleTabClose,
            normalizeFsPath,
            documentSessions,
            onRunFile: handleRunFile,
            onOpenFile: openFileOnly,
            onOpenFolder: openFolderOnly,
        });

        setupTabManager({
            TabManagerCtor: coreModules.TabManager,
            appState,
            beforeTabSelect: async (targetTab) => {
                return await featureManager?.getFeatureApi?.('ai-sidebar')?.confirmBeforeDocumentChange?.(targetTab?.path || null) ?? true;
            },
            handleTabSelect,
            handleTabClose,
            handleTabRenameConfirm,
            handleTabRenameCancel,
            handleTabReorder,
            handleCreateUntitled,
        });

        const fileWatcherController = createFileWatcherController({
            fileTree,
            normalizeFsPath,
            getCurrentFile: () => appState.getCurrentFile(),
            getActiveViewMode: () => appState.getActiveViewMode(),
            getEditor: () => editorRegistry.getMarkdownEditor(),
            getCodeEditor: () => editorRegistry.getCodeEditor(),
            scheduleLoadFile: async (path) => {
                const normalized = normalizeFsPath(path) || path || null;
                await loadFile(path, {
                    skipWatchSetup: true,
                    forceReload: true,
                    autoFocus: false,
                    tabId: normalized,
                    suppressMissingFileErrors: true,
                });
            },
            fileSession,
            documentSessions,
        });
        appState.setFileWatcherController(fileWatcherController);

        await restoreWorkspaceStateFromStorage();

        const loadedSettings = loadEditorSettings();
        appState.setEditorSettings(loadedSettings);
        applyEditorSettings(loadedSettings);
        codeEditor.applyPreferences?.(loadedSettings);
        saveEditorSettings(loadedSettings);

        setupTitlebarControls();
        setupThemeToggle(appState);

        const settingsDialog = new coreModules.SettingsDialog({ onSubmit: handleSettingsSubmit });
        appState.setSettingsDialog(settingsDialog);
        const availableFontFamilies = appState.getAvailableFontFamilies();
        if (availableFontFamilies.length > 0) {
            settingsDialog.setAvailableFonts(availableFontFamilies);
        }

        appState.setCleanupFunction('commandContributions', registerCoreCommands({
            commandManager,
            handlers: {
                onAbout: showAboutDialog,
                onQuit: async () => {
                    const { getCurrentWindow } = await import('@tauri-apps/api/window');
                    await getCurrentWindow().close();
                },
                onUndo: handleUndoCommand,
                onRedo: handleRedoCommand,
                onSelectAll: () => editorRegistry.getMarkdownEditor()?.selectAll?.(),
                onCut: async () => {
                    const viewMode = appState.getActiveViewMode();
                    let editor = null;
                    if (viewMode === 'markdown') {
                        editor = editorRegistry.getMarkdownEditor();
                    } else if (viewMode === 'code') {
                        editor = editorRegistry.getCodeEditor();
                    }
                    if (editor) {
                        const text = editor.getSelectionText?.() || editor.getSelectedMarkdown?.() || '';
                        if (text) {
                            await navigator.clipboard.writeText(text);
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
                    const viewMode = appState.getActiveViewMode();
                    let editor = null;
                    if (viewMode === 'markdown') {
                        editor = editorRegistry.getMarkdownEditor();
                    } else if (viewMode === 'code') {
                        editor = editorRegistry.getCodeEditor();
                    }
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
                    const viewMode = appState.getActiveViewMode();
                    let editor = null;
                    if (viewMode === 'markdown') {
                        editor = editorRegistry.getMarkdownEditor();
                    } else if (viewMode === 'code') {
                        editor = editorRegistry.getCodeEditor();
                    }
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
                    if (!path) {
                        return;
                    }
                    await navigator.clipboard.writeText(path);
                },
                onRecentItemClick: handleRecentItemClick,
                onClearRecent: clearRecent,
            },
        }));

        appState.setCleanupFunction('keybindingManager', registerDefaultKeybindings({
            keybindingManager,
        }));
        appState.setCleanupFunction('windowsKeybindings', registerWindowsKeybindings({
            keybindingManager,
        }));

        appState.setCleanupFunction('keyboardShortcut', keybindingManager.attach({
            target: document,
            executeCommand: (commandId, payload, context) => commandManager.executeCommand(commandId, payload, context),
        }));

        appState.setCleanupFunction('menuListeners', await registerMenuListeners({
            executeCommand: (commandId, payload, context) => commandManager.executeCommand(commandId, payload, context),
        }));

        // Windows 自定义标题栏菜单（macOS 使用原生菜单栏）
        if (isWindows) {
            const appMenu = new AppMenu({
                executeCommand: (commandId, payload, context) => commandManager.executeCommand(commandId, payload, context),
            });
            appState.setCleanupFunction('appMenu', () => appMenu.destroy());
        }

        setupLinkNavigationListener();
        appState.setCleanupFunction('sidebarResizer', setupSidebarResizer());

        const fileDropController = createFileDropController({ openPathsFromSelection });
        appState.setFileDropController(fileDropController);
        appState.setCleanupFunction('fileDrop', await fileDropController.setup());

        setupCleanupHandlers();
        showWindow();
        loadAvailableFonts();
        updateWindowTitle();

        eventBus.emit('app:initialized');
        void updateExportMenuState();
        void updateRecentMenu();

        const markdownToolbarManager = new MarkdownToolbarManager(appServices, {
            executeCommand: (commandId, payload, context) => commandManager.executeCommand(commandId, payload, context),
            getEditorRegistry: () => editorRegistry,
        });
        appState.setMarkdownToolbarManager(markdownToolbarManager);
        markdownToolbarManager.setToggleViewModeCallback(toggleMarkdownCodeMode);
        syncToolbarWithCurrentContext();

        setupToolbarEvents({ handleToolbarOnViewModeChange, handleToolbarOnFileChange });

        windowFocusHandler = createWindowFocusHandler({
            getFileTree: () => appState.getFileTree(),
            normalizePath: normalizeFsPath,
            fileService: appServices.file,
            fileSession,
            getEditor: () => editorRegistry.getMarkdownEditor(),
            getCodeEditor: () => editorRegistry.getCodeEditor(),
            getCurrentFile: () => appState.getCurrentFile(),
            getActiveViewMode: () => appState.getActiveViewMode(),
            scheduleLoadFile: async (path) => {
                const normalized = normalizeFsPath(path) || path || null;
                await loadFile(path, {
                    skipWatchSetup: true,
                    forceReload: true,
                    autoFocus: false,
                    tabId: normalized,
                    suppressMissingFileErrors: true,
                });
            },
        });
        appState.setCleanupFunction('windowFocusHandler', () => windowFocusHandler.dispose());
        await windowFocusHandler.setup();

        setupOpenedFilesListener();
    }

    return {
        initializeApplication,
        saveCurrentEditorContentToCache,
        clearActiveFileView,
        persistWorkspaceState,
        updateExportMenuState,
        handleTabReorder,
        handleSidebarStateChange,
        handleRunFile,
    };
}
