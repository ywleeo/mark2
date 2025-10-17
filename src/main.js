import { confirm } from '@tauri-apps/plugin-dialog';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { detectLanguageForPath, getViewModeForPath } from './utils/fileTypeUtils.js';
import {
    applyEditorSettings,
    defaultEditorSettings,
    loadEditorSettings,
    normalizeEditorSettings,
    saveEditorSettings,
} from './utils/editorSettings.js';
import { normalizeFsPath, normalizeSelectedPaths } from './utils/pathUtils.js';
import { setupKeyboardShortcuts } from './utils/shortcuts.js';
import { setupSidebarResizer } from './utils/sidebarResizer.js';
import { exportCurrentViewToImage, exportCurrentViewToPdf } from './modules/menuExports.js';
import {
    getFileMetadata,
    isDirectory,
    listFonts,
    pickPaths,
    readFile,
    writeFile,
} from './modules/fileGateway.js';
import { registerMenuListeners } from './modules/menuListeners.js';
import { createFileSession } from './modules/fileSession.js';
import { createFileWatcherController } from './modules/fileWatchers.js';
import { createDefaultWorkspaceState, loadWorkspaceState, saveWorkspaceState } from './utils/workspaceState.js';

let MarkdownEditorCtor = null;
let CodeEditorCtor = null;
let ImageViewerCtor = null;
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
                unsupportedViewerModule,
                fileTreeModule,
                tabManagerModule,
                settingsModule,
            ] = await Promise.all([
                import('./components/MarkdownEditor.js'),
                import('./components/CodeEditor.js'),
                import('./components/ImageViewer.js'),
                import('./components/UnsupportedViewer.js'),
                import('./components/FileTree.js'),
                import('./components/TabManager.js'),
                import('./components/SettingsDialog.js'),
            ]);

            MarkdownEditorCtor = editorModule.MarkdownEditor;
            CodeEditorCtor = codeEditorModule.CodeEditor;
            ImageViewerCtor = imageViewerModule.ImageViewer;
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
let unsupportedViewer = null;
let fileTree = null;
let tabManager = null;
let settingsDialog = null;
let isOpeningFromLink = false;
let hasUnsavedChanges = false;
const fileSession = createFileSession({ readFile, getViewModeForPath });
let editorSettings = { ...defaultEditorSettings };
let availableFontFamilies = [];
let markdownPaneElement = null;
let codeEditorPaneElement = null;
let imagePaneElement = null;
let unsupportedPaneElement = null;
let activeViewMode = 'markdown';
let keyboardShortcutCleanup = null;
let sidebarResizerCleanup = null;
let menuListenersCleanup = null;
let fileWatcherController = null;
let isRestoringWorkspaceState = false;
let fileDropCleanup = null;
let isFileDropHoverActive = false;

/**
 * 激活 Markdown 视图并隐藏其余面板。
 */
function activateMarkdownView() {
    markdownPaneElement?.classList.add('is-active');
    codeEditorPaneElement?.classList.remove('is-active');
    imagePaneElement?.classList.remove('is-active');
    unsupportedPaneElement?.classList.remove('is-active');
    codeEditor?.hide?.();
    imageViewer?.hide?.();
    unsupportedViewer?.hide?.();
    activeViewMode = 'markdown';
}
/**
 * 激活代码编辑器视图并隐藏其他面板。
 */
function activateCodeView() {
    markdownPaneElement?.classList.remove('is-active');
    codeEditorPaneElement?.classList.add('is-active');
    imagePaneElement?.classList.remove('is-active');
    unsupportedPaneElement?.classList.remove('is-active');
    imageViewer?.hide?.();
    unsupportedViewer?.hide?.();
    activeViewMode = 'code';
}
/**
 * 激活图片预览视图并隐藏其他面板。
 */
function activateImageView() {
    markdownPaneElement?.classList.remove('is-active');
    codeEditorPaneElement?.classList.remove('is-active');
    imagePaneElement?.classList.add('is-active');
    unsupportedPaneElement?.classList.remove('is-active');
    editor?.clear?.();
    codeEditor?.hide?.();
    imageViewer?.show?.();
    unsupportedViewer?.hide?.();
    activeViewMode = 'image';
}
/**
 * 切换到不受支持文件的提示视图。
 */
function activateUnsupportedView() {
    markdownPaneElement?.classList.remove('is-active');
    codeEditorPaneElement?.classList.remove('is-active');
    imagePaneElement?.classList.remove('is-active');
    unsupportedPaneElement?.classList.add('is-active');
    editor?.clear?.();
    codeEditor?.hide?.();
    imageViewer?.hide?.();
    activeViewMode = 'unsupported';
}
/**
 * 清空所有编辑器内容并重置活动文件。
 */
function clearActiveFileView() {
    editor?.clear?.();
    codeEditor?.clear?.();
    imageViewer?.clear?.();
    unsupportedViewer?.clear?.();
    activateMarkdownView();
    currentFile = null;
    hasUnsavedChanges = false;
    updateWindowTitle();
    persistWorkspaceState({ currentFile: null });
}

function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function getDefaultSidebarState() {
    return createDefaultWorkspaceState().sidebar;
}

function persistWorkspaceState(overrides = {}, options = {}) {
    const forcePersist = options.force === true;
    if (isRestoringWorkspaceState && !forcePersist) {
        return;
    }

    try {
        const defaultState = createDefaultWorkspaceState();
        const sidebarState = overrides.sidebar
            ?? fileTree?.getPersistedState?.()
            ?? defaultState.sidebar;
        const openFilesState = Array.isArray(overrides.openFiles)
            ? [...overrides.openFiles]
            : fileTree?.getOpenFilePaths?.()
                ? [...fileTree.getOpenFilePaths()]
                : [...defaultState.openFiles];

        const nextState = {
            currentFile,
            sidebar: sidebarState,
            openFiles: openFilesState,
            ...overrides,
        };

        if (!Object.prototype.hasOwnProperty.call(overrides, 'currentFile')) {
            nextState.currentFile = currentFile;
        }

        if (!Object.prototype.hasOwnProperty.call(overrides, 'sidebar')) {
            nextState.sidebar = sidebarState;
        }

        if (!Object.prototype.hasOwnProperty.call(overrides, 'openFiles')) {
            nextState.openFiles = openFilesState;
        }

        saveWorkspaceState(nextState);
    } catch (error) {
        console.warn('保存工作区状态失败', error);
    }
}

function handleSidebarStateChange(sidebarState) {
    if (isRestoringWorkspaceState) {
        return;
    }
    persistWorkspaceState({ sidebar: sidebarState });
}

async function sanitizeSidebarState(rawSidebar) {
    const defaultSidebar = getDefaultSidebarState();
    const sanitized = {
        rootPaths: [],
        expandedFolders: [],
        sectionStates: { ...defaultSidebar.sectionStates },
    };

    if (rawSidebar && typeof rawSidebar === 'object') {
        if (Array.isArray(rawSidebar.rootPaths)) {
            sanitized.rootPaths = Array.from(
                new Set(
                    rawSidebar.rootPaths
                        .filter(isNonEmptyString)
                        .map(path => path.trim())
                )
            );
        }

        if (Array.isArray(rawSidebar.expandedFolders)) {
            sanitized.expandedFolders = Array.from(
                new Set(
                    rawSidebar.expandedFolders
                        .filter(isNonEmptyString)
                        .map(key => key.trim())
                )
            );
        }

        if (rawSidebar.sectionStates && typeof rawSidebar.sectionStates === 'object') {
            if (typeof rawSidebar.sectionStates.openFilesCollapsed === 'boolean') {
                sanitized.sectionStates.openFilesCollapsed = rawSidebar.sectionStates.openFilesCollapsed;
            }
            if (typeof rawSidebar.sectionStates.foldersCollapsed === 'boolean') {
                sanitized.sectionStates.foldersCollapsed = rawSidebar.sectionStates.foldersCollapsed;
            }
        }
    }

    const validRoots = [];
    for (const rootPath of sanitized.rootPaths) {
        try {
            const isDir = await isDirectory(rootPath);
            if (isDir) {
                validRoots.push(rootPath);
            }
        } catch (error) {
            console.warn('跳过无效的根目录', rootPath, error);
        }
    }

    sanitized.rootPaths = validRoots;
    if (sanitized.expandedFolders.length > 0 && validRoots.length > 0) {
        sanitized.expandedFolders = sanitized.expandedFolders.filter((key) => {
            return validRoots.some(root => key.includes(root));
        });
    } else if (validRoots.length === 0) {
        sanitized.expandedFolders = [];
    }

    return sanitized;
}

async function sanitizeOpenFiles(rawOpenFiles) {
    if (!Array.isArray(rawOpenFiles) || rawOpenFiles.length === 0) {
        return [];
    }

    const uniquePaths = Array.from(
        new Set(
            rawOpenFiles
                .filter(isNonEmptyString)
                .map(path => path.trim())
        )
    );

    const validFiles = [];
    for (const path of uniquePaths) {
        try {
            const isDirPath = await isDirectory(path);
            if (isDirPath) {
                continue;
            }
            await getFileMetadata(path);
            validFiles.push(path);
        } catch (error) {
            console.warn('跳过无效的标签页文件', path, error);
        }
    }

    return validFiles;
}

async function restoreWorkspaceStateFromStorage() {
    const stored = loadWorkspaceState();
    if (!stored) {
        return;
    }

    const sanitizedSidebar = await sanitizeSidebarState(stored.sidebar);
    const sanitizedOpenFiles = await sanitizeOpenFiles(stored.openFiles);

    isRestoringWorkspaceState = true;
    try {
        if (fileTree) {
            await fileTree.restoreState(sanitizedSidebar);
            if (typeof fileTree.restoreOpenFiles === 'function') {
                fileTree.restoreOpenFiles(sanitizedOpenFiles);
            }
        }
    } finally {
        isRestoringWorkspaceState = false;
    }

    let targetFileToRestore = null;
    if (stored.currentFile && isNonEmptyString(stored.currentFile)) {
        try {
            await getFileMetadata(stored.currentFile);
            const directory = await isDirectory(stored.currentFile);
            if (!directory) {
                targetFileToRestore = stored.currentFile;
            }
        } catch (error) {
            console.warn('恢复上次打开的文件失败', error);
        }
    }

    if (!targetFileToRestore && sanitizedOpenFiles.length > 0) {
        targetFileToRestore = sanitizedOpenFiles[sanitizedOpenFiles.length - 1];
    }

    if (targetFileToRestore) {
        fileTree?.selectFile(targetFileToRestore);
    } else {
        tabManager?.clearSharedTab?.();
    }

    const sidebarSnapshot = fileTree?.getPersistedState?.() ?? sanitizedSidebar;
    const openFilesSnapshot = fileTree?.getOpenFilePaths?.() ?? sanitizedOpenFiles;
    persistWorkspaceState({
        sidebar: sidebarSnapshot,
        openFiles: openFilesSnapshot,
    });
}

// 基础初始化代码
document.addEventListener('DOMContentLoaded', () => {
    void initializeApplication();
});

/**
 * 执行应用初始化流程，构建 UI 并加载配置。
 */
async function initializeApplication() {

    await ensureCoreModules();

    // 初始化主视图容器
    const viewContainer = document.getElementById('viewContent');
    if (!viewContainer) {
        throw new Error('未找到视图容器 viewContent');
    }
    viewContainer.innerHTML = `
        <div class="view-pane markdown-pane is-active" data-pane="markdown"></div>
        <div class="view-pane code-pane" data-pane="code"></div>
        <div class="view-pane image-pane" data-pane="image"></div>
        <div class="view-pane unsupported-pane" data-pane="unsupported"></div>
    `;

    markdownPaneElement = viewContainer.querySelector('.markdown-pane');
    codeEditorPaneElement = viewContainer.querySelector('.code-pane');
    imagePaneElement = viewContainer.querySelector('.image-pane');
    unsupportedPaneElement = viewContainer.querySelector('.unsupported-pane');
    if (!markdownPaneElement || !codeEditorPaneElement || !imagePaneElement || !unsupportedPaneElement) {
        throw new Error('视图容器渲染失败');
    }

    const editorCallbacks = {
        onContentChange: () => {
            hasUnsavedChanges = editor?.hasUnsavedChanges() || codeEditor?.hasUnsavedChanges() || false;
            updateWindowTitle();
        }
    };

    editor = new MarkdownEditorCtor(markdownPaneElement, editorCallbacks);
    codeEditor = new CodeEditorCtor(codeEditorPaneElement, editorCallbacks);
    codeEditor.applyPreferences?.(editorSettings);
    codeEditor.hide();
    imageViewer = new ImageViewerCtor(imagePaneElement);
    imageViewer.hide();
    unsupportedViewer = new UnsupportedViewerCtor(unsupportedPaneElement);
    unsupportedViewer.hide();
    activeViewMode = 'markdown';

    // 将代码编辑器引用传递给 Markdown 编辑器的搜索管理器
    editor.setCodeEditor(codeEditor);

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
    });
    menuListenersCleanup = await registerMenuListeners({
        onOpen: openFileOrFolder,
        onSettings: openSettingsDialog,
        onExportImage: () => exportCurrentViewToImage({ ensureToPng }),
        onExportPdf: () => exportCurrentViewToPdf({ activeViewMode }),
    });
    setupLinkNavigationListener();
    sidebarResizerCleanup = setupSidebarResizer();
    fileDropCleanup = await setupFileDropListeners();
    setupCleanupHandlers();

    loadAvailableFonts();

    // 初始化时清空窗口标题
    updateWindowTitle();
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
 * 从缓存或文件系统获取指定路径的内容。
 */
async function getFileContent(filePath, options = {}) {
    return await fileSession.getFileContent(filePath, options);
}

/**
 * 文件树选中文件时触发的加载逻辑。
 */
async function handleFileSelect(filePath) {
    if (!filePath) {
        saveCurrentEditorContentToCache();

        // 如果有 shared tab，切换到它，而不是清除
        const sharedTab = tabManager?.sharedTab;
        if (sharedTab && sharedTab.path) {
            // 切换到 shared tab
            try {
                await loadFile(sharedTab.path);
                tabManager?.setActiveTab(sharedTab.id, { silent: true });
            } catch (error) {
                console.error('切换到 shared tab 失败:', error);
                currentFile = null;
                clearActiveFileView();
            }
        } else {
            // 没有 shared tab，清除视图
            currentFile = null;
            clearActiveFileView();
        }
        return;
    }

    try {
        // 保存当前文件的编辑内容
        saveCurrentEditorContentToCache();

        await loadFile(filePath);
        // 只有文件加载成功后才更新 tab
        const isOpenTab = fileTree?.isInOpenList?.(filePath);

        // 如果是从链接打开，强制使用 shared tab
        if (isOpeningFromLink) {
            tabManager?.showSharedTab(filePath);
            isOpeningFromLink = false; // 重置标记
        } else if (isOpenTab) {
            tabManager?.setActiveFileTab(filePath, { silent: true });
        } else {
            tabManager?.showSharedTab(filePath);
        }
    } catch (error) {
        // 加载失败时不更新 tab，保持当前状态
        console.error('文件选择失败，保持当前 tab 状态');
        isOpeningFromLink = false; // 重置标记
    }
}

/**
 * 同步打开文件列表与标签栏状态。
 */
function handleOpenFilesChange(openFilePaths) {
    tabManager?.syncFileTabs(openFilePaths, fileTree?.currentFile || null);
    if (!isRestoringWorkspaceState) {
        persistWorkspaceState({ openFiles: openFilePaths });
    }
}

/**
 * 响应标签栏选择事件并在文件树中聚焦对应项。
 */
function handleTabSelect(tab) {
    if (!tab) return;
    if ((tab.type === 'file' || tab.type === 'shared') && tab.path) {
        fileTree?.selectFile(tab.path);
    }
}

/**
 * 处理标签关闭逻辑，必要时提醒用户保存更改。
 */
async function handleTabClose(tab) {
    if (!tab) return;

    if (tab.type === 'file' && tab.path) {
        // 检查文件是否有未保存的更改
        const hasChanges = await checkFileHasUnsavedChanges(tab.path);

        if (hasChanges) {
            // 弹出确认对话框
            const fileName = tab.path.split('/').pop() || tab.path;
            const shouldSave = await confirm(
                `文件 "${fileName}" 有未保存的更改，是否保存？`,
                {
                    title: '保存确认',
                    kind: 'warning',
                    okLabel: '保存',
                    cancelLabel: '不保存',
                }
            );

            if (shouldSave) {
                const saved = await saveFile(tab.path);
                if (!saved) {
                    // 保存失败，不关闭 tab
                    return;
                }
            }

            // 清除缓存
            fileSession.clearEntry(tab.path);
        }

        fileTree?.closeFile(tab.path);
        return;
    }

    if (tab.type === 'shared') {
        // shared tab 关闭时也要检查未保存的更改
        if (tab.path) {
            const hasChanges = await checkFileHasUnsavedChanges(tab.path);

            if (hasChanges) {
                const fileName = tab.path.split('/').pop() || tab.path;
                const shouldSave = await confirm(
                    `文件 "${fileName}" 有未保存的更改，是否保存？`,
                    {
                        title: '保存确认',
                        kind: 'warning',
                        okLabel: '保存',
                        cancelLabel: '不保存',
                    }
                );

                if (shouldSave) {
                    const saved = await saveFile(tab.path);
                    if (!saved) {
                        return;
                    }
                }

                fileSession.clearEntry(tab.path);
            }

            // 如果文件不在打开列表中，停止监听
            if (!fileTree?.isInOpenList(tab.path)) {
                fileTree?.stopWatchingFile(tab.path);
            }
        }

        if (!tab.fallbackPath) {
            fileTree?.selectFile(null);
        }
        return;
    }
}

/**
 * 判断指定文件是否存在未保存的缓存变更。
 */
async function checkFileHasUnsavedChanges(filePath) {
    // 如果是当前文件，检查编辑器状态
    if (filePath === currentFile) {
        if (activeViewMode === 'markdown' && editor) {
            return editor.hasUnsavedChanges();
        }
        if (activeViewMode === 'code' && codeEditor) {
            return codeEditor.hasUnsavedChanges();
        }
    }

    // 检查缓存
    const cached = fileSession.getCachedEntry(filePath);
    return cached ? cached.hasChanges : false;
}

/**
 * 监听自定义 open-file 事件以支持文档内跳转。
 */
function setupLinkNavigationListener() {
    window.addEventListener('open-file', async (event) => {
        const { path } = event.detail || {};
        if (!path) {
            console.error('open-file 事件缺少 path');
            return;
        }

        if (!fileTree) {
            console.error('fileTree 未初始化');
            return;
        }

        // 获取当前激活的 tab
        const activeTab = tabManager?.getAllTabs().find(tab => tab.id === tabManager?.activeTabId);

        // 如果当前有激活的 file tab，用新文件替换它
        if (activeTab && activeTab.type === 'file' && activeTab.path) {
            const oldPath = activeTab.path;

            // 先添加新文件到打开列表并选择它
            fileTree.addToOpenFiles(path);
            fileTree.selectFile(path);

            // 再移除旧文件（这样不会触发自动选择其他文件）
            fileTree.closeFile(oldPath);
        } else {
            // 如果当前是 shared tab 或没有激活的 tab，使用 shared tab
            isOpeningFromLink = true;
            fileTree.selectFile(path);
        }
    });
}

/**
 * 管理拖拽悬停态的样式。
 */
function setFileDropHoverState(isActive) {
    if (isFileDropHoverActive === isActive) {
        return;
    }

    const body = document.body;
    if (!body) {
        return;
    }

    isFileDropHoverActive = isActive;
    body.classList.toggle('is-file-drop-hover', isActive);
}

/**
 * 注册系统文件拖拽事件，支持拖入文件/文件夹直接打开。
 */
async function setupFileDropListeners() {
    try {
        const window = getCurrentWindow();
        if (typeof window.onDragDropEvent === 'function') {
            let pendingPaths = [];
            const unlisten = await window.onDragDropEvent(async (event) => {
                const { payload } = event;
                if (!payload) return;

                if (payload.type === 'enter' || payload.type === 'over') {
                    if (Array.isArray(payload.paths) && payload.paths.length > 0) {
                        pendingPaths = payload.paths;
                    }
                    setFileDropHoverState(true);
                    return;
                }

                if (payload.type === 'leave') {
                    pendingPaths = [];
                    setFileDropHoverState(false);
                    return;
                }

                if (payload.type === 'drop') {
                    const targetPaths = Array.isArray(payload.paths) && payload.paths.length > 0
                        ? payload.paths
                        : pendingPaths;
                    pendingPaths = [];
                    setFileDropHoverState(false);
                    if (Array.isArray(targetPaths) && targetPaths.length > 0) {
                        try {
                            await openPathsFromSelection(targetPaths);
                        } catch (error) {
                            console.error('处理拖拽文件时出错:', error);
                        }
                    }
                }
            });

            return () => {
                unlisten?.();
                setFileDropHoverState(false);
                pendingPaths = [];
            };
        }

        // fallback for Tauri 1.x event names
        const [unlistenDrop, unlistenHover, unlistenCancel] = await Promise.all([
            window.listen('tauri://file-drop', async (event) => {
                setFileDropHoverState(false);
                try {
                    await openPathsFromSelection(event.payload);
                } catch (error) {
                    console.error('处理拖拽文件时出错:', error);
                }
            }),
            window.listen('tauri://file-drop-hover', () => {
                setFileDropHoverState(true);
            }),
            window.listen('tauri://file-drop-cancel', () => {
                setFileDropHoverState(false);
            }),
        ]);

        return () => {
            unlistenDrop?.();
            unlistenHover?.();
            unlistenCancel?.();
            setFileDropHoverState(false);
        };
    } catch (error) {
        console.error('注册拖拽监听失败:', error);
        return null;
    }
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
function handleSettingsSubmit(nextSettings) {
    const merged = {
        ...editorSettings,
        ...nextSettings,
    };

    editorSettings = normalizeEditorSettings(merged);
    applyEditorSettings(editorSettings);
    codeEditor?.applyPreferences?.(editorSettings);
    saveEditorSettings(editorSettings);
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
 * 关闭当前激活的标签页，供快捷键调用。
 */
async function closeActiveTab() {
    if (!tabManager || !tabManager.activeTabId) {
        return;
    }
    await tabManager.handleTabClose(tabManager.activeTabId);
}

/**
 * 统一处理需要打开的文件或文件夹路径。
 */
async function openPathsFromSelection(rawPaths) {
    const selections = normalizeSelectedPaths(rawPaths)
        .map(normalizeFsPath)
        .filter(Boolean);

    if (selections.length === 0) {
        return;
    }

    if (!fileTree) {
        console.warn('文件树尚未初始化，无法打开拖入的路径');
        return;
    }

    const uniqueSelections = Array.from(new Set(selections));

    for (const resolvedPath of uniqueSelections) {
        try {
            const isDir = await isDirectory(resolvedPath);

            if (isDir) {
                await fileTree.loadFolder(resolvedPath);
            } else {
                fileTree.addToOpenFiles(resolvedPath);
                fileTree.selectFile(resolvedPath);
            }
        } catch (typeError) {
            console.error('处理路径失败:', { resolvedPath, error: typeError });
        }
    }
}

/**
 * 选择并打开文件或目录，根据类型分支处理。
 */
async function openFileOrFolder() {
    try {
        const selected = await pickPaths();
        await openPathsFromSelection(selected);
    } catch (error) {
        console.error('打开失败:', error);
        alert('打开失败: ' + error);
    }
}

/**
 * 保存当前活动文件，根据视图模式写回内容。
 */
async function saveCurrentFile() {
    if (!currentFile) {
        return false;
    }

    if (activeViewMode === 'markdown' && editor) {
        const result = await editor.save();
        if (result) {
            hasUnsavedChanges = false;
            // 清除缓存，因为文件已保存
            fileSession.clearEntry(currentFile);
            updateWindowTitle();
        }
        return result;
    }

    if (activeViewMode === 'code' && codeEditor) {
        try {
            const content = codeEditor.getValue();
            await writeFile(currentFile, content);
            codeEditor.markSaved();
            hasUnsavedChanges = false;
            // 清除缓存，因为文件已保存
            fileSession.clearEntry(currentFile);
            updateWindowTitle();
            return true;
        } catch (error) {
            console.error('保存失败:', error);
            alert('保存失败: ' + error);
            return false;
        }
    }

    return false;
}

/**
 * 保存指定路径的文件，多用于标签关闭确认流程。
 */
async function saveFile(filePath) {
    // 如果是当前文件，直接保存
    if (filePath === currentFile) {
        return await saveCurrentFile();
    }

    // 如果不是当前文件，从缓存获取内容并保存
    const cached = fileSession.getCachedEntry(filePath);
    if (!cached || !cached.hasChanges) {
        return true; // 没有未保存的更改
    }

    try {
        await writeFile(filePath, cached.content);
        // 清除缓存
        fileSession.clearEntry(filePath);
        return true;
    } catch (error) {
        console.error('保存文件失败:', error);
        return false;
    }
}

/**
 * 加载目标文件并根据类型切换到合适的视图。
 */
async function loadFile(filePath, options = {}) {
    const { skipWatchSetup = false, forceReload = false } = options;

    try {
        currentFile = filePath;
        const initialViewMode = getViewModeForPath(filePath);

        if (initialViewMode === 'image') {
            // 图片文件，直接加载显示
            activateImageView();
            editor?.clear?.();
            codeEditor?.clear?.();
            await imageViewer?.loadImage(filePath);
            hasUnsavedChanges = false;
            updateWindowTitle();
            if (!skipWatchSetup) {
                try {
                    await fileTree.watchFile(filePath);
                } catch (error) {
                    console.error('无法监听文件:', error);
                }
            }
            persistWorkspaceState();
            return;
        }

        // 文本或其他文件，从缓存或磁盘获取内容（强制刷新时跳过缓存）
        const fileData = await getFileContent(filePath, { skipCache: forceReload });
        const targetViewMode = fileData.viewMode || initialViewMode;

        if (targetViewMode === 'unsupported') {
            activateUnsupportedView();
            unsupportedViewer?.show(filePath, fileData.error);
            hasUnsavedChanges = false;
            updateWindowTitle();
            if (!skipWatchSetup) {
                fileTree?.stopWatchingFile?.(filePath);
            }
            persistWorkspaceState();
            return;
        }

        if (targetViewMode === 'markdown') {
            activateMarkdownView();
            if (editor) {
                await editor.loadFile(filePath, fileData.content);
                // 如果有未保存的更改，需要标记编辑器为已修改状态
                if (fileData.hasChanges) {
                    editor.contentChanged = true;
                    // 恢复原始内容，这样编辑器才能正确判断是否有修改
                    if (fileData.originalContent) {
                        editor.originalMarkdown = fileData.originalContent;
                    }
                }
            }
        } else {
            activateCodeView();
            editor?.clear?.();
            const language = detectLanguageForPath(filePath);
            await codeEditor?.show(filePath, fileData.content, language);
            // 如果有未保存的更改，需要标记编辑器为已修改状态
            if (fileData.hasChanges) {
                codeEditor.isDirty = true;
            }
            // 文档切换时，重新触发搜索（如果搜索框还开着）
            editor?.refreshSearch?.();
        }

        // 在加载完成后再次确认并设置 hasUnsavedChanges
        hasUnsavedChanges = fileData.hasChanges;
        updateWindowTitle();

        // 只在首次打开文件时建立监听，刷新时不重新建立
        if (!skipWatchSetup) {
            try {
                await fileTree.watchFile(filePath);
            } catch (error) {
                console.error('无法监听文件:', error);
            }
        }
        persistWorkspaceState();
    } catch (error) {
        console.error('读取文件失败:', error);
        alert('读取文件失败: ' + error);
        throw error; // 向上抛出异常，让调用方知道加载失败了
    }
}

/**
 * 根据当前文件状态动态更新窗口标题。
 */
async function updateWindowTitle() {
    try {
        const window = getCurrentWindow();
        let title = '';

        if (currentFile) {
            const fileName = currentFile.split('/').pop() || currentFile;

            // 获取字数
            const wordCount = getWordCount();

            // 获取最后编辑时间
            const lastModified = await getLastModifiedTime(currentFile);

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

            title = parts.join(' • ');
        }

        window.setTitle(title);
    } catch (error) {
        console.error('更新窗口标题失败:', error);
    }
}

/**
 * 计算编辑器内容的字数统计。
 */
function getWordCount() {
    try {
        let content = '';

        if (activeViewMode === 'markdown' && editor) {
            content = editor.getMarkdown() || '';
        } else if (activeViewMode === 'code' && codeEditor) {
            content = codeEditor.getValue() || '';
        }

        if (!content) return 0;

        // 移除 Markdown 标记和代码块
        const cleaned = content
            .replace(/```[\s\S]*?```/g, '') // 移除代码块
            .replace(/`[^`]+`/g, '') // 移除行内代码
            .replace(/!\[.*?\]\(.*?\)/g, '') // 移除图片
            .replace(/\[.*?\]\(.*?\)/g, '') // 移除链接
            .replace(/[#*_~\->`]/g, '') // 移除 Markdown 标记
            .replace(/\s+/g, ' ') // 合并空白
            .trim();

        // 统计中文字符和英文单词
        const chineseChars = cleaned.match(/[\u4e00-\u9fa5]/g) || [];
        const englishWords = cleaned.match(/[a-zA-Z]+/g) || [];

        return chineseChars.length + englishWords.length;
    } catch (error) {
        console.error('计算字数失败:', error);
        return 0;
    }
}

/**
 * 获取文件的可读格式最近修改时间。
 */
async function getLastModifiedTime(filePath) {
    try {
        const metadata = await getFileMetadata(filePath);
        if (!metadata || !metadata.modified_time) return null;

        const date = new Date(metadata.modified_time * 1000);
        const now = new Date();

        // 如果是今天，只显示时间
        if (date.toDateString() === now.toDateString()) {
            return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        }

        // 如果是今年，显示月日时间
        if (date.getFullYear() === now.getFullYear()) {
            return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) + ' ' +
                   date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        }

        // 否则显示完整日期
        return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
    } catch (error) {
        console.error('获取文件修改时间失败:', error);
        return null;
    }
}

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
    folderRefreshTimers.forEach((timer) => clearTimeout(timer));
    folderRefreshTimers.clear();
    fileRefreshTimers.forEach((timer) => clearTimeout(timer));
    fileRefreshTimers.clear();
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
    if (fileDropCleanup) {
        fileDropCleanup();
        fileDropCleanup = null;
    } else {
        setFileDropHoverState(false);
    }
    if (fileWatcherController) {
        fileWatcherController.cleanup();
        fileWatcherController = null;
    }
    fileSession.clearAll();
    fileTree?.dispose?.();
    editor?.destroy?.();
    codeEditor?.dispose?.();
    imageViewer?.dispose?.();
}
