import { getAppServices } from '../services/appServices.js';
import { rememberSecurityScopes } from '../services/securityScopeService.js';
import { basename } from '../utils/pathUtils.js';
import { addClickHandler } from '../utils/PointerHelper.js';

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
            const selections = await this.ensureFileService().pick({
                directory: true,
                multiple: false,
                allowFiles: false,
            });
            const entries = Array.isArray(selections) ? selections.filter(Boolean) : [];
            if (entries.length === 0) {
                return;
            }
            await rememberSecurityScopes(entries);
            const target = entries[0]?.path;
            if (!target) {
                return;
            }
            this.currentFolder = target;
            await this.loadFileTree(target);
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

            const fileName = basename(entry);
            item.textContent = fileName;

            if (fileName.endsWith('.md') || fileName.endsWith('.markdown')) {
                addClickHandler(item, () => {
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
        this.services = getAppServices();
        if (!this.services?.file) {
            throw new Error('文件服务未初始化');
        }
        this.fileService = this.services.file;
        return this.fileService;
    }
}
