/** 本地音视频播放器，按需加载原生媒体流并反馈访问与解码错误。 */
import { convertFileSrc } from '@tauri-apps/api/core';
import { createLogger } from '../core/diagnostics/Logger.js';
import { getFileReadFailureKind } from '../utils/fileAccessErrors.js';
import { isAudioFilePath, isVideoFilePath } from '../utils/fileTypeUtils.js';
import { basename } from '../utils/pathUtils.js';

const logger = createLogger('media');

/** 承载主栏或副栏的单个媒体播放器。 */
export class MediaViewer {
    /** 初始化播放器容器。 */
    constructor(containerElement) {
        this.container = containerElement;
        this.mediaElement = null;
        this.loadId = 0;
        this.defaultHintText = '本地文件按需加载，使用系统解码能力播放';
        this.init();
    }

    /** 构建播放器、文件名和反馈区域。 */
    init() {
        this.container.classList.add('media-viewer');
        this.container.innerHTML = `
            <div class="media-viewer__content">
                <div class="media-viewer__player" data-role="player"></div>
                <div class="media-viewer__info">
                    <div class="media-viewer__filename"></div>
                    <div class="media-viewer__hint">${this.defaultHintText}</div>
                    <div class="media-viewer__error" hidden></div>
                </div>
            </div>
        `;

        this.playerSlot = this.container.querySelector('[data-role="player"]');
        this.filenameElement = this.container.querySelector('.media-viewer__filename');
        this.hintElement = this.container.querySelector('.media-viewer__hint');
        this.errorElement = this.container.querySelector('.media-viewer__error');
    }

    /** 创建使用系统解码能力的媒体元素。 */
    createMediaElement(tagName) {
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

    /** 将本地路径转换为支持按字节读取的 Tauri 地址。 */
    resolveStreamSrc(filePath) {
        /** 兼容不同运行环境暴露的地址转换接口。 */
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

    /** 清空旧错误，恢复默认提示。 */
    hideError() {
        if (this.errorElement) {
            this.errorElement.textContent = '';
            this.errorElement.hidden = true;
        }
        this.resetHint();
    }

    /** 展示当前媒体的错误。 */
    showError(message) {
        if (this.errorElement) {
            this.errorElement.textContent = message || '无法加载媒体文件';
            this.errorElement.hidden = false;
        }
    }

    /** 恢复默认播放提示。 */
    resetHint() {
        if (this.hintElement) {
            this.hintElement.textContent = this.defaultHintText;
            this.hintElement.classList.remove('media-viewer__hint--warning');
        }
    }

    /** 对时长元数据损坏的 MP3 提供提示。 */
    showDurationWarning() {
        if (this.hintElement) {
            this.hintElement.textContent = '无法读取时长，可能是 ID3 标签损坏。但不影响播放。可以自行手动修复。';
            this.hintElement.classList.add('media-viewer__hint--warning');
        }
    }

    /** 授权完成后交给原生播放器异步取流，忽略过期的授权和媒体事件。 */
    async loadMedia(filePath, { ensureReadable } = {}) {
        this.clear();
        if (!filePath) return;
        const loadId = this.loadId;

        const isVideo = isVideoFilePath(filePath);
        const isAudio = isAudioFilePath(filePath);
        if (!isVideo && !isAudio) {
            this.showError('不支持的媒体类型');
            return;
        }

        this.filenameElement.textContent = basename(filePath) || filePath;

        try {
            await ensureReadable?.(filePath);
        } catch (error) {
            if (this.loadId !== loadId) return;
            const kind = getFileReadFailureKind(error);
            logger.warn('无法读取媒体文件', { path: filePath, kind, error: String(error) });
            const messages = {
                permission: '无法读取媒体文件，请授权访问该文件或所在文件夹',
                missing: '找不到媒体文件，请检查链接路径',
            };
            this.showError(messages[kind] ?? '无法读取媒体文件');
            return;
        }
        if (this.loadId !== loadId) return;

        const streamSrc = this.resolveStreamSrc(filePath);
        if (!streamSrc) {
            this.showError('无法生成媒体地址');
            return;
        }

        const element = this.createMediaElement(isVideo ? 'video' : 'audio');
        if (isAudio && /\.mp3$/i.test(filePath)) {
            /** 只在当前 MP3 缺失时长时显示修复提示。 */
            element.onloadedmetadata = () => {
                if (this.mediaElement !== element) return;
                if (!Number.isFinite(element.duration) || element.duration <= 0) {
                    this.showDurationWarning();
                }
            };
        }
        /** 加载或播放中发生的错误都应反馈给用户。 */
        element.onerror = () => {
            if (this.mediaElement !== element) return;
            logger.warn('媒体流加载失败', {
                path: filePath,
                code: element.error?.code,
                message: element.error?.message,
            });
            this.showError('媒体加载失败，请检查文件是否受支持');
        };
        element.src = streamSrc;
    }

    /** 取消待处理的加载并释放正在播放的媒体资源。 */
    clear() {
        this.loadId += 1;
        this.filenameElement.textContent = '';
        this.hideError();
        if (this.mediaElement) {
            this.mediaElement.onerror = null;
            this.mediaElement.onloadedmetadata = null;
            this.mediaElement.pause?.();
            this.mediaElement.removeAttribute('src');
            this.mediaElement.load?.();
            this.mediaElement.remove();
            this.mediaElement = null;
        }
    }

    /** 离开预览时停止播放并清理媒体流。 */
    hide() {
        this.clear();
        this.container.style.display = 'none';
    }

    /** 显示媒体预览。 */
    show() {
        this.container.style.display = 'flex';
    }

    /** 与其他查看器保持接口一致，由原生控件处理播放尺寸。 */
    setZoomScale() {
        // 媒体播放器不响应内容缩放，预留接口便于保持 API 一致性
    }

    /** 销毁播放器时释放媒体资源。 */
    dispose() {
        this.clear();
    }
}
