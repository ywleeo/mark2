import { addClickHandler } from '../utils/PointerHelper.js';

/**
 * Polished image lightbox — dark glass UI, smooth animations,
 * cursor-centered zoom, drag-to-pan, auto-hiding controls.
 */
export class ImageModal {
    constructor() {
        this.modal = null;
        this.img = null;
        this.isVisible = false;

        // zoom / pan state
        this.scale = 1;
        this.fitScale = 1;      // scale at which image fits viewport
        this.minScale = 0.1;
        this.maxScale = 10;
        this.offsetX = 0;
        this.offsetY = 0;

        // drag state
        this.isDragging = false;
        this.dragStartX = 0;
        this.dragStartY = 0;
        this.dragOffsetX = 0;
        this.dragOffsetY = 0;

        // auto-hide
        this.idleTimer = null;
        this.hoveringControls = false;

        this.cleanupHandlers = [];
        this._init();
    }

    // ── Setup ──────────────────────────────────────────

    _init() {
        this.modal = document.createElement('div');
        this.modal.className = 'image-modal';
        this.modal.innerHTML = `
            <div class="image-modal-backdrop"></div>
            <button class="image-modal-close" aria-label="Close">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
                     stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
                    <path d="M3 3l8 8M11 3l-8 8"/>
                </svg>
            </button>
            <div class="image-modal-content">
                <img class="image-modal-img" alt="" />
            </div>
            <div class="image-modal-controls">
                <button class="image-modal-zoom-btn" data-action="zoom-out" aria-label="Zoom out">−</button>
                <span class="image-modal-zoom-value">100%</span>
                <button class="image-modal-zoom-btn" data-action="zoom-in" aria-label="Zoom in">+</button>
                <span class="image-modal-divider"></span>
                <button class="image-modal-zoom-btn" data-action="download" aria-label="Download">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
                         stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M7 2v7.5M3.5 7L7 10.5 10.5 7M2 12h10"/>
                    </svg>
                </button>
            </div>
        `;

        this.img = this.modal.querySelector('.image-modal-img');
        this.zoomValue = this.modal.querySelector('.image-modal-zoom-value');
        this.controls = this.modal.querySelector('.image-modal-controls');
        this.closeBtn = this.modal.querySelector('.image-modal-close');

        const backdrop = this.modal.querySelector('.image-modal-backdrop');

        // clicks
        this.cleanupHandlers.push(addClickHandler(backdrop, () => this.hide()));
        this.cleanupHandlers.push(addClickHandler(this.closeBtn, () => this.hide()));
        this.cleanupHandlers.push(addClickHandler(
            this.modal.querySelector('[data-action="zoom-out"]'),
            () => this._zoomBy(0.8, true),
        ));
        this.cleanupHandlers.push(addClickHandler(
            this.modal.querySelector('[data-action="zoom-in"]'),
            () => this._zoomBy(1.25, true),
        ));
        // download
        this.cleanupHandlers.push(addClickHandler(
            this.modal.querySelector('[data-action="download"]'),
            () => this._download(),
        ));
        // click zoom-value → reset to 100%
        this.cleanupHandlers.push(addClickHandler(this.zoomValue, () => {
            this._enableSmoothZoom();
            this.scale = 1;
            this.offsetX = 0;
            this.offsetY = 0;
            this._applyTransform();
            this._updateZoomDisplay();
            this._updateCursor();
            this._disableSmoothZoomDeferred();
        }));

        // block double-click zoom (zoom only via bar buttons)
        this.img.addEventListener('dblclick', (e) => e.preventDefault());

        // drag
        this.img.addEventListener('dragstart', (e) => e.preventDefault());
        this._onMouseDown = (e) => this._startDrag(e);
        this._onMouseMove = (e) => this._onDrag(e);
        this._onMouseUp = () => this._stopDrag();
        this.img.addEventListener('mousedown', this._onMouseDown);
        document.addEventListener('mousemove', this._onMouseMove);
        document.addEventListener('mouseup', this._onMouseUp);

        // block scroll/pinch inside modal to prevent background scrolling
        this._handleWheel = (e) => {
            if (!this.isVisible) return;
            e.preventDefault();
        };

        // keyboard
        this._handleKeydown = (e) => this._onKeydown(e);

        // auto-hide controls
        this._handleMouseMove = () => this._resetIdleTimer();
        this.controls.addEventListener('mouseenter', () => { this.hoveringControls = true; });
        this.controls.addEventListener('mouseleave', () => { this.hoveringControls = false; });

        document.body.appendChild(this.modal);
    }

    // ── Public API ─────────────────────────────────────

    /**
     * @param {string} imgSrc
     * @param {string} imgAlt
     * @param {{ width?: number, height?: number }} [hints] — fallback dimensions when naturalWidth is 0 (e.g. SVG data URLs)
     */
    show(imgSrc, imgAlt = '', hints = {}) {
        if (!imgSrc) return;

        this.offsetX = 0;
        this.offsetY = 0;
        this.scale = 1;
        this.fitScale = 1;
        // SVG data URL → parse exact size from content; otherwise use caller hints
        this._hints = this._parseSvgSize(imgSrc) || hints;
        this.isDragging = false;
        this._dragPending = false;
        this.img.classList.remove('smooth-zoom');
        this.img.style.willChange = '';

        const onLoad = () => {
            this.img.removeEventListener('load', onLoad);
            this._resolveSize();
            this._computeFitScale();
            this._applyTransform();
            this._updateZoomDisplay();
            this._updateCursor();
        };

        // SVG diagrams get dark mode filter via CSS class
        this.img.classList.toggle('is-svg', imgSrc.startsWith('data:image/svg+xml'));

        // force fresh render — clear src first so browser re-decodes the image
        this.img.removeAttribute('src');
        this.img.src = imgSrc;
        this.img.alt = imgAlt;

        // lock dimensions immediately if available, otherwise onLoad will lock
        this._resolveSize();

        if (this.img.complete && (this.img.naturalWidth > 0 || this._hints?.width)) {
            this._computeFitScale();
        } else {
            this.img.addEventListener('load', onLoad);
        }

        this._applyTransform();
        this._updateZoomDisplay();
        this._updateCursor();

        // trigger entrance animation
        this.modal.classList.remove('is-closing');
        this.modal.classList.add('is-visible');
        this.isVisible = true;

        // listeners
        document.addEventListener('keydown', this._handleKeydown);
        this.modal.addEventListener('wheel', this._handleWheel, { passive: false });
        this.modal.addEventListener('mousemove', this._handleMouseMove);
        document.body.style.overflow = 'hidden';

        this._resetIdleTimer();
    }

    hide() {
        if (!this.isVisible) return;
        this.isVisible = false;

        // exit animation
        this.modal.classList.add('is-closing');
        const onEnd = () => {
            this.modal.removeEventListener('transitionend', onEnd);
            if (!this.isVisible) {
                this.modal.classList.remove('is-visible', 'is-closing');
            }
        };
        this.modal.addEventListener('transitionend', onEnd);
        // safety fallback — skip if reopened in the meantime
        setTimeout(() => {
            if (!this.isVisible) {
                this.modal.classList.remove('is-visible', 'is-closing');
            }
        }, 250);

        // cleanup
        document.removeEventListener('keydown', this._handleKeydown);
        this.modal.removeEventListener('wheel', this._handleWheel);
        this.modal.removeEventListener('mousemove', this._handleMouseMove);
        clearTimeout(this.idleTimer);
        document.body.style.overflow = '';
    }

    destroy() {
        this.hide();
        document.removeEventListener('mousemove', this._onMouseMove);
        document.removeEventListener('mouseup', this._onMouseUp);
        this.cleanupHandlers.forEach(fn => fn?.());
        this.cleanupHandlers = [];
        this.modal?.remove();
    }

    // ── Zoom ───────────────────────────────────────────

    /** Extract stable width/height from SVG data URL content */
    _parseSvgSize(src) {
        if (!src || !src.startsWith('data:image/svg+xml')) return null;
        try {
            const payload = decodeURIComponent(src.substring(src.indexOf(',') + 1));
            const w = payload.match(/\bwidth="([\d.]+)"/);
            const h = payload.match(/\bheight="([\d.]+)"/);
            if (w && h) return { width: parseFloat(w[1]), height: parseFloat(h[1]) };
        } catch { /* ignore */ }
        return null;
    }

    /** Resolve and cache image dimensions — called once per show() */
    _resolveSize() {
        this._cachedW = this.img.naturalWidth || this._hints?.width || 1;
        this._cachedH = this.img.naturalHeight || this._hints?.height || 1;
    }

    _getNaturalSize() {
        return { nw: this._cachedW || 1, nh: this._cachedH || 1 };
    }

    _computeFitScale() {
        const vw = window.innerWidth * 0.92;
        const vh = window.innerHeight * 0.92;
        const { nw, nh } = this._getNaturalSize();
        this.fitScale = Math.min(vw / nw, vh / nh, 1);
    }

    /** Multiply current scale by `factor`, optionally animate */
    _zoomBy(factor, smooth = false) {
        if (smooth) this._enableSmoothZoom();
        this._zoomTo(this.scale * factor);
        if (smooth) this._disableSmoothZoomDeferred();
    }

    /** Zoom to `newScale` — image stays centered (flexbox handles centering, offset unchanged) */
    _zoomTo(newScale) {
        newScale = Math.max(this.minScale, Math.min(this.maxScale, newScale));
        if (newScale === this.scale) return;
        this.scale = newScale;
        this._applyTransform();
        this._updateZoomDisplay();
        this._updateCursor();
    }

    _enableSmoothZoom() {
        this.img.classList.add('smooth-zoom');
    }

    _disableSmoothZoomDeferred() {
        setTimeout(() => this.img.classList.remove('smooth-zoom'), 220);
    }

    // ── Transform ──────────────────────────────────────

    _applyTransform() {
        const { nw, nh } = this._getNaturalSize();
        const w = nw * this.scale;
        const h = nh * this.scale;
        this.img.style.maxWidth = 'none';
        this.img.style.maxHeight = 'none';
        this.img.style.width = `${w}px`;
        this.img.style.height = `${h}px`;
        this.img.style.transform = `translate(${this.offsetX}px, ${this.offsetY}px)`;
    }

    _updateZoomDisplay() {
        const pct = Math.round(this.scale * 100);
        this.zoomValue.textContent = `${pct}%`;
    }

    _updateCursor() {
        const isDefault = Math.abs(this.scale - 1) < 0.01;
        this.img.style.cursor = isDefault ? 'zoom-in' : 'grab';
    }

    // ── Drag / Pan ─────────────────────────────────────

    _startDrag(e) {
        // 100% 默认尺寸下不允许拖拽
        const isDefault = Math.abs(this.scale - 1) < 0.01 &&
                          Math.abs(this.offsetX) < 2 && Math.abs(this.offsetY) < 2;
        if (isDefault) return;

        this._dragPending = true;
        this.isDragging = false;
        this.dragStartX = e.clientX;
        this.dragStartY = e.clientY;
        this.dragOffsetX = this.offsetX;
        this.dragOffsetY = this.offsetY;
    }

    _onDrag(e) {
        if (!this._dragPending && !this.isDragging) return;
        e.preventDefault();

        // 5px 阈值防止误触
        if (this._dragPending && !this.isDragging) {
            const dx = Math.abs(e.clientX - this.dragStartX);
            const dy = Math.abs(e.clientY - this.dragStartY);
            if (dx < 5 && dy < 5) return;
            this.isDragging = true;
            this._dragPending = false;
            this.img.style.cursor = 'grabbing';
            this.img.style.willChange = 'transform';
            this.img.classList.remove('smooth-zoom');
        }

        this.offsetX = this.dragOffsetX + (e.clientX - this.dragStartX);
        this.offsetY = this.dragOffsetY + (e.clientY - this.dragStartY);
        this._applyTransform();
    }

    _stopDrag() {
        this._dragPending = false;
        if (!this.isDragging) return;
        this.isDragging = false;
        this.img.style.willChange = '';
        this._updateCursor();
    }

    // ── Keyboard ───────────────────────────────────────

    _onKeydown(e) {
        if (!this.isVisible) return;
        if (e.key === 'Escape') this.hide();
    }

    // ── Download ───────────────────────────────────────

    async _download() {
        try {
            const src = this.img.src;
            if (!src) return;

            const { save } = await import('@tauri-apps/plugin-dialog');
            const isSvgSrc = src.startsWith('data:image/svg+xml');

            // SVG 源默认导 PNG（更通用），同时允许保存为 SVG 原文件
            const filters = isSvgSrc
                ? [
                    { name: 'PNG Image', extensions: ['png'] },
                    { name: 'SVG Image', extensions: ['svg'] },
                ]
                : [{ name: 'PNG Image', extensions: ['png'] }];

            const targetPath = await save({
                title: 'Save Image',
                filters,
                defaultPath: 'image.png',
            });
            if (!targetPath) return;

            const wantSvg = targetPath.toLowerCase().endsWith('.svg');

            if (wantSvg && isSvgSrc) {
                // 保存 SVG 原文件
                let payload = decodeURIComponent(src.substring(src.indexOf(',') + 1));
                if (!payload.startsWith('<?xml')) {
                    payload = `<?xml version="1.0" encoding="UTF-8"?>\n${payload}`;
                }
                const { writeTextFile } = await import('@tauri-apps/plugin-fs');
                await writeTextFile(targetPath, payload);
                return;
            }

            // 走 PNG：把当前显示的图（SVG 或位图）画到 canvas 再导出
            const baseW = this._cachedW || this.img.naturalWidth || 800;
            const baseH = this._cachedH || this.img.naturalHeight || 600;
            const scale = 2; // 高分屏 2x 输出，避免糊
            const canvas = document.createElement('canvas');
            canvas.width = baseW * scale;
            canvas.height = baseH * scale;
            const ctx = canvas.getContext('2d');
            ctx.scale(scale, scale);
            ctx.drawImage(this.img, 0, 0, baseW, baseH);
            const dataUrl = canvas.toDataURL('image/png');

            const { invoke } = await import('@tauri-apps/api/core');
            await invoke('capture_screenshot', { destination: targetPath, imageData: dataUrl });
        } catch (err) {
            console.error('[ImageModal] download failed:', err);
        }
    }

    // ── Auto-hide controls ─────────────────────────────

    _resetIdleTimer() {
        this.controls.classList.remove('controls-hidden');
        this.closeBtn.style.opacity = '';
        clearTimeout(this.idleTimer);
        this.idleTimer = setTimeout(() => {
            if (this.hoveringControls) return;
            this.controls.classList.add('controls-hidden');
            this.closeBtn.style.opacity = '0';
        }, 2500);
    }
}
