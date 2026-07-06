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
import { setupOpenSharedDocumentListener } from '../modules/share/openSharedDocument.js';
import { setupAccountTitlebarIcon } from '../modules/cloud-account/accountPopover.js';
import { CloudFolder } from '../components/CloudFolder.js';
import { features as appFeatures } from '../config/features.js';
import { createFileWatcherController } from '../modules/fileWatchers.js';
import { loadEditorSettings, applyEditorSettings, saveEditorSettings } from '../utils/editorSettings.js';
import { isMarkdownFilePath, detectLanguageForPath, isCsvFilePath } from '../utils/fileTypeUtils.js';
import { normalizeFsPath, dirname, getPathIdentityKey } from '../utils/pathUtils.js';
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
import { setupSecretCloudSwitch } from './secretCloudSwitch.js';
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
    toggleEmbedCodeMode,
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
    handleImportAsUntitled,
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
                getWorkspaceCwd: () => {
                    // rootPaths 是 Set，必须先转数组；优先用包含当前 tab 文件的最近 root，
                    // 否则用文件所在目录，再退到第一个 root，避免 cwd 落到进程默认目录
                    const fileTree = appState.getFileTree();
                    if (!fileTree) return null;
                    const rootPaths = typeof fileTree.getRootPaths === 'function'
                        ? fileTree.getRootPaths()
                        : Array.from(fileTree.rootPaths || []);
                    const currentFile = appState.getCurrentFile?.();
                    if (currentFile) {
                        let best = null;
                        for (const root of rootPaths) {
                            if (!root) continue;
                            if (currentFile === root
                                || currentFile.startsWith(`${root}/`)
                                || currentFile.startsWith(`${root}\\`)) {
                                if (!best || root.length > best.length) best = root;
                            }
                        }
                        if (best) return best;
                        return dirname(currentFile) || null;
                    }
                    return rootPaths[0] || null;
                },
            },
        }));
        appState.setCleanupFunction('featureManager', () => {
            void featureManager?.unmountAll?.();
        });
        await featureManager?.mountAll?.();
        handleCardSidebarOnFileChange(appState.getCurrentFile());

        const markdownCodeMode = createMarkdownCodeMode({
            detectLanguageForPath,
            isMarkdownFilePath,
            view: viewManager.createViewProtocol(),
            saveCurrentEditorContentToCache,
            getFileContent: (filePath, options) => documentRegistry.getFileContent(filePath, options),
        });
        appState.setMarkdownCodeMode(markdownCodeMode);

        const svgCodeMode = createSvgCodeMode({ view: viewManager.createViewProtocol() });
        appState.setSvgCodeMode(svgCodeMode);

        const csvTableMode = createCsvTableMode({
            isCsvFilePath,
            view: viewManager.createViewProtocol(),
            detectLanguageForPath,
            saveCurrentEditorContentToCache,
            getFileContent: (filePath, options) => documentRegistry.getFileContent(filePath, options),
        });
        appState.setCsvTableMode(csvTableMode);

        const fileTree = setupFileTree({
            FileTreeCtor: coreModules.FileTree,
            appState,
            documentManager,
            executeCommand: (commandId, payload, context) => commandManager.executeCommand(commandId, payload, context),
            handleFileSelect,
            handleOpenFilesChange,
            handleSidebarStateChange,
            applyPathChange,
            handleTabClose,
            normalizeFsPath,
            documentSessions,
            onOpenFile: openFileOnly,
            onOpenFolder: openFolderOnly,
        });

        setupTabManager({
            TabManagerCtor: coreModules.TabManager,
            appState,
            documentManager,
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
        // 隐藏暗号(非输入态依次按 j j l l)切换 mark2 Cloud 开关 —— 必须无条件注册,关闭时也能用它开启
        appState.setCleanupFunction('secretCloudSwitch', setupSecretCloudSwitch());
        if (appFeatures.cloudAccount) {
            setupAccountTitlebarIcon();

            const cloudFolderEl = document.getElementById('cloudFolder');
            if (cloudFolderEl) {
                const cloudFolder = new CloudFolder(cloudFolderEl, {
                    openAsUntitled: ({ content, filename, cloudFileId }) =>
                        handleImportAsUntitled(content, filename, null, { cloudBacked: true, cloudFileId }),
                    getCurrentFile: () => appState.getCurrentFile?.() ?? null,
                    onCurrentFileChange: (listener) => appState.onCurrentFileChange?.(listener),
                    getCloudFileId: (path) => untitledFileManager.getCloudFileId?.(path) ?? null,
                    clearLocalSelection: () => appState.getFileTree()?.clearSelection?.(),
                    // 已打开同源 tab 时聚焦它,返回是否命中 → 避免重复点叠开多个 tab
                    focusDocumentIfOpen: (path) => {
                        const tm = appState.getTabManager();
                        const tabs = tm?.getAllTabs?.() || [];
                        // 宽松匹配:untitled 路径可能被规范化,先精确再按 identity key 比
                        const key = getPathIdentityKey(normalizeFsPath(path));
                        const tab = tabs.find((t) => t && (
                            t.path === path ||
                            getPathIdentityKey(normalizeFsPath(t.path)) === key
                        ));
                        if (!tab) return false;
                        void activateTabTransition(tab, { autoFocus: true });
                        return true;
                    },
                    // 重启后内存映射丢失时,靠持久化的 cloudFileId 反查已恢复的 untitled tab
                    findOpenPathByCloudId: (fileId) => {
                        const tm = appState.getTabManager();
                        const tabs = tm?.getAllTabs?.() || [];
                        for (const tab of tabs) {
                            if (tab?.path && untitledFileManager.getCloudFileId?.(tab.path) === fileId) {
                                return tab.path;
                            }
                        }
                        return null;
                    },
                    writeTextFile: (path, content) => appServices.file.writeText(path, content),
                    readLocalText: (path) => appServices.file.readText(path),
                    pickUploadFiles: async () => {
                        const { open } = await import('@tauri-apps/plugin-dialog');
                        const sel = await open({ multiple: true });
                        return Array.isArray(sel) ? sel : (sel ? [sel] : []);
                    },
                    pickSaveTarget: async (defaultName) => {
                        const { save } = await import('@tauri-apps/plugin-dialog');
                        return await save({ defaultPath: defaultName });
                    },
                    confirm,
                });
                appState.setCleanupFunction('cloudFolder', () => cloudFolder.destroy());
            }
        }

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
                toggleEmbedCodeMode,
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
        // mark2://open?share=<uuid>  → 从 cloud 取分享内容,开成本地 untitled tab
        await setupOpenSharedDocumentListener({
            openAsUntitled: ({ content, filename }) =>
                handleImportAsUntitled(content, filename, null, { cloudBacked: true }),
        });
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
            getCurrentFilePath: () => appState.getCurrentFile(),
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
    };
}
