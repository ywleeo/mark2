import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { listen } from '@tauri-apps/api/event';
import { MarkdownEditor } from './components/MarkdownEditor.js';
import { FileTree } from './components/FileTree.js';

console.log('Mark2 Tauri 版本已启动');

let currentFile = null;
let editor = null;
let fileTree = null;

const folderRefreshTimers = new Map();
const fileRefreshTimers = new Map();

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
    });

    setupKeyboardShortcuts();
    setupMenuListeners();
    setupSidebarResizer();
    setupCleanupHandlers();
});

// 文件选择回调
async function handleFileSelect(filePath) {
    await loadFile(filePath);
}

// 监听菜单事件
async function setupMenuListeners() {
    await listen('menu-open', (event) => {
        console.log('收到菜单事件:', event);
        openFileOrFolder();
    });
    console.log('菜单事件监听已设置');
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
