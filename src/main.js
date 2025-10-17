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

let MarkdownEditorCtor = null;
let CodeEditorCtor = null;
let ImageViewerCtor = null;
let FileTreeCtor = null;
let TabManagerCtor = null;
let SettingsDialogCtor = null;
let ensureCoreModulesPromise = null;

async function ensureCoreModules() {
    if (!ensureCoreModulesPromise) {
        ensureCoreModulesPromise = (async () => {
            const [
                editorModule,
                codeEditorModule,
                imageViewerModule,
                fileTreeModule,
                tabManagerModule,
                settingsModule,
            ] = await Promise.all([
                import('./components/MarkdownEditor.js'),
                import('./components/CodeEditor.js'),
                import('./components/ImageViewer.js'),
                import('./components/FileTree.js'),
                import('./components/TabManager.js'),
                import('./components/SettingsDialog.js'),
            ]);

            MarkdownEditorCtor = editorModule.MarkdownEditor;
            CodeEditorCtor = codeEditorModule.CodeEditor;
            ImageViewerCtor = imageViewerModule.ImageViewer;
            FileTreeCtor = fileTreeModule.FileTree;
            TabManagerCtor = tabManagerModule.TabManager;
            SettingsDialogCtor = settingsModule.SettingsDialog;
        })();
    }

    await ensureCoreModulesPromise;
}

let toPngRenderer = null;

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
let fileTree = null;
let tabManager = null;
let settingsDialog = null;
let isOpeningFromLink = false;
let hasUnsavedChanges = false;
let fileContentCache = new Map(); // 缓存文件的编辑内容和状态
let editorSettings = { ...defaultEditorSettings };
let availableFontFamilies = [];
let markdownPaneElement = null;
let codeEditorPaneElement = null;
let imagePaneElement = null;
let activeViewMode = 'markdown';
let keyboardShortcutCleanup = null;
let sidebarResizerCleanup = null;
let menuListenersCleanup = null;

const folderRefreshTimers = new Map();
const fileRefreshTimers = new Map();
function activateMarkdownView() {
    markdownPaneElement?.classList.add('is-active');
    codeEditorPaneElement?.classList.remove('is-active');
    imagePaneElement?.classList.remove('is-active');
    codeEditor?.hide?.();
    imageViewer?.hide?.();
    activeViewMode = 'markdown';
}

function activateCodeView() {
    markdownPaneElement?.classList.remove('is-active');
    codeEditorPaneElement?.classList.add('is-active');
    imagePaneElement?.classList.remove('is-active');
    imageViewer?.hide?.();
    activeViewMode = 'code';
}

function activateImageView() {
    markdownPaneElement?.classList.remove('is-active');
    codeEditorPaneElement?.classList.remove('is-active');
    imagePaneElement?.classList.add('is-active');
    editor?.clear?.();
    codeEditor?.hide?.();
    imageViewer?.show?.();
    activeViewMode = 'image';
}

function clearActiveFileView() {
    editor?.clear?.();
    codeEditor?.clear?.();
    imageViewer?.clear?.();
    activateMarkdownView();
    currentFile = null;
    hasUnsavedChanges = false;
    updateWindowTitle();
}

// 基础初始化代码
document.addEventListener('DOMContentLoaded', () => {
    void initializeApplication();
});

async function initializeApplication() {

    await ensureCoreModules();

    // 初始化主视图容器
    const viewContainer = document.getElementById('viewContent');
    if (!viewContainer) {
        throw new Error('未找到视图容器 viewContent');
    }
    viewContainer.innerHTML = '';

    markdownPaneElement = document.createElement('div');
    markdownPaneElement.className = 'view-pane markdown-pane is-active';
    viewContainer.appendChild(markdownPaneElement);

    codeEditorPaneElement = document.createElement('div');
    codeEditorPaneElement.className = 'view-pane code-pane';
    viewContainer.appendChild(codeEditorPaneElement);

    imagePaneElement = document.createElement('div');
    imagePaneElement.className = 'view-pane image-pane';
    viewContainer.appendChild(imagePaneElement);

    const editorCallbacks = {
        onContentChange: () => {
            hasUnsavedChanges = editor?.hasUnsavedChanges() || codeEditor?.hasUnsavedChanges() || false;
            updateWindowTitle();
        }
    };

    editor = new MarkdownEditorCtor(markdownPaneElement, editorCallbacks);
    codeEditor = new CodeEditorCtor(codeEditorPaneElement, editorCallbacks);
    codeEditor.hide();
    imageViewer = new ImageViewerCtor(imagePaneElement);
    imageViewer.hide();
    activeViewMode = 'markdown';

    // 将代码编辑器引用传递给 Markdown 编辑器的搜索管理器
    editor.setCodeEditor(codeEditor);

    // 初始化文件树
    const fileTreeElement = document.getElementById('fileTree');
    fileTree = new FileTreeCtor(fileTreeElement, handleFileSelect, {
        onFolderChange: handleFolderWatcherEvent,
        onFileChange: handleFileWatcherEvent,
        onOpenFilesChange: handleOpenFilesChange,
    });

    const tabBarElement = document.getElementById('tabBar');
    tabManager = new TabManagerCtor(tabBarElement, {
        onTabSelect: handleTabSelect,
        onTabClose: handleTabClose,
    });

    editorSettings = loadEditorSettings();
    applyEditorSettings(editorSettings);
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
    setupCleanupHandlers();

    loadAvailableFonts();

    // 初始化时清空窗口标题
    updateWindowTitle();
}

// 保存当前编辑器内容到缓存
function saveCurrentEditorContentToCache() {
    if (!currentFile) return;

    const viewMode = activeViewMode;
    let content = null;
    let originalContent = null;
    let hasChanges = false;

    if (viewMode === 'markdown' && editor) {
        content = editor.getMarkdown();
        originalContent = editor.originalMarkdown;
        hasChanges = editor.hasUnsavedChanges();
    } else if (viewMode === 'code' && codeEditor) {
        content = codeEditor.getValue();
        hasChanges = codeEditor.hasUnsavedChanges();
    }

    if (content !== null) {
        fileContentCache.set(currentFile, {
            content,
            originalContent,
            hasChanges,
            viewMode,
        });
    }
}

// 从缓存或磁盘加载文件内容
async function getFileContent(filePath, options = {}) {
    const { skipCache = false } = options;

    if (!skipCache) {
        const cached = fileContentCache.get(filePath);
        if (cached) {
            return cached;
        }
    }

    // 从磁盘读取
    const content = await readFile(filePath);
    const viewMode = getViewModeForPath(filePath);
    return {
        content,
        hasChanges: false,
        viewMode,
    };
}

// 文件选择回调
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

function handleOpenFilesChange(openFilePaths) {
    tabManager?.syncFileTabs(openFilePaths, fileTree?.currentFile || null);
}

function handleTabSelect(tab) {
    if (!tab) return;
    if ((tab.type === 'file' || tab.type === 'shared') && tab.path) {
        fileTree?.selectFile(tab.path);
    }
}

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
            fileContentCache.delete(tab.path);
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

                fileContentCache.delete(tab.path);
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

// 检查文件是否有未保存的更改
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
    const cached = fileContentCache.get(filePath);
    return cached ? cached.hasChanges : false;
}

// 监听菜单事件
// 监听文档链接导航
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

function handleSettingsSubmit(nextSettings) {
    const merged = {
        ...editorSettings,
        ...nextSettings,
    };

    editorSettings = normalizeEditorSettings(merged);
    applyEditorSettings(editorSettings);
    saveEditorSettings(editorSettings);
}

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

// 设置快捷键
async function closeActiveTab() {
    if (!tabManager || !tabManager.activeTabId) {
        return;
    }
    await tabManager.handleTabClose(tabManager.activeTabId);
}

// 打开文件或文件夹（自动判断）
async function openFileOrFolder() {
    try {
        const selected = await pickPaths();
        const selections = normalizeSelectedPaths(selected)
            .map(normalizeFsPath)
            .filter(Boolean);

        if (selections.length === 0) return;

        const uniqueSelections = Array.from(new Set(selections));

        for (const resolvedPath of uniqueSelections) {
            try {
                const isDir = await isDirectory(resolvedPath);

                if (isDir) {
                    await fileTree?.loadFolder(resolvedPath);
                } else {
                    fileTree?.addToOpenFiles(resolvedPath);
                    fileTree?.selectFile(resolvedPath);
                }
            } catch (typeError) {
                console.error('判断路径类型失败:', { resolvedPath, error: typeError });
            }
        }
    } catch (error) {
        console.error('打开失败:', error);
        alert('打开失败: ' + error);
    }
}

async function saveCurrentFile() {
    if (!currentFile) {
        return false;
    }

    if (activeViewMode === 'markdown' && editor) {
        const result = await editor.save();
        if (result) {
            hasUnsavedChanges = false;
            // 清除缓存，因为文件已保存
            fileContentCache.delete(currentFile);
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
            fileContentCache.delete(currentFile);
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

// 保存指定文件（用于关闭 tab 时）
async function saveFile(filePath) {
    // 如果是当前文件，直接保存
    if (filePath === currentFile) {
        return await saveCurrentFile();
    }

    // 如果不是当前文件，从缓存获取内容并保存
    const cached = fileContentCache.get(filePath);
    if (!cached || !cached.hasChanges) {
        return true; // 没有未保存的更改
    }

    try {
        await writeFile(filePath, cached.content);
        // 清除缓存
        fileContentCache.delete(filePath);
        return true;
    } catch (error) {
        console.error('保存文件失败:', error);
        return false;
    }
}

async function loadFile(filePath, options = {}) {
    const { skipWatchSetup = false, forceReload = false } = options;

    try {
        currentFile = filePath;
        const viewMode = getViewModeForPath(filePath);

        if (viewMode === 'image') {
            // 图片文件，直接加载显示
            activateImageView();
            editor?.clear?.();
            codeEditor?.clear?.();
            await imageViewer?.loadImage(filePath);
            hasUnsavedChanges = false;
            updateWindowTitle();
        } else {
            // 文本文件（Markdown 或代码），从缓存或磁盘获取内容
            // 如果是强制重新加载（刷新），跳过缓存
            const fileData = await getFileContent(filePath, { skipCache: forceReload });

            if (viewMode === 'markdown') {
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
        }

        // 只在首次打开文件时建立监听，刷新时不重新建立
        if (!skipWatchSetup) {
            try {
                await fileTree.watchFile(filePath);
            } catch (error) {
                console.error('无法监听文件:', error);
            }
        }
    } catch (error) {
        console.error('读取文件失败:', error);
        alert('读取文件失败: ' + error);
        throw error; // 向上抛出异常，让调用方知道加载失败了
    }
}

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

function setupCleanupHandlers() {
    window.addEventListener('beforeunload', cleanupResources);
}

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
    fileTree?.dispose?.();
    editor?.destroy?.();
    codeEditor?.dispose?.();
    imageViewer?.dispose?.();
}

function handleFolderWatcherEvent(watchedPath, event) {
    if (!fileTree) return;

    const normalizedRoot = normalizeFsPath(watchedPath);
    if (!normalizedRoot || !fileTree?.hasRoot?.(normalizedRoot)) {
        return;
    }

    const eventPaths = Array.isArray(event?.paths) ? event.paths.map(normalizeFsPath) : [];

    eventPaths.forEach((changedPath) => {
        if (!changedPath) return;
        if (fileTree?.isFileOpen?.(changedPath)) {
            const editorPath = editor ? normalizeFsPath(editor.currentFile) : null;
            if (editor && editorPath === changedPath) {
                if (typeof editor.hasUnsavedChanges === 'function' && editor.hasUnsavedChanges()) {
                    return;
                }
            }
            scheduleFileRefresh(changedPath);
        }
    });

    scheduleFolderRefresh(normalizedRoot);
}

function handleFileWatcherEvent(filePath) {
    const normalizedPath = normalizeFsPath(filePath);
    if (!normalizedPath) return;

    const isOpenFile = fileTree?.isFileOpen?.(normalizedPath);
    if (!isOpenFile) {
        // 不在打开列表的文件不需要自动刷新
        return;
    }

    const editorPath = editor ? normalizeFsPath(editor.currentFile) : null;
    const currentFilePath = normalizeFsPath(currentFile);
    const isMarkdownActive = editor && editorPath === normalizedPath;
    const isCodeActive = activeViewMode === 'code' && currentFilePath === normalizedPath;

    if (isMarkdownActive) {
        if (typeof editor.hasUnsavedChanges === 'function' && editor.hasUnsavedChanges()) {
            return;
        }
    }

    if (isCodeActive) {
        if (codeEditor?.hasUnsavedChanges?.()) {
            return;
        }
    }

    if (isMarkdownActive || isCodeActive) {
        scheduleFileRefresh(normalizedPath);
    }
}

function scheduleFolderRefresh(rootPath) {
    const normalizedRoot = normalizeFsPath(rootPath);
    if (!normalizedRoot) return;

    const existing = folderRefreshTimers.get(normalizedRoot);
    if (existing) {
        clearTimeout(existing);
    }

    const timer = setTimeout(async () => {
        folderRefreshTimers.delete(normalizedRoot);
        if (!fileTree?.hasRoot?.(normalizedRoot)) {
            return;
        }

        try {
            await fileTree.refreshFolder(normalizedRoot);
        } catch (error) {
            console.error('刷新目录失败:', error);
        }
    }, 100);

    folderRefreshTimers.set(normalizedRoot, timer);
}

function scheduleFileRefresh(filePath) {
    const normalizedPath = normalizeFsPath(filePath);
    if (!normalizedPath) return;

    const existing = fileRefreshTimers.get(normalizedPath);
    if (existing) {
        clearTimeout(existing);
    }

    const timer = setTimeout(async () => {
        fileRefreshTimers.delete(normalizedPath);
        if (!fileTree?.isFileOpen?.(normalizedPath)) {
            return;
        }

        // 只刷新当前激活的文件，避免切换到其他 tab
        const currentFilePath = normalizeFsPath(currentFile);
        if (currentFilePath !== normalizedPath) {
            // 如果不是当前文件，只清除缓存，下次切换时会重新加载
            fileContentCache.delete(normalizedPath);
            return;
        }

        try {
            await loadFile(normalizedPath, { skipWatchSetup: true, forceReload: true });
        } catch (error) {
            console.error('刷新文件失败:', error);
        }
    }, 50);

    fileRefreshTimers.set(normalizedPath, timer);
}
