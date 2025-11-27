import { convertFileSrc } from '@tauri-apps/api/core';
import { isAudioFilePath, isVideoFilePath } from '../utils/fileTypeUtils.js';

export class MediaViewer {
    constructor(containerElement) {
        this.container = containerElement;
        this.mediaElement = null;
        this.currentFile = null;
        this.init();
    }

    init() {
        this.container.classList.add('media-viewer');
        this.container.innerHTML = `
            <div class="media-viewer__content">
                <div class="media-viewer__player" data-role="player"></div>
                <div class="media-viewer__info">
                    <div class="media-viewer__filename"></div>
                    <div class="media-viewer__hint">本地文件按需加载，使用系统解码能力播放</div>
                    <div class="media-viewer__error" hidden></div>
                </div>
            </div>
        `;

        this.playerSlot = this.container.querySelector('[data-role="player"]');
        this.filenameElement = this.container.querySelector('.media-viewer__filename');
        this.errorElement = this.container.querySelector('.media-viewer__error');
    }

    createMediaElement(tagName) {
        if (this.mediaElement) {
            this.mediaElement.pause?.();
            this.mediaElement.src = '';
            this.mediaElement.load?.();
            this.mediaElement.remove();
        }

        const element = document.createElement(tagName);
        element.className = 'media-viewer__element';
        element.controls = true;
        element.preload = 'metadata';
        element.playsInline = true;
        element.setAttribute('webkit-playsinline', 'true');

        this.mediaElement = element;
        this.playerSlot?.appendChild(element);
        return element;
    }

    resolveStreamSrc(filePath) {
        const tryConvert = (convertFn) => {
            try {
                const result = convertFn?.(filePath, 'stream');
                if (typeof result === 'string' && result.includes('://')) {
                    return result;
                }
            } catch {
                // ignore
            }
            return null;
        };

        return (
            tryConvert(convertFileSrc)
            || tryConvert(window?.__TAURI_INTERNALS__?.convertFileSrc)
            || ''
        );
    }

    hideError() {
        if (this.errorElement) {
            this.errorElement.textContent = '';
            this.errorElement.hidden = true;
        }
    }

    showError(message) {
        if (this.errorElement) {
            this.errorElement.textContent = message || '无法加载媒体文件';
            this.errorElement.hidden = false;
        }
    }

    async loadMedia(filePath) {
        if (!filePath) {
            this.clear();
            return;
        }

        const isVideo = isVideoFilePath(filePath);
        const isAudio = isAudioFilePath(filePath);
        if (!isVideo && !isAudio) {
            this.showError('不支持的媒体类型');
            return;
        }

        this.currentFile = filePath;
        this.hideError();
        this.filenameElement.textContent = filePath.split('/').pop() || filePath;

        const element = this.createMediaElement(isVideo ? 'video' : 'audio');
        const tryLoad = (src, { isFallback } = {}) => new Promise((resolve, reject) => {
            const cleanup = () => {
                element.onloadedmetadata = null;
                element.oncanplay = null;
                element.onerror = null;
            };
            element.onloadedmetadata = () => {
                cleanup();
                resolve();
            };
            element.oncanplay = () => {
                cleanup();
                resolve();
            };
            element.onerror = (event) => {
                cleanup();
                if (isFallback) {
                    reject(event?.error || new Error('媒体加载失败'));
                } else {
                    resolve('fallback');
                }
            };
            element.src = src;
            element.load();
        });

        const streamSrc = this.resolveStreamSrc(filePath);
        if (!streamSrc) {
            this.showError('无法生成媒体地址');
            return;
        }

        await tryLoad(streamSrc).catch((error) => {
            console.error('加载媒体失败:', error);
            this.showError('媒体加载失败，请检查文件是否受支持');
        });
    }

    clear() {
        this.currentFile = null;
        this.filenameElement.textContent = '';
        this.hideError();
        if (this.mediaElement) {
            this.mediaElement.pause?.();
            this.mediaElement.src = '';
            this.mediaElement.load?.();
            this.mediaElement.remove();
            this.mediaElement = null;
        }
    }

    hide() {
        this.container.style.display = 'none';
    }

    show() {
        this.container.style.display = 'flex';
    }

    setZoomScale() {
        // 媒体播放器不响应内容缩放，预留接口便于保持 API 一致性
    }

    dispose() {
        this.clear();
    }
}
