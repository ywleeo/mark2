// 过滤开发环境下 Tauri 热重载产生的无用警告
const originalWarn = console.warn;
console.warn = function(...args) {
    const message = args[0];
    if (typeof message === 'string' && message.includes('[TAURI] Couldn\'t find callback id')) {
        return; // 忽略这类警告
    }
    originalWarn.apply(console, args);
};

import 'katex/dist/katex.min.css';
import { confirm } from '@tauri-apps/plugin-dialog';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getVersion } from '@tauri-apps/api/app';
import {
    detectLanguageForPath,
    getViewModeForPath,
    isMarkdownFilePath,
    isCsvFilePath,
} from './utils/fileTypeUtils.js';
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
import {
    exportCurrentViewToImage,
    exportCurrentViewToPdf,
    exportCurrentViewToPdfA4,
} from './modules/menuExports.js';
import {
    listFonts,
} from './api/filesystem.js';
import { registerDocumentIO, getDocumentApi } from './api/document.js';
import { setExportMenuEnabled } from './api/native.js';
import { createAppServices } from './services/appServices.js';
import { createFileService } from './services/fileService.js';
import { createRecentFilesService } from './services/recentFilesService.js';
import { registerMenuListeners } from './modules/menuListeners.js';
import { isFeatureEnabled, getMASLimitationMessage } from './config/features.js';
import { MarkdownToolbarManager } from './components/MarkdownToolbarManager.js';
import { createFileSession } from './modules/fileSession.js';
import { createFileWatcherController } from './modules/fileWatchers.js';
import { createDefaultWorkspaceState, loadWorkspaceState, saveWorkspaceState } from './utils/workspaceState.js';
import { createMarkdownCodeMode } from './modules/markdownCodeMode.js';
import { createSvgCodeMode } from './modules/svgCodeMode.js';
import { createCsvTableMode } from './modules/csvTableMode.js';
import { createWorkflowCodeMode } from './modules/workflowCodeMode.js';
import { createFileDropController } from './modules/fileDropController.js';
import { createWindowFocusHandler } from './modules/windowFocusHandler.js';
import { createWorkspaceController } from './modules/workspaceController.js';
import { createNavigationController } from './modules/navigationController.js';
import { createFileOperations } from './modules/fileOperations.js';
import { createFileMenuActions } from './modules/fileMenuActions.js';
import { createRecentFilesActions } from './modules/recentFilesActions.js';
import { eventBus } from './core/EventBus.js';
import { createDocumentIO } from './core/DocumentIO.js';

import { initCardExportSidebar } from './modules/card-export/index.js';
import { createTerminalPanel } from './modules/terminalPanel.js';
import { createDocumentSessionManager } from './modules/documentSessionManager.js';
import { untitledFileManager } from './modules/untitledFileManager.js';
import { createViewController, ZOOM_DEFAULT, ZOOM_STEP } from './app/viewController.js';
import { createEditorActions } from './app/editorActions.js';
import { createLayoutControls } from './app/layoutControls.js';
import { createWorkspaceSyncController, createDocumentSnapshotSyncController } from './app/syncControllers.js';
import { addClickHandler } from './utils/PointerHelper.js';
import { AppState } from './state/AppState.js';
import { EditorRegistry } from './state/EditorRegistry.js';
import { setupTitlebarControls, setupThemeToggle } from './app/windowControls.js';
import { loadAndRegisterModules } from './app/moduleLoader.js';
import { setupViewPanes } from './app/viewSetup.js';
import { createEditorCallbacks, setupEditors } from './app/editorSetup.js';
import { setupStatusBar, setupFileTree, setupTabManager } from './app/componentSetup.js';
import { setupToolbarEvents } from './app/eventSetup.js';
import { restoreStoredSecurityScopes } from './services/securityScopeService.js';
import { RendererRegistry } from './fileRenderers/registry.js';
import { createMarkdownRenderer } from './fileRenderers/handlers/markdown.js';
import { createCodeRenderer } from './fileRenderers/handlers/code.js';
import { createImageRenderer } from './fileRenderers/handlers/image.js';
import { createMediaRenderer } from './fileRenderers/handlers/media.js';
import { createSpreadsheetRenderer } from './fileRenderers/handlers/spreadsheet.js';
import { createPdfRenderer } from './fileRenderers/handlers/pdf.js';
import { createWorkflowRenderer } from './fileRenderers/handlers/workflow.js';

// ========== 状态管理实例 ==========
const appState = new AppState();
const editorRegistry = new EditorRegistry();
const rendererRegistry = new RendererRegistry();

// ========== 构造函数（动态加载） ==========
let SettingsDialogCtor = null;

let cardExportSidebar = null;
let terminalPanel = null;
let windowFocusHandler = null;

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

async function updateExportMenuState() {
    const currentFile = appState.getCurrentFile();
    const activeViewMode = appState.getActiveViewMode();
    const hasMarkdownFile = typeof currentFile === 'string' && isMarkdownFilePath(currentFile);
    const shouldEnable = activeViewMode === 'markdown' && hasMarkdownFile;

    if (appState.getExportMenuEnabledState() === shouldEnable) {
        return;
    }

    appState.setExportMenuEnabledState(shouldEnable);

    try {
        await setExportMenuEnabled(shouldEnable);
    } catch (error) {
        console.warn('更新导出菜单状态失败:', error);
    }
}


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
    setActiveViewModeState: (mode) => {
        appState.setActiveViewMode(mode);
    },
    getActiveViewModeState: () => appState.getActiveViewMode(),
    setContentZoomState: (value) => {
        appState.setContentZoom(value);
    },
    getContentZoomState: () => appState.getContentZoom(),
    setPdfZoomStateState: (state) => {
        appState.setPdfZoomState(state);
    },
    getPdfZoomState: () => appState.getPdfZoomState(),
    updateExportMenuState: () => {
        void updateExportMenuState();
    },
    onViewModeChange: (nextMode) => {
        void updateExportMenuState();
        handleToolbarOnViewModeChange(nextMode);
        // 切换到非 markdown 视图时隐藏 card sidebar
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

const editorActions = createEditorActions({
    getActiveViewMode: () => appState.getActiveViewMode(),
    setActiveViewMode: (mode) => {
        appState.setActiveViewMode(mode);
    },
    getEditor: () => editorRegistry.getMarkdownEditor(),
    getCodeEditor: () => editorRegistry.getCodeEditor(),
    getMarkdownCodeMode: () => appState.getMarkdownCodeMode(),
    getSvgCodeMode: () => appState.getSvgCodeMode(),
    getCsvTableMode: () => appState.getCsvTableMode(),
    getWorkflowCodeMode: () => appState.getWorkflowCodeMode(),
    getCurrentFile: () => appState.getCurrentFile(),
    setHasUnsavedChanges: (value) => {
        appState.setHasUnsavedChanges(value);
    },
    saveCurrentEditorContentToCache: () => {
        saveCurrentEditorContentToCache();
    },
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

const layoutControls = createLayoutControls({
    getStatusBarController: () => appState.getStatusBarController(),
    getCodeEditor: () => editorRegistry.getCodeEditor(),
});
const {
    setSidebarVisibility,
    toggleSidebarVisibility,
    toggleStatusBarVisibility,
} = layoutControls;

function getToolbarEditorInstance() {
    const editor = editorRegistry.getMarkdownEditor();
    if (!editor) {
        return null;
    }
    if (typeof editor.getTipTapEditor === 'function') {
        const tiptapEditor = editor.getTipTapEditor();
        if (tiptapEditor) {
            return tiptapEditor;
        }
    }
    if (editor.editor) {
        return editor.editor;
    }
    return editor;
}

// 创建工具栏切换函数
function toggleMarkdownToolbar() {
    const currentFile = appState.getCurrentFile();
    const markdownToolbarManager = appState.getMarkdownToolbarManager();

    console.log('toggleMarkdownToolbar called, markdownToolbarManager:', markdownToolbarManager);

    // 只有 markdown 文件才能呼出 toolbar
    if (!currentFile || !isMarkdownFilePath(currentFile)) {
        console.log('Not a markdown file, toolbar disabled');
        return;
    }

    if (markdownToolbarManager) {
        // 确保回调已设置
        markdownToolbarManager.setToggleViewModeCallback(toggleMarkdownCodeMode);
        markdownToolbarManager.setCardExportCallback?.(() => showCardExportSidebar());
        markdownToolbarManager.toggle();
    } else {
        console.log('markdownToolbarManager is null, trying to initialize...');
        // 如果还没有初始化，先初始化 - 根据当前视图模式选择编辑器
        if (appServices) {
            const newManager = new MarkdownToolbarManager(appServices, {
                onToggleViewMode: toggleMarkdownCodeMode,
                onCardExport: () => showCardExportSidebar(),
            });
            appState.setMarkdownToolbarManager(newManager);

            const activeViewMode = appState.getActiveViewMode();
            const codeEditor = editorRegistry.getCodeEditor();

            if (activeViewMode === 'code') {
                // code 模式下使用 Monaco 编辑器
                if (codeEditor) {
                    newManager.initialize(codeEditor, 'monaco');
                }
            } else {
                // markdown 模式下使用 TipTap 编辑器
                const tiptapEditor = getToolbarEditorInstance();
                if (tiptapEditor) {
                    newManager.initialize(tiptapEditor, 'tiptap');
                }
            }
        }
    }
}

function showCardExportSidebar() {
    if (!cardExportSidebar) {
        console.warn('Card sidebar 未初始化');
        return;
    }

    const currentFile = appState.getCurrentFile();
    if (!currentFile || !isMarkdownFilePath(currentFile)) {
        console.log('Card sidebar 仅支持 Markdown 文件');
        return;
    }

    // 检查视图模式，code 模式下显示提示
    const activeViewMode = appState.getActiveViewMode();
    if (activeViewMode !== 'markdown' && activeViewMode !== 'split') {
        showModeWarning('卡片功能仅在 Markdown 预览模式下可用');
        return;
    }

    cardExportSidebar.showSidebar?.();
}

let modeWarningElement = null;
let modeWarningTimeout = null;

function showModeWarning(message) {
    // 如果已有警告，先移除
    if (modeWarningElement) {
        modeWarningElement.remove();
        modeWarningElement = null;
    }
    if (modeWarningTimeout) {
        clearTimeout(modeWarningTimeout);
        modeWarningTimeout = null;
    }

    // 创建警告元素（复用 toc-mode-warning 样式）
    modeWarningElement = document.createElement('div');
    modeWarningElement.className = 'toc-mode-warning';
    modeWarningElement.textContent = message;
    document.body.appendChild(modeWarningElement);

    // 触发动画
    setTimeout(() => {
        if (modeWarningElement) {
            modeWarningElement.classList.add('toc-mode-warning--visible');
        }
    }, 10);

    // 2秒后移除
    modeWarningTimeout = setTimeout(() => {
        if (modeWarningElement) {
            modeWarningElement.classList.remove('toc-mode-warning--visible');
            setTimeout(() => {
                modeWarningElement?.remove();
                modeWarningElement = null;
            }, 200);
        }
        modeWarningTimeout = null;
    }, 2000);
}

// 处理视图模式切换时的 toolbar 状态
function handleToolbarOnViewModeChange(nextMode) {
    syncToolbarWithCurrentContext({ mode: nextMode });
}

function handleToolbarOnFileChange(nextPath) {
    const markdownToolbarManager = appState.getMarkdownToolbarManager();
    if (!markdownToolbarManager) {
        return;
    }

    if (!nextPath || !isMarkdownFilePath(nextPath)) {
        markdownToolbarManager.hide({ persist: false });
        return;
    }

    syncToolbarWithCurrentContext();
}


function handleCardSidebarOnFileChange(nextPath) {
    if (!cardExportSidebar) {
        return;
    }
    if (!nextPath || !isMarkdownFilePath(nextPath)) {
        cardExportSidebar.hideSidebar?.();
    }
}

function syncToolbarWithCurrentContext(options = {}) {
    const markdownToolbarManager = appState.getMarkdownToolbarManager();
    if (!markdownToolbarManager) {
        return;
    }

    const activeViewMode = appState.getActiveViewMode();
    const currentFile = appState.getCurrentFile();
    const effectiveMode = options.mode ?? activeViewMode;
    const hasMarkdownFile = currentFile && isMarkdownFilePath(currentFile);
    const isMarkdownView = effectiveMode === 'markdown' || effectiveMode === 'split';
    const isCodeView = effectiveMode === 'code';

    if (!hasMarkdownFile || (!isMarkdownView && !isCodeView)) {
        markdownToolbarManager.hide({ persist: false });
        return;
    }

    const editorType = isCodeView ? 'monaco' : 'tiptap';
    const codeEditor = editorRegistry.getCodeEditor();
    const targetEditor = isCodeView ? codeEditor : getToolbarEditorInstance();

    if (!targetEditor) {
        return;
    }

    markdownToolbarManager.setToggleViewModeCallback?.(toggleMarkdownCodeMode);
    markdownToolbarManager.setCardExportCallback?.(() => showCardExportSidebar());

    if (!markdownToolbarManager.isInitialized) {
        markdownToolbarManager.initialize(targetEditor, editorType);
    } else {
        markdownToolbarManager.updateEditor(targetEditor, editorType);
    }

    if (markdownToolbarManager.isVisible) {
        markdownToolbarManager.show({ persist: false });
    } else {
        markdownToolbarManager.hide({ persist: false });
    }
}

const documentIO = createDocumentIO({
    eventBus,
    getCurrentFile: () => appState.getCurrentFile(),
    getEditor: () => editorRegistry.getMarkdownEditor(),
    getCodeEditor: () => editorRegistry.getCodeEditor(),
    getActiveViewMode: () => appState.getActiveViewMode(),
    setHasUnsavedChanges: (value) => {
        appState.setHasUnsavedChanges(value);
    },
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

const workspaceController = createWorkspaceController({
    getCurrentFile: () => appState.getCurrentFile(),
    getFileTree: () => appState.getFileTree(),
    getTabManager: () => appState.getTabManager(),
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
    setHasUnsavedChanges: (value) => {
        appState.setHasUnsavedChanges(value);
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
    getRendererRegistry: () => appState.getRendererRegistry(),
});

/**
 * 清空所有编辑器内容并重置活动文件。
 */
function clearActiveFileView() {
    // 先重置文件状态，避免清理编辑器时触发的更新回调使用旧路径更新窗口标题
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

function persistWorkspaceState(overrides = {}, options = {}) {
    workspaceController?.persistWorkspaceState(overrides, options);
    scheduleWorkspaceContextSync();
}

/**
 * 创建新的 untitled 文件并打开
 */
async function handleCreateUntitled() {
    // 先缓存当前编辑器内容（可能是另一个 untitled 文件）
    saveCurrentEditorContentToCache();

    const untitledPath = untitledFileManager.createUntitledFile();
    const displayName = untitledFileManager.getDisplayName(untitledPath);

    // 创建一个虚拟的 tab
    const tabManager = appState.getTabManager();
    if (tabManager) {
        // 直接添加到 fileTabs 末尾
        tabManager.fileTabs.push({
            id: untitledPath,
            type: 'file',
            path: untitledPath,
            label: displayName,
        });
        tabManager.setActiveTab(untitledPath, { silent: true });
        tabManager.render();
    }

    // 设置当前文件并初始化编辑器
    appState.setCurrentFile(untitledPath);
    appState.setHasUnsavedChanges(false);

    // 激活 markdown 视图并清空编辑器
    const editor = editorRegistry.getMarkdownEditor();
    if (editor) {
        editor.setContent?.('');
        editor.currentFile = untitledPath;
        activateMarkdownView();
        // 聚焦到编辑器
        setTimeout(() => {
            editor.focus?.();
        }, 50);
    }

    void updateWindowTitle();
    scheduleWorkspaceContextSync();
    scheduleDocumentSnapshotSync();
}

/**
 * 保存 untitled 文件到磁盘
 * @param {string} untitledPath - untitled 文件的虚拟路径
 * @param {string} content - 文件内容
 * @returns {Promise<boolean>} 是否保存成功
 */
async function saveUntitledFile(untitledPath, content) {
    try {
        const { save } = await import('@tauri-apps/plugin-dialog');
        const displayName = untitledFileManager.getDisplayName(untitledPath);

        const targetPath = await save({
            title: '保存文件',
            defaultPath: displayName,
            filters: [{
                name: 'Markdown',
                extensions: ['md'],
            }],
        });

        if (!targetPath) {
            // 用户取消了保存对话框
            return false;
        }

        const normalizedPath = normalizeFsPath(targetPath);
        if (!normalizedPath) {
            return false;
        }

        // 写入文件
        await appServices.file.writeText(normalizedPath, content);

        // 转换为正常文件 tab
        await convertUntitledToRealFile(untitledPath, normalizedPath);

        return true;
    } catch (error) {
        console.error('保存 untitled 文件失败:', error);
        alert('保存文件失败: ' + (error?.message || error));
        return false;
    }
}

/**
 * 将 untitled 虚拟文件转换为正常文件
 * @param {string} untitledPath - untitled 文件的虚拟路径
 * @param {string} realPath - 实际保存的文件路径
 */
async function convertUntitledToRealFile(untitledPath, realPath) {
    const tabManager = appState.getTabManager();
    const fileTree = appState.getFileTree();
    const currentFile = appState.getCurrentFile();

    // 从 untitledFileManager 中移除
    untitledFileManager.removeUntitledFile(untitledPath);

    // 移除旧的 untitled tab
    if (tabManager && Array.isArray(tabManager.fileTabs)) {
        const tabIndex = tabManager.fileTabs.findIndex(tab => tab.path === untitledPath);
        if (tabIndex !== -1) {
            tabManager.fileTabs.splice(tabIndex, 1);
            tabManager.render();
        }
    }

    // 清理 session
    documentSessions.closeSessionForPath(untitledPath);
    const editor = editorRegistry.getMarkdownEditor();
    const codeEditor = editorRegistry.getCodeEditor();
    editor?.forgetViewStateForTab?.(untitledPath);
    codeEditor?.forgetViewStateForTab?.(untitledPath);
    fileSession.clearEntry(untitledPath);

    // 如果当前文件是这个 untitled 文件，切换到新的真实文件
    if (currentFile === untitledPath) {
        // 添加到 fileTree 的打开文件列表
        fileTree?.addToOpenFiles?.(realPath);
        // 选中新文件（这会触发正常的文件加载流程）
        fileTree?.selectFile?.(realPath);
    }
}

function handleTabReorder(reorderPayload) {
    if (!reorderPayload || !Array.isArray(reorderPayload.storageOrder)) {
        return;
    }
    const fileTree = appState.getFileTree();
    if (typeof fileTree?.reorderOpenFiles === 'function') {
        fileTree.reorderOpenFiles(reorderPayload.storageOrder);
        return;
    }
    fileTree?.restoreOpenFiles(reorderPayload.storageOrder);
}

function handleSidebarStateChange(sidebarState) {
    workspaceController?.handleSidebarStateChange(sidebarState);
}

/**
 * 在内置终端中运行脚本文件
 * @param {string} filePath - 要运行的文件路径
 */
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
        await terminalPanel.runCommand(command);
    } catch (error) {
        console.error('[Run] 执行命令失败:', error);
    }
}

async function restoreWorkspaceStateFromStorage() {
    if (!workspaceController) {
        return;
    }
    try {
        await restoreStoredSecurityScopes();
    } catch (error) {
        console.warn('[main] 恢复文件权限失败', error);
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
        handleAISidebarOnFileChange(value);
    },
    getHasUnsavedChanges: () => appState.getHasUnsavedChanges(),
    setHasUnsavedChanges: (value) => {
        appState.setHasUnsavedChanges(value);
    },
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

// 基础初始化代码
document.addEventListener('DOMContentLoaded', () => {
    void initializeApplication();
});

/**
 * 执行应用初始化流程，构建 UI 并加载配置。
 */
async function initializeApplication() {
    // 加载和注册核心模块
    const coreModules = await loadAndRegisterModules(editorRegistry);

    // 保存 SettingsDialog 构造函数供延迟加载使用
    SettingsDialogCtor = coreModules.SettingsDialog;

    // 初始化视图容器
    setupViewPanes(appState);

    // 初始化状态栏
    setupStatusBar({
        appState,
        appServices,
        editorRegistry,
        normalizeFsPath,
        handleZoomControl,
        updateZoomDisplayForActiveView,
    });

    // 创建编辑器回调
    const editorCallbacks = createEditorCallbacks({
        editorRegistry,
        appState,
        fileSession,
        normalizeFsPath,
        updateWindowTitle,
        scheduleDocumentSnapshotSync,
        onFileSaved: async (filePath, modifiedTime) => {
            await windowFocusHandler?.syncFileModifiedTime?.(filePath, modifiedTime);
        },
    });

    // 初始化所有编辑器和查看器
    const { editor, codeEditor } = setupEditors({
        constructors: coreModules,
        appState,
        editorRegistry,
        editorCallbacks,
        documentSessions,
        setContentZoom,
    });

    // 发布编辑器就绪事件
    eventBus.emit('editor:ready', {
        markdownEditor: editor,
        codeEditor: codeEditor,
    });


    cardExportSidebar = await initCardExportSidebar();
    console.log('[App] 卡片导出侧边栏已初始化');
    handleCardSidebarOnFileChange(appState.getCurrentFile());

    // 初始化终端面板
    terminalPanel = createTerminalPanel({
        getWorkspaceCwd: () => {
            const fileTree = appState.getFileTree();
            return fileTree?.rootPaths?.[0] || null;
        },
    });
    terminalPanel.initialize();


    const markdownCodeMode = createMarkdownCodeMode({
        detectLanguageForPath,
        isMarkdownFilePath,
        activateMarkdownView,
        activateCodeView,
    });
    appState.setMarkdownCodeMode(markdownCodeMode);

    const svgCodeMode = createSvgCodeMode({
        activateCodeView,
        activateImageView,
    });
    appState.setSvgCodeMode(svgCodeMode);

    const csvTableMode = createCsvTableMode({
        isCsvFilePath,
        activateSpreadsheetView,
        activateCodeView,
        detectLanguageForPath,
    });
    appState.setCsvTableMode(csvTableMode);

    const workflowCodeMode = createWorkflowCodeMode({
        activateCodeView,
        activateWorkflowView,
    });
    appState.setWorkflowCodeMode(workflowCodeMode);

    // 初始化文件树
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
    });

    // 初始化标签管理器
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
    // 保存一次以更新 localStorage 中的旧数据（如旧主题名）
    saveEditorSettings(loadedSettings);

    // 设置窗口控制按钮
    setupTitlebarControls();
    setupThemeToggle(appState);

    const settingsDialog = new SettingsDialogCtor({
        onSubmit: handleSettingsSubmit,
    });
    appState.setSettingsDialog(settingsDialog);
    const availableFontFamilies = appState.getAvailableFontFamilies();
    if (availableFontFamilies.length > 0) {
        settingsDialog.setAvailableFonts(availableFontFamilies);
    }

    appState.setCleanupFunction('keyboardShortcut', setupKeyboardShortcuts({
        onOpen: openFileOrFolder,
        onSave: saveCurrentFile,
        onCloseTab: closeActiveTab,
        onFind: () => editorRegistry.getMarkdownEditor()?.showSearch?.(),
        onSelectSearchMatches: () => editorRegistry.getMarkdownEditor()?.selectAllSearchMatches?.(),
        onDeleteFile: handleDeleteActiveFile,
        onToggleSidebar: toggleSidebarVisibility,
        onToggleMarkdownCodeView: toggleMarkdownCodeMode,
        onToggleSvgCodeView: toggleSvgCodeMode,
        onToggleCsvTableView: toggleCsvTableMode,
        onToggleWorkflowCodeView: toggleWorkflowCodeMode,
    }));
    appState.setCleanupFunction('menuListeners', await registerMenuListeners({
        onAbout: showAboutDialog,
        onUndo: handleUndoCommand,
        onRedo: handleRedoCommand,
        onNewFile: handleCreateNewFile,
        onOpen: openFileOrFolder,
        onSettings: openSettingsDialog,
        onExportImage: () => exportCurrentViewToImage({ statusBarController: appState.getStatusBarController() }),
        onExportPdf: () => exportCurrentViewToPdf({ activeViewMode: appState.getActiveViewMode(), statusBarController: appState.getStatusBarController() }),
        onExportPdfA4: () => exportCurrentViewToPdfA4({ activeViewMode: appState.getActiveViewMode(), statusBarController: appState.getStatusBarController() }),
        onToggleSidebar: toggleSidebarVisibility,
        onToggleStatusBar: toggleStatusBarVisibility,
        onToggleMarkdownCodeView: toggleMarkdownCodeMode,
        onToggleMarkdownToolbar: toggleMarkdownToolbar,

        onToggleTerminal: () => {
            if (!isFeatureEnabled('terminal')) {
                alert(getMASLimitationMessage('terminal'));
                return;
            }
            terminalPanel?.toggle();
        },
        onDeleteActiveFile: handleDeleteActiveFile,
        onMoveActiveFile: handleMoveActiveFile,
        onRenameActiveFile: handleRenameActiveFile,
        onRecentItemClick: handleRecentItemClick,
        onClearRecent: clearRecent,
    }));
    setupLinkNavigationListener();
    appState.setCleanupFunction('sidebarResizer', setupSidebarResizer());
    const fileDropController = createFileDropController({
        openPathsFromSelection,
    });
    appState.setFileDropController(fileDropController);
    appState.setCleanupFunction('fileDrop', await fileDropController.setup());
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
    const markdownToolbarManager = new MarkdownToolbarManager(appServices);
    appState.setMarkdownToolbarManager(markdownToolbarManager);
    markdownToolbarManager.setToggleViewModeCallback(toggleMarkdownCodeMode);
    syncToolbarWithCurrentContext();

    // 导出编辑器实例到全局，供工具栏使用
    window.editor = getToolbarEditorInstance();
    // 同时导出 MarkdownEditor 实例，用于获取 markdown 内容
    window.markdownEditor = editorRegistry.getMarkdownEditor();

    // 设置工具栏事件监听
    setupToolbarEvents({
        handleToolbarOnViewModeChange,
        handleToolbarOnFileChange,
    });

    // 初始化窗口焦点处理器（用于校验文件树状态）
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

    // 监听从系统传入的文件打开事件
    setupOpenedFilesListener();
}

/**
 * 处理从系统传入的文件路径（如通过"打开方式"）
 */
async function handleOpenedFiles(paths) {
    if (!Array.isArray(paths) || paths.length === 0) {
        return;
    }
    const fileTree = appState.getFileTree();
    if (!fileTree) {
        console.warn('[main] fileTree 未初始化，无法处理打开的文件');
        return;
    }
    // 打开第一个文件
    const firstPath = paths[0];
    if (firstPath) {
        fileTree.addToOpenFiles(firstPath);
        fileTree.selectFile(firstPath);
    }
}

/**
 * 设置文件打开事件监听器
 */
async function setupOpenedFilesListener() {
    // 监听后续的文件打开事件
    await listen('files-opened', (event) => {
        const paths = event?.payload?.paths;
        void handleOpenedFiles(paths);
    });

    // 获取启动时传入的文件（可能在监听器设置之前就已经触发）
    try {
        const initialPaths = await invoke('get_opened_files');
        if (initialPaths && initialPaths.length > 0) {
            void handleOpenedFiles(initialPaths);
        }
    } catch (error) {
        console.warn('[main] 获取初始打开文件失败:', error);
    }
}

/**
 * 将当前活跃编辑器内容写入会话缓存。
 */
function saveCurrentEditorContentToCache() {
    const currentFile = appState.getCurrentFile();
    const activeViewMode = appState.getActiveViewMode();
    const editor = editorRegistry.getMarkdownEditor();
    const codeEditor = editorRegistry.getCodeEditor();
    const workflowEditor = editorRegistry.getWorkflowEditor();

    // 对于 untitled 文件，保存到 untitledFileManager 中
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

/**
 * 打开设置对话框并确保依赖加载完毕。
 */
async function openSettingsDialog() {
    if (!SettingsDialogCtor) {
        const coreModules = await loadCoreModules();
        SettingsDialogCtor = coreModules.SettingsDialog;
    }

    let settingsDialog = appState.getSettingsDialog();
    if (!settingsDialog) {
        settingsDialog = new SettingsDialogCtor({
            onSubmit: handleSettingsSubmit,
        });
        appState.setSettingsDialog(settingsDialog);
        const availableFontFamilies = appState.getAvailableFontFamilies();
        if (availableFontFamilies.length > 0) {
            settingsDialog.setAvailableFonts(availableFontFamilies);
        }
    }

    settingsDialog.open(appState.getEditorSettings());
}

/**
 * 显示 About 对话框
 */
async function showAboutDialog() {
    const version = await getVersion();

    const overlay = document.createElement('div');
    overlay.className = 'about-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'about-dialog';
    dialog.innerHTML = `
        <div class="about-app-name">Mark2</div>
        <div class="about-version">Version ${version}</div>
        <button class="about-ok-button">OK</button>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const closeDialog = () => {
        document.body.removeChild(overlay);
    };

    dialog.querySelector('.about-ok-button').addEventListener('click', closeDialog);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            closeDialog();
        }
    });
}

/**
 * 响应设置提交事件并持久化编辑器偏好。
 */
async function handleSettingsSubmit(nextSettings) {
    const currentSettings = appState.getEditorSettings();
    const merged = {
        ...currentSettings,
        ...nextSettings,
    };

    const normalizedSettings = normalizeEditorSettings(merged);
    appState.setEditorSettings(normalizedSettings);
    applyEditorSettings(normalizedSettings);
    editorRegistry.getCodeEditor()?.applyPreferences?.(normalizedSettings);
    saveEditorSettings(normalizedSettings);
}

function handleUndoCommand() {
    invokeEditorHistoryAction('undo');
}

function handleRedoCommand() {
    invokeEditorHistoryAction('redo');
}

function invokeEditorHistoryAction(action) {
    const editor = editorRegistry.getMarkdownEditor();
    const codeEditor = editorRegistry.getCodeEditor();

    const attemptMarkdown = () => {
        if (typeof editor?.[action] !== 'function') {
            return false;
        }
        return editor[action]();
    };
    const attemptCode = () => {
        if (typeof codeEditor?.[action] !== 'function') {
            return false;
        }
        return codeEditor[action]();
    };

    if (isMarkdownEditorFocused()) {
        if (attemptMarkdown()) {
            return true;
        }
        if (attemptCode()) {
            return true;
        }
        return false;
    }

    if (isCodeEditorFocused()) {
        if (attemptCode()) {
            return true;
        }
        if (attemptMarkdown()) {
            return true;
        }
        return false;
    }

    const activeViewMode = appState.getActiveViewMode();
    if (activeViewMode === 'code') {
        if (attemptCode()) {
            return true;
        }
        if (attemptMarkdown()) {
            return true;
        }
        return false;
    }

    if (activeViewMode === 'markdown' || activeViewMode === 'split') {
        if (attemptMarkdown()) {
            return true;
        }
        if (attemptCode()) {
            return true;
        }
        return false;
    }

    return attemptMarkdown() || attemptCode();
}

function isMarkdownEditorFocused() {
    const activeElement = document?.activeElement;
    if (!activeElement) {
        return false;
    }
    const editor = editorRegistry.getMarkdownEditor();
    const tiptapRoot = editor?.editor?.view?.dom;
    return Boolean(tiptapRoot && (tiptapRoot === activeElement || tiptapRoot.contains(activeElement)));
}

function isCodeEditorFocused() {
    const activeElement = document?.activeElement;
    if (!activeElement) {
        return false;
    }
    const codeEditor = editorRegistry.getCodeEditor();
    const codeHost = codeEditor?.editorHost;
    return Boolean(codeHost && (codeHost === activeElement || codeHost.contains(activeElement)));
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

        appState.setAvailableFontFamilies(normalized);
        const settingsDialog = appState.getSettingsDialog();
        if (settingsDialog) {
            settingsDialog.setAvailableFonts(normalized);
            settingsDialog.syncFontSelection(appState.getEditorSettings().fontFamily);
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
        const currentFile = appState.getCurrentFile();
        const activeViewMode = appState.getActiveViewMode();
        const statusBarController = appState.getStatusBarController();
        const editor = editorRegistry.getMarkdownEditor();
        const codeEditor = editorRegistry.getCodeEditor();
        const hasUnsavedChanges = appState.getHasUnsavedChanges();

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
 * 注册窗口卸载时的清理钩子。
 */
function setupCleanupHandlers() {
    window.addEventListener('beforeunload', cleanupResources);
    setupWindowCloseHandler();
}

/**
 * 设置窗口关闭拦截，检查未保存的 untitled 文件
 */
async function setupWindowCloseHandler() {
    try {
        const currentWindow = getCurrentWindow();
        await currentWindow.onCloseRequested(async (event) => {
            // 检查是否有未保存的 untitled 文件
            const tabManager = appState.getTabManager();
            const allTabs = tabManager?.getAllTabs() || [];
            const untitledTabs = allTabs.filter(tab =>
                tab.path && untitledFileManager.isUntitledPath(tab.path)
            );

            if (untitledTabs.length === 0) {
                return; // 没有 untitled 文件，允许关闭
            }

            // 获取当前文件的内容
            const currentFile = appState.getCurrentFile();
            let hasContent = false;

            for (const tab of untitledTabs) {
                if (tab.path === currentFile) {
                    // 当前激活的 untitled 文件，从编辑器获取内容
                    const editor = editorRegistry.getMarkdownEditor();
                    const codeEditor = editorRegistry.getCodeEditor();
                    const activeViewMode = appState.getActiveViewMode();

                    let content = '';
                    if (activeViewMode === 'markdown' && editor) {
                        content = editor.getMarkdown?.() || '';
                    } else if (activeViewMode === 'code' && codeEditor) {
                        content = codeEditor.getValue?.() || '';
                    }

                    if (content.trim().length > 0) {
                        hasContent = true;
                        untitledFileManager.setContent(tab.path, content);
                    }
                } else {
                    // 非当前激活的 untitled 文件，检查缓存内容
                    if (untitledFileManager.hasUnsavedChanges(tab.path)) {
                        hasContent = true;
                    }
                }
            }

            if (!hasContent) {
                return; // 所有 untitled 文件都是空的，允许关闭
            }

            // 阻止关闭并询问用户
            event.preventDefault();

            const displayNames = untitledTabs
                .filter(tab => {
                    if (tab.path === currentFile) {
                        const content = untitledFileManager.getContent(tab.path) || '';
                        return content.trim().length > 0;
                    }
                    return untitledFileManager.hasUnsavedChanges(tab.path);
                })
                .map(tab => untitledFileManager.getDisplayName(tab.path))
                .join(', ');

            const shouldSave = await confirm(
                `"${displayNames}" 尚未保存，是否保存？`,
                {
                    title: '保存文件',
                    kind: 'warning',
                    okLabel: '保存',
                    cancelLabel: '不保存',
                }
            );

            if (shouldSave === true) {
                // 用户选择保存，逐个保存 untitled 文件
                for (const tab of untitledTabs) {
                    const content = untitledFileManager.getContent(tab.path) || '';
                    if (content.trim().length > 0) {
                        const saved = await saveUntitledFile(tab.path, content);
                        if (!saved) {
                            // 用户取消了保存对话框，不关闭窗口
                            return;
                        }
                    }
                }
            }
            // 用户选择"不保存"或保存完成后，关闭窗口
            currentWindow.destroy();
        });
    } catch (error) {
        console.warn('设置窗口关闭处理器失败:', error);
    }
}

/**
 * 清理运行期资源，确保退出时释放引用。
 */
function cleanupResources() {
    // 执行所有注册的清理函数
    appState.executeAllCleanups();

    // 清理文件拖放控制器
    const fileDropController = appState.getFileDropController();
    if (fileDropController) {
        fileDropController.teardown();
        appState.setFileDropController(null);
    }

    // 清理状态栏控制器
    const statusBarController = appState.getStatusBarController();
    statusBarController?.teardown?.();
    appState.setStatusBarController(null);

    // 清理文件监听控制器
    const fileWatcherController = appState.getFileWatcherController();
    if (fileWatcherController) {
        fileWatcherController.cleanup();
        appState.setFileWatcherController(null);
    }


    // 清理终端面板
    if (terminalPanel?.destroy) {
        terminalPanel.destroy();
    }

    // 清理文件会话
    fileSession.clearAll();

    // 清理 UI 组件
    const fileTree = appState.getFileTree();
    fileTree?.dispose?.();

    // 销毁所有编辑器
    editorRegistry.destroyAll();
}
