import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { listen } from '@tauri-apps/api/event';
import { MarkdownEditor } from './components/MarkdownEditor.js';
import { FileTree } from './components/FileTree.js';

console.log('Mark2 Tauri 版本已启动');

let currentFile = null;
let currentFolder = null;
let editor = null;
let fileTree = null;

let folderRefreshTimer = null;
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
        if (!selected) return;

        const resolvedPath = normalizeSelectedPath(selected);
        if (!resolvedPath) return;

        console.log('选择:', resolvedPath);

        const isDir = await invoke('is_directory', { path: resolvedPath });

        if (isDir) {
            currentFolder = resolvedPath;
            if (fileTree) {
                await fileTree.loadFolder(resolvedPath);
            }
        } else {
            fileTree?.addToOpenFiles(resolvedPath);
            fileTree?.selectFile(resolvedPath);
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
            return await open({ multiple: false, directory: false });
        }
        throw error;
    }
}

function normalizeSelectedPath(selected) {
    if (!selected) return null;
    if (typeof selected === 'string') return selected;
    if (Array.isArray(selected)) return selected[0] ?? null;
    if (typeof selected === 'object') {
        if ('path' in selected && typeof selected.path === 'string') {
            return selected.path;
        }
        if ('uri' in selected && typeof selected.uri === 'string') {
            return selected.uri;
        }
    }
    return null;
}

async function loadFile(filePath) {
    try {
        console.log('读取文件:', filePath);
        const content = await invoke('read_file', { path: filePath });
        currentFile = filePath;

        // 使用编辑器加载内容
        if (editor) {
            editor.loadFile(filePath, content);
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
            return url.pathname;
        } catch (error) {
            console.warn('无法解析文件路径 URL:', path, error);
        }
    }
    return path;
}

function handleFolderWatcherEvent(watchedPath, event) {
    if (!fileTree || !fileTree.rootPath) return;
    if (normalizeFsPath(watchedPath) !== normalizeFsPath(fileTree.rootPath)) return;

    const eventPaths = Array.isArray(event?.paths) ? event.paths.map(normalizeFsPath) : [];
    eventPaths.forEach((changedPath) => {
        if (!changedPath) return;
        if (fileTree.openFiles?.includes?.(changedPath)) {
            if (editor && editor.currentFile === changedPath) {
                if (typeof editor.hasUnsavedChanges === 'function' && editor.hasUnsavedChanges()) {
                    console.log('检测到文件外部变更，但编辑器存在未保存的修改，暂不覆盖');
                    return;
                }
            }
            scheduleFileRefresh(changedPath);
        }
    });

    scheduleFolderRefresh();
}

function handleFileWatcherEvent(filePath, event) {
    const normalizedPath = normalizeFsPath(filePath);
    if (!normalizedPath) return;

    const isOpenFile = fileTree?.openFiles?.includes?.(normalizedPath);
    if (!isOpenFile) {
        // 不在打开列表的文件不需要自动刷新
        return;
    }

    if (editor && normalizeFsPath(editor.currentFile) === normalizedPath) {
        if (typeof editor.hasUnsavedChanges === 'function' && editor.hasUnsavedChanges()) {
            console.log('检测到文件外部变更，但编辑器存在未保存的修改，暂不覆盖');
            return;
        }
        scheduleFileRefresh(normalizedPath);
    }
}

function scheduleFolderRefresh() {
    if (folderRefreshTimer) {
        clearTimeout(folderRefreshTimer);
    }

    folderRefreshTimer = setTimeout(async () => {
        folderRefreshTimer = null;
        if (!fileTree || !fileTree.rootPath) return;

        try {
            await fileTree.refreshCurrentFolder();
        } catch (error) {
            console.error('刷新目录失败:', error);
        }
    }, 200);
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
        if (!fileTree?.openFiles?.includes?.(normalizedPath)) {
            return;
        }
        try {
            await loadFile(normalizedPath);
        } catch (error) {
            console.error('刷新文件失败:', error);
        }
    }, 150);

    fileRefreshTimers.set(normalizedPath, timer);
}
