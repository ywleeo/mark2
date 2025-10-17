import { invoke } from '@tauri-apps/api/core';
import { open, save, message, confirm } from '@tauri-apps/plugin-dialog';
import { listen } from '@tauri-apps/api/event';
import { desktopDir, join } from '@tauri-apps/api/path';
import { getCurrentWindow } from '@tauri-apps/api/window';

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
let editorSettings = {
    theme: 'default',
    fontSize: 16,
    lineHeight: 1.6,
    fontFamily: '',
    fontWeight: 400,
    codeFontSize: 14,
    codeLineHeight: 1.5,
    codeFontFamily: '',
    codeFontWeight: 400,
};
let availableFontFamilies = [];
let markdownPaneElement = null;
let codeEditorPaneElement = null;
let imagePaneElement = null;
let activeViewMode = 'markdown';

const folderRefreshTimers = new Map();
const fileRefreshTimers = new Map();
const SETTINGS_STORAGE_KEY = 'mark2:editorSettings';
const defaultEditorSettings = {
    theme: 'default',
    fontSize: 16,
    lineHeight: 1.6,
    fontFamily: '',
    fontWeight: 400,
    codeFontSize: 14,
    codeLineHeight: 1.5,
    codeFontFamily: '',
    codeFontWeight: 400,
};

const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdx']);
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'ico']);
const CODE_SUFFIX_LANGUAGE_MAP = [
    ['.d.ts', 'typescript'],
    ['.d.mts', 'typescript'],
    ['.d.cts', 'typescript'],
    ['.dockerfile', 'dockerfile'],
];

const CODE_EXTENSION_LANGUAGE_MAP = new Map([
    ['js', 'javascript'],
    ['mjs', 'javascript'],
    ['cjs', 'javascript'],
    ['jsx', 'javascript'],
    ['ts', 'typescript'],
    ['tsx', 'typescript'],
    ['json', 'json'],
    ['yml', 'yaml'],
    ['yaml', 'yaml'],
    ['toml', 'ini'],
    ['ini', 'ini'],
    ['conf', 'ini'],
    ['env', 'ini'],
    ['properties', 'ini'],
    ['css', 'css'],
    ['scss', 'scss'],
    ['less', 'less'],
    ['html', 'html'],
    ['htm', 'html'],
    ['vue', 'html'],
    ['svelte', 'html'],
    ['xml', 'xml'],
    ['py', 'python'],
    ['pyw', 'python'],
    ['go', 'go'],
    ['rs', 'rust'],
    ['java', 'java'],
    ['kt', 'kotlin'],
    ['kts', 'kotlin'],
    ['swift', 'swift'],
    ['rb', 'ruby'],
    ['php', 'php'],
    ['cs', 'csharp'],
    ['cpp', 'cpp'],
    ['cc', 'cpp'],
    ['cxx', 'cpp'],
    ['hpp', 'cpp'],
    ['hh', 'cpp'],
    ['hxx', 'cpp'],
    ['c', 'c'],
    ['h', 'c'],
    ['mm', 'objective-c'],
    ['m', 'objective-c'],
    ['sql', 'sql'],
    ['sh', 'shell'],
    ['bash', 'shell'],
    ['zsh', 'shell'],
    ['fish', 'shell'],
    ['ps1', 'powershell'],
    ['psm1', 'powershell'],
    ['bat', 'shell'],
    ['cmd', 'shell'],
    ['dock', 'dockerfile'],
    ['dockerfile', 'dockerfile'],
    ['diff', 'diff'],
    ['patch', 'diff'],
    ['log', 'plaintext'],
    ['txt', 'plaintext'],
]);

function normalizeCandidatePath(path) {
    return typeof path === 'string' ? path.toLowerCase() : '';
}

function isMarkdownFilePath(filePath) {
    const normalized = normalizeCandidatePath(filePath);
    if (!normalized) {
        return false;
    }

    if (normalized.endsWith('.md') || normalized.endsWith('.markdown') || normalized.endsWith('.mdx')) {
        return true;
    }

    const match = normalized.match(/\.([a-z0-9]+)$/);
    if (!match) {
        return false;
    }

    return MARKDOWN_EXTENSIONS.has(match[1]);
}

function isImageFilePath(filePath) {
    const normalized = normalizeCandidatePath(filePath);
    if (!normalized) {
        return false;
    }

    const match = normalized.match(/\.([a-z0-9]+)$/);
    if (!match) {
        return false;
    }

    return IMAGE_EXTENSIONS.has(match[1]);
}

function detectLanguageForPath(filePath) {
    const normalized = normalizeCandidatePath(filePath);
    if (!normalized) {
        return null;
    }

    for (const [suffix, language] of CODE_SUFFIX_LANGUAGE_MAP) {
        if (normalized.endsWith(suffix)) {
            return language;
        }
    }

    const match = normalized.match(/\.([a-z0-9]+)$/);
    if (!match) {
        return null;
    }

    return CODE_EXTENSION_LANGUAGE_MAP.get(match[1]) || null;
}

function getViewModeForPath(filePath) {
    if (isMarkdownFilePath(filePath)) {
        return 'markdown';
    }
    if (isImageFilePath(filePath)) {
        return 'image';
    }
    return 'code';
}

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

    setupKeyboardShortcuts();
    await setupMenuListeners();
    setupLinkNavigationListener();
    setupSidebarResizer();
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
    const content = await invoke('read_file', { path: filePath });
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
async function setupMenuListeners() {
    await listen('menu-open', () => {
        void openFileOrFolder();
    });

    await listen('menu-settings', () => {
        void openSettingsDialog();
    });

    await listen('menu-export-image', async () => {
        await handleMenuExportImage();
    });

    await listen('menu-export-pdf', async () => {
        await handleMenuExportPdf();
    });
}

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

async function handleMenuExportImage() {
    try {
        const defaultPath = await buildDefaultScreenshotPath();
        const targetPath = await save({
            title: '保存截图',
            filters: [
                {
                    name: 'PNG 图片',
                    extensions: ['png'],
                },
            ],
            defaultPath,
        });

        if (!targetPath) {
            return;
        }

        const dataUrl = await captureViewContent();
        await invoke('capture_screenshot', {
            destination: targetPath,
            imageData: dataUrl,
        });
        await message('截图已保存至: ' + targetPath, {
            title: '截图完成',
            kind: 'info',
        });
    } catch (error) {
        console.error('生成截图失败', error);
        const reason = error?.message || String(error);
        await message('生成截图失败: ' + reason, {
            title: '截图失败',
            kind: 'error',
        });
    }
}

async function handleMenuExportPdf() {
    try {
        const defaultPath = await buildDefaultPdfPath();
        const targetPath = await save({
            title: '导出 PDF',
            filters: [
                {
                    name: 'PDF 文件',
                    extensions: ['pdf'],
                },
            ],
            defaultPath,
        });

        if (!targetPath) {
            return;
        }

        const { htmlContent, cssContent, pageWidth } = await collectContentForPdf();
        await invoke('export_to_pdf', {
            destination: targetPath,
            htmlContent,
            cssContent,
            pageWidth,
        });

        await message('PDF 已保存至: ' + targetPath, {
            title: '导出完成',
            kind: 'info',
        });
    } catch (error) {
        console.error('导出 PDF 失败', error);
        const reason = error?.message || String(error);
        await message('导出 PDF 失败: ' + reason, {
            title: '导出失败',
            kind: 'error',
        });
    }
}

async function buildDefaultScreenshotPath() {
    const timestamp = formatTimestampForFilename(new Date());
    const fileName = `Mark2-Screenshot-${timestamp}.png`;

    try {
        const desktop = await desktopDir();
        if (desktop && desktop.length > 0) {
            return await join(desktop, fileName);
        }
    } catch (error) {
        console.warn('无法获取桌面路径，使用默认文件名', error);
    }

    return fileName;
}

async function buildDefaultPdfPath() {
    const timestamp = formatTimestampForFilename(new Date());
    const fileName = `Mark2-Export-${timestamp}.pdf`;

    try {
        const desktop = await desktopDir();
        if (desktop && desktop.length > 0) {
            return await join(desktop, fileName);
        }
    } catch (error) {
        console.warn('无法获取桌面路径，使用默认文件名', error);
    }

    return fileName;
}

function formatTimestampForFilename(date) {
    const pad = (value) => String(value).padStart(2, '0');
    const year = date.getFullYear();
    const month = pad(date.getMonth() + 1);
    const day = pad(date.getDate());
    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());
    const seconds = pad(date.getSeconds());
    return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

async function captureViewContent() {
    const viewElement = document.getElementById('viewContent');
    if (!viewElement) {
        throw new Error('无法找到 viewContent 元素');
    }

    const captureElement = viewElement.querySelector('.tiptap-editor') || viewElement;

    const transparentValues = new Set(['rgba(0, 0, 0, 0)', 'transparent']);
    const getBackground = (element) => {
        const color = window.getComputedStyle(element).backgroundColor;
        return color && !transparentValues.has(color) ? color : null;
    };

    const bodyBackground = getBackground(document.body);
    const backgroundColor =
        getBackground(captureElement) ||
        getBackground(viewElement) ||
        bodyBackground ||
        '#ffffff';
    const scale = Math.min(Math.max(window.devicePixelRatio || 1, 2), 3);

    const scrollWidth = Math.ceil(
        Math.max(
            captureElement.scrollWidth,
            captureElement.offsetWidth,
            captureElement.clientWidth
        )
    );
    const scrollHeight = Math.ceil(captureElement.scrollHeight);

    const wrapper = document.createElement('div');
    wrapper.style.position = 'fixed';
    wrapper.style.left = '-100000px';
    wrapper.style.top = '0';
    wrapper.style.padding = '0';
    wrapper.style.margin = '0';
    wrapper.style.background = backgroundColor;
    wrapper.style.width = `${scrollWidth}px`;
    wrapper.style.pointerEvents = 'none';
    wrapper.style.zIndex = '-1';

    captureElement
        .querySelectorAll('.screenshot-watermark')
        .forEach(element => element.remove());

    const clone = captureElement.cloneNode(true);
    clone.style.paddingBottom = '0px';
    clone.style.marginBottom = '0px';
    const watermarkElement = createWatermarkElement(backgroundColor || '#ffffff');
    clone.appendChild(watermarkElement);
    clone.style.width = `${scrollWidth}px`;
    clone.style.minHeight = `${scrollHeight}px`;
    clone.style.boxSizing = 'border-box';

    wrapper.appendChild(clone);
    document.body.appendChild(wrapper);

    await new Promise(resolve => requestAnimationFrame(resolve));
    await new Promise(resolve => requestAnimationFrame(resolve));

    try {
        const targetWidth = Math.ceil(
            Math.max(
                scrollWidth,
                clone.scrollWidth,
                clone.offsetWidth,
                clone.clientWidth
            )
        );
        const targetHeight = Math.ceil(
            Math.max(
                scrollHeight,
                clone.scrollHeight,
                clone.offsetHeight,
                clone.clientHeight
            )
        );

        wrapper.style.width = `${targetWidth}px`;
        clone.style.width = `${targetWidth}px`;
        clone.style.minHeight = `${targetHeight}px`;

        await document.fonts?.ready;
        const renderToPng = await ensureToPng();
        const dataUrl = await renderToPng(clone, {
            backgroundColor,
            pixelRatio: scale,
            cacheBust: true,
            width: targetWidth,
            height: targetHeight,
            canvasWidth: Math.ceil(targetWidth * scale),
            canvasHeight: Math.ceil(targetHeight * scale),
        });
        return dataUrl;
    } finally {
        if (wrapper.parentNode) {
            wrapper.parentNode.removeChild(wrapper);
        }
    }
}

function createWatermarkElement(baseBackground) {
    const container = document.createElement('div');
    container.className = 'screenshot-watermark';
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.alignItems = 'center';
    container.style.padding = '2px 0 5px';
    container.style.background = baseBackground;

    const divider = document.createElement('div');
    divider.style.width = '100%';
    divider.style.height = '2px';
    divider.style.backgroundColor = '#eeeeee';
    divider.style.margin = '0 0 10px 0';

    const ribbon = document.createElement('span');
    ribbon.textContent = 'Mark2';
    ribbon.style.display = 'inline-block';
    ribbon.style.background = '#ff3b30';
    ribbon.style.color = '#ffffff';
    ribbon.style.fontSize = '14px';
    ribbon.style.fontWeight = '700';
    ribbon.style.padding = '2px 15px';
    ribbon.style.letterSpacing = '0.5px';

    container.appendChild(divider);
    container.appendChild(ribbon);

    return container;
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

function loadEditorSettings() {
    try {
        const stored = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
        if (!stored) {
            return { ...defaultEditorSettings };
        }

        const parsed = JSON.parse(stored);
        return normalizeEditorSettings(parsed);
    } catch (error) {
        console.warn('加载编辑器设置失败，使用默认值', error);
        return { ...defaultEditorSettings };
    }
}

function saveEditorSettings(settings) {
    try {
        const normalized = normalizeEditorSettings(settings);
        window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
    } catch (error) {
        console.warn('保存编辑器设置失败', error);
    }
}

function applyEditorSettings(settings) {
    const prefs = normalizeEditorSettings(settings);
    const root = document.documentElement;

    // 应用主题
    loadTheme(prefs.theme);

    // 普通模式设置
    root.style.setProperty('--editor-font-size', `${prefs.fontSize}px`);
    root.style.setProperty('--editor-line-height', prefs.lineHeight.toString());
    root.style.setProperty('--editor-font-weight', prefs.fontWeight.toString());

    if (prefs.fontFamily && prefs.fontFamily.length > 0) {
        root.style.setProperty('--editor-font-family', prefs.fontFamily);
    } else {
        root.style.removeProperty('--editor-font-family');
    }

    // Code 模式设置
    root.style.setProperty('--code-font-size', `${prefs.codeFontSize}px`);
    root.style.setProperty('--code-line-height', prefs.codeLineHeight.toString());
    root.style.setProperty('--code-font-weight', prefs.codeFontWeight.toString());

    if (prefs.codeFontFamily && prefs.codeFontFamily.length > 0) {
        root.style.setProperty('--code-font-family', prefs.codeFontFamily);
    } else {
        root.style.removeProperty('--code-font-family');
    }
}

function loadTheme(themeName) {
    const theme = themeName || 'default';
    const themeId = 'markdown-theme-stylesheet';

    // 移除已有的主题样式
    const existingTheme = document.getElementById(themeId);
    if (existingTheme) {
        existingTheme.remove();
    }

    // 创建新的主题样式链接
    const link = document.createElement('link');
    link.id = themeId;
    link.rel = 'stylesheet';
    link.href = `/styles/themes/${theme}.css`;

    // 添加到 head 中
    document.head.appendChild(link);
}

async function loadAvailableFonts() {
    try {
        const fonts = await invoke('list_fonts');
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

function normalizeEditorSettings(candidate) {
    const prefs = { ...defaultEditorSettings };

    if (candidate && typeof candidate === 'object') {
        // 主题设置
        if (typeof candidate.theme === 'string') {
            let theme = candidate.theme.trim() || 'default';
            // 兼容旧主题名
            if (theme === 'github-dark') {
                theme = 'emerald';
            }
            prefs.theme = theme;
        }

        // 普通模式设置
        if (candidate.fontSize !== undefined) {
            const size = Number(candidate.fontSize);
            if (Number.isFinite(size)) {
                prefs.fontSize = clamp(size, 10, 48);
            }
        }

        if (candidate.lineHeight !== undefined) {
            const height = Number(candidate.lineHeight);
            if (Number.isFinite(height)) {
                const clampedHeight = clamp(height, 1.0, 3.0);
                prefs.lineHeight = Number(clampedHeight.toFixed(2));
            }
        }

        if (typeof candidate.fontFamily === 'string') {
            const trimmedFamily = candidate.fontFamily.trim();
            if (
                trimmedFamily &&
                !trimmedFamily.includes(',') &&
                !/["']/.test(trimmedFamily) &&
                /\s/.test(trimmedFamily)
            ) {
                prefs.fontFamily = `'${trimmedFamily.replace(/'/g, "\\'")}'`;
            } else {
                prefs.fontFamily = trimmedFamily;
            }
        }

        if (candidate.fontWeight !== undefined) {
            const weight = Number(candidate.fontWeight);
            if (Number.isFinite(weight)) {
                prefs.fontWeight = normalizeFontWeight(weight);
            }
        }

        // Code 模式设置
        if (candidate.codeFontSize !== undefined) {
            const size = Number(candidate.codeFontSize);
            if (Number.isFinite(size)) {
                prefs.codeFontSize = clamp(size, 10, 48);
            }
        }

        if (candidate.codeLineHeight !== undefined) {
            const height = Number(candidate.codeLineHeight);
            if (Number.isFinite(height)) {
                const clampedHeight = clamp(height, 1.0, 3.0);
                prefs.codeLineHeight = Number(clampedHeight.toFixed(2));
            }
        }

        if (typeof candidate.codeFontFamily === 'string') {
            prefs.codeFontFamily = candidate.codeFontFamily.trim();
        }

        if (candidate.codeFontWeight !== undefined) {
            const weight = Number(candidate.codeFontWeight);
            if (Number.isFinite(weight)) {
                prefs.codeFontWeight = normalizeFontWeight(weight);
            }
        }
    }

    return prefs;
}

function clamp(value, min, max) {
    if (!Number.isFinite(value)) {
        return min;
    }
    return Math.min(Math.max(value, min), max);
}

function normalizeFontWeight(weight) {
    const allowed = [100, 200, 300, 400, 500, 600, 700, 800, 900];
    if (allowed.includes(weight)) {
        return weight;
    }

    const nearest = allowed.reduce((closest, current) => {
        return Math.abs(current - weight) < Math.abs(closest - weight) ? current : closest;
    }, allowed[0]);

    return nearest;
}

// 设置快捷键
function setupKeyboardShortcuts() {
    document.addEventListener('keydown', async (e) => {
        // Cmd+O (macOS) 或 Ctrl+O (Windows/Linux)
        if ((e.metaKey || e.ctrlKey) && e.key === 'o') {
            e.preventDefault();
            await openFileOrFolder();
        }

        // Cmd+S (macOS) 或 Ctrl+S (Windows/Linux) 保存
        if ((e.metaKey || e.ctrlKey) && e.key === 's') {
            e.preventDefault();
            await saveCurrentFile();
        }

        // Cmd+W (macOS) 或 Ctrl+W (Windows/Linux) 关闭当前 tab
        if ((e.metaKey || e.ctrlKey) && e.key === 'w') {
            e.preventDefault();
            await closeActiveTab();
        }

        // Cmd+F (macOS) 或 Ctrl+F (Windows/Linux) 查找
        if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
            e.preventDefault();
            // 统一使用 editor 的 showSearch 方法，它会自动判断当前编辑器
            if (editor) {
                editor.showSearch();
            }
        }
    });
}

async function closeActiveTab() {
    if (!tabManager || !tabManager.activeTabId) {
        return;
    }
    await tabManager.handleTabClose(tabManager.activeTabId);
}

function setupSidebarResizer() {
    const sidebar = document.getElementById('sidebar');
    const resizer = document.getElementById('sidebarResizer');

    if (!sidebar || !resizer) return;

    const minWidth = 180;
    const maxSidebarWidth = 640;
    const minContentWidth = 320;
    let startX = 0;
    let startWidth = 0;
    let activePointerId = null;

    const stopResizing = (event) => {
        if (activePointerId === null || event.pointerId !== activePointerId) return;

        if (resizer.hasPointerCapture(activePointerId)) {
            resizer.releasePointerCapture(activePointerId);
        }
        activePointerId = null;
        document.body.classList.remove('sidebar-resizing');
        document.body.style.userSelect = '';
    };

    resizer.addEventListener('pointerdown', (event) => {
        if (activePointerId !== null) return;

        startX = event.clientX;
        startWidth = sidebar.getBoundingClientRect().width;
        activePointerId = event.pointerId;
        resizer.setPointerCapture(activePointerId);
        document.body.classList.add('sidebar-resizing');
        document.body.style.userSelect = 'none';
        event.preventDefault();
    });

    resizer.addEventListener('pointermove', (event) => {
        if (activePointerId === null || event.pointerId !== activePointerId) return;

        const delta = event.clientX - startX;
        const bodyWidth = document.body.getBoundingClientRect().width;
        const maxAvailable = bodyWidth - minContentWidth;
        const clampedMax = Math.max(minWidth, Math.min(maxSidebarWidth, maxAvailable));
        const nextWidth = Math.min(Math.max(minWidth, startWidth + delta), clampedMax);

        sidebar.style.width = `${nextWidth}px`;
    });

    resizer.addEventListener('pointerup', stopResizing);
    resizer.addEventListener('pointercancel', stopResizing);
}

// 打开文件或文件夹（自动判断）
async function openFileOrFolder() {
    try {
        const selected = await selectPath();
        const selections = normalizeSelectedPaths(selected)
            .map(normalizeFsPath)
            .filter(Boolean);

        if (selections.length === 0) return;

        const uniqueSelections = Array.from(new Set(selections));

        for (const resolvedPath of uniqueSelections) {
            try {
                const isDir = await invoke('is_directory', { path: resolvedPath });

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

async function selectPath() {
    try {
        return await invoke('pick_path');
    } catch (error) {
        const message = typeof error === 'string' ? error : error?.message;
        if (message === 'unsupported') {
            return await open({ multiple: true, directory: false });
        }
        throw error;
    }
}

function normalizeSelectedPaths(selected) {
    if (!selected) return [];

    const extractPath = (entry) => {
        if (!entry) return null;
        if (typeof entry === 'string') return entry;
        if (typeof entry === 'object') {
            if ('path' in entry && typeof entry.path === 'string') {
                return entry.path;
            }
            if ('uri' in entry && typeof entry.uri === 'string') {
                return entry.uri;
            }
        }
        return null;
    };

    if (Array.isArray(selected)) {
        return selected.map(extractPath).filter(Boolean);
    }

    const single = extractPath(selected);
    return single ? [single] : [];
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
            await invoke('write_file', {
                path: currentFile,
                content,
            });
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
        await invoke('write_file', {
            path: filePath,
            content: cached.content,
        });
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

function normalizeFsPath(path) {
    if (!path) return path;
    if (typeof path === 'string' && path.startsWith('file://')) {
        try {
            const url = new URL(path);
            return decodeURI(url.pathname);
        } catch (error) {
            console.warn('无法解析文件路径 URL:', path, error);
        }
    }
    return path;
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
        const metadata = await invoke('get_file_metadata', { path: filePath });
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

async function collectContentForPdf() {
    const viewElement = document.getElementById('viewContent');
    if (!viewElement) {
        throw new Error('无法找到 viewContent 元素');
    }

    // 获取内容元素
    let contentElement;
    if (activeViewMode === 'markdown') {
        contentElement = viewElement.querySelector('.tiptap-editor');
    } else {
        contentElement = viewElement.querySelector('.monaco-editor');
    }

    if (!contentElement) {
        contentElement = viewElement;
    }

    // 获取 HTML 内容
    const htmlContent = contentElement.innerHTML;

    // 收集所有相关的 CSS
    const cssContent = await collectAllStyles();

    // 获取视图容器的实际宽度
    const pageWidth = viewElement.clientWidth || 800;

    return { htmlContent, cssContent, pageWidth };
}

async function collectAllStyles() {
    const styles = [];

    // 收集所有 <style> 标签
    const styleTags = document.querySelectorAll('style');
    styleTags.forEach(tag => {
        if (tag.textContent) {
            styles.push(tag.textContent);
        }
    });

    // 收集所有外部样式表
    const linkTags = document.querySelectorAll('link[rel="stylesheet"]');
    for (const link of linkTags) {
        try {
            const href = link.getAttribute('href');
            if (href) {
                const response = await fetch(href);
                const cssText = await response.text();
                styles.push(cssText);
            }
        } catch (error) {
            console.warn('无法加载样式表:', link.href, error);
        }
    }

    // 添加必要的基础样式
    styles.push(`
        body {
            margin: 0;
            padding: 20px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
            line-height: 1.6;
        }
        .tiptap-editor {
            max-width: 800px;
            margin: 0 auto;
        }
        .code-copy-button {
            display: none !important;
        }
    `);

    return styles.join('\n');
}
