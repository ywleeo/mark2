import { invoke } from '@tauri-apps/api/core';

export class ImageViewer {
    constructor(containerElement) {
        this.container = containerElement;
        this.currentFile = null;
        this.init();
    }

    init() {
        this.container.className = 'image-viewer';
        this.container.innerHTML = `
            <div class="image-viewer-content">
                <img class="image-viewer-img" alt="图片加载中..." />
                <div class="image-viewer-info">
                    <span class="image-viewer-filename"></span>
                </div>
            </div>
        `;

        this.imgElement = this.container.querySelector('.image-viewer-img');
        this.filenameElement = this.container.querySelector('.image-viewer-filename');
    }

    async loadImage(filePath) {
        if (!filePath) {
            this.clear();
            return;
        }

        try {
            this.currentFile = filePath;

            // 读取图片文件为 base64
            const base64Data = await invoke('read_image_base64', { path: filePath });

            // 根据文件扩展名确定 MIME 类型
            const ext = filePath.toLowerCase().split('.').pop();
            const mimeTypes = {
                'png': 'image/png',
                'jpg': 'image/jpeg',
                'jpeg': 'image/jpeg',
                'gif': 'image/gif',
                'bmp': 'image/bmp',
                'webp': 'image/webp',
                'svg': 'image/svg+xml',
                'ico': 'image/x-icon'
            };
            const mimeType = mimeTypes[ext] || 'image/png';

            // 设置 data URL
            this.imgElement.src = `data:${mimeType};base64,${base64Data}`;
            this.imgElement.alt = filePath.split('/').pop() || filePath;

            const fileName = filePath.split('/').pop() || filePath;
            this.filenameElement.textContent = fileName;

            // 等待图片加载
            await new Promise((resolve, reject) => {
                this.imgElement.onload = resolve;
                this.imgElement.onerror = reject;
            });
        } catch (error) {
            console.error('加载图片失败:', error);
            throw error;
        }
    }

    clear() {
        this.currentFile = null;
        this.imgElement.src = '';
        this.imgElement.alt = '';
        this.filenameElement.textContent = '';
    }

    hide() {
        this.container.style.display = 'none';
    }

    show() {
        this.container.style.display = 'flex';
    }

    dispose() {
        this.clear();
    }
}
