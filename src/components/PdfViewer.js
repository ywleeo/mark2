import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import pdfWorkerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

const DEFAULT_SCALE = 1;
const MIN_SCALE = 0.5;
const MAX_SCALE = 2.5;

if (pdfWorkerSrc && GlobalWorkerOptions.workerSrc !== pdfWorkerSrc) {
    GlobalWorkerOptions.workerSrc = pdfWorkerSrc;
}

function base64ToUint8Array(base64) {
    if (!base64 || typeof base64 !== 'string') {
        return new Uint8Array();
    }
    try {
        const binaryString = atob(base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i += 1) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes;
    } catch (error) {
        console.error('[PdfViewer] base64 decode failed', error);
        return new Uint8Array();
    }
}

export class PdfViewer {
    constructor(containerElement, callbacks = {}) {
        this.container = containerElement;
        this.currentFile = null;
        this.pdfDocument = null;
        this.loadingTask = null;
        this.callbacks = typeof callbacks === 'object' ? callbacks : {};
        this.externalScale = DEFAULT_SCALE;
        this.scale = DEFAULT_SCALE;
        this.pagesContainer = null;
        this.emptyStateElement = null;
        this.init();
    }

    init() {
        this.container.classList.add('pdf-viewer');
        this.container.innerHTML = `
            <div class="pdf-viewer__body">
                <div class="pdf-viewer__pages" aria-live="polite"></div>
                <div class="pdf-viewer__empty" aria-hidden="true">无法显示 PDF 内容</div>
            </div>
        `;

        this.pagesContainer = this.container.querySelector('.pdf-viewer__pages');
        this.emptyStateElement = this.container.querySelector('.pdf-viewer__empty');
    }

    hide() {
        this.container.style.display = 'none';
    }

    show() {
        this.container.style.display = 'flex';
    }

    clear() {
        this.currentFile = null;
        this.setEmptyState(true);
        this.callbacks.onPageInfoChange?.('');
        void this.destroyPdfDocument();
        this.hide();
    }

    async destroyPdfDocument() {
        if (this.loadingTask) {
            try {
                await this.loadingTask.destroy();
            } catch {
                // ignore
            }
            this.loadingTask = null;
        }
        if (this.pdfDocument) {
            try {
                await this.pdfDocument.destroy();
            } catch {
                // ignore
            }
            this.pdfDocument = null;
        }
    }

    async loadDocument(filePath, base64Data) {
        await this.destroyPdfDocument();
        this.currentFile = filePath;
        this.setEmptyState(true);

        const fileBytes = base64ToUint8Array(base64Data);
        if (!fileBytes.length) {
            this.callbacks.onPageInfoChange?.('');
            this.setEmptyState(true, '无法解码 PDF');
            return;
        }

        try {
            this.loadingTask = getDocument({ data: fileBytes });
            this.pdfDocument = await this.loadingTask.promise;
            this.scale = this.clampScale(this.externalScale);
            this.callbacks.onPageInfoChange?.(`共 ${this.pdfDocument.numPages} 页`);
            await this.renderAllPages();
            this.setEmptyState(false);
            this.show();
        } catch (error) {
            console.error('加载 PDF 失败:', error);
            this.callbacks.onPageInfoChange?.('');
            this.setEmptyState(true, 'PDF 加载失败');
        }
    }

    clampScale(value) {
        if (!Number.isFinite(value)) {
            return DEFAULT_SCALE;
        }
        return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
    }

    async setZoomScale(scale) {
        this.externalScale = this.clampScale(scale);
        if (!this.pdfDocument) {
            this.scale = this.externalScale;
            return;
        }
        if (Math.abs(this.externalScale - this.scale) < 0.01) {
            return;
        }
        this.scale = this.externalScale;
        await this.renderAllPages();
    }

    setEmptyState(isEmpty, message) {
        if (!this.emptyStateElement) {
            return;
        }
        if (isEmpty) {
            this.emptyStateElement.textContent = message || '无法显示 PDF 内容';
            this.emptyStateElement.classList.add('is-visible');
        } else {
            this.emptyStateElement.classList.remove('is-visible');
        }
    }

    async renderAllPages() {
        if (!this.pdfDocument || !this.pagesContainer) {
            return;
        }
        this.pagesContainer.innerHTML = '';
        const totalPages = this.pdfDocument.numPages;
        for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
            await this.renderSinglePage(pageNumber);
        }
    }

    async renderSinglePage(pageNumber) {
        try {
            const page = await this.pdfDocument.getPage(pageNumber);
            const viewport = page.getViewport({ scale: this.scale });
            const pixelRatio = window.devicePixelRatio || 1;
            const outputScale = Math.max(1, pixelRatio);

            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d', { alpha: false });
            if (!context) {
                console.warn('无法获取 PDF canvas 上下文');
                return;
            }

            canvas.width = Math.floor(viewport.width * outputScale);
            canvas.height = Math.floor(viewport.height * outputScale);
            canvas.style.width = `${viewport.width}px`;
            canvas.style.height = `${viewport.height}px`;
            canvas.classList.add('pdf-viewer__canvas');
            context.setTransform(outputScale, 0, 0, outputScale, 0, 0);

            const renderTask = page.render({
                canvasContext: context,
                viewport,
            });
            await renderTask.promise;

            const pageWrapper = document.createElement('div');
            pageWrapper.className = 'pdf-viewer__page';
            pageWrapper.appendChild(canvas);
            this.pagesContainer.appendChild(pageWrapper);
        } catch (error) {
            console.error(`渲染第 ${pageNumber} 页失败:`, error);
        }
    }
}
