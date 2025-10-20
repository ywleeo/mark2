import { confirm } from '@tauri-apps/plugin-dialog';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { detectLanguageForPath, getViewModeForPath, isMarkdownFilePath } from './utils/fileTypeUtils.js';
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
    revealInFileManager,
    writeFile,
} from './modules/fileGateway.js';
import { registerMenuListeners } from './modules/menuListeners.js';
import { createFileSession } from './modules/fileSession.js';
import { createFileWatcherController } from './modules/fileWatchers.js';
import { createDefaultWorkspaceState, loadWorkspaceState, saveWorkspaceState } from './utils/workspaceState.js';
import { createStatusBarController } from './modules/statusBarController.js';
import { createMarkdownCodeMode } from './modules/markdownCodeMode.js';
import { createFileDropController } from './modules/fileDropController.js';
import { createWorkspaceController } from './modules/workspaceController.js';
import { createNavigationController } from './modules/navigationController.js';

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
let fileDropCleanup = null;
let isSidebarHidden = false;
let statusBarController = null;
let markdownCodeMode = null;
let fileDropController = null;
const workspaceController = createWorkspaceController({
    getCurrentFile: () => currentFile,
    getFileTree: () => fileTree,
    getTabManager: () => tabManager,
    isDirectory,
    getFileMetadata,
    createDefaultWorkspaceState,
    loadWorkspaceState,
    saveWorkspaceState,
});

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
    editor?.clear?.();
    codeEditor?.clear?.();
    imageViewer?.clear?.();
    unsupportedViewer?.clear?.();
    activateMarkdownView();
    markdownCodeMode?.reset();
    currentFile = null;
    hasUnsavedChanges = false;
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

    const statusBarElement = document.getElementById('statusBar');
    if (!statusBarElement) {
        throw new Error('未找到状态栏元素 statusBar');
    }
    const statusBarFilePathElement = document.getElementById('statusBarPath');
    const statusBarWordCountElement = document.getElementById('statusBarWordCount');
    const statusBarLastModifiedElement = document.getElementById('statusBarLastModified');
    if (!statusBarFilePathElement || !statusBarWordCountElement || !statusBarLastModifiedElement) {
        throw new Error('状态栏子元素渲染失败');
    }
    statusBarController = createStatusBarController({
        statusBarElement,
        statusBarFilePathElement,
        statusBarWordCountElement,
        statusBarLastModifiedElement,
        normalizeFsPath,
        revealInFileManager,
        getFileMetadata,
    });
    statusBarController.updateStatusBar();
    statusBarController.setupStatusBarPathInteraction({
        getCurrentFile: () => currentFile,
    });

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
        onToggleSidebar: toggleSidebarVisibility,
        onToggleMarkdownCodeView: toggleMarkdownCodeMode,
    });
    menuListenersCleanup = await registerMenuListeners({
        onOpen: openFileOrFolder,
        onSettings: openSettingsDialog,
        onExportImage: () => exportCurrentViewToImage({ ensureToPng }),
        onExportPdf: () => exportCurrentViewToPdf({ activeViewMode }),
        onToggleSidebar: toggleSidebarVisibility,
        onToggleStatusBar: toggleStatusBarVisibility,
        onToggleMarkdownCodeView: toggleMarkdownCodeMode,
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
            markdownCodeMode?.handleCodeSaved(content);
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
        const previousFile = currentFile;
        currentFile = filePath;
        if (previousFile !== filePath) {
            markdownCodeMode?.reset();
        }
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
            fileTree?.clearExternalModification?.(filePath);
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
            fileTree?.clearExternalModification?.(filePath);
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
        fileTree?.clearExternalModification?.(filePath);
        persistWorkspaceState();
    } catch (error) {
        console.error('读取文件失败:', error);
        alert('读取文件失败: ' + error);
        throw error; // 向上抛出异常，让调用方知道加载失败了
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
    fileSession.clearAll();
    fileTree?.dispose?.();
    editor?.destroy?.();
    codeEditor?.dispose?.();
    imageViewer?.dispose?.();
}
