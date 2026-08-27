import { getAppServices } from '../services/appServices.js';
import { ImageModal } from './ImageModal.js';
import { addClickHandler } from '../utils/PointerHelper.js';
import { basename } from '../utils/pathUtils.js';
import {
    formatFileTimestamp,
    formatImageMetadata,
    getBase64ByteLength,
    resolveImageMimeType,
} from '../utils/imageMetadata.js';
import { t } from '../i18n/index.js';

/** 负责独立图片文件的加载、缩放、元信息展示与大图预览。 */
export class ImageViewer {
    /**
     * 创建图片查看器。
     * @param {HTMLElement} containerElement - 图片视图的宿主容器。
     */
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

    /** 初始化图片查看器 DOM 与交互事件。 */
    init() {
        this.container.classList.add('image-viewer');
        this.container.innerHTML = `
            <div class="image-viewer-content">
                <img class="image-viewer-img" alt="图片加载中..." />
                <div class="image-viewer-info">
                    <span class="image-viewer-filename"></span>
                    <span class="image-viewer-metadata" hidden></span>
                    <div class="image-viewer-message" hidden></div>
                </div>
            </div>
        `;

        this.imgElement = this.container.querySelector('.image-viewer-img');
        this.filenameElement = this.container.querySelector('.image-viewer-filename');
        this.metadataElement = this.container.querySelector('.image-viewer-metadata');
        this.messageElement = this.container.querySelector('.image-viewer-message');
        if (this.imgElement) {
            this.imgElement.style.transformOrigin = 'center top';
            // 使用 PointerHelper 处理单击事件
            this.clickCleanup = addClickHandler(this.imgElement, this.handleImageClick);
        }
    }

    /** 将提示信息恢复为查看器默认值。 */
    resetMessage() {
        if (this.messageElement) {
            this.messageElement.textContent = this.defaultMessage;
            this.messageElement.hidden = !this.defaultMessage;
        }
    }

    /**
     * 展示图片加载提示或错误信息。
     * @param {string} text - 要展示的信息。
     */
    showMessage(text) {
        if (this.messageElement) {
            this.messageElement.textContent = text || '';
            this.messageElement.hidden = !text;
        }
    }

    /** 清理当前图片节点及其元信息。 */
    clearImageContent() {
        if (this.imgElement) {
            this.imgElement.src = '';
            this.imgElement.alt = '';
        }
        this.setMetadata('');
    }

    /**
     * 更新图片元信息摘要。
     * @param {string} text - 元信息摘要。
     */
    setMetadata(text) {
        if (this.metadataElement) {
            this.metadataElement.textContent = text || '';
            this.metadataElement.hidden = !text;
        }
    }

    /**
     * 加载并展示图片文件。
     * @param {string} filePath - 图片文件绝对路径。
     * @returns {Promise<void>}
     */
    async loadImage(filePath) {
        if (!filePath) {
            this.clear();
            return;
        }

        try {
            this.currentFile = filePath;
            this.resetMessage();
            this.filenameElement.textContent = basename(filePath) || filePath;
            this.setMetadata('');

            // 图片内容和文件系统元数据并行读取，元数据失败不影响基础预览能力。
            const fileService = getAppServices().file;
            const fileMetadataPromise = fileService.metadata?.(filePath).catch((error) => {
                console.warn('[ImageViewer] 读取图片文件元数据失败', { filePath, error });
                return null;
            }) ?? Promise.resolve(null);
            const [base64Data, fileMetadata] = await Promise.all([
                fileService.readImageBase64(filePath),
                fileMetadataPromise,
            ]);

            // 空文件直接提示，不抛出异常
            if (!base64Data) {
                this.clearImageContent();
                this.showMessage('文件为空，无法预览');
                return;
            }

            // 根据文件扩展名确定 MIME 类型和原始文件体积。
            const mimeType = resolveImageMimeType(filePath);
            const byteLength = Number.isFinite(fileMetadata?.file_size)
                ? fileMetadata.file_size
                : getBase64ByteLength(base64Data);

            // 设置 data URL
            this.imgElement.src = `data:${mimeType};base64,${base64Data}`;
            this.imgElement.alt = basename(filePath) || filePath;

            // 等待图片加载
            await new Promise((resolve, reject) => {
                this.imgElement.onload = resolve;
                this.imgElement.onerror = reject;
            });

            const summary = formatImageMetadata({
                width: this.imgElement.naturalWidth,
                height: this.imgElement.naturalHeight,
                mimeType,
                byteLength,
            });
            const timestamps = [
                this.formatTimestampMetadata('imageViewer.createdAt', fileMetadata?.created_time),
                this.formatTimestampMetadata('imageViewer.modifiedAt', fileMetadata?.modified_time),
            ].filter(Boolean).join(' · ');
            this.setMetadata([summary, timestamps].filter(Boolean).join('\n'));
        } catch (error) {
            console.error('加载图片失败:', error);
            this.clearImageContent();
            this.showMessage('无法加载图片，文件可能为空或已损坏');
            return;
        }

        this.applyZoomScale();
    }

    /**
     * 将文件时间转换为带本地化标签的图片元信息。
     * @param {string} translationKey - i18n 标签键。
     * @param {number|null|undefined} timestamp - Unix 毫秒时间戳。
     * @returns {string} 可展示的时间元信息。
     */
    formatTimestampMetadata(translationKey, timestamp) {
        const value = formatFileTimestamp(timestamp);
        return value ? t(translationKey, { value }) : '';
    }

    /** 清空查看器并恢复默认缩放。 */
    clear() {
        this.currentFile = null;
        this.clearImageContent();
        this.filenameElement.textContent = '';
        this.resetMessage();
        this.zoomScale = 1;
        this.applyZoomScale();
    }

    /** 隐藏图片查看器。 */
    hide() {
        this.container.style.display = 'none';
    }

    /** 显示图片查看器。 */
    show() {
        this.container.style.display = 'flex';
    }

    /**
     * 设置图片缩放倍数。
     * @param {number} scale - 目标缩放倍数。
     */
    setZoomScale(scale) {
        if (!Number.isFinite(scale)) {
            return;
        }
        const clamped = Math.min(3, Math.max(0.5, scale));
        this.zoomScale = clamped;
        this.applyZoomScale();
    }

    /** 将当前缩放倍数应用到图片节点。 */
    applyZoomScale() {
        if (this.imgElement) {
            this.imgElement.style.transform = `scale(${this.zoomScale})`;
        }
    }

    /** 在用户点击图片时打开大图预览。 */
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

    /** 释放查看器注册的事件与弹窗资源。 */
    dispose() {
        this.clear();
        if (this.clickCleanup) {
            this.clickCleanup();
            this.clickCleanup = null;
        }
        this.imageModal?.destroy();
    }
}
