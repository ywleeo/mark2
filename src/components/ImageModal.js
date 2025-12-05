import { addClickHandler } from '../utils/PointerHelper.js';

/**
 * 图片弹窗查看器 - 点击 Markdown 中的图片时弹出放大查看
 */
export class ImageModal {
    constructor() {
        this.modal = null;
        this.img = null;
        this.isVisible = false;
        this.scale = 1;
        this.minScale = 0.5;
        this.maxScale = 5;
        this.isDragging = false;
        this.dragStart = { x: 0, y: 0 };
        this.imgOffset = { x: 0, y: 0 };
        this.cleanupHandlers = [];
        this.init();
    }

    init() {
        // 创建 modal 结构
        this.modal = document.createElement('div');
        this.modal.className = 'image-modal';
        this.modal.innerHTML = `
            <div class="image-modal-backdrop"></div>
            <button class="image-modal-close" aria-label="关闭">&times;</button>
            <div class="image-modal-content">
                <img class="image-modal-img" alt="" />
            </div>
            <div class="image-modal-controls">
                <button class="image-modal-zoom-btn" data-action="zoom-out" aria-label="缩小">−</button>
                <span class="image-modal-zoom-value">100%</span>
                <button class="image-modal-zoom-btn" data-action="zoom-in" aria-label="放大">+</button>
                <button class="image-modal-zoom-btn" data-action="reset" aria-label="重置">1:1</button>
            </div>
        `;

        this.img = this.modal.querySelector('.image-modal-img');
        this.zoomValue = this.modal.querySelector('.image-modal-zoom-value');
        const backdrop = this.modal.querySelector('.image-modal-backdrop');
        const closeBtn = this.modal.querySelector('.image-modal-close');
        const zoomOutBtn = this.modal.querySelector('[data-action="zoom-out"]');
        const zoomInBtn = this.modal.querySelector('[data-action="zoom-in"]');
        const resetBtn = this.modal.querySelector('[data-action="reset"]');

        // 点击背景或关闭按钮关闭 - 使用 PointerHelper 防止重复触发
        this.cleanupHandlers.push(addClickHandler(backdrop, () => this.hide()));
        this.cleanupHandlers.push(addClickHandler(closeBtn, () => this.hide()));

        // 缩放按钮 - 使用 PointerHelper 防止重复触发
        this.cleanupHandlers.push(addClickHandler(zoomOutBtn, () => this.zoom(-0.25)));
        this.cleanupHandlers.push(addClickHandler(zoomInBtn, () => this.zoom(0.25)));
        this.cleanupHandlers.push(addClickHandler(resetBtn, () => this.resetZoom()));

        // 双击图片重置缩放
        this.img.addEventListener('dblclick', () => this.resetZoom());

        // 禁止图片默认拖动
        this.img.addEventListener('dragstart', (e) => e.preventDefault());

        // 鼠标拖动
        this.img.addEventListener('mousedown', (e) => this.startDrag(e));
        document.addEventListener('mousemove', (e) => this.onDrag(e));
        document.addEventListener('mouseup', () => this.stopDrag());

        // 鼠标滚轮缩放
        this.handleWheel = (e) => {
            if (!this.isVisible) return;
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.1 : 0.1;
            this.zoom(delta);
        };

        // ESC 键关闭
        this.handleKeydown = (e) => {
            if (e.key === 'Escape' && this.isVisible) {
                this.hide();
            }
        };

        document.body.appendChild(this.modal);
    }

    show(imgSrc, imgAlt = '') {
        if (!imgSrc) return;

        this.img.src = imgSrc;
        this.img.alt = imgAlt;
        this.scale = 1;
        this.imgOffset = { x: 0, y: 0 };
        this.updateZoom();
        this.modal.classList.add('is-visible');
        this.isVisible = true;

        // 添加事件监听
        document.addEventListener('keydown', this.handleKeydown);
        this.modal.addEventListener('wheel', this.handleWheel, { passive: false });

        // 防止背景滚动
        document.body.style.overflow = 'hidden';
    }

    startDrag(e) {
        if (this.scale <= 1) return;
        this.isDragging = true;
        this.dragStart = { x: e.clientX - this.imgOffset.x, y: e.clientY - this.imgOffset.y };
        this.img.style.cursor = 'grabbing';
        this.img.style.willChange = 'transform';
    }

    onDrag(e) {
        if (!this.isDragging) return;
        e.preventDefault();
        this.imgOffset.x = e.clientX - this.dragStart.x;
        this.imgOffset.y = e.clientY - this.dragStart.y;
        this.updateTransform();
    }

    stopDrag() {
        this.isDragging = false;
        if (this.img) {
            this.img.style.willChange = '';
            if (this.scale > 1) {
                this.img.style.cursor = 'grab';
            } else {
                this.img.style.cursor = 'zoom-in';
            }
        }
    }

    zoom(delta) {
        const newScale = Math.max(this.minScale, Math.min(this.maxScale, this.scale + delta));
        if (newScale !== this.scale) {
            this.scale = newScale;
            this.updateZoom();
        }
    }

    resetZoom() {
        this.scale = 1;
        this.imgOffset = { x: 0, y: 0 };
        this.updateZoom();
    }

    updateTransform() {
        const transform = this.scale > 1
            ? `translate(${this.imgOffset.x}px, ${this.imgOffset.y}px) scale(${this.scale})`
            : `scale(${this.scale})`;
        this.img.style.transform = transform;
    }

    updateZoom() {
        this.updateTransform();
        this.img.style.cursor = this.scale > 1 ? 'grab' : 'zoom-in';
        this.zoomValue.textContent = `${Math.round(this.scale * 100)}%`;
    }

    hide() {
        this.modal.classList.remove('is-visible');
        this.isVisible = false;

        // 移除事件监听
        document.removeEventListener('keydown', this.handleKeydown);
        this.modal.removeEventListener('wheel', this.handleWheel);

        // 恢复背景滚动
        document.body.style.overflow = '';
    }

    destroy() {
        this.hide();
        document.removeEventListener('keydown', this.handleKeydown);
        this.modal?.removeEventListener('wheel', this.handleWheel);

        // 清理 PointerHelper 事件处理器
        this.cleanupHandlers.forEach(cleanup => cleanup?.());
        this.cleanupHandlers = [];

        if (this.modal && this.modal.parentNode) {
            this.modal.parentNode.removeChild(this.modal);
        }
    }
}
