// 过滤开发环境下 Tauri 热重载产生的无用警告
const originalWarn = console.warn;
console.warn = function(...args) {
    const message = args[0];
    if (typeof message === 'string' && message.includes('[TAURI] Couldn\'t find callback id')) {
        return;
    }
    originalWarn.apply(console, args);
};

import 'katex/dist/katex.min.css';
import { invoke } from '@tauri-apps/api/core';
import { confirm } from '@tauri-apps/plugin-dialog';
import {
    detectLanguageForPath,
    getViewModeForPath,
    isMarkdownFilePath,
    isCsvFilePath,
} from './utils/fileTypeUtils.js';
import {
    defaultEditorSettings,
    onEditorAppearanceChange,
} from './utils/editorSettings.js';
import { normalizeFsPath, normalizeSelectedPaths } from './utils/pathUtils.js';
import { registerDocumentIO } from './api/document.js';
import { createAppServices } from './services/appServices.js';
import { createFileService } from './services/fileService.js';
import { createRecentFilesService } from './services/recentFilesService.js';
import { MarkdownToolbarManager } from './components/MarkdownToolbarManager.js';
import { createFileSession } from './modules/fileSession.js';
import { createDefaultWorkspaceState, loadWorkspaceState, saveWorkspaceState } from './utils/workspaceState.js';
import { createWorkspaceController } from './modules/workspaceController.js';
import { createNavigationController } from './modules/navigationController.js';
import { createFileOperations } from './modules/fileOperations.js';
import { createFileMenuActions } from './modules/fileMenuActions.js';
import { createRecentFilesActions } from './modules/recentFilesActions.js';
import { eventBus } from './core/EventBus.js';
import { createDocumentIO } from './core/DocumentIO.js';
import { createDocumentManager } from './core/documents/DocumentManager.js';
import { createLogger } from './core/diagnostics/Logger.js';
import { createTraceRecorder } from './core/diagnostics/TraceRecorder.js';
import { createCommandManager } from './core/commands/CommandManager.js';
import { createKeybindingManager } from './core/commands/KeybindingManager.js';
import { createFeatureManager } from './core/features/FeatureManager.js';
import { createExportManager } from './core/export/ExportManager.js';
import { createWorkspaceManager } from './core/workspace/WorkspaceManager.js';
import { createViewManager } from './core/views/ViewManager.js';
import { createDocumentSessionManager } from './modules/documentSessionManager.js';
import { untitledFileManager } from './modules/untitledFileManager.js';
import { createViewController, ZOOM_DEFAULT, ZOOM_STEP } from './app/viewController.js';
import { createEditorActions } from './app/editorActions.js';
import { createLayoutControls } from './app/layoutControls.js';
import { createWorkspaceSyncController, createDocumentSnapshotSyncController } from './app/syncControllers.js';
import { AppState } from './state/AppState.js';
import { EditorRegistry } from './state/EditorRegistry.js';
import { TabHistoryManager } from './state/TabHistoryManager.js';
import { createEditorHistoryController } from './app/editorHistoryController.js';
import { createToolbarController } from './app/toolbarController.js';
import { createUntitledController } from './app/untitledController.js';
import { createWindowLifecycle } from './app/windowLifecycle.js';
import { createAppBootstrap } from './app/appBootstrap.js';
import { RendererRegistry } from './fileRenderers/registry.js';
import { createMarkdownRenderer } from './fileRenderers/handlers/markdown.js';
import { createCodeRenderer } from './fileRenderers/handlers/code.js';
import { createImageRenderer } from './fileRenderers/handlers/image.js';
import { createMediaRenderer } from './fileRenderers/handlers/media.js';
import { createSpreadsheetRenderer } from './fileRenderers/handlers/spreadsheet.js';
import { createPdfRenderer } from './fileRenderers/handlers/pdf.js';
import { createDocxRenderer } from './fileRenderers/handlers/docx.js';
import { createPptxRenderer } from './fileRenderers/handlers/pptx.js';

// ========== 状态管理实例 ==========
const appState = new AppState();
const editorRegistry = new EditorRegistry();
const rendererRegistry = new RendererRegistry();
const tabHistoryManager = new TabHistoryManager();
const traceRecorder = createTraceRecorder();
const documentLogger = createLogger('documents');
const commandLogger = createLogger('commands');
const ioLogger = createLogger('io');
const workspaceLogger = createLogger('workspace');
const featureLogger = createLogger('features');
const exportLogger = createLogger('export');
const viewLogger = createLogger('views');
const documentManager = createDocumentManager({
    appState,
    normalizePath: normalizeFsPath,
    logger: documentLogger,
    traceRecorder,
});
const commandManager = createCommandManager({
    logger: commandLogger,
    traceRecorder,
});
const keybindingManager = createKeybindingManager({
    logger: commandLogger,
});
const featureManager = createFeatureManager({
    logger: featureLogger,
    traceRecorder,
});
const exportManager = createExportManager({
    logger: exportLogger,
    traceRecorder,
});
const workspaceManager = createWorkspaceManager({
    createDefaultWorkspaceState,
    loadWorkspaceState,
    saveWorkspaceState,
    logger: workspaceLogger,
    traceRecorder,
});

function ensureFileService() {
    if (typeof globalThis !== 'undefined') {
        if (!globalThis.__MARK2_FILE_SERVICE__) {
            globalThis.__MARK2_FILE_SERVICE__ = createFileService();
        }
        return globalThis.__MARK2_FILE_SERVICE__;
    }
    return createFileService();
}

console.log('Mark2 Tauri 版本已启动');

// ========== 服务层实例 ==========
const recentFilesService = createRecentFilesService();
const fileSession = createFileSession({
    fileService: ensureFileService(),
    getViewModeForPath,
    isCsvFilePath,
});
const documentSessions = createDocumentSessionManager();
let appServices = null;

function getActiveDocumentPath() {
    return documentManager.getActivePath();
}

function setActiveDocumentPath(path, metadata = {}) {
    if (!path) {
        documentManager.clearActiveDocument();
        return null;
    }
    return documentManager.openDocument(path, {
        activate: true,
        ...metadata,
    });
}

// ========== 初始化应用状态 ==========
appState.setEditorSettings({ ...defaultEditorSettings });
appState.setContentZoom(ZOOM_DEFAULT);
appState.setRendererRegistry(rendererRegistry);
rendererRegistry.register(createMarkdownRenderer());
rendererRegistry.register(createImageRenderer());
rendererRegistry.register(createMediaRenderer());
rendererRegistry.register(createSpreadsheetRenderer());
rendererRegistry.register(createPdfRenderer());
rendererRegistry.register(createDocxRenderer());
rendererRegistry.register(createPptxRenderer());
rendererRegistry.setDefaultHandler(createCodeRenderer());

// ========== 外观变化监听 ==========
appState.setCleanupFunction('appearanceChange', onEditorAppearanceChange(({ appearance }) => {
    const codeEditor = editorRegistry.getCodeEditor();
    const markdownToolbarManager = appState.getMarkdownToolbarManager();
    codeEditor?.applyPreferences?.(appState.getEditorSettings());
    markdownToolbarManager?.setTheme?.(appearance);
}));

const workspaceSyncController = createWorkspaceSyncController({
    invoke,
    getWorkspaceContext: () => appServices?.workspace?.getContext?.(),
});
const documentSnapshotSyncController = createDocumentSnapshotSyncController({
    invoke,
    readDocumentSnapshot: () => appState.getDocumentIO()?.readDocument?.(),
});
const { scheduleWorkspaceContextSync } = workspaceSyncController;
const { scheduleDocumentSnapshotSync } = documentSnapshotSyncController;

// ========== 编辑器历史控制器（早创建，供 windowLifecycle 延迟引用）==========
const editorHistoryController = createEditorHistoryController({
    getMarkdownEditor: () => editorRegistry.getMarkdownEditor(),
    getCodeEditor: () => editorRegistry.getCodeEditor(),
    getCurrentTabId: () => getActiveDocumentPath(),
    getActiveViewMode: () => appState.getActiveViewMode(),
    tabHistoryManager,
    getEditorSettings: () => appState.getEditorSettings(),
    setEditorSettings: (s) => appState.setEditorSettings(s),
});
const {
    handleSettingsSubmit,
    handleUndoCommand,
    handleRedoCommand,
} = editorHistoryController;

// ========== 窗口生命周期（早创建，使 updateWindowTitle 在所有 controller 创建前可用）==========
const windowLifecycle = createWindowLifecycle({
    appState,
    editorRegistry,
    fileSession,
    untitledFileManager,
    getViewManager: () => viewManager,
    getTerminalPanel: () => featureManager.getFeatureApi('terminal'),
    getHandleSettingsSubmit: () => handleSettingsSubmit,
    getPersistWorkspaceState: () => persistWorkspaceState,
});
const {
    updateWindowTitle,
    loadAvailableFonts,
    openSettingsDialog,
    showAboutDialog,
    setupOpenedFilesListener,
    setupCleanupHandlers,
    setSettingsDialogCtor,
} = windowLifecycle;

// ========== Bootstrap 占位 + 胶水函数包装（function 声明自动提升）==========
let bootstrap;
// 这些函数实现在 appBootstrap.js，main.js 只保留一行转发
function persistWorkspaceState(...args) { return bootstrap.persistWorkspaceState(...args); }
function clearActiveFileView() { return bootstrap.clearActiveFileView(); }
function saveCurrentEditorContentToCache() { return bootstrap.saveCurrentEditorContentToCache(); }
async function updateExportMenuState() { return bootstrap.updateExportMenuState(); }
function handleTabReorder(p) { return bootstrap.handleTabReorder(p); }
function handleSidebarStateChange(s) { return bootstrap.handleSidebarStateChange(s); }
async function handleRunFile(f) { return bootstrap.handleRunFile(f); }

// ========== 视图控制器 ==========
const viewController = createViewController({
    getCurrentFile: () => getActiveDocumentPath(),
    getEditor: () => editorRegistry.getMarkdownEditor(),
    getCodeEditor: () => editorRegistry.getCodeEditor(),
    getImageViewer: () => editorRegistry.getImageViewer(),
    getMediaViewer: () => editorRegistry.getMediaViewer(),
    getSpreadsheetViewer: () => editorRegistry.getSpreadsheetViewer(),
    getPdfViewer: () => editorRegistry.getPdfViewer(),
    getUnsupportedViewer: () => editorRegistry.getUnsupportedViewer(),
    getMarkdownPane: () => appState.getPaneElement('markdown'),
    getCodePane: () => appState.getPaneElement('code'),
    getImagePane: () => appState.getPaneElement('image'),
    getMediaPane: () => appState.getPaneElement('media'),
    getSpreadsheetPane: () => appState.getPaneElement('spreadsheet'),
    getPdfPane: () => appState.getPaneElement('pdf'),
    getUnsupportedPane: () => appState.getPaneElement('unsupported'),
    getViewContainer: () => appState.getPaneElement('viewContainer'),
    getStatusBarController: () => appState.getStatusBarController(),
    setActiveViewModeState: (mode) => { appState.setActiveViewMode(mode); },
    getActiveViewModeState: () => appState.getActiveViewMode(),
    setContentZoomState: (value) => { appState.setContentZoom(value); },
    getContentZoomState: () => appState.getContentZoom(),
    setPdfZoomStateState: (state) => { appState.setPdfZoomState(state); },
    getPdfZoomState: () => appState.getPdfZoomState(),
    updateExportMenuState: () => { void updateExportMenuState(); },
    onViewModeChange: (nextMode) => {
        void updateExportMenuState();
        handleToolbarOnViewModeChange(nextMode);
        if (nextMode !== 'markdown' && nextMode !== 'split') {
            featureManager.getFeatureApi('card-export')?.hideSidebar?.();
        }
    },
});
const {
    rememberScrollPosition,
    restoreScrollPosition,
    rememberMarkdownScrollPosition,
    restoreMarkdownScrollPosition,
    setActiveViewMode,
    activateMarkdownView,
    activateCodeView,
    activateImageView,
    activateMediaView,
    activateSpreadsheetView,
    activatePdfView,
    activateUnsupportedView,
    updateZoomDisplayForActiveView,
    handleZoomControl,
    setContentZoom,
    adjustContentZoom,
} = viewController;

const viewManager = createViewManager({
    getViewModeForPath,
    getRendererRegistry: () => appState.getRendererRegistry(),
    viewController,
    logger: viewLogger,
    traceRecorder,
});

// ========== 编辑器动作 ==========
const editorActions = createEditorActions({
    getActiveViewMode: () => appState.getActiveViewMode(),
    setActiveViewMode: (mode) => { appState.setActiveViewMode(mode); },
    getEditor: () => editorRegistry.getMarkdownEditor(),
    getCodeEditor: () => editorRegistry.getCodeEditor(),
    getMarkdownCodeMode: () => appState.getMarkdownCodeMode(),
    getSvgCodeMode: () => appState.getSvgCodeMode(),
    getCsvTableMode: () => appState.getCsvTableMode(),
    getCurrentFile: () => getActiveDocumentPath(),
    setHasUnsavedChanges: (value) => { appState.setHasUnsavedChanges(value); },
    saveCurrentEditorContentToCache: () => { saveCurrentEditorContentToCache(); },
    persistWorkspaceState,
    updateWindowTitle,
    fileSession,
    getImageViewer: () => editorRegistry.getImageViewer(),
    getSpreadsheetViewer: () => editorRegistry.getSpreadsheetViewer(),
    getFileService: () => appServices?.file,
    getLoadFile: () => ({ openPathsFromSelection, loadFile }),
});
const {
    insertTextIntoActiveEditor,
    toggleMarkdownCodeMode,
    toggleSvgCodeMode,
    toggleCsvTableMode,
    requestActiveEditorContext,
} = editorActions;

// ========== 布局控制 ==========
const layoutControls = createLayoutControls({
    getStatusBarController: () => appState.getStatusBarController(),
    getCodeEditor: () => editorRegistry.getCodeEditor(),
});
const {
    setSidebarVisibility,
    toggleSidebarVisibility,
    toggleStatusBarVisibility,
} = layoutControls;

// ========== 工具栏控制器 ==========
const toolbarController = createToolbarController({
    getMarkdownEditor: () => editorRegistry.getMarkdownEditor(),
    getCodeEditor: () => editorRegistry.getCodeEditor(),
    getCurrentFile: () => getActiveDocumentPath(),
    getActiveViewMode: () => appState.getActiveViewMode(),
    executeCommand: (commandId, payload, context) => commandManager.executeCommand(commandId, payload, context),
    getMarkdownToolbarManager: () => appState.getMarkdownToolbarManager(),
    setMarkdownToolbarManager: (m) => appState.setMarkdownToolbarManager(m),
    getCardExportSidebar: () => featureManager.getFeatureApi('card-export'),
    getAppServices: () => appServices,
    getEditorRegistry: () => editorRegistry,
    getToggleMarkdownCodeMode: () => toggleMarkdownCodeMode,
    isMarkdownFilePath,
    MarkdownToolbarManager,
});
const {
    getToolbarEditorInstance,
    toggleMarkdownToolbar,
    showCardExportSidebar,
    handleToolbarOnViewModeChange,
    handleToolbarOnFileChange,
    handleCardSidebarOnFileChange,
    syncToolbarWithCurrentContext,
} = toolbarController;

// ========== DocumentIO + AppServices ==========
const documentIO = createDocumentIO({
    eventBus,
    getCurrentFile: () => getActiveDocumentPath(),
    getEditor: () => editorRegistry.getMarkdownEditor(),
    getCodeEditor: () => editorRegistry.getCodeEditor(),
    getActiveViewMode: () => appState.getActiveViewMode(),
    setHasUnsavedChanges: (value) => { appState.setHasUnsavedChanges(value); },
    saveCurrentEditorContentToCache,
    fileSession,
    updateWindowTitle,
    persistWorkspaceState,
});
appState.setDocumentIO(documentIO);
registerDocumentIO(documentIO);
scheduleDocumentSnapshotSync();
appServices = createAppServices({
    fileService: ensureFileService(),
    getCurrentFile: () => getActiveDocumentPath(),
});
scheduleWorkspaceContextSync();

// ========== 工作区控制器 ==========
const workspaceController = createWorkspaceController({
    getCurrentFile: () => getActiveDocumentPath(),
    getFileTree: () => appState.getFileTree(),
    getTabManager: () => appState.getTabManager(),
    fileService: appServices.file,
    workspaceManager,
    untitledFileManager,
});

// ========== Untitled 控制器（在 fileOperations 前创建，避免 TDZ）==========
const untitledController = createUntitledController({
    getTabManager: () => appState.getTabManager(),
    getCurrentFile: () => getActiveDocumentPath(),
    setCurrentFile: (v, meta) => setActiveDocumentPath(v, meta),
    documentManager,
    setHasUnsavedChanges: (v) => appState.setHasUnsavedChanges(v),
    getMarkdownEditor: () => editorRegistry.getMarkdownEditor(),
    getCodeEditor: () => editorRegistry.getCodeEditor(),
    getFileTree: () => appState.getFileTree(),
    getFileService: () => appServices.file,
    untitledFileManager,
    documentSessions,
    fileSession,
    normalizeFsPath,
    activateMarkdownView,
    getUpdateWindowTitle: () => updateWindowTitle,
    getSaveCurrentEditorContentToCache: () => saveCurrentEditorContentToCache,
    scheduleWorkspaceContextSync,
    scheduleDocumentSnapshotSync,
});
const {
    handleCreateUntitled,
    handleImportAsUntitled,
    saveUntitledFile,
} = untitledController;

// ========== 文件操作 ==========
const {
    openPathsFromSelection,
    openFileOrFolder,
    openFileOnly,
    openFolderOnly,
    saveCurrentFile,
    saveFile,
    loadFile,
} = createFileOperations({
    logger: ioLogger,
    getFileTree: () => appState.getFileTree(),
    getEditor: () => editorRegistry.getMarkdownEditor(),
    getCodeEditor: () => editorRegistry.getCodeEditor(),
    getImageViewer: () => editorRegistry.getImageViewer(),
    getMediaViewer: () => editorRegistry.getMediaViewer(),
    getSpreadsheetViewer: () => editorRegistry.getSpreadsheetViewer(),
    getPdfViewer: () => editorRegistry.getPdfViewer(),
    getUnsupportedViewer: () => editorRegistry.getUnsupportedViewer(),
    getMarkdownCodeMode: () => appState.getMarkdownCodeMode(),
    getCurrentFile: () => getActiveDocumentPath(),
    setCurrentFile: (value, metadata = {}) => {
        setActiveDocumentPath(value, metadata);
        scheduleWorkspaceContextSync();
        scheduleDocumentSnapshotSync();
        void updateExportMenuState();
        handleToolbarOnFileChange(value);
        handleCardSidebarOnFileChange(value);
    },
    documentManager,
    getActiveViewMode: () => appState.getActiveViewMode(),
    setHasUnsavedChanges: (value) => { appState.setHasUnsavedChanges(value); },
    fileSession,
    documentSessions,
    detectLanguageForPath,
    viewManager,
    normalizeFsPath,
    normalizeSelectedPaths,
    fileService: appServices.file,
    persistWorkspaceState,
    updateWindowTitle,
    saveCurrentEditorContentToCache,
    rememberMarkdownScrollPosition,
    restoreMarkdownScrollPosition,
    restoreScrollPosition,
    recentFilesService,
    updateRecentMenuFn: () => recentFilesActions?.updateRecentMenu?.(),
    untitledFileManager,
    saveUntitledFile,
    importAsUntitled: handleImportAsUntitled,
    getStatusBarController: () => appState.getStatusBarController(),
});

// ========== 导航控制器 ==========
const {
    handleFileSelect,
    handleOpenFilesChange,
    handleTabSelect,
    handleTabClose,
    checkFileHasUnsavedChanges,
    closeActiveTab,
    setupLinkNavigationListener,
    activateTabTransition,
} = createNavigationController({
    logger: workspaceLogger,
    getFileTree: () => appState.getFileTree(),
    getTabManager: () => appState.getTabManager(),
    getCurrentFile: () => getActiveDocumentPath(),
    documentSessions,
    saveCurrentEditorContentToCache,
    documentManager,
    clearActiveFileView,
    loadFile,
    fileSession,
    persistWorkspaceState,
    saveFile,
    getActiveViewMode: () => appState.getActiveViewMode(),
    getEditor: () => editorRegistry.getMarkdownEditor(),
    getCodeEditor: () => editorRegistry.getCodeEditor(),
    confirm,
    untitledFileManager,
    saveUntitledFile,
    eventBus,
    rememberScrollPosition,
});

// ========== 文件菜单操作 ==========
const {
    createNewFile: handleCreateNewFile,
    deleteActiveFile: handleDeleteActiveFile,
    moveActiveFile: handleMoveActiveFile,
    renameActiveFile: handleRenameActiveFile,
    handleTabRenameConfirm,
    handleTabRenameCancel,
    applyPathChange,
} = createFileMenuActions({
    confirm,
    normalizeFsPath,
    normalizeSelectedPaths,
    checkFileHasUnsavedChanges,
    fileService: appServices.file,
    getCurrentFile: () => getActiveDocumentPath(),
    setCurrentFile: (value, metadata = {}) => {
        setActiveDocumentPath(value, metadata);
        scheduleWorkspaceContextSync();
        scheduleDocumentSnapshotSync();
        void updateExportMenuState();
        handleToolbarOnFileChange(value);
    },
    getHasUnsavedChanges: () => appState.getHasUnsavedChanges(),
    setHasUnsavedChanges: (value) => { appState.setHasUnsavedChanges(value); },
    clearActiveFileView,
    updateWindowTitle,
    persistWorkspaceState,
    fileSession,
    documentManager,
    getFileTree: () => appState.getFileTree(),
    getTabManager: () => appState.getTabManager(),
    getEditor: () => editorRegistry.getMarkdownEditor(),
    getCodeEditor: () => editorRegistry.getCodeEditor(),
    getImageViewer: () => editorRegistry.getImageViewer(),
    getUnsupportedViewer: () => editorRegistry.getUnsupportedViewer(),
    getStatusBarController: () => appState.getStatusBarController(),
    documentSessions,
    loadFile,
    viewManager,
    getActiveViewMode: () => appState.getActiveViewMode(),
    activateTabTransition,
});

// ========== 最近文件 ==========
const recentFilesActions = createRecentFilesActions({
    recentFilesService,
    fileService: appServices.file,
    normalizeFsPath,
    getFileTree: () => appState.getFileTree(),
    workspaceController,
});
const {
    updateRecentMenu,
    handleRecentItemClick,
    clearRecent,
} = recentFilesActions;

// ========== 组装 Bootstrap，启动应用 ==========
bootstrap = createAppBootstrap({
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
    scheduleWorkspaceContextSync,
    scheduleDocumentSnapshotSync,
    updateWindowTitle,
    loadAvailableFonts,
    openSettingsDialog,
    showAboutDialog,
    setupOpenedFilesListener,
    setupCleanupHandlers,
    setSettingsDialogCtor,
    handleToolbarOnFileChange,
    handleCardSidebarOnFileChange,
    handleToolbarOnViewModeChange,
    syncToolbarWithCurrentContext,
    getToolbarEditorInstance,
    toggleMarkdownToolbar,
    showCardExportSidebar,
    viewManager,
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
    toggleMarkdownCodeMode,
    toggleSvgCodeMode,
    toggleCsvTableMode,
    toggleSidebarVisibility,
    toggleStatusBarVisibility,
    handleFileSelect,
    handleOpenFilesChange,
    handleTabSelect,
    handleTabClose,
    checkFileHasUnsavedChanges,
    closeActiveTab,
    setupLinkNavigationListener,
    handleCreateNewFile,
    handleDeleteActiveFile,
    handleMoveActiveFile,
    handleRenameActiveFile,
    handleTabRenameConfirm,
    handleTabRenameCancel,
    applyPathChange,
    updateRecentMenu,
    handleRecentItemClick,
    clearRecent,
    handleSettingsSubmit,
    handleUndoCommand,
    handleRedoCommand,
    openPathsFromSelection,
    openFileOrFolder,
    openFileOnly,
    openFolderOnly,
    saveCurrentFile,
    loadFile,
    handleCreateUntitled,
    saveUntitledFile,
    confirm,
    eventBus,
});

document.addEventListener('DOMContentLoaded', () => {
    void bootstrap.initializeApplication();
});
