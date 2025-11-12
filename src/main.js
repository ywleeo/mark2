import { confirm } from '@tauri-apps/plugin-dialog';
import { getCurrentWindow } from '@tauri-apps/api/window';
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
    revealInFileManager,
} from './api/filesystem.js';
import { registerDocumentIO, getDocumentApi } from './api/document.js';
import { setExportMenuEnabled } from './api/native.js';
import { createAppServices } from './services/appServices.js';
import { createFileService } from './services/fileService.js';
import { registerMenuListeners } from './modules/menuListeners.js';
import { createFileSession } from './modules/fileSession.js';
import { createFileWatcherController } from './modules/fileWatchers.js';
import { createDefaultWorkspaceState, loadWorkspaceState, saveWorkspaceState } from './utils/workspaceState.js';
import { createStatusBarController } from './modules/statusBarController.js';
import { createMarkdownCodeMode } from './modules/markdownCodeMode.js';
import { createFileDropController } from './modules/fileDropController.js';
import { createWorkspaceController } from './modules/workspaceController.js';
import { createNavigationController } from './modules/navigationController.js';
import { createFileOperations } from './modules/fileOperations.js';
import { createFileMenuActions } from './modules/fileMenuActions.js';
import { PluginManager } from './core/PluginManager.js';
import { eventBus } from './core/EventBus.js';
import { createDocumentIO } from './core/DocumentIO.js';

let MarkdownEditorCtor = null;
let CodeEditorCtor = null;
let ImageViewerCtor = null;
let SpreadsheetViewerCtor = null;
let PdfViewerCtor = null;
let FileTreeCtor = null;
let TabManagerCtor = null;
let SettingsDialogCtor = null;
let UnsupportedViewerCtor = null;
let ensureCoreModulesPromise = null;

/**
 * 确保核心组件模块只被加载一次，并缓存各构造器引用。
 */
async function ensureCoreModules() {
    if (!ensureCoreModulesPromise) {
        ensureCoreModulesPromise = (async () => {
            const [
                editorModule,
                codeEditorModule,
                imageViewerModule,
                spreadsheetViewerModule,
                pdfViewerModule,
                unsupportedViewerModule,
                fileTreeModule,
                tabManagerModule,
                settingsModule,
            ] = await Promise.all([
                import('./components/MarkdownEditor.js'),
                import('./components/CodeEditor.js'),
                import('./components/ImageViewer.js'),
                import('./components/SpreadsheetViewer.js'),
                import('./components/PdfViewer.js'),
                import('./components/UnsupportedViewer.js'),
                import('./components/FileTree.js'),
                import('./components/TabManager.js'),
                import('./components/SettingsDialog.js'),
            ]);

            MarkdownEditorCtor = editorModule.MarkdownEditor;
            CodeEditorCtor = codeEditorModule.CodeEditor;
            ImageViewerCtor = imageViewerModule.ImageViewer;
            SpreadsheetViewerCtor = spreadsheetViewerModule.SpreadsheetViewer;
            PdfViewerCtor = pdfViewerModule.PdfViewer;
            UnsupportedViewerCtor = unsupportedViewerModule.UnsupportedViewer;
            FileTreeCtor = fileTreeModule.FileTree;
            TabManagerCtor = tabManagerModule.TabManager;
            SettingsDialogCtor = settingsModule.SettingsDialog;
        })();
    }

    await ensureCoreModulesPromise;
}

let toPngRenderer = null;

/**
 * 按需加载 html-to-image 并返回渲染方法。
 */
async function ensureToPng() {
    if (!toPngRenderer) {
        const module = await import('html-to-image');
        toPngRenderer = module.toPng;
    }

    return toPngRenderer;
}

console.log('Mark2 Tauri 版本已启动');

let currentFile = null;
let editor = null;
let codeEditor = null;
let imageViewer = null;
let spreadsheetViewer = null;
let pdfViewer = null;
let unsupportedViewer = null;
let fileTree = null;
let tabManager = null;
let settingsDialog = null;
let hasUnsavedChanges = false;
const fileService = createFileService();
const fileSession = createFileSession({
    fileService,
    getViewModeForPath,
});
let editorSettings = { ...defaultEditorSettings };
let availableFontFamilies = [];
let markdownPaneElement = null;
let codeEditorPaneElement = null;
let imagePaneElement = null;
let unsupportedPaneElement = null;
let spreadsheetPaneElement = null;
let pdfPaneElement = null;
let viewContainerElement = null;
let pdfZoomState = {
    zoomValue: 1,
    canZoomIn: true,
    canZoomOut: true,
};
const markdownScrollPositions = new Map();
let activeViewMode = 'markdown';
let keyboardShortcutCleanup = null;
let sidebarResizerCleanup = null;
let menuListenersCleanup = null;
let fileWatcherController = null;
let fileDropCleanup = null;
let isSidebarHidden = false;
let statusBarController = null;
let markdownCodeMode = null;
let fileDropController = null;
let pluginManager = null;
let documentIO = null;
let exportMenuEnabledState = null;
let appServices = null;
const ZOOM_DEFAULT = 1;
const ZOOM_MIN = 0.6;
const ZOOM_MAX = 2.4;
const ZOOM_STEP = 0.1;
const ZOOM_SUPPORTED_VIEWS = new Set(['markdown', 'code', 'image', 'pdf', 'spreadsheet']);
let contentZoom = ZOOM_DEFAULT;
let appearanceChangeCleanup = null;

appearanceChangeCleanup = onEditorAppearanceChange(() => {
    codeEditor?.applyPreferences?.(editorSettings);
});

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

async function insertTextIntoActiveEditor(text, options = {}) {
    const nextText = typeof text === 'string' ? text : '';
    const position = options?.position || 'cursor';
    const mode = activeViewMode || 'markdown';

    const tryInsertIntoMarkdownEditor = () => {
        if (!editor?.editor) {
            return false;
        }

        const tiptapEditor = editor.editor;
        if (!tiptapEditor) {
            return false;
        }

        if (position === 'replace') {
            if (typeof editor.insertTextAtCursor !== 'function') {
                return false;
            }
            editor.insertTextAtCursor(nextText);
            return true;
        }

        if (position === 'end') {
            const docSize = tiptapEditor.state?.doc?.content?.size ?? tiptapEditor.state?.doc?.nodeSize ?? 0;
            if (typeof tiptapEditor.commands?.setTextSelection === 'function' && docSize >= 0) {
                tiptapEditor.commands.setTextSelection({ from: docSize, to: docSize });
            }
            if (typeof editor.insertTextAtCursor !== 'function') {
                return false;
            }
            editor.insertTextAtCursor(nextText);
            return true;
        }

        if (position === 'cursor') {
            if (typeof editor.insertTextAtCursor !== 'function') {
                return false;
            }
            editor.insertTextAtCursor(nextText);
            return true;
        }

        return false;
    };

    const tryInsertIntoCodeEditor = () => {
        if (!codeEditor) {
            return false;
        }

        if (position === 'replace') {
            if (typeof codeEditor.replaceSelectionWithText === 'function') {
                codeEditor.replaceSelectionWithText(nextText);
                return true;
            }
            if (typeof codeEditor.insertTextAtCursor === 'function') {
                codeEditor.insertTextAtCursor(nextText);
                return true;
            }
            return false;
        }

        if (position === 'end') {
            const instance = codeEditor.editor;
            const monaco = codeEditor.monaco;
            const model = instance?.getModel?.();
            if (instance && monaco && model) {
                const lineNumber = model.getLineCount();
                const column = model.getLineMaxColumn(lineNumber);
                instance.setPosition({ lineNumber, column });
                if (typeof codeEditor.insertTextAtCursor === 'function') {
                    codeEditor.insertTextAtCursor(nextText);
                    return true;
                }
            }
            return false;
        }

        if (position === 'cursor') {
            if (typeof codeEditor.insertTextAtCursor !== 'function') {
                return false;
            }
            codeEditor.insertTextAtCursor(nextText);
            return true;
        }

        return false;
    };

    if (mode === 'code' && tryInsertIntoCodeEditor()) {
        return;
    }

    if (mode === 'markdown' && tryInsertIntoMarkdownEditor()) {
        return;
    }

    if (tryInsertIntoMarkdownEditor()) {
        return;
    }

    if (tryInsertIntoCodeEditor()) {
        return;
    }

    console.warn('[Main] 插入文本失败：未找到可用编辑器', { position, mode });
}

function rememberMarkdownScrollPosition(filePath = currentFile, viewMode = activeViewMode) {
    if (!filePath || !viewContainerElement) {
        return;
    }
    if (viewMode !== 'markdown') {
        return;
    }
    const scrollTop = viewContainerElement.scrollTop || 0;
    markdownScrollPositions.set(filePath, scrollTop);
}

function restoreMarkdownScrollPosition(filePath) {
    if (!filePath || !viewContainerElement) {
        return;
    }
    const target = markdownScrollPositions.get(filePath) ?? 0;
    viewContainerElement.scrollTop = target;
    window.requestAnimationFrame(() => {
        if (!viewContainerElement) {
            return;
        }
        viewContainerElement.scrollTop = target;
    });
}

const VIEW_MODE_BEHAVIORS = {
    markdown: {
        getPane: () => markdownPaneElement,
        onEnter: () => {
            codeEditor?.hide?.();
            imageViewer?.hide?.();
            spreadsheetViewer?.hide?.();
            pdfViewer?.hide?.();
            unsupportedViewer?.hide?.();
        },
    },
    code: {
        getPane: () => codeEditorPaneElement,
        onEnter: () => {
            imageViewer?.hide?.();
            spreadsheetViewer?.hide?.();
            pdfViewer?.hide?.();
            unsupportedViewer?.hide?.();
        },
    },
    image: {
        getPane: () => imagePaneElement,
        onEnter: () => {
            editor?.clear?.();
            codeEditor?.hide?.();
            imageViewer?.show?.();
            spreadsheetViewer?.hide?.();
            pdfViewer?.hide?.();
            unsupportedViewer?.hide?.();
        },
    },
    spreadsheet: {
        getPane: () => spreadsheetPaneElement,
        onEnter: () => {
            editor?.clear?.();
            codeEditor?.hide?.();
            imageViewer?.hide?.();
            pdfViewer?.hide?.();
            unsupportedViewer?.hide?.();
            spreadsheetViewer?.show?.();
        },
    },
    pdf: {
        getPane: () => pdfPaneElement,
        onEnter: () => {
            editor?.clear?.();
            codeEditor?.hide?.();
            imageViewer?.hide?.();
            spreadsheetViewer?.hide?.();
            unsupportedViewer?.hide?.();
            pdfViewer?.show?.();
        },
    },
    unsupported: {
        getPane: () => unsupportedPaneElement,
        onEnter: () => {
            editor?.clear?.();
            codeEditor?.hide?.();
            imageViewer?.hide?.();
            spreadsheetViewer?.hide?.();
            pdfViewer?.hide?.();
        },
    },
};

function clampZoomValue(value) {
    if (!Number.isFinite(value)) {
        return ZOOM_DEFAULT;
    }
    return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
}

function isZoomSupportedView(mode) {
    return ZOOM_SUPPORTED_VIEWS.has(mode);
}

function applyContentZoom() {
    const root = document.documentElement;
    if (root) {
        root.style.setProperty('--content-zoom', contentZoom.toString());
        root.style.setProperty('--editor-zoom-scale', contentZoom.toString());
    }
    codeEditor?.setZoomScale?.(contentZoom);
    imageViewer?.setZoomScale?.(contentZoom);
    spreadsheetViewer?.setZoomScale?.(contentZoom);
    updateZoomDisplayForActiveView();
}

function setContentZoom(nextZoom, { silent } = {}) {
    const clamped = clampZoomValue(nextZoom);
    if (Math.abs(clamped - contentZoom) < 0.001 && !silent) {
        return;
    }
    contentZoom = clamped;
    applyContentZoom();
}

function adjustContentZoom(delta) {
    setContentZoom(contentZoom + delta);
}

function updateZoomDisplayForActiveView() {
    const supported = isZoomSupportedView(activeViewMode);
    statusBarController?.setZoomVisibility?.(supported);
    if (!supported) {
        return;
    }
    if (activeViewMode === 'pdf') {
        const zoomState = pdfViewer?.getZoomState?.() || pdfZoomState;
        pdfZoomState = zoomState || pdfZoomState;
        statusBarController?.updateZoomDisplay?.(pdfZoomState);
        return;
    }
    statusBarController?.updateZoomDisplay?.({
        zoomValue: contentZoom,
        canZoomIn: contentZoom < ZOOM_MAX - 0.001,
        canZoomOut: contentZoom > ZOOM_MIN + 0.001,
    });
}

function handleZoomControl(delta) {
    if (activeViewMode === 'pdf') {
        void pdfViewer?.adjustZoomScale?.(delta);
        return;
    }
    adjustContentZoom(delta);
}

function setActiveViewMode(nextMode) {
    const config = VIEW_MODE_BEHAVIORS[nextMode];
    if (!config) {
        return;
    }
    if (activeViewMode === 'markdown' && nextMode !== 'markdown') {
        rememberMarkdownScrollPosition(currentFile, activeViewMode);
    }

    Object.entries(VIEW_MODE_BEHAVIORS).forEach(([mode, entry]) => {
        const pane = entry.getPane?.();
        if (!pane) {
            return;
        }
        if (mode === nextMode) {
            pane.classList.add('is-active');
        } else {
            pane.classList.remove('is-active');
        }
    });

    config.onEnter?.();
    if (nextMode !== 'pdf') {
        statusBarController?.setPageInfo?.('');
    }
    activeViewMode = nextMode;
    updateZoomDisplayForActiveView();
    void updateExportMenuState();
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
appServices = createAppServices({ fileService });

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
    getSpreadsheetViewer: () => spreadsheetViewer,
    getPdfViewer: () => pdfViewer,
    getUnsupportedViewer: () => unsupportedViewer,
    getMarkdownCodeMode: () => markdownCodeMode,
    getCurrentFile: () => currentFile,
    setCurrentFile: (value) => {
        currentFile = value;
        window.currentFile = value;  // 同时导出到 window
        void updateExportMenuState();
    },
    getActiveViewMode: () => activeViewMode,
    setHasUnsavedChanges: (value) => {
        hasUnsavedChanges = value;
    },
    fileSession,
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
    activateSpreadsheetView,
    activatePdfView,
    activateUnsupportedView,
});

/**
 * 激活 Markdown 视图并隐藏其余面板。
 */
function activateMarkdownView() {
    setActiveViewMode('markdown');
}
/**
 * 激活代码编辑器视图并隐藏其他面板。
 */
function activateCodeView() {
    setActiveViewMode('code');
}
/**
 * 激活图片预览视图并隐藏其他面板。
 */
function activateImageView() {
    setActiveViewMode('image');
}
/**
 * 激活表格视图。
 */
function activateSpreadsheetView() {
    setActiveViewMode('spreadsheet');
}
/**
 * 激活 PDF 视图。
 */
function activatePdfView() {
    setActiveViewMode('pdf');
}
/**
 * 切换到不受支持文件的提示视图。
 */
function activateUnsupportedView() {
    setActiveViewMode('unsupported');
}

function setSidebarVisibility(hidden) {
    const body = document.body;
    const sidebar = document.getElementById('sidebar');
    const resizer = document.getElementById('sidebarResizer');
    if (!body || !sidebar || !resizer) {
        return;
    }

    if (hidden && !isSidebarHidden) {
        const currentWidth = sidebar.style.width;
        sidebar.dataset.previousWidth = currentWidth ?? '';
    }

    if (hidden) {
        body.classList.add('is-sidebar-hidden');
        sidebar.setAttribute('aria-hidden', 'true');
        resizer.setAttribute('aria-hidden', 'true');
    } else {
        body.classList.remove('is-sidebar-hidden');
        sidebar.removeAttribute('aria-hidden');
        resizer.removeAttribute('aria-hidden');
        const previousWidth = sidebar.dataset.previousWidth;
        if (typeof previousWidth === 'string') {
            if (previousWidth.length > 0) {
                sidebar.style.width = previousWidth;
            } else {
                sidebar.style.removeProperty('width');
            }
        }
        delete sidebar.dataset.previousWidth;
    }

    isSidebarHidden = hidden;
}

function toggleSidebarVisibility() {
    setSidebarVisibility(!isSidebarHidden);
}

function toggleStatusBarVisibility() {
    statusBarController?.toggleStatusBarVisibility();
}

/**
 * 清空所有编辑器内容并重置活动文件。
 */
function clearActiveFileView() {
    // 先重置文件状态，避免清理编辑器时触发的更新回调使用旧路径更新窗口标题
    currentFile = null;
    window.currentFile = null;
    hasUnsavedChanges = false;

    editor?.clear?.();
    codeEditor?.clear?.();
    imageViewer?.clear?.();
    spreadsheetViewer?.clear?.();
    pdfViewer?.clear?.();
    unsupportedViewer?.clear?.();
    activateMarkdownView();
    markdownCodeMode?.reset();
    updateWindowTitle();
    persistWorkspaceState({ currentFile: null });
}

function persistWorkspaceState(overrides = {}, options = {}) {
    workspaceController?.persistWorkspaceState(overrides, options);
}

function handleSidebarStateChange(sidebarState) {
    workspaceController?.handleSidebarStateChange(sidebarState);
}

async function restoreWorkspaceStateFromStorage() {
    if (!workspaceController) {
        return;
    }
    await workspaceController.restoreWorkspaceStateFromStorage();
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
    saveCurrentEditorContentToCache,
    clearActiveFileView,
    loadFile,
    fileSession,
    persistWorkspaceState,
    confirm,
    saveFile,
    getActiveViewMode: () => activeViewMode,
    getEditor: () => editor,
    getCodeEditor: () => codeEditor,
});

const {
    createNewFile: handleCreateNewFile,
    deleteActiveFile: handleDeleteActiveFile,
    moveActiveFile: handleMoveActiveFile,
    renameActiveFile: handleRenameActiveFile,
    handleTabRenameConfirm,
    handleTabRenameCancel,
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
});

// 基础初始化代码
document.addEventListener('DOMContentLoaded', () => {
    void initializeApplication();
});

/**
 * 执行应用初始化流程，构建 UI 并加载配置。
 */
async function initializeApplication() {

    await ensureCoreModules();

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
        <div class="view-pane spreadsheet-pane" data-pane="spreadsheet"></div>
        <div class="view-pane pdf-pane" data-pane="pdf"></div>
        <div class="view-pane unsupported-pane" data-pane="unsupported"></div>
    `;

    markdownPaneElement = requireElementWithin(viewContainer, '.markdown-pane', '视图容器缺少 markdown-pane');
    codeEditorPaneElement = requireElementWithin(viewContainer, '.code-pane', '视图容器缺少 code-pane');
    imagePaneElement = requireElementWithin(viewContainer, '.image-pane', '视图容器缺少 image-pane');
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
    revealInFileManager,
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
        },
        onAutoSaveSuccess: async ({ skipped }) => {
            const activeFile = currentFile;
            if (!activeFile) {
                return;
            }
            if (!skipped) {
                hasUnsavedChanges = false;
                fileSession.clearEntry(activeFile);
            }
            await updateWindowTitle();
        },
        onAutoSaveError: (error) => {
            console.error('自动保存失败:', error);
        },
    };

    editor = new MarkdownEditorCtor(markdownPaneElement, editorCallbacks);
    codeEditor = new CodeEditorCtor(codeEditorPaneElement, editorCallbacks);
    codeEditor.applyPreferences?.(editorSettings);
    codeEditor.hide();
    imageViewer = new ImageViewerCtor(imagePaneElement);
    imageViewer.hide();
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
    setContentZoom(contentZoom, { silent: true });

    // 将代码编辑器引用传递给 Markdown 编辑器的搜索管理器
    editor.setCodeEditor(codeEditor);

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

    // 初始化文件树
    const fileTreeElement = document.getElementById('fileTree');
    fileTree = new FileTreeCtor(fileTreeElement, handleFileSelect, {
        onFolderChange: (...args) => fileWatcherController?.handleFolderWatcherEvent(...args),
        onFileChange: (...args) => fileWatcherController?.handleFileWatcherEvent(...args),
        onOpenFilesChange: handleOpenFilesChange,
        onStateChange: handleSidebarStateChange,
    });

    const tabBarElement = document.getElementById('tabBar');
    tabManager = new TabManagerCtor(tabBarElement, {
        onTabSelect: handleTabSelect,
        onTabClose: handleTabClose,
        onRenameConfirm: handleTabRenameConfirm,
        onRenameCancel: handleTabRenameCancel,
    });

    fileWatcherController = createFileWatcherController({
        fileTree,
        normalizeFsPath,
        getCurrentFile: () => currentFile,
        getActiveViewMode: () => activeViewMode,
        getEditor: () => editor,
        getCodeEditor: () => codeEditor,
        scheduleLoadFile: async (path) => {
            await loadFile(path, { skipWatchSetup: true, forceReload: true });
        },
        fileSession,
    });

    await restoreWorkspaceStateFromStorage();

    editorSettings = loadEditorSettings();
    applyEditorSettings(editorSettings);
    codeEditor.applyPreferences?.(editorSettings);
    // 保存一次以更新 localStorage 中的旧数据（如旧主题名）
    saveEditorSettings(editorSettings);

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
        onToggleSidebar: toggleSidebarVisibility,
        onToggleMarkdownCodeView: toggleMarkdownCodeMode,
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
        onToggleAiAssistant: toggleAiSidebarVisibility,
        onOpenAiSettings: openAiSettingsDialog,
        onDeleteActiveFile: handleDeleteActiveFile,
        onMoveActiveFile: handleMoveActiveFile,
        onRenameActiveFile: handleRenameActiveFile,
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
    await ensureCoreModules();

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

async function toggleMarkdownCodeMode() {
    if (!markdownCodeMode) {
        return;
    }

    const result = await markdownCodeMode.toggle({
        currentFile,
        activeViewMode,
        editor,
        codeEditor,
    });

    if (!result.changed) {
        return;
    }

    activeViewMode = result.nextViewMode;
    hasUnsavedChanges = result.hasUnsavedChanges;

    fileSession.saveCurrentEditorContentToCache({
        currentFile,
        activeViewMode,
        editor,
        codeEditor,
    });
    persistWorkspaceState();
    void updateWindowTitle();
}

/**
 * 根据当前文件状态动态更新窗口标题。
 */
async function updateWindowTitle() {
    try {
        const window = getCurrentWindow();
        let windowTitle = 'Mark2';
        let wordCount = 0;
        let lastModified = '';

        if (currentFile) {
            const fileName = currentFile.split('/').pop() || currentFile;

            // 获取字数
            wordCount = statusBarController
                ? statusBarController.calculateWordCount({ activeViewMode, editor, codeEditor })
                : 0;

            // 获取最后编辑时间
            lastModified = statusBarController
                ? (await statusBarController.getLastModifiedTime(currentFile)) ?? ''
                : '';

            // 构建标题
            const parts = [fileName];

            if (wordCount > 0) {
                parts.push(`${wordCount} 字`);
            }

            if (lastModified) {
                parts.push(lastModified);
            }

            if (hasUnsavedChanges) {
                parts.push('已编辑');
            }

            windowTitle = hasUnsavedChanges ? `${fileName} • 已编辑` : fileName;
        }

        statusBarController?.updateStatusBar({
            filePath: currentFile,
            wordCount,
            lastModified,
            isDirty: hasUnsavedChanges,
        });
        await window.setTitle(windowTitle);
    } catch (error) {
        console.error('更新窗口标题失败:', error);
    }
}

async function requestActiveEditorContext(options = {}) {
    const preferSelection = options?.preferSelection !== false;
    const normalize = (value) => (typeof value === 'string' ? value.trim() : '');
    const activeFile = currentFile;

    if (!activeFile) {
        return '';
    }

    const readFromSession = async () => {
        try {
            const data = await fileSession.getFileContent(activeFile);
            return normalize(data?.content ?? '');
        } catch (_error) {
            return '';
        }
    };

    const readMarkdownSelection = () => {
        if (editor?.currentFile !== activeFile) {
            return '';
        }
        return normalize(editor?.getSelectedMarkdown?.());
    };

    const readMarkdownFull = () => {
        if (editor?.currentFile !== activeFile) {
            return '';
        }
        return normalize(editor?.getMarkdown?.());
    };

    const readCodeSelection = () => {
        if (codeEditor?.currentFile !== activeFile) {
            return '';
        }
        return normalize(codeEditor?.getSelectionText?.());
    };

    const readCodeFull = () => {
        if (codeEditor?.currentFile !== activeFile) {
            return '';
        }
        return normalize(codeEditor?.getValue?.());
    };

    if (activeViewMode === 'code') {
        if (preferSelection) {
            const codeSelection = readCodeSelection();
            if (codeSelection) {
                return codeSelection;
            }
            const markdownSelection = readMarkdownSelection();
            if (markdownSelection) {
                return markdownSelection;
            }
        }

        const fullCode = readCodeFull();
        if (fullCode) {
            return fullCode;
        }

        const markdownFallback = readMarkdownFull();
        if (markdownFallback) {
            return markdownFallback;
        }

        return await readFromSession();
    }

    if (preferSelection) {
        const markdownSelection = readMarkdownSelection();
        if (markdownSelection) {
            return markdownSelection;
        }
    }

    const fullMarkdown = readMarkdownFull();
    if (fullMarkdown) {
        return fullMarkdown;
    }

    if (preferSelection) {
        const codeSelection = readCodeSelection();
        if (codeSelection) {
            return codeSelection;
        }
    }

    const codeFallback = readCodeFull();
    if (codeFallback) {
        return codeFallback;
    }

    return await readFromSession();
}

function showAiSidebar() {
    const aiApi = pluginManager?.getPluginApi('ai-assistant');
    aiApi?.showSidebar();
}

function hideAiSidebar() {
    const aiApi = pluginManager?.getPluginApi('ai-assistant');
    aiApi?.hideSidebar();
}

function toggleAiSidebarVisibility() {
    const aiApi = pluginManager?.getPluginApi('ai-assistant');
    aiApi?.toggleSidebar();
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
