import { basename } from '../utils/pathUtils.js';
import { getFileReadFailureKind } from '../utils/fileAccessErrors.js';
import { t } from '../i18n/index.js';

export class UnsupportedViewer {
    constructor(containerElement) {
        this.container = containerElement;
        this.currentFile = null;
        this.filenameElement = null;
        this.init();
    }

    init() {
        this.container.classList.add('unsupported-viewer');
        this.container.innerHTML = `
            <div class="unsupported-viewer-content">
                <div class="unsupported-viewer-title"></div>
                <div class="unsupported-viewer-filename"></div>
                <div class="unsupported-viewer-description"></div>
            </div>
        `;

        this.titleElement = this.container.querySelector('.unsupported-viewer-title');
        this.descriptionElement = this.container.querySelector('.unsupported-viewer-description');
        this.filenameElement = this.container.querySelector('.unsupported-viewer-filename');
    }

    /** 显示可处理的文件提示，避免把编码和系统错误原文放入预览。 */
    show(filePath, error = null) {
        this.currentFile = filePath;
        this.titleElement.textContent = t('unsupportedViewer.title');
        this.descriptionElement.textContent = t('unsupportedViewer.' + (error ? getFileReadFailureKind(error) : 'format'));
        const fileName = basename(filePath) || filePath || '';
        if (this.filenameElement) {
            this.filenameElement.textContent = fileName;
        }

        this.container.style.display = 'flex';
    }

    clear() {
        this.currentFile = null;
        if (this.filenameElement) {
            this.filenameElement.textContent = '';
        }
        this.container.style.display = 'none';
    }

    hide() {
        this.container.style.display = 'none';
    }

    dispose() {
        this.clear();
    }
}
