import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import pdfWorkerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

const DEFAULT_SCALE = 1;
const MIN_SCALE = 0.5;
const MAX_SCALE = 2.5;
const SCALE_EPSILON = 0.01;

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
        this.fitScale = DEFAULT_SCALE;
        this.manualScale = DEFAULT_SCALE;
        this.scale = DEFAULT_SCALE;
        this.pagesContainer = null;
        this.emptyStateElement = null;
        this.resizeTimer = null;
        this.resizeObserver = null;
        this.pageElements = new Map();
        this.pageInfoText = '';
        this.loadingElement = null;
        this.handleWindowResize = this.handleWindowResize.bind(this);
        this.handlePagesScroll = this.handlePagesScroll.bind(this);
        this.isPagesScrollListenerAttached = false;
        this.renderVisibleRaf = null;
        window.addEventListener('resize', this.handleWindowResize);
        if (typeof window !== 'undefined' && 'ResizeObserver' in window) {
            this.resizeObserver = new window.ResizeObserver(() => {
                this.scheduleFitUpdate();
            });
            this.resizeObserver.observe(this.container);
        }
        this.init();
    }

    init() {
        this.container.classList.add('pdf-viewer');
        this.container.innerHTML = `
            <div class="pdf-viewer__body">
                <div class="pdf-viewer__pages" aria-live="polite"></div>
                <div class="pdf-viewer__loading" aria-live="polite">
                    <span class="pdf-viewer__spinner" aria-hidden="true"></span>
                    <span class="pdf-viewer__loading-text">正在渲染 PDF…</span>
                </div>
                <div class="pdf-viewer__empty" aria-hidden="true">无法显示 PDF 内容</div>
            </div>
        `;

        this.pagesContainer = this.container.querySelector('.pdf-viewer__pages');
        this.emptyStateElement = this.container.querySelector('.pdf-viewer__empty');
        this.loadingElement = this.container.querySelector('.pdf-viewer__loading');
        this.attachPagesScrollListener();
    }

    hide() {
        if (!this.container) {
            return;
        }
        this.container.setAttribute('aria-hidden', 'true');
        this.container.style.display = 'none';
        this.container.style.pointerEvents = 'none';
    }

    show() {
        if (!this.container) {
            return;
        }
        this.container.removeAttribute('aria-hidden');
        this.container.style.removeProperty('display');
        this.container.style.removeProperty('pointer-events');
    }

    clear() {
        this.currentFile = null;
        this.setEmptyState(true);
        this.callbacks.onPageInfoChange?.('');
        this.pageInfoText = '';
        void this.destroyPdfDocument();
        this.clearPages();
        this.setLoadingState(false);
        window.clearTimeout(this.resizeTimer);
        this.resizeTimer = null;
        this.fitScale = DEFAULT_SCALE;
        this.manualScale = DEFAULT_SCALE;
        this.scale = DEFAULT_SCALE;
        this.emitZoomChange();
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

    async loadDocument(filePath, base64Data, options = {}) {
        const { forceReload = false } = options;
        if (!forceReload && this.pdfDocument && this.currentFile === filePath) {
            this.setEmptyState(false);
            this.setLoadingState(false);
            if (this.pageInfoText) {
                this.callbacks.onPageInfoChange?.(this.pageInfoText);
            }
            this.show();
            this.emitZoomChange();
            return;
        }

        await this.destroyPdfDocument();
        this.clearPages();
        this.currentFile = filePath;
        this.setEmptyState(false);
        this.setLoadingState(true, '正在渲染 PDF…');

        const fileBytes = base64ToUint8Array(base64Data);
        if (!fileBytes.length) {
            this.callbacks.onPageInfoChange?.('');
            this.setEmptyState(true, '无法解码 PDF');
            return;
        }

        try {
            this.loadingTask = getDocument({ data: fileBytes });
            this.pdfDocument = await this.loadingTask.promise;
            this.manualScale = DEFAULT_SCALE;
            await this.updateFitScale({ rerender: false });
            this.pageInfoText = `共 ${this.pdfDocument.numPages} 页`;
            this.callbacks.onPageInfoChange?.(this.pageInfoText);
            await this.preparePagePlaceholders();
            await this.renderVisiblePagesImmediately();
            this.setEmptyState(false);
            this.setLoadingState(false);
            this.show();
            this.emitZoomChange();
        } catch (error) {
            console.error('加载 PDF 失败:', error);
            this.callbacks.onPageInfoChange?.('');
            this.pageInfoText = '';
            this.setEmptyState(true, 'PDF 加载失败');
            this.setLoadingState(false);
        }
    }

    clampScale(value) {
        if (!Number.isFinite(value)) {
            return DEFAULT_SCALE;
        }
        return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
    }

    async setZoomScale(scale) {
        const clampedScale = this.clampScale(scale);
        if (!this.pdfDocument) {
            this.scale = clampedScale;
            this.emitZoomChange();
            return;
        }
        const baseScale = this.fitScale > 0 ? this.fitScale : DEFAULT_SCALE;
        this.manualScale = this.clampManualScale(clampedScale / baseScale);
        if (Math.abs(clampedScale - this.scale) < SCALE_EPSILON) {
            this.scale = clampedScale;
            this.emitZoomChange();
            return;
        }
        this.scale = clampedScale;
        this.markPagesForRerender();
        await this.renderVisiblePagesImmediately();
        this.emitZoomChange();
    }

    async adjustZoomScale(delta) {
        const nextScale = this.clampScale(this.scale + delta);
        await this.setZoomScale(nextScale);
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

    setLoadingState(isLoading, message) {
        if (!this.loadingElement) {
            return;
        }
        const textElement = this.loadingElement.querySelector('.pdf-viewer__loading-text');
        if (textElement && message) {
            textElement.textContent = message;
        }
        if (isLoading) {
            this.loadingElement.classList.add('is-visible');
            this.loadingElement.removeAttribute('aria-hidden');
        } else {
            this.loadingElement.classList.remove('is-visible');
            this.loadingElement.setAttribute('aria-hidden', 'true');
        }
    }

    async renderSinglePage(pageNumber) {
        if (!this.pdfDocument) {
            return;
        }
        const entry = this.pageElements.get(pageNumber);
        if (!entry?.canvas) {
            return;
        }
        if (entry.activeRenderTask) {
            try {
                await entry.activeRenderTask.promise;
            } catch {
                // ignore
            }
            return;
        }
        if (entry.renderedScale && Math.abs(entry.renderedScale - this.scale) < SCALE_EPSILON) {
            return;
        }
        const currentDocument = this.pdfDocument;
        try {
            const page = await currentDocument.getPage(pageNumber);
            if (this.pdfDocument !== currentDocument) {
                return;
            }
            const viewport = page.getViewport({ scale: this.scale });
            const pixelRatio = window.devicePixelRatio || 1;
            const outputScale = Math.max(1, pixelRatio);
            const canvas = entry.canvas;
            const context = canvas.getContext('2d', { alpha: false });
            if (!context) {
                console.warn('无法获取 PDF canvas 上下文');
                return;
            }

            canvas.width = Math.floor(viewport.width * outputScale);
            canvas.height = Math.floor(viewport.height * outputScale);
            canvas.style.width = `${viewport.width}px`;
            canvas.style.height = `${viewport.height}px`;
            entry.wrapper.style.minHeight = `${viewport.height}px`;
            context.setTransform(outputScale, 0, 0, outputScale, 0, 0);

            const renderTask = page.render({
                canvasContext: context,
                viewport,
            });
            entry.activeRenderTask = renderTask;
            await renderTask.promise;
            if (this.pdfDocument === currentDocument) {
                entry.renderedScale = this.scale;
            }
        } catch (error) {
            if (error?.name !== 'RenderingCancelledException') {
                console.error(`渲染第 ${pageNumber} 页失败:`, error);
            }
        } finally {
            if (entry) {
                entry.activeRenderTask = null;
            }
        }
    }

    clearPages() {
        this.pageElements.forEach((entry) => {
            if (entry?.activeRenderTask?.cancel) {
                try {
                    entry.activeRenderTask.cancel();
                } catch {
                    // ignore
                }
            }
        });
        if (this.renderVisibleRaf) {
            window.cancelAnimationFrame(this.renderVisibleRaf);
            this.renderVisibleRaf = null;
        }
        if (this.pagesContainer) {
            this.pagesContainer.innerHTML = '';
            this.pagesContainer.scrollTop = 0;
        }
        this.pageElements.clear();
    }

    clampManualScale(value) {
        if (!Number.isFinite(value) || value <= 0) {
            return 1;
        }
        if (this.fitScale <= 0) {
            return value;
        }
        const minManual = MIN_SCALE / this.fitScale;
        const maxManual = MAX_SCALE / this.fitScale;
        return Math.min(maxManual, Math.max(minManual, value));
    }

    async calculateFitScale() {
        if (!this.pdfDocument) {
            return null;
        }
        const availableWidth = this.getAvailableWidth();
        if (!availableWidth || availableWidth <= 0) {
            return null;
        }
        try {
            const page = await this.pdfDocument.getPage(1);
            const viewport = page.getViewport({ scale: 1 });
            if (!viewport?.width) {
                return null;
            }
            return this.clampScale(availableWidth / viewport.width);
        } catch (error) {
            console.warn('计算 PDF 自适应宽度失败:', error);
            return null;
        }
    }

    getAvailableWidth() {
        if (!this.pagesContainer) {
            return this.container?.clientWidth || window.innerWidth || 0;
        }
        const containerWidth = this.pagesContainer.clientWidth || 0;
        if (!containerWidth) {
            return this.container?.clientWidth || window.innerWidth || 0;
        }
        const styles = window.getComputedStyle(this.pagesContainer);
        const paddingLeft = parseFloat(styles?.paddingLeft) || 0;
        const paddingRight = parseFloat(styles?.paddingRight) || 0;
        return Math.max(0, containerWidth - paddingLeft - paddingRight);
    }

    async updateFitScale({ rerender = true } = {}) {
        const nextFitScale = await this.calculateFitScale();
        if (!nextFitScale) {
            return;
        }
        this.fitScale = nextFitScale;
        const nextScale = this.clampScale(this.fitScale * this.clampManualScale(this.manualScale));
        const shouldRender = rerender && Math.abs(nextScale - this.scale) > SCALE_EPSILON;
        this.scale = nextScale;
        this.manualScale = this.fitScale > 0 ? this.scale / this.fitScale : 1;
        if (shouldRender) {
            this.markPagesForRerender();
            await this.renderVisiblePagesImmediately();
        }
        this.emitZoomChange();
    }

    handleWindowResize() {
        this.scheduleFitUpdate();
    }

    scheduleFitUpdate() {
        if (!this.pdfDocument) {
            return;
        }
        window.clearTimeout(this.resizeTimer);
        this.resizeTimer = window.setTimeout(() => {
            this.resizeTimer = null;
            if (!this.pdfDocument) {
                return;
            }
            void this.updateFitScale();
        }, 150);
    }

    getZoomState() {
        return {
            zoomValue: this.scale,
            canZoomIn: this.scale < MAX_SCALE - SCALE_EPSILON,
            canZoomOut: this.scale > MIN_SCALE + SCALE_EPSILON,
        };
    }

    emitZoomChange() {
        this.callbacks.onZoomChange?.(this.getZoomState());
    }

    attachPagesScrollListener() {
        if (!this.pagesContainer || this.isPagesScrollListenerAttached) {
            return;
        }
        this.pagesContainer.addEventListener('scroll', this.handlePagesScroll, { passive: true });
        this.isPagesScrollListenerAttached = true;
    }

    handlePagesScroll() {
        this.requestRenderForVisiblePages();
    }

    async preparePagePlaceholders() {
        if (!this.pdfDocument || !this.pagesContainer) {
            return;
        }
        this.clearPages();
        const fragment = document.createDocumentFragment();
        const totalPages = this.pdfDocument.numPages;
        for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
            const wrapper = document.createElement('div');
            wrapper.className = 'pdf-viewer__page';
            wrapper.dataset.pageNumber = `${pageNumber}`;
            const canvasElement = document.createElement('canvas');
            canvasElement.classList.add('pdf-viewer__canvas');
            wrapper.appendChild(canvasElement);
            fragment.appendChild(wrapper);
            this.pageElements.set(pageNumber, {
                wrapper,
                canvas: canvasElement,
                renderedScale: 0,
                activeRenderTask: null,
            });
        }
        this.pagesContainer.appendChild(fragment);
        this.requestRenderForVisiblePages();
    }

    markPagesForRerender() {
        this.pageElements.forEach((entry) => {
            if (!entry) {
                return;
            }
            entry.renderedScale = 0;
            if (entry.activeRenderTask?.cancel) {
                try {
                    entry.activeRenderTask.cancel();
                } catch {
                    // ignore
                }
                entry.activeRenderTask = null;
            }
        });
        this.requestRenderForVisiblePages();
    }

    requestRenderForVisiblePages() {
        if (this.renderVisibleRaf) {
            return;
        }
        if (typeof window === 'undefined') {
            return;
        }
        this.renderVisibleRaf = window.requestAnimationFrame(() => {
            this.renderVisibleRaf = null;
            void this.renderVisiblePagesImmediately();
        });
    }

    async renderVisiblePagesImmediately() {
        if (!this.pagesContainer) {
            return;
        }
        const containerRect = this.pagesContainer.getBoundingClientRect();
        const buffer = 400;
        const tasks = [];
        this.pageElements.forEach((entry, pageNumber) => {
            if (!entry?.wrapper) {
                return;
            }
            const rect = entry.wrapper.getBoundingClientRect();
            if (rect.bottom >= containerRect.top - buffer && rect.top <= containerRect.bottom + buffer) {
                tasks.push(this.renderSinglePage(pageNumber));
            }
        });
        await Promise.all(tasks);
    }
}
