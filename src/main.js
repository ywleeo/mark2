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
        const selected = await open({
            multiple: false,
            directory: false, // 允许选择文件和文件夹
        });

        if (!selected) return;

        console.log('选择:', selected);

        // 判断是文件还是文件夹
        const isDir = await invoke('is_directory', { path: selected });

        if (isDir) {
            currentFolder = selected;
            await loadFileTree(selected);
        } else {
            await loadFile(selected);
        }
    } catch (error) {
        console.error('打开失败:', error);
        alert('打开失败: ' + error);
    }
}


async function loadFileTree(folderPath) {
    try {
        console.log('读取文件夹:', folderPath);
        const entries = await invoke('read_dir', { path: folderPath });
        console.log('文件列表:', entries);
        renderFileTree(entries);
    } catch (error) {
        console.error('读取文件夹失败:', error);
        alert('读取文件夹失败: ' + error);
    }
}

function renderFileTree(entries) {
    const fileTree = document.getElementById('fileTree');
    fileTree.innerHTML = '';

    entries.forEach(entry => {
        const item = document.createElement('div');
        item.className = 'file-tree-item';

        const fileName = entry.split('/').pop();
        item.textContent = fileName;

        if (fileName.endsWith('.md') || fileName.endsWith('.markdown')) {
            item.style.cursor = 'pointer';
            item.addEventListener('click', () => {
                loadFile(entry);
            });
        }

        fileTree.appendChild(item);
    });
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
