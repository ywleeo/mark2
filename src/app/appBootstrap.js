/**
 * 应用引导模块
 * 包含应用初始化主流程和相关胶水函数
 */

import { exportCurrentViewToImage, exportCurrentViewToPdf } from '../modules/menuExports.js';
import { isFeatureEnabled, getMASLimitationMessage } from '../config/features.js';
import { MarkdownToolbarManager } from '../components/MarkdownToolbarManager.js';
import { createMarkdownCodeMode } from '../modules/markdownCodeMode.js';
import { createSvgCodeMode } from '../modules/svgCodeMode.js';
import { createCsvTableMode } from '../modules/csvTableMode.js';
import { createWorkflowCodeMode } from '../modules/workflowCodeMode.js';
import { createFileDropController } from '../modules/fileDropController.js';
import { createWindowFocusHandler } from '../modules/windowFocusHandler.js';
import { createFileWatcherController } from '../modules/fileWatchers.js';
import { createTerminalPanel } from '../modules/terminalPanel.js';
import { createScratchpadPanel } from '../modules/scratchpadPanel.js';
import { initCardExportSidebar } from '../modules/card-export/index.js';
import { initAiSidebar } from '../modules/ai-assistant/AiSidebar.js';
import { restoreStoredSecurityScopes } from '../services/securityScopeService.js';
import { setExportMenuEnabled } from '../api/native.js';
import { loadEditorSettings, applyEditorSettings, saveEditorSettings } from '../utils/editorSettings.js';
import { isMarkdownFilePath, detectLanguageForPath, isCsvFilePath } from '../utils/fileTypeUtils.js';
import { normalizeFsPath } from '../utils/pathUtils.js';
import { setupKeyboardShortcuts } from '../utils/shortcuts.js';
import { setupSidebarResizer } from '../utils/sidebarResizer.js';
import { registerMenuListeners } from '../modules/menuListeners.js';
import { loadAndRegisterModules } from './moduleLoader.js';
import { setupViewPanes } from './viewSetup.js';
import { createEditorCallbacks, setupEditors } from './editorSetup.js';
import { setupStatusBar, setupFileTree, setupTabManager } from './componentSetup.js';
import { setupToolbarEvents } from './eventSetup.js';
import { setupTitlebarControls, setupThemeToggle, toggleAppTheme } from './windowControls.js';
import { createTabStateTrimmer, registerIdleCleanup, startIdleGC } from '../utils/idleGC.js';

export function createAppBootstrap({
    // 核心状态/服务
    appState,
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
    // cardExportSidebar / terminalPanel 的 setter/getter（由 main.js 持有变量）
    setCardExportSidebar,
    getCardExportSidebar,
    setTerminalPanel,
    getTerminalPanel,
    setScratchpadPanel,
    getScratchpadPanel,
    // windowLifecycle 导出
    updateWindowTitle,
    loadAvailableFonts,
    openSettingsDialog,
    showAboutDialog,
    setupOpenedFilesListener,
    setupCleanupHandlers,
    setSettingsDialogCtor,
    // toolbarController 导出
    handleToolbarOnFileChange,
    handleCardSidebarOnFileChange,
    handleToolbarOnViewModeChange,
    syncToolbarWithCurrentContext,
    getToolbarEditorInstance,
    toggleMarkdownToolbar,
    // viewController 导出
    activateMarkdownView,
    activateCodeView,
    activateImageView,
    activateMediaView,
    activateSpreadsheetView,
    activatePdfView,
    activateWorkflowView,
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
    toggleWorkflowCodeMode,
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
        appState.setCurrentFile(null);
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
            await getTerminalPanel()?.runCommand(command);
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
        const currentFile = appState.getCurrentFile();
        const activeViewMode = appState.getActiveViewMode();
        const editor = editorRegistry.getMarkdownEditor();
        const codeEditor = editorRegistry.getCodeEditor();
        const workflowEditor = editorRegistry.getWorkflowEditor();

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
            workflowEditor,
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

        const cardExportSidebar = await initCardExportSidebar();
        setCardExportSidebar(cardExportSidebar);
        console.log('[App] 卡片导出侧边栏已初始化');
        handleCardSidebarOnFileChange(appState.getCurrentFile());

        const aiSidebar = initAiSidebar({
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
        });
        console.log('[App] AI 助手侧边栏已初始化');

        const terminalPanel = createTerminalPanel({
            getWorkspaceCwd: () => appState.getFileTree()?.rootPaths?.[0] || null,
        });
        setTerminalPanel(terminalPanel);
        terminalPanel.initialize();

        const scratchpadPanel = createScratchpadPanel();
        setScratchpadPanel(scratchpadPanel);
        scratchpadPanel?.initialize();

        const markdownCodeMode = createMarkdownCodeMode({
            detectLanguageForPath,
            isMarkdownFilePath,
            activateMarkdownView,
            activateCodeView,
        });
        appState.setMarkdownCodeMode(markdownCodeMode);

        const svgCodeMode = createSvgCodeMode({ activateCodeView, activateImageView });
        appState.setSvgCodeMode(svgCodeMode);

        const csvTableMode = createCsvTableMode({
            isCsvFilePath,
            activateSpreadsheetView,
            activateCodeView,
            detectLanguageForPath,
        });
        appState.setCsvTableMode(csvTableMode);

        const workflowCodeMode = createWorkflowCodeMode({ activateCodeView, activateWorkflowView });
        appState.setWorkflowCodeMode(workflowCodeMode);

        const fileTree = setupFileTree({
            FileTreeCtor: coreModules.FileTree,
            appState,
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
            getWorkflowEditor: () => editorRegistry.getWorkflowEditor(),
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

        appState.setCleanupFunction('keyboardShortcut', setupKeyboardShortcuts({
            onOpen: openFileOrFolder,
            onSave: saveCurrentFile,
            onCloseTab: closeActiveTab,
            onNewTab: handleCreateUntitled,
            onFind: () => editorRegistry.getMarkdownEditor()?.showSearch?.(),
            onSelectSearchMatches: () => editorRegistry.getMarkdownEditor()?.selectAllSearchMatches?.(),
            onDeleteFile: handleDeleteActiveFile,
            onToggleSidebar: toggleSidebarVisibility,
            onToggleMarkdownCodeView: toggleMarkdownCodeMode,
            onToggleSvgCodeView: toggleSvgCodeMode,
            onToggleCsvTableView: toggleCsvTableMode,
            onToggleWorkflowCodeView: toggleWorkflowCodeMode,
            onToggleScratchpad: () => getScratchpadPanel()?.toggle(),
        }));

        appState.setCleanupFunction('menuListeners', await registerMenuListeners({
            onAbout: showAboutDialog,
            onQuit: async () => {
                const { getCurrentWindow } = await import('@tauri-apps/api/window');
                await getCurrentWindow().close();
            },
            onUndo: handleUndoCommand,
            onRedo: handleRedoCommand,
            onNewFile: handleCreateNewFile,
            onOpen: openFileOrFolder,
            onOpenFile: openFileOnly,
            onOpenFolder: openFolderOnly,
            onSettings: openSettingsDialog,
            onExportImage: () => exportCurrentViewToImage({ statusBarController: appState.getStatusBarController() }),
            onExportPdf: () => exportCurrentViewToPdf({
                activeViewMode: appState.getActiveViewMode(),
                statusBarController: appState.getStatusBarController(),
            }),
            onToggleSidebar: toggleSidebarVisibility,
            onToggleStatusBar: toggleStatusBarVisibility,
            onToggleMarkdownCodeView: toggleMarkdownCodeMode,
            onToggleMarkdownToolbar: toggleMarkdownToolbar,
            onToggleTheme: () => toggleAppTheme(appState),
            onToggleTerminal: () => {
                if (!isFeatureEnabled('terminal')) {
                    alert(getMASLimitationMessage('terminal'));
                    return;
                }
                getTerminalPanel()?.toggle();
            },
            onToggleAiSidebar: () => aiSidebar?.toggle(),
            onDeleteActiveFile: handleDeleteActiveFile,
            onMoveActiveFile: handleMoveActiveFile,
            onRenameActiveFile: handleRenameActiveFile,
            onRecentItemClick: handleRecentItemClick,
            onClearRecent: clearRecent,
        }));

        setupLinkNavigationListener();
        appState.setCleanupFunction('sidebarResizer', setupSidebarResizer());

        const fileDropController = createFileDropController({ openPathsFromSelection });
        appState.setFileDropController(fileDropController);
        appState.setCleanupFunction('fileDrop', await fileDropController.setup());

        setupCleanupHandlers();
        loadAvailableFonts();
        updateWindowTitle();

        eventBus.emit('app:initialized');
        void updateExportMenuState();
        void updateRecentMenu();

        const markdownToolbarManager = new MarkdownToolbarManager(appServices);
        appState.setMarkdownToolbarManager(markdownToolbarManager);
        markdownToolbarManager.setToggleViewModeCallback(toggleMarkdownCodeMode);
        syncToolbarWithCurrentContext();

        window.editor = getToolbarEditorInstance();
        window.markdownEditor = editorRegistry.getMarkdownEditor();

        setupToolbarEvents({ handleToolbarOnViewModeChange, handleToolbarOnFileChange });

        windowFocusHandler = createWindowFocusHandler({
            getFileTree: () => appState.getFileTree(),
            normalizePath: normalizeFsPath,
            fileService: appServices.file,
            fileSession,
            getEditor: () => editorRegistry.getMarkdownEditor(),
            getCodeEditor: () => editorRegistry.getCodeEditor(),
            getWorkflowEditor: () => editorRegistry.getWorkflowEditor(),
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
