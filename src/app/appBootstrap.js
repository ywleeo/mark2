/**
 * 应用引导模块。
 * 包含应用初始化主流程和相关胶水函数。
 */

import { MarkdownToolbarManager } from '../components/markdown-toolbar/MarkdownToolbarManager.js';
import { createMarkdownCodeMode } from '../modules/markdownCodeMode.js';
import { createSvgCodeMode } from '../modules/svgCodeMode.js';
import { createCsvTableMode } from '../modules/csvTableMode.js';
import { createFileDropController } from '../modules/fileDropController.js';
import { createWindowFocusHandler } from '../modules/windowFocusHandler.js';
import { setupAutoUpdater } from '../modules/autoUpdater.js';
// Cloud provider plugins：每个 plugin 在自己的 import 副作用里自注册到 cloudProviderRegistry
import '../modules/cloud-account/plugin.js';
import { bootstrapCloudPlugins } from '../modules/ai-assistant/cloudProviderRegistry.js';
import { createFileWatcherController } from '../modules/fileWatchers.js';
import { loadEditorSettings, applyEditorSettings, saveEditorSettings } from '../utils/editorSettings.js';
import { isMarkdownFilePath, detectLanguageForPath, isCsvFilePath } from '../utils/fileTypeUtils.js';
import { normalizeFsPath } from '../utils/pathUtils.js';
import { setupSidebarResizer } from '../utils/sidebarResizer.js';
import { registerMenuListeners } from '../modules/menuListeners.js';
import { registerCoreCommands, registerDefaultKeybindings, registerWindowsKeybindings } from './commandSetup.js';
import { restoreKeybindingsFromFileIfNeeded } from '../utils/keybindingsStorage.js';
import { createCommandHandlers } from './commandHandlers.js';
import { createBootstrapHelpers } from './bootstrapHelpers.js';
import { isWindows } from '../utils/platform.js';
import { registerCoreFeatures } from './featureSetup.js';
import { registerCoreExports } from './exportSetup.js';
import { loadAndRegisterModules } from './moduleLoader.js';
import { setupViewPanes } from './viewSetup.js';
import { createEditorCallbacks, setupEditors } from './editorSetup.js';
import { setupStatusBar, setupFileTree, setupTabManager } from './componentSetup.js';
import { setupToolbarEvents } from './eventSetup.js';
import { setupTitlebarControls, setupThemeToggle, toggleAppTheme } from './windowControls.js';
import { AppMenu } from '../components/AppMenu.js';
import { VaultPanel } from '../components/VaultPanel.js';
import { createTabStateTrimmer, registerIdleCleanup, startIdleGC } from '../utils/idleGC.js';
import { EVENT_IDS } from '../core/eventIds.js';

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
    documentSessions,
    documentRegistry,
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
    reopenLastClosedTab,
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
    // fileOperations 导出
    openPathsFromSelection,
    openFileOrFolder,
    openFileOnly,
    openFolderOnly,
    saveCurrentFile,
    saveCurrentFileAs,
    loadFile,
    // untitledController 导出
    handleCreateUntitled,
    saveUntitledFile,
    // 其他
    confirm,
    eventBus,
}) {
    const {
        updateExportMenuState,
        clearActiveFileView,
        persistWorkspaceState,
        handleSidebarStateChange,
        handleRunFile,
        restoreWorkspaceStateFromStorage,
        saveCurrentEditorContentToCache,
    } = createBootstrapHelpers({
        appState,
        documentManager,
        workspaceManager,
        workspaceController,
        editorRegistry,
        documentSessions,
        documentRegistry,
        untitledFileManager,
        featureManager,
        scheduleWorkspaceContextSync,
        scheduleDocumentSnapshotSync,
        updateWindowTitle,
        activateMarkdownView,
        handleToolbarOnFileChange,
        handleCardSidebarOnFileChange,
    });

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
            documentRegistry,
            documentManager,
            normalizeFsPath,
            updateWindowTitle,
            scheduleDocumentSnapshotSync,
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
        });

        eventBus.emit(EVENT_IDS.EDITOR_READY, { markdownEditor: editor, codeEditor });

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
            documentManager,
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
            documentManager,
            beforeTabSelect: async (targetTab) => {
                return await featureManager?.getFeatureApi?.('ai-sidebar')?.confirmBeforeDocumentChange?.(targetTab?.path || null) ?? true;
            },
            handleTabSelect,
            handleTabClose,
            handleTabRenameConfirm,
            handleTabRenameCancel,
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
            documentRegistry,
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

        let vaultPanel = null;
        const toggleVault = () => {
            if (!vaultPanel) vaultPanel = new VaultPanel();
            vaultPanel.toggle();
        };
        appState.setCleanupFunction('vaultPanel', () => {
            vaultPanel?.destroy?.();
            vaultPanel = null;
        });

        appState.setCleanupFunction('commandContributions', registerCoreCommands({
            commandManager,
            handlers: createCommandHandlers({
                appState,
                editorRegistry,
                exportManager,
                featureManager,
                showAboutDialog,
                openSettingsDialog,
                toggleSidebarVisibility,
                toggleStatusBarVisibility,
                toggleMarkdownCodeMode,
                toggleSvgCodeMode,
                toggleCsvTableMode,
                toggleMarkdownToolbar,
                toggleAppTheme,
                openFileOrFolder,
                openFileOnly,
                openFolderOnly,
                saveCurrentFile,
                saveCurrentFileAs,
                closeActiveTab,
                reopenLastClosedTab,
                handleCreateNewFile,
                handleCreateUntitled,
                handleDeleteActiveFile,
                handleMoveActiveFile,
                handleRenameActiveFile,
                showCardExportSidebar,
                handleRunFile,
                handleRecentItemClick,
                clearRecent,
                toggleVault,
            }),
        }));

        await restoreKeybindingsFromFileIfNeeded();
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

        eventBus.emit(EVENT_IDS.APP_INITIALIZED);
        void updateExportMenuState();
        void updateRecentMenu();
        setupAutoUpdater();
        bootstrapCloudPlugins();

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
            documentRegistry,
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
        handleSidebarStateChange,
        handleRunFile,
    };
}
