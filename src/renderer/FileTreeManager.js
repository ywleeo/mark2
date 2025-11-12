import { open } from '@tauri-apps/plugin-dialog';
import { getAppServices } from '../services/appServices.js';

export class FileTreeManager {
    constructor() {
        this.currentFolder = null;
        this.fileTree = document.getElementById('fileTree');
        this.services = null;
        this.fileService = null;
        this.ensureFileService();
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
            const { entries = [] } = await this.ensureFileService().list(folderPath);
            const paths = entries.map(entry => entry.path);
            this.renderFileTree(paths);
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

    ensureFileService() {
        if (this.fileService) {
            return this.fileService;
        }
        try {
            this.services = getAppServices();
        } catch (error) {
            const fallback = typeof window !== 'undefined' ? window.__MARK2_SERVICES__ : null;
            if (fallback) {
                this.services = fallback;
            } else {
                throw error;
            }
        }
        if (!this.services?.file) {
            throw new Error('文件服务未初始化');
        }
        this.fileService = this.services.file;
        return this.fileService;
    }
}
