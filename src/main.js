// 过滤开发环境下 Tauri 热重载产生的无用警告
const originalWarn = console.warn;
console.warn = function(...args) {
    const message = args[0];
    if (typeof message === 'string' && message.includes('[TAURI] Couldn\'t find callback id')) {
        return; // 忽略这类警告
    }
    originalWarn.apply(console, args);
};

import { confirm } from '@tauri-apps/plugin-dialog';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { detectLanguageForPath, getViewModeForPath, isMarkdownFilePath } from './utils/fileTypeUtils.js';
import {
    applyEditorSettings,
    // 龙来撒来
    defaultEditorSettings,
    loadEditorSettings,
    normalizeEditorSettings,
    onEditorAppearanceChange,
    saveEditorSettings,
} from './utils/editorSettings.js';
import { normalizeFsPath, normalizeSelectedPaths } from './utils/pathUtils.js';
import { setupKeyboardShortcuts } from './utils/shortcuts.js';
import { setupSidebarResizer } from './utils/sidebarResizer.js';
import { exportCurrentViewToImage, exportCurrentViewToPdf } from './modules/menuExports.js';
import {
    listFonts,
} from './api/filesystem.js';
import { registerDocumentIO, getDocumentApi } from './api/document.js';
import { setExportMenuEnabled } from './api/native.js';
import { createAppServices } from './services/appServices.js';
import { createFileService } from './services/fileService.js';
import { createRecentFilesService } from './services/recentFilesService.js';
import { createMcpHandler } from './mcp/handler.js';
import { registerMenuListeners } from './modules/menuListeners.js';
import { MarkdownToolbarManager } from './components/MarkdownToolbarManager.js';
import { createFileSession } from './modules/fileSession.js';
import { createFileWatcherController } from './modules/fileWatchers.js';
import { createDefaultWorkspaceState, loadWorkspaceState, saveWorkspaceState } from './utils/workspaceState.js';
import { createStatusBarController } from './modules/statusBarController.js';
import { createMarkdownCodeMode } from './modules/markdownCodeMode.js';
import { createSvgCodeMode } from './modules/svgCodeMode.js';
import { createFileDropController } from './modules/fileDropController.js';
import { createWorkspaceController } from './modules/workspaceController.js';
import { createNavigationController } from './modules/navigationController.js';
import { createFileOperations } from './modules/fileOperations.js';
import { createFileMenuActions } from './modules/fileMenuActions.js';
import { createRecentFilesActions } from './modules/recentFilesActions.js';
import { PluginManager } from './core/PluginManager.js';
import { eventBus } from './core/EventBus.js';
import { createDocumentIO } from './core/DocumentIO.js';
import { createDocumentSessionManager } from './modules/documentSessionManager.js';
import { loadCoreModules, ensureToPng } from './app/coreModules.js';
import { createViewController, ZOOM_DEFAULT, ZOOM_STEP } from './app/viewController.js';
import { createEditorActions } from './app/editorActions.js';
import { createLayoutControls } from './app/layoutControls.js';
import { createWorkspaceSyncController, createDocumentSnapshotSyncController } from './app/syncControllers.js';
import { addClickHandler } from './utils/PointerHelper.js';

let MarkdownEditorCtor = null;
let CodeEditorCtor = null;
let ImageViewerCtor = null;
let MediaViewerCtor = null;
let SpreadsheetViewerCtor = null;
let PdfViewerCtor = null;
let FileTreeCtor = null;
let TabManagerCtor = null;
let SettingsDialogCtor = null;
let UnsupportedViewerCtor = null;

console.log('Mark2 Tauri 版本已启动');

let currentFile = null;
let editor = null;
let codeEditor = null;
let imageViewer = null;
let mediaViewer = null;
let spreadsheetViewer = null;
let pdfViewer = null;
let unsupportedViewer = null;
let fileTree = null;
let tabManager = null;
let settingsDialog = null;
let hasUnsavedChanges = false;
const fileService = createFileService();
const recentFilesService = createRecentFilesService();
const fileSession = createFileSession({
    fileService,
    getViewModeForPath,
});
const documentSessions = createDocumentSessionManager();
let editorSettings = { ...defaultEditorSettings };
let availableFontFamilies = [];
let markdownPaneElement = null;
let codeEditorPaneElement = null;
let imagePaneElement = null;
let mediaPaneElement = null;
let unsupportedPaneElement = null;
let spreadsheetPaneElement = null;
let pdfPaneElement = null;
let viewContainerElement = null;
let pdfZoomState = {
    zoomValue: 1,
    canZoomIn: true,
    canZoomOut: true,
};
let activeViewMode = 'markdown';
let keyboardShortcutCleanup = null;
let sidebarResizerCleanup = null;
let menuListenersCleanup = null;
let fileWatcherController = null;
let fileDropCleanup = null;
let statusBarController = null;
let markdownCodeMode = null;
let svgCodeMode = null;
let fileDropController = null;
let pluginManager = null;
let documentIO = null;
let exportMenuEnabledState = null;
let appServices = null;
let mcpHandler = null;
let markdownToolbarManager = null;
let contentZoom = ZOOM_DEFAULT;
let appearanceChangeCleanup = null;
appearanceChangeCleanup = onEditorAppearanceChange(({ appearance }) => {
    codeEditor?.applyPreferences?.(editorSettings);
    markdownToolbarManager?.setTheme?.(appearance);
});

const workspaceSyncController = createWorkspaceSyncController({
    invoke,
    getWorkspaceContext: () => appServices?.workspace?.getContext?.(),
});
const documentSnapshotSyncController = createDocumentSnapshotSyncController({
    invoke,
    readDocumentSnapshot: () => documentIO?.readDocument?.(),
});
const { scheduleWorkspaceContextSync } = workspaceSyncController;
const { scheduleDocumentSnapshotSync } = documentSnapshotSyncController;

async function updateExportMenuState() {
    const hasMarkdownFile = typeof currentFile === 'string' && isMarkdownFilePath(currentFile);
    const shouldEnable = activeViewMode === 'markdown' && hasMarkdownFile;

    if (exportMenuEnabledState === shouldEnable) {
        return;
    }

    exportMenuEnabledState = shouldEnable;

    try {
        await setExportMenuEnabled(shouldEnable);
    } catch (error) {
        console.warn('更新导出菜单状态失败:', error);
    }
}

function requireElementById(id, errorMessage) {
    const element = document.getElementById(id);
    if (!element) {
        throw new Error(errorMessage || `未找到元素 id=${id}`);
    }
    return element;
}

function requireElementWithin(container, selector, errorMessage) {
    const element = container.querySelector(selector);
    if (!element) {
        throw new Error(errorMessage || `未在容器中找到元素 ${selector}`);
    }
    return element;
}

const viewController = createViewController({
    getCurrentFile: () => currentFile,
    getEditor: () => editor,
    getCodeEditor: () => codeEditor,
    getImageViewer: () => imageViewer,
    getMediaViewer: () => mediaViewer,
    getSpreadsheetViewer: () => spreadsheetViewer,
    getPdfViewer: () => pdfViewer,
    getUnsupportedViewer: () => unsupportedViewer,
    getMarkdownPane: () => markdownPaneElement,
    getCodePane: () => codeEditorPaneElement,
    getImagePane: () => imagePaneElement,
    getMediaPane: () => mediaPaneElement,
    getSpreadsheetPane: () => spreadsheetPaneElement,
    getPdfPane: () => pdfPaneElement,
    getUnsupportedPane: () => unsupportedPaneElement,
    getViewContainer: () => viewContainerElement,
    getStatusBarController: () => statusBarController,
    setActiveViewModeState: (mode) => {
        activeViewMode = mode;
    },
    getActiveViewModeState: () => activeViewMode,
    setContentZoomState: (value) => {
        contentZoom = value;
    },
    getContentZoomState: () => contentZoom,
    setPdfZoomStateState: (state) => {
        pdfZoomState = state;
    },
    getPdfZoomState: () => pdfZoomState,
    updateExportMenuState: () => {
        void updateExportMenuState();
    },
    onViewModeChange: () => {
        void updateExportMenuState();
    },
});

const {
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

const editorActions = createEditorActions({
    getActiveViewMode: () => activeViewMode,
    setActiveViewMode: (mode) => {
        activeViewMode = mode;
    },
    getEditor: () => editor,
    getCodeEditor: () => codeEditor,
    getMarkdownCodeMode: () => markdownCodeMode,
    getSvgCodeMode: () => svgCodeMode,
    getCurrentFile: () => currentFile,
    setHasUnsavedChanges: (value) => {
        hasUnsavedChanges = value;
    },
    saveCurrentEditorContentToCache: () => {
        saveCurrentEditorContentToCache();
    },
    persistWorkspaceState,
    updateWindowTitle,
    fileSession,
    getImageViewer: () => imageViewer,
    getFileService: () => appServices?.file,
    getLoadFile: () => ({ openPathsFromSelection, loadFile }),
});
const {
    insertTextIntoActiveEditor,
    toggleMarkdownCodeMode,
    toggleSvgCodeMode,
    requestActiveEditorContext,
} = editorActions;

const layoutControls = createLayoutControls({
    getStatusBarController: () => statusBarController,
    getPluginManager: () => pluginManager,
});
const {
    setSidebarVisibility,
    toggleSidebarVisibility,
    toggleStatusBarVisibility,
    showAiSidebar,
    hideAiSidebar,
    toggleAiSidebarVisibility,
} = layoutControls;

// 创建工具栏切换函数
function toggleMarkdownToolbar() {
    console.log('toggleMarkdownToolbar called, markdownToolbarManager:', markdownToolbarManager);
    if (markdownToolbarManager) {
        markdownToolbarManager.toggle();
    } else {
        console.log('markdownToolbarManager is null, trying to initialize...');
        // 如果还没有初始化，先初始化
        if (editor && appServices) {
            markdownToolbarManager = new MarkdownToolbarManager(appServices);
            markdownToolbarManager.initialize(editor, 'tiptap');
        }
    }
}

documentIO = createDocumentIO({
    eventBus,
    getCurrentFile: () => currentFile,
    getEditor: () => editor,
    getCodeEditor: () => codeEditor,
    getActiveViewMode: () => activeViewMode,
    setHasUnsavedChanges: (value) => {
        hasUnsavedChanges = value;
    },
    saveCurrentEditorContentToCache,
    fileSession,
    updateWindowTitle,
    persistWorkspaceState,
});
registerDocumentIO(documentIO);
scheduleDocumentSnapshotSync();
appServices = createAppServices({
    fileService,
    getCurrentFile: () => currentFile,
});
scheduleWorkspaceContextSync();

const workspaceController = createWorkspaceController({
    getCurrentFile: () => currentFile,
    getFileTree: () => fileTree,
    getTabManager: () => tabManager,
    fileService: appServices.file,
    createDefaultWorkspaceState,
    loadWorkspaceState,
    saveWorkspaceState,
});
const {
    openPathsFromSelection,
    openFileOrFolder,
    saveCurrentFile,
    saveFile,
    loadFile,
} = createFileOperations({
    getFileTree: () => fileTree,
    getEditor: () => editor,
    getCodeEditor: () => codeEditor,
    getImageViewer: () => imageViewer,
    getMediaViewer: () => mediaViewer,
    getSpreadsheetViewer: () => spreadsheetViewer,
    getPdfViewer: () => pdfViewer,
    getUnsupportedViewer: () => unsupportedViewer,
    getMarkdownCodeMode: () => markdownCodeMode,
    getCurrentFile: () => currentFile,
    setCurrentFile: (value) => {
        currentFile = value;
        window.currentFile = value;  // 同时导出到 window
        scheduleWorkspaceContextSync();
        scheduleDocumentSnapshotSync();
        void updateExportMenuState();
    },
    getActiveViewMode: () => activeViewMode,
    setHasUnsavedChanges: (value) => {
        hasUnsavedChanges = value;
    },
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
    activateMarkdownView,
    activateCodeView,
    activateImageView,
    activateMediaView,
    activateSpreadsheetView,
    activatePdfView,
    activateUnsupportedView,
    recentFilesService,
    updateRecentMenuFn: () => recentFilesActions?.updateRecentMenu?.(),
});

mcpHandler = createMcpHandler({
    services: appServices,
    fileOperations: {
        openPathsFromSelection,
        saveCurrentFile,
        saveFile,
        loadFile,
    },
    documentApi: appServices.document,
});

if (typeof window !== 'undefined') {
    window.__MARK2_MCP__ = mcpHandler;
}

/**
 * 清空所有编辑器内容并重置活动文件。
 */
function clearActiveFileView() {
    // 先重置文件状态，避免清理编辑器时触发的更新回调使用旧路径更新窗口标题
    currentFile = null;
    window.currentFile = null;
    hasUnsavedChanges = false;
    documentSessions.closeActiveSession();

    editor?.clear?.();
    codeEditor?.clear?.();
    imageViewer?.clear?.();
    mediaViewer?.clear?.();
    spreadsheetViewer?.clear?.();
    pdfViewer?.clear?.();
    unsupportedViewer?.clear?.();
    activateMarkdownView();
    markdownCodeMode?.reset();
    updateWindowTitle();
    persistWorkspaceState({ currentFile: null });
    scheduleWorkspaceContextSync();
    scheduleDocumentSnapshotSync();
}

function persistWorkspaceState(overrides = {}, options = {}) {
    workspaceController?.persistWorkspaceState(overrides, options);
    scheduleWorkspaceContextSync();
}

function handleTabReorder(reorderPayload) {
    if (!reorderPayload || !Array.isArray(reorderPayload.storageOrder)) {
        return;
    }
    if (typeof fileTree?.reorderOpenFiles === 'function') {
        fileTree.reorderOpenFiles(reorderPayload.storageOrder);
        return;
    }
    fileTree?.restoreOpenFiles(reorderPayload.storageOrder);
}

function handleSidebarStateChange(sidebarState) {
    workspaceController?.handleSidebarStateChange(sidebarState);
}

async function restoreWorkspaceStateFromStorage() {
    if (!workspaceController) {
        return;
    }
    await workspaceController.restoreWorkspaceStateFromStorage();
    scheduleWorkspaceContextSync();
}

const {
    handleFileSelect,
    handleOpenFilesChange,
    handleTabSelect,
    handleTabClose,
    checkFileHasUnsavedChanges,
    closeActiveTab,
    setupLinkNavigationListener,
} = createNavigationController({
    getFileTree: () => fileTree,
    getTabManager: () => tabManager,
    getCurrentFile: () => currentFile,
    documentSessions,
    saveCurrentEditorContentToCache,
    clearActiveFileView,
    loadFile,
    fileSession,
    persistWorkspaceState,
    saveFile,
    getActiveViewMode: () => activeViewMode,
    getEditor: () => editor,
    getCodeEditor: () => codeEditor,
    confirm,
});

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
    getCurrentFile: () => currentFile,
    setCurrentFile: (value) => {
        currentFile = value;
        window.currentFile = value;  // 同时导出到 window
        scheduleWorkspaceContextSync();
        scheduleDocumentSnapshotSync();
        void updateExportMenuState();
    },
    getHasUnsavedChanges: () => hasUnsavedChanges,
    setHasUnsavedChanges: (value) => {
        hasUnsavedChanges = value;
    },
    clearActiveFileView,
    updateWindowTitle,
    persistWorkspaceState,
    fileSession,
    getFileTree: () => fileTree,
    getTabManager: () => tabManager,
    getEditor: () => editor,
    getCodeEditor: () => codeEditor,
    getImageViewer: () => imageViewer,
    getUnsupportedViewer: () => unsupportedViewer,
    getStatusBarController: () => statusBarController,
    documentSessions,
});

const recentFilesActions = createRecentFilesActions({
    recentFilesService,
    fileService: appServices.file,
    normalizeFsPath,
    getFileTree: () => fileTree,
    workspaceController,
});
const {
    updateRecentMenu,
    handleRecentItemClick,
    clearRecent,
} = recentFilesActions;

// 基础初始化代码
document.addEventListener('DOMContentLoaded', () => {
    void initializeApplication();
});

/**
 * 执行应用初始化流程，构建 UI 并加载配置。
 */
async function initializeApplication() {
    const coreModules = await loadCoreModules();
    MarkdownEditorCtor = coreModules.MarkdownEditor;
    CodeEditorCtor = coreModules.CodeEditor;
    ImageViewerCtor = coreModules.ImageViewer;
    MediaViewerCtor = coreModules.MediaViewer;
    SpreadsheetViewerCtor = coreModules.SpreadsheetViewer;
    PdfViewerCtor = coreModules.PdfViewer;
    UnsupportedViewerCtor = coreModules.UnsupportedViewer;
    FileTreeCtor = coreModules.FileTree;
    TabManagerCtor = coreModules.TabManager;
    SettingsDialogCtor = coreModules.SettingsDialog;

    // 初始化插件系统
    pluginManager = new PluginManager({
        eventBus,
        services: appServices,
        appContext: {
            getActiveViewMode: () => activeViewMode,
            getEditorContext: requestActiveEditorContext,
            documentApi: getDocumentApi(),
            getDocumentIO: () => documentIO,
            insertText: insertTextIntoActiveEditor,
        },
    });

    // 自动扫描并加载所有插件
    await pluginManager.scanAndLoadPlugins();

    // 初始化主视图容器
    const viewContainer = requireElementById('viewContent', '未找到视图容器 viewContent');
    viewContainerElement = viewContainer;
    viewContainer.innerHTML = `
        <div class="view-pane markdown-pane is-active" data-pane="markdown"></div>
        <div class="view-pane code-pane" data-pane="code"></div>
        <div class="view-pane image-pane" data-pane="image"></div>
        <div class="view-pane media-pane" data-pane="media"></div>
        <div class="view-pane spreadsheet-pane" data-pane="spreadsheet"></div>
        <div class="view-pane pdf-pane" data-pane="pdf"></div>
        <div class="view-pane unsupported-pane" data-pane="unsupported"></div>
    `;

    markdownPaneElement = requireElementWithin(viewContainer, '.markdown-pane', '视图容器缺少 markdown-pane');
    codeEditorPaneElement = requireElementWithin(viewContainer, '.code-pane', '视图容器缺少 code-pane');
    imagePaneElement = requireElementWithin(viewContainer, '.image-pane', '视图容器缺少 image-pane');
    mediaPaneElement = requireElementWithin(viewContainer, '.media-pane', '视图容器缺少 media-pane');
    spreadsheetPaneElement = requireElementWithin(viewContainer, '.spreadsheet-pane', '视图容器缺少 spreadsheet-pane');
    pdfPaneElement = requireElementWithin(viewContainer, '.pdf-pane', '视图容器缺少 pdf-pane');
    unsupportedPaneElement = requireElementWithin(viewContainer, '.unsupported-pane', '视图容器缺少 unsupported-pane');

    const statusBarElement = requireElementById('statusBar', '未找到状态栏元素 statusBar');
    const statusBarFilePathElement = requireElementById('statusBarPath', '状态栏缺少文件路径区域');
    const statusBarProgressElement = requireElementById('statusBarProgress', '状态栏缺少进度区域');
    const statusBarProgressTextElement = requireElementById('statusBarProgressText', '状态栏缺少进度文本区域');
    const statusBarWordCountElement = requireElementById('statusBarWordCount', '状态栏缺少字数区域');
    const statusBarLastModifiedElement = requireElementById('statusBarLastModified', '状态栏缺少更新日期区域');
    const statusBarZoomElement = requireElementById('statusBarZoom', '状态栏缺少缩放控件');
    const statusBarZoomValueElement = requireElementById('statusBarZoomValue', '状态栏缺少缩放显示');
    const statusBarZoomOutButton = requireElementWithin(statusBarZoomElement, '[data-zoom="out"]', '状态栏缺少缩小按钮');
    const statusBarZoomInButton = requireElementWithin(statusBarZoomElement, '[data-zoom="in"]', '状态栏缺少放大按钮');
    const statusBarPageInfoElement = requireElementById('statusBarPageInfo', '状态栏缺少页码区域');
    statusBarController = createStatusBarController({
        statusBarElement,
        statusBarFilePathElement,
        statusBarWordCountElement,
        statusBarLastModifiedElement,
        statusBarProgressElement,
        statusBarProgressTextElement,
        statusBarZoomElement,
        statusBarZoomValueElement,
        statusBarZoomInButton,
        statusBarZoomOutButton,
        statusBarPageInfoElement,
        normalizeFsPath,
        fileService: appServices.file,
        onVisibilityChange: () => {
            window.requestAnimationFrame(() => {
                codeEditor?.requestLayout?.();
            });
    },
    });
    statusBarController.updateStatusBar();
    statusBarController.setupStatusBarPathInteraction({
        getCurrentFile: () => currentFile,
    });
    statusBarController.setupZoomControls({
        onZoomIn: () => handleZoomControl(ZOOM_STEP),
        onZoomOut: () => handleZoomControl(-ZOOM_STEP),
    });
    updateZoomDisplayForActiveView();
    statusBarController.setPageInfo('');

    const editorCallbacks = {
        onContentChange: () => {
            hasUnsavedChanges = editor?.hasUnsavedChanges() || codeEditor?.hasUnsavedChanges() || false;
            void updateWindowTitle();
            scheduleDocumentSnapshotSync();
        },
        onAutoSaveSuccess: async ({ skipped, filePath }) => {
            if (skipped) {
                return;
            }
            const targetPath = filePath || currentFile;
            if (!targetPath) {
                return;
            }
            fileSession.clearEntry(targetPath);
            if (normalizeFsPath(currentFile) === normalizeFsPath(targetPath)) {
                hasUnsavedChanges = false;
                await updateWindowTitle();
            }
            scheduleDocumentSnapshotSync();
        },
        onAutoSaveError: (error) => {
            console.error('自动保存失败:', error);
        },
    };

    editor = new MarkdownEditorCtor(markdownPaneElement, editorCallbacks, {
        documentSessions,
    });
    codeEditor = new CodeEditorCtor(codeEditorPaneElement, editorCallbacks, {
        documentSessions,
    });
    codeEditor.applyPreferences?.(editorSettings);
    codeEditor.hide();
    imageViewer = new ImageViewerCtor(imagePaneElement);
    imageViewer.hide();
    mediaViewer = new MediaViewerCtor(mediaPaneElement);
    mediaViewer.hide();
    spreadsheetViewer = new SpreadsheetViewerCtor(spreadsheetPaneElement);
    spreadsheetViewer.hide();
    pdfViewer = new PdfViewerCtor(pdfPaneElement, {
        onPageInfoChange: (text) => statusBarController?.setPageInfo?.(text || ''),
        onZoomChange: (state) => {
            if (!state) {
                return;
            }
            pdfZoomState = state;
            if (activeViewMode === 'pdf') {
                statusBarController?.updateZoomDisplay?.(pdfZoomState);
            }
        },
    });
    pdfViewer.hide();
    unsupportedViewer = new UnsupportedViewerCtor(unsupportedPaneElement);
   unsupportedViewer.hide();
   activeViewMode = 'markdown';

    codeEditor?.setZoomScale?.(contentZoom);
    imageViewer?.setZoomScale?.(contentZoom);
    mediaViewer?.setZoomScale?.(contentZoom);
    setContentZoom(contentZoom, { silent: true });

    // 将代码编辑器引用传递给 Markdown 编辑器的搜索管理器
    editor.setCodeEditor(codeEditor);

    // TODO: 初始化工具栏管理器（暂时注释掉）
    // markdownToolbarManager = new MarkdownToolbarManager(appServices);

    // 监听视图模式切换，自动更新工具栏
    // eventBus.on('view-mode-changed', ({ mode }) => {
    //     if (mode === 'markdown' || mode === 'split') {
    //         if (markdownToolbarManager && !markdownToolbarManager.isInitialized) {
    //             markdownToolbarManager.initialize(editor, 'tiptap');
    //         } else if (markdownToolbarManager) {
    //             markdownToolbarManager.show();
    //         }
    //     } else {
    //         markdownToolbarManager?.hide();
    //     }
    // });

    // 监听文件切换，只在Markdown文件时显示工具栏
    // eventBus.on('file-changed', ({ path }) => {
    //     if (isMarkdownFilePath(path)) {
    //         if (markdownToolbarManager && !markdownToolbarManager.isInitialized) {
    //             markdownToolbarManager.initialize(editor, 'tiptap');
    //         } else if (markdownToolbarManager) {
    //             markdownToolbarManager.show();
    //         }
    //     } else {
    //         markdownToolbarManager?.hide();
    //     }
    // });

    // 发布编辑器就绪事件（让插件可以连接编辑器）
    eventBus.emit('editor:ready', {
        markdownEditor: editor,
        monacoEditor: codeEditor,
    });

    markdownCodeMode = createMarkdownCodeMode({
        detectLanguageForPath,
        isMarkdownFilePath,
        activateMarkdownView,
        activateCodeView,
    });

    svgCodeMode = createSvgCodeMode({
        activateCodeView,
        activateImageView,
    });

    // 初始化文件树
    const fileTreeElement = document.getElementById('fileTree');
    fileTree = new FileTreeCtor(fileTreeElement, handleFileSelect, {
        onFolderChange: (...args) => fileWatcherController?.handleFolderWatcherEvent(...args),
        onFileChange: (...args) => fileWatcherController?.handleFileWatcherEvent(...args),
        onOpenFilesChange: handleOpenFilesChange,
        onStateChange: handleSidebarStateChange,
        onPathRenamed: applyPathChange,
        onCloseFileRequest: (path) => {
            if (!path) {
                return;
            }
            const normalized = normalizeFsPath(path) || path;
            if (!normalized) {
                return;
            }
            return handleTabClose({
                id: normalized,
                type: 'file',
                path: normalized,
            });
        },
    });

    const tabBarElement = document.getElementById('tabBar');
    tabManager = new TabManagerCtor(tabBarElement, {
        onTabSelect: handleTabSelect,
        onTabClose: handleTabClose,
        onRenameConfirm: handleTabRenameConfirm,
        onRenameCancel: handleTabRenameCancel,
        onTabReorder: handleTabReorder,
    });

    fileWatcherController = createFileWatcherController({
        fileTree,
        normalizeFsPath,
        getCurrentFile: () => currentFile,
        getActiveViewMode: () => activeViewMode,
        getEditor: () => editor,
        getCodeEditor: () => codeEditor,
        scheduleLoadFile: async (path) => {
            await loadFile(path, { skipWatchSetup: true, forceReload: true, autoFocus: false });
        },
        fileSession,
        documentSessions,
    });

    await restoreWorkspaceStateFromStorage();

    editorSettings = loadEditorSettings();
    applyEditorSettings(editorSettings);
    codeEditor.applyPreferences?.(editorSettings);
    // 保存一次以更新 localStorage 中的旧数据（如旧主题名）
    saveEditorSettings(editorSettings);

    // 设置主题切换按钮
    setupThemeToggle();

    settingsDialog = new SettingsDialogCtor({
        onSubmit: handleSettingsSubmit,
    });
    if (availableFontFamilies.length > 0) {
        settingsDialog.setAvailableFonts(availableFontFamilies);
    }

    keyboardShortcutCleanup = setupKeyboardShortcuts({
        onOpen: openFileOrFolder,
        onSave: saveCurrentFile,
        onCloseTab: closeActiveTab,
        onFind: () => editor?.showSearch?.(),
        onSelectSearchMatches: () => editor?.selectAllSearchMatches?.(),
        onDeleteFile: handleDeleteActiveFile,
        onToggleSidebar: toggleSidebarVisibility,
        onToggleMarkdownCodeView: toggleMarkdownCodeMode,
        onToggleSvgCodeView: toggleSvgCodeMode,
        onToggleAiSidebar: toggleAiSidebarVisibility,
    });
    menuListenersCleanup = await registerMenuListeners({
        onNewFile: handleCreateNewFile,
        onOpen: openFileOrFolder,
        onSettings: openSettingsDialog,
        onExportImage: () => exportCurrentViewToImage({ ensureToPng, statusBarController }),
        onExportPdf: () => exportCurrentViewToPdf({ activeViewMode, statusBarController }),
        onToggleSidebar: toggleSidebarVisibility,
        onToggleStatusBar: toggleStatusBarVisibility,
        onToggleMarkdownCodeView: toggleMarkdownCodeMode,
        onToggleMarkdownToolbar: toggleMarkdownToolbar,
        onToggleAiAssistant: toggleAiSidebarVisibility,
        onOpenAiSettings: openAiSettingsDialog,
        onDeleteActiveFile: handleDeleteActiveFile,
        onMoveActiveFile: handleMoveActiveFile,
        onRenameActiveFile: handleRenameActiveFile,
        onRecentItemClick: handleRecentItemClick,
        onClearRecent: clearRecent,
    });
    setupLinkNavigationListener();
    sidebarResizerCleanup = setupSidebarResizer();
    fileDropController = createFileDropController({
        openPathsFromSelection,
    });
    fileDropCleanup = await fileDropController.setup();
    setupCleanupHandlers();

    loadAvailableFonts();

    // 初始化时清空窗口标题
    updateWindowTitle();

    // 发布应用初始化完成事件
    eventBus.emit('app:initialized');
    void updateExportMenuState();

    // 更新最近文件菜单
    void updateRecentMenu();

    // 初始化工具栏管理器
    markdownToolbarManager = new MarkdownToolbarManager(appServices);

    // 导出编辑器实例到全局，供工具栏使用
    window.editor = editor;

    // 监听视图模式切换，自动更新工具栏
    eventBus.on('view-mode-changed', ({ mode }) => {
        if (mode === 'markdown' || mode === 'split') {
            if (markdownToolbarManager && !markdownToolbarManager.isInitialized && editor) {
                markdownToolbarManager.initialize(editor, 'tiptap');
            } else if (markdownToolbarManager) {
                markdownToolbarManager.show();
            }
        } else {
            markdownToolbarManager?.hide();
        }
    });

    // 监听文件切换，只在Markdown文件时显示工具栏
    eventBus.on('file-changed', ({ path }) => {
        if (isMarkdownFilePath(path)) {
            if (markdownToolbarManager && !markdownToolbarManager.isInitialized && editor) {
                markdownToolbarManager.initialize(editor, 'tiptap');
            } else if (markdownToolbarManager) {
                markdownToolbarManager.show();
            }
        } else {
            markdownToolbarManager?.hide();
        }
    });
}

/**
 * 将当前活跃编辑器内容写入会话缓存。
 */
function saveCurrentEditorContentToCache() {
    fileSession.saveCurrentEditorContentToCache({
        currentFile,
        activeViewMode,
        editor,
        codeEditor,
    });
}

/**
 * 打开设置对话框并确保依赖加载完毕。
 */
async function openSettingsDialog() {
    if (!SettingsDialogCtor) {
        const coreModules = await loadCoreModules();
        SettingsDialogCtor = coreModules.SettingsDialog;
    }

    if (!settingsDialog) {
        settingsDialog = new SettingsDialogCtor({
            onSubmit: handleSettingsSubmit,
        });
        if (availableFontFamilies.length > 0) {
            settingsDialog.setAvailableFonts(availableFontFamilies);
        }
    }

    settingsDialog.open(editorSettings);
}

/**
 * 响应设置提交事件并持久化编辑器偏好。
 */
async function handleSettingsSubmit(nextSettings) {
    const merged = {
        ...editorSettings,
        ...nextSettings,
    };

    editorSettings = normalizeEditorSettings(merged);
    applyEditorSettings(editorSettings);
    codeEditor?.applyPreferences?.(editorSettings);
    saveEditorSettings(editorSettings);
}

async function openAiSettingsDialog() {
    const aiApi = pluginManager?.getPluginApi('ai-assistant');
    await aiApi?.openSettings();
}

/**
 * 加载系统字体列表并刷新设置对话框。
 */
async function loadAvailableFonts() {
    try {
        const fonts = await listFonts();
        if (!Array.isArray(fonts)) {
            return;
        }

        const normalized = Array.from(
            new Set(
                fonts
                    .map(name => (typeof name === 'string' ? name.trim() : ''))
                    .filter(Boolean)
            )
        ).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN', { sensitivity: 'accent' }));

        availableFontFamilies = normalized;
        if (settingsDialog) {
            settingsDialog.setAvailableFonts(availableFontFamilies);
            settingsDialog.syncFontSelection(editorSettings.fontFamily);
        }
    } catch (error) {
        console.warn('加载系统字体列表失败', error);
    }
}

/**
 * 根据当前文件状态动态更新窗口标题。
 */
async function updateWindowTitle() {
    try {
        const window = getCurrentWindow();
        let wordCount = null;
        let lineCount = null;
        let lastModified = '';

        if (currentFile) {
            const viewMode = getViewModeForPath(currentFile);

            // 根据文件类型计算相应的统计信息
            if (viewMode === 'markdown') {
                wordCount = statusBarController
                    ? statusBarController.calculateWordCount({ activeViewMode, editor, codeEditor })
                    : { words: 0, characters: 0 };
            } else if (viewMode === 'code') {
                lineCount = statusBarController
                    ? statusBarController.calculateLineCount({ activeViewMode, editor, codeEditor })
                    : { total: 0, nonEmpty: 0 };
            }

            lastModified = statusBarController
                ? (await statusBarController.getLastModifiedTime(currentFile)) ?? ''
                : '';
        }

        statusBarController?.updateStatusBar({
            filePath: currentFile,
            wordCount,
            lineCount,
            lastModified,
            isDirty: hasUnsavedChanges,
        });

        if (hasUnsavedChanges) {
            statusBarController?.showProgress('已编辑', { state: 'dirty' });
        } else {
            statusBarController?.hideProgress();
        }

        await window.setTitle('Mark2');
    } catch (error) {
        console.error('更新窗口标题失败:', error);
    }
}

/**
 * 计算编辑器内容的字数统计。
 */
/**
 * 注册窗口卸载时的清理钩子。
 */
function setupCleanupHandlers() {
    window.addEventListener('beforeunload', cleanupResources);
}

/**
 * 清理运行期资源，确保退出时释放引用。
 */
function cleanupResources() {
    if (keyboardShortcutCleanup) {
        keyboardShortcutCleanup();
        keyboardShortcutCleanup = null;
    }
    if (menuListenersCleanup) {
        menuListenersCleanup();
        menuListenersCleanup = null;
    }
    if (sidebarResizerCleanup) {
        sidebarResizerCleanup();
        sidebarResizerCleanup = null;
    }
    if (fileDropController) {
        fileDropController.teardown();
        fileDropController = null;
    } else if (fileDropCleanup) {
        try {
            fileDropCleanup();
        } catch (error) {
            console.warn('清理拖拽监听失败:', error);
        }
    }
    fileDropCleanup = null;
    statusBarController?.teardown?.();
    statusBarController = null;
    markdownCodeMode = null;
    if (fileWatcherController) {
        fileWatcherController.cleanup();
        fileWatcherController = null;
    }
    // 停用所有插件
    if (pluginManager) {
        void pluginManager.deactivateAll();
    }
    fileSession.clearAll();
    fileTree?.dispose?.();
    editor?.destroy?.();
    codeEditor?.dispose?.();
    imageViewer?.dispose?.();
    if (appearanceChangeCleanup) {
        appearanceChangeCleanup();
        appearanceChangeCleanup = null;
    }
}

/**
 * 设置自定义标题栏的窗口控制按钮
 */
function setupTitlebarControls() {
    const closeBtn = document.getElementById('titlebar-close');
    const minimizeBtn = document.getElementById('titlebar-minimize');
    const maximizeBtn = document.getElementById('titlebar-maximize');
    const appWindow = getCurrentWindow();

    if (closeBtn) {
        closeBtn.addEventListener('click', () => appWindow.close());
    }
    if (minimizeBtn) {
        minimizeBtn.addEventListener('click', () => appWindow.minimize());
    }
    if (maximizeBtn) {
        maximizeBtn.addEventListener('click', async () => {
            const isMaximized = await appWindow.isMaximized();
            if (isMaximized) {
                await appWindow.unmaximize();
            } else {
                await appWindow.maximize();
            }
        });
    }
}

/**
 * 设置主题切换按钮
 */
function setupThemeToggle() {
    const toggleBtn = document.getElementById('theme-toggle');
    if (!toggleBtn) return;

    addClickHandler(toggleBtn, () => {
        const root = document.documentElement;
        const currentAppearance = root.dataset.themeAppearance;
        const newAppearance = currentAppearance === 'dark' ? 'light' : 'dark';

        editorSettings.appearance = newAppearance;
        applyEditorSettings(editorSettings);
        saveEditorSettings(editorSettings);
    }, {
        preventDefault: true,
    });
}
