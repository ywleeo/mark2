import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';

export class FileTreeManager {
    constructor() {
        this.currentFolder = null;
        this.fileTree = document.getElementById('fileTree');
    }

    async openFolder() {
        try {
            const selected = await open({
                directory: true,
                multiple: false,
            });

            if (selected) {
                this.currentFolder = selected;
                await this.loadFileTree(selected);
            }
        } catch (error) {
            console.error('打开文件夹失败:', error);
        }
    }

    async loadFileTree(folderPath) {
        try {
            const entries = await invoke('read_dir', { path: folderPath });
            this.renderFileTree(entries);
        } catch (error) {
            console.error('读取文件夹失败:', error);
        }
    }

    renderFileTree(entries) {
        this.fileTree.innerHTML = '';

        entries.forEach(entry => {
            const item = document.createElement('div');
            item.className = 'file-tree-item';

            const fileName = entry.split('/').pop();
            item.textContent = fileName;

            if (fileName.endsWith('.md') || fileName.endsWith('.markdown')) {
                item.addEventListener('click', () => {
                    this.onFileClick(entry);
                });
            }

            this.fileTree.appendChild(item);
        });
    }

    onFileClick(filePath) {
        window.dispatchEvent(new CustomEvent('file-selected', {
            detail: { path: filePath }
        }));
    }
}
