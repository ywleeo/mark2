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

// 基础初始化代码
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM 加载完成');

    // 初始化编辑器
    const editorElement = document.getElementById('viewContent');
    editor = new MarkdownEditor(editorElement);

    // 初始化文件树
    const fileTreeElement = document.getElementById('fileTree');
    fileTree = new FileTree(fileTreeElement, handleFileSelect);

    setupKeyboardShortcuts();
    setupMenuListeners();
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
            await loadFile(resolvedPath);
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

        console.log('文件加载成功');
    } catch (error) {
        console.error('读取文件失败:', error);
        alert('读取文件失败: ' + error);
    }
}
