import { invoke } from '@tauri-apps/api/core';
import { open, save, message } from '@tauri-apps/plugin-dialog';
import { listen } from '@tauri-apps/api/event';
import { MarkdownEditor } from './components/MarkdownEditor.js';
import { FileTree } from './components/FileTree.js';
import { TabManager } from './components/TabManager.js';
import { SettingsDialog } from './components/SettingsDialog.js';
import { desktopDir, join } from '@tauri-apps/api/path';
import { toPng } from 'html-to-image';

console.log('Mark2 Tauri 版本已启动');

let currentFile = null;
let editor = null;
let fileTree = null;
let tabManager = null;
let settingsDialog = null;
let editorSettings = { fontSize: 16, lineHeight: 1.6, fontFamily: '', fontWeight: 400 };
let availableFontFamilies = [];

const folderRefreshTimers = new Map();
const fileRefreshTimers = new Map();
const SETTINGS_STORAGE_KEY = 'mark2:editorSettings';
const defaultEditorSettings = {
    fontSize: 16,
    lineHeight: 1.6,
    fontFamily: '',
    fontWeight: 400,
};

// 基础初始化代码
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM 加载完成');

    // 初始化编辑器
    const editorElement = document.getElementById('viewContent');
    editor = new MarkdownEditor(editorElement);

    // 初始化文件树
    const fileTreeElement = document.getElementById('fileTree');
    fileTree = new FileTree(fileTreeElement, handleFileSelect, {
        onFolderChange: handleFolderWatcherEvent,
        onFileChange: handleFileWatcherEvent,
        onOpenFilesChange: handleOpenFilesChange,
    });

    const tabBarElement = document.getElementById('tabBar');
    tabManager = new TabManager(tabBarElement, {
        onTabSelect: handleTabSelect,
        onTabClose: handleTabClose,
    });

    editorSettings = loadEditorSettings();
    applyEditorSettings(editorSettings);

    settingsDialog = new SettingsDialog({
        onSubmit: handleSettingsSubmit,
    });
    if (availableFontFamilies.length > 0) {
        settingsDialog.setAvailableFonts(availableFontFamilies);
    }

    setupKeyboardShortcuts();
    setupMenuListeners();
    setupSidebarResizer();
    setupCleanupHandlers();

    loadAvailableFonts();
});

// 文件选择回调
async function handleFileSelect(filePath) {
    if (!filePath) {
        currentFile = null;
        editor?.clear?.();
        tabManager?.clearSharedTab?.();
        return;
    }

    await loadFile(filePath);
    const isOpenTab = fileTree?.isInOpenList?.(filePath);
    if (isOpenTab) {
        tabManager?.setActiveFileTab(filePath, { silent: true });
    } else {
        tabManager?.showSharedTab(filePath);
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

function handleTabClose(tab) {
    if (!tab) return;
    if (tab.type === 'file' && tab.path) {
        fileTree?.closeFile(tab.path);
        return;
    }

    if (tab.type === 'shared') {
        if (!tab.fallbackPath) {
            fileTree?.selectFile(null);
        }
        return;
    }
}

// 监听菜单事件
async function setupMenuListeners() {
    await listen('menu-open', (event) => {
        console.log('收到菜单事件:', event);
        openFileOrFolder();
    });

    await listen('menu-settings', () => {
        console.log('收到设置菜单事件');
        openSettingsDialog();
    });

    await listen('menu-screenshot', async () => {
        console.log('收到截图菜单事件');
        await handleMenuScreenshot();
    });
    console.log('菜单事件监听已设置');
}

async function handleMenuScreenshot() {
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
        const dataUrl = await toPng(clone, {
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

function openSettingsDialog() {
    if (!settingsDialog) {
        settingsDialog = new SettingsDialog({
            onSubmit: handleSettingsSubmit,
        });
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

    root.style.setProperty('--editor-font-size', `${prefs.fontSize}px`);
    root.style.setProperty('--editor-line-height', prefs.lineHeight.toString());
    root.style.setProperty('--editor-font-weight', prefs.fontWeight.toString());

    if (prefs.fontFamily && prefs.fontFamily.length > 0) {
        root.style.setProperty('--editor-font-family', prefs.fontFamily);
    } else {
        root.style.removeProperty('--editor-font-family');
    }
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
            if (editor) {
                await editor.save();
            }
        }
    });
    console.log('快捷键已设置: Cmd+O 打开文件, Cmd+S 保存');
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

        console.log('选择:', uniqueSelections);

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

async function loadFile(filePath) {
    try {
        console.log('读取文件:', filePath);
        const content = await invoke('read_file', { path: filePath });
        currentFile = filePath;

        // 使用编辑器加载内容
        if (editor) {
            await editor.loadFile(filePath, content);
        }

        if (fileTree?.openFiles?.includes?.(filePath)) {
            try {
                await fileTree.watchFile(filePath);
            } catch (error) {
                console.error('无法监听文件:', error);
            }
        }

        console.log('文件加载成功');
    } catch (error) {
        console.error('读取文件失败:', error);
        alert('读取文件失败: ' + error);
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
}

function handleFolderWatcherEvent(watchedPath, event) {
    if (!fileTree) return;

    const normalizedRoot = normalizeFsPath(watchedPath);
    if (!normalizedRoot || !fileTree?.hasRoot?.(normalizedRoot)) {
        return;
    }

    const eventPaths = Array.isArray(event?.paths) ? event.paths.map(normalizeFsPath) : [];
    console.debug('[Watcher] 目录变更路径', eventPaths);

    eventPaths.forEach((changedPath) => {
        if (!changedPath) return;
        if (fileTree?.isFileOpen?.(changedPath)) {
            const editorPath = editor ? normalizeFsPath(editor.currentFile) : null;
            if (editor && editorPath === changedPath) {
                if (typeof editor.hasUnsavedChanges === 'function' && editor.hasUnsavedChanges()) {
                    console.log('检测到文件外部变更，但编辑器存在未保存的修改，暂不覆盖');
                    return;
                }
            }
            scheduleFileRefresh(changedPath);
        }
    });

    scheduleFolderRefresh(normalizedRoot);
}

function handleFileWatcherEvent(filePath, event) {
    const normalizedPath = normalizeFsPath(filePath);
    if (!normalizedPath) return;

    console.debug('[Watcher] 文件变更事件触发', { normalizedPath, event });

    const isOpenFile = fileTree?.isFileOpen?.(normalizedPath);
    if (!isOpenFile) {
        // 不在打开列表的文件不需要自动刷新
        return;
    }

    const editorPath = editor ? normalizeFsPath(editor.currentFile) : null;
    if (editor && editorPath === normalizedPath) {
        if (typeof editor.hasUnsavedChanges === 'function' && editor.hasUnsavedChanges()) {
            console.log('检测到文件外部变更，但编辑器存在未保存的修改，暂不覆盖');
            return;
        }
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
    }, 200);

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
            console.debug('[Watcher] 跳过文件刷新，文件已不在打开列表', normalizedPath);
            return;
        }
        try {
            console.debug('[Watcher] 重新加载文件', normalizedPath);
            await loadFile(normalizedPath);
        } catch (error) {
            console.error('刷新文件失败:', error);
        }
    }, 150);

    fileRefreshTimers.set(normalizedPath, timer);
}
