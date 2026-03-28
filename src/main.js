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
import { createWorkflowRenderer } from './fileRenderers/handlers/workflow.js';
import { createDocxRenderer } from './fileRenderers/handlers/docx.js';
import { createPptxRenderer } from './fileRenderers/handlers/pptx.js';

// ========== 状态管理实例 ==========
const appState = new AppState();
const editorRegistry = new EditorRegistry();
const rendererRegistry = new RendererRegistry();
const tabHistoryManager = new TabHistoryManager();

// 由 initializeApplication 赋值，通过 setter/getter 传递给 appBootstrap
let cardExportSidebar = null;
let terminalPanel = null;

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

// ========== 初始化应用状态 ==========
appState.setEditorSettings({ ...defaultEditorSettings });
appState.setContentZoom(ZOOM_DEFAULT);
appState.setRendererRegistry(rendererRegistry);
rendererRegistry.register(createMarkdownRenderer());
rendererRegistry.register(createImageRenderer());
rendererRegistry.register(createMediaRenderer());
rendererRegistry.register(createSpreadsheetRenderer());
rendererRegistry.register(createPdfRenderer());
rendererRegistry.register(createWorkflowRenderer());
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
    getCurrentTabId: () => appState.getCurrentFile(),
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
    confirm,
    getViewModeForPath,
    getTerminalPanel: () => terminalPanel,
    getSaveUntitledFile: () => saveUntitledFile,
    getHandleSettingsSubmit: () => handleSettingsSubmit,
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
    getCurrentFile: () => appState.getCurrentFile(),
    getEditor: () => editorRegistry.getMarkdownEditor(),
    getCodeEditor: () => editorRegistry.getCodeEditor(),
    getImageViewer: () => editorRegistry.getImageViewer(),
    getMediaViewer: () => editorRegistry.getMediaViewer(),
    getSpreadsheetViewer: () => editorRegistry.getSpreadsheetViewer(),
    getPdfViewer: () => editorRegistry.getPdfViewer(),
    getUnsupportedViewer: () => editorRegistry.getUnsupportedViewer(),
    getWorkflowEditor: () => editorRegistry.get('workflow'),
    getMarkdownPane: () => appState.getPaneElement('markdown'),
    getCodePane: () => appState.getPaneElement('code'),
    getImagePane: () => appState.getPaneElement('image'),
    getMediaPane: () => appState.getPaneElement('media'),
    getSpreadsheetPane: () => appState.getPaneElement('spreadsheet'),
    getPdfPane: () => appState.getPaneElement('pdf'),
    getWorkflowPane: () => appState.getPaneElement('workflow'),
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
            cardExportSidebar?.hideSidebar?.();
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
    activateWorkflowView,
    activateUnsupportedView,
    updateZoomDisplayForActiveView,
    handleZoomControl,
    setContentZoom,
    adjustContentZoom,
} = viewController;

// ========== 编辑器动作 ==========
const editorActions = createEditorActions({
    getActiveViewMode: () => appState.getActiveViewMode(),
    setActiveViewMode: (mode) => { appState.setActiveViewMode(mode); },
    getEditor: () => editorRegistry.getMarkdownEditor(),
    getCodeEditor: () => editorRegistry.getCodeEditor(),
    getMarkdownCodeMode: () => appState.getMarkdownCodeMode(),
    getSvgCodeMode: () => appState.getSvgCodeMode(),
    getCsvTableMode: () => appState.getCsvTableMode(),
    getWorkflowCodeMode: () => appState.getWorkflowCodeMode(),
    getCurrentFile: () => appState.getCurrentFile(),
    setHasUnsavedChanges: (value) => { appState.setHasUnsavedChanges(value); },
    saveCurrentEditorContentToCache: () => { saveCurrentEditorContentToCache(); },
    persistWorkspaceState,
    updateWindowTitle,
    fileSession,
    getImageViewer: () => editorRegistry.getImageViewer(),
    getSpreadsheetViewer: () => editorRegistry.getSpreadsheetViewer(),
    getWorkflowEditor: () => editorRegistry.getWorkflowEditor(),
    getFileService: () => appServices?.file,
    getLoadFile: () => ({ openPathsFromSelection, loadFile }),
});
const {
    insertTextIntoActiveEditor,
    toggleMarkdownCodeMode,
    toggleSvgCodeMode,
    toggleCsvTableMode,
    toggleWorkflowCodeMode,
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
    getCurrentFile: () => appState.getCurrentFile(),
    getActiveViewMode: () => appState.getActiveViewMode(),
    getMarkdownToolbarManager: () => appState.getMarkdownToolbarManager(),
    setMarkdownToolbarManager: (m) => appState.setMarkdownToolbarManager(m),
    getCardExportSidebar: () => cardExportSidebar,
    getAppServices: () => appServices,
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
    getCurrentFile: () => appState.getCurrentFile(),
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
    getCurrentFile: () => appState.getCurrentFile(),
});
scheduleWorkspaceContextSync();

// ========== 工作区控制器 ==========
const workspaceController = createWorkspaceController({
    getCurrentFile: () => appState.getCurrentFile(),
    getFileTree: () => appState.getFileTree(),
    getTabManager: () => appState.getTabManager(),
    fileService: appServices.file,
    createDefaultWorkspaceState,
    loadWorkspaceState,
    saveWorkspaceState,
});

// ========== Untitled 控制器（在 fileOperations 前创建，避免 TDZ）==========
const untitledController = createUntitledController({
    getTabManager: () => appState.getTabManager(),
    getCurrentFile: () => appState.getCurrentFile(),
    setCurrentFile: (v) => appState.setCurrentFile(v),
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
    getFileTree: () => appState.getFileTree(),
    getEditor: () => editorRegistry.getMarkdownEditor(),
    getCodeEditor: () => editorRegistry.getCodeEditor(),
    getImageViewer: () => editorRegistry.getImageViewer(),
    getMediaViewer: () => editorRegistry.getMediaViewer(),
    getSpreadsheetViewer: () => editorRegistry.getSpreadsheetViewer(),
    getPdfViewer: () => editorRegistry.getPdfViewer(),
    getUnsupportedViewer: () => editorRegistry.getUnsupportedViewer(),
    getWorkflowEditor: () => editorRegistry.get('workflow'),
    getMarkdownCodeMode: () => appState.getMarkdownCodeMode(),
    getCurrentFile: () => appState.getCurrentFile(),
    setCurrentFile: (value) => {
        appState.setCurrentFile(value);
        scheduleWorkspaceContextSync();
        scheduleDocumentSnapshotSync();
        void updateExportMenuState();
        handleToolbarOnFileChange(value);
        handleCardSidebarOnFileChange(value);
    },
    getActiveViewMode: () => appState.getActiveViewMode(),
    setHasUnsavedChanges: (value) => { appState.setHasUnsavedChanges(value); },
    fileSession,
    documentSessions,
    detectLanguageForPath,
    getViewModeForPath,
    normalizeFsPath,
    normalizeSelectedPaths,
    fileService: appServices.file,
    persistWorkspaceState,
    updateWindowTitle,
    saveCurrentEditorContentToCache,
    rememberMarkdownScrollPosition,
    restoreMarkdownScrollPosition,
    restoreScrollPosition,
    activateMarkdownView,
    activateCodeView,
    activateImageView,
    activateMediaView,
    activateSpreadsheetView,
    activatePdfView,
    activateWorkflowView,
    activateUnsupportedView,
    recentFilesService,
    updateRecentMenuFn: () => recentFilesActions?.updateRecentMenu?.(),
    untitledFileManager,
    saveUntitledFile,
    importAsUntitled: handleImportAsUntitled,
    getRendererRegistry: () => appState.getRendererRegistry(),
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
} = createNavigationController({
    getFileTree: () => appState.getFileTree(),
    getTabManager: () => appState.getTabManager(),
    getCurrentFile: () => appState.getCurrentFile(),
    documentSessions,
    saveCurrentEditorContentToCache,
    clearActiveFileView,
    loadFile,
    fileSession,
    persistWorkspaceState,
    saveFile,
    getActiveViewMode: () => appState.getActiveViewMode(),
    getEditor: () => editorRegistry.getMarkdownEditor(),
    getCodeEditor: () => editorRegistry.getCodeEditor(),
    getWorkflowEditor: () => editorRegistry.getWorkflowEditor(),
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
    getCurrentFile: () => appState.getCurrentFile(),
    setCurrentFile: (value) => {
        appState.setCurrentFile(value);
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
    getFileTree: () => appState.getFileTree(),
    getTabManager: () => appState.getTabManager(),
    getEditor: () => editorRegistry.getMarkdownEditor(),
    getCodeEditor: () => editorRegistry.getCodeEditor(),
    getImageViewer: () => editorRegistry.getImageViewer(),
    getUnsupportedViewer: () => editorRegistry.getUnsupportedViewer(),
    getStatusBarController: () => appState.getStatusBarController(),
    documentSessions,
    loadFile,
    getViewModeForPath,
    getActiveViewMode: () => appState.getActiveViewMode(),
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
    editorRegistry,
    tabHistoryManager,
    documentSessions,
    fileSession,
    untitledFileManager,
    appServices,
    workspaceController,
    scheduleWorkspaceContextSync,
    scheduleDocumentSnapshotSync,
    setCardExportSidebar: (v) => { cardExportSidebar = v; },
    getCardExportSidebar: () => cardExportSidebar,
    setTerminalPanel: (v) => { terminalPanel = v; },
    getTerminalPanel: () => terminalPanel,
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
    toggleMarkdownCodeMode,
    toggleSvgCodeMode,
    toggleCsvTableMode,
    toggleWorkflowCodeMode,
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
