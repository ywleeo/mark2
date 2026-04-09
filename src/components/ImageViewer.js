import { getAppServices } from '../services/appServices.js';
import { ImageModal } from './ImageModal.js';
import { addClickHandler } from '../utils/PointerHelper.js';
import { basename } from '../utils/pathUtils.js';

export class ImageViewer {
    constructor(containerElement) {
        this.container = containerElement;
        this.currentFile = null;
        this.zoomScale = 1;
        this.defaultMessage = '';
        this.handleImageClick = this.handleImageClick.bind(this);
        this.imageModal = new ImageModal();
        this.clickCleanup = null;
        this.init();
    }

    init() {
        this.container.classList.add('image-viewer');
        this.container.innerHTML = `
            <div class="image-viewer-content">
                <img class="image-viewer-img" alt="图片加载中..." />
                <div class="image-viewer-info">
                    <span class="image-viewer-filename"></span>
                    <div class="image-viewer-message" hidden></div>
                </div>
            </div>
        `;

        this.imgElement = this.container.querySelector('.image-viewer-img');
        this.filenameElement = this.container.querySelector('.image-viewer-filename');
        this.messageElement = this.container.querySelector('.image-viewer-message');
        if (this.imgElement) {
            this.imgElement.style.transformOrigin = 'center top';
            // 使用 PointerHelper 处理单击事件
            this.clickCleanup = addClickHandler(this.imgElement, this.handleImageClick);
        }
    }

    resetMessage() {
        if (this.messageElement) {
            this.messageElement.textContent = this.defaultMessage;
            this.messageElement.hidden = !this.defaultMessage;
        }
    }

    showMessage(text) {
        if (this.messageElement) {
            this.messageElement.textContent = text || '';
            this.messageElement.hidden = !text;
        }
    }

    clearImageContent() {
        if (this.imgElement) {
            this.imgElement.src = '';
            this.imgElement.alt = '';
        }
    }

    async loadImage(filePath) {
        if (!filePath) {
            this.clear();
            return;
        }

        try {
            this.currentFile = filePath;
            this.resetMessage();

            // 读取图片文件为 base64
            const base64Data = await getAppServices().file.readImageBase64(filePath);

            // 空文件直接提示，不抛出异常
            if (!base64Data) {
                const fileName = basename(filePath) || filePath;
                this.filenameElement.textContent = fileName;
                this.clearImageContent();
                this.showMessage('文件为空，无法预览');
                return;
            }

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
            this.imgElement.alt = basename(filePath) || filePath;

            const fileName = basename(filePath) || filePath;
            this.filenameElement.textContent = fileName;

            // 等待图片加载
            await new Promise((resolve, reject) => {
                this.imgElement.onload = resolve;
                this.imgElement.onerror = reject;
            });
        } catch (error) {
            console.error('加载图片失败:', error);
            this.clearImageContent();
            this.showMessage('无法加载图片，文件可能为空或已损坏');
            return;
        }

        this.applyZoomScale();
    }

    clear() {
        this.currentFile = null;
        this.clearImageContent();
        this.filenameElement.textContent = '';
        this.resetMessage();
        this.zoomScale = 1;
        this.applyZoomScale();
    }

    hide() {
        this.container.style.display = 'none';
    }

    show() {
        this.container.style.display = 'flex';
    }

    setZoomScale(scale) {
        if (!Number.isFinite(scale)) {
            return;
        }
        const clamped = Math.min(3, Math.max(0.5, scale));
        this.zoomScale = clamped;
        this.applyZoomScale();
    }

    applyZoomScale() {
        if (this.imgElement) {
            this.imgElement.style.transform = `scale(${this.zoomScale})`;
        }
    }

    handleImageClick() {
        if (!this.imgElement || !this.imgElement.src) {
            return;
        }
        const alt = this.imgElement.alt || basename(this.currentFile) || '图片';
        const hints = this.imgElement.naturalWidth > 0
            ? { width: this.imgElement.naturalWidth, height: this.imgElement.naturalHeight }
            : {};
        this.imageModal?.show(this.imgElement.src, alt, hints);
    }

    dispose() {
        this.clear();
        if (this.clickCleanup) {
            this.clickCleanup();
            this.clickCleanup = null;
        }
        this.imageModal?.destroy();
    }
}
