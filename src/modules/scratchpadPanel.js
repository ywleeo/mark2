/**
 * Scratchpad 浮动便签面板
 * 右下角浮动，由 status bar 铅笔按钮触发
 * 全程使用 right/bottom 定位，自动跟随窗口移动和缩放
 */

import { addClickHandler } from '../utils/PointerHelper.js';

const STORAGE_KEYS = {
    content:  'mark2_scratchpad_content',
    position: 'mark2_scratchpad_position_v2',
    size:     'mark2_scratchpad_size_v2',
    visible:  'mark2_scratchpad_visible',
};

const DEFAULT_SIZE     = { width: 300, height: 240 };
const DEFAULT_POSITION = { right: 0, bottom: 28 };
const SAVE_DEBOUNCE_MS = 400;

function loadJson(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        if (raw) return JSON.parse(raw);
    } catch { /* ignore */ }
    return fallback;
}

function saveJson(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch { /* ignore */ }
}

export function createScratchpadPanel() {
    const panel        = document.getElementById('scratchpadPanel');
    const header       = panel?.querySelector('.scratchpad-header');
    const textarea     = panel?.querySelector('.scratchpad-textarea');
    const closeBtn     = panel?.querySelector('.scratchpad-close-btn');
    const resizeHandle = panel?.querySelector('.scratchpad-resize-handle');
    const statusBtn    = document.getElementById('statusBarScratchpad');

    if (!panel || !textarea) {
        console.warn('[Scratchpad] DOM 节点未找到');
        return null;
    }

    let isVisible  = false;
    let saveTimer  = null;

    // ── 定位和尺寸（始终用 right/bottom） ──

    function applyPosition(pos) {
        panel.style.left   = 'auto';
        panel.style.top    = 'auto';
        panel.style.right  = (pos.right  ?? DEFAULT_POSITION.right)  + 'px';
        panel.style.bottom = (pos.bottom ?? DEFAULT_POSITION.bottom) + 'px';
    }

    function applySize(size) {
        panel.style.width  = size.width  + 'px';
        panel.style.height = size.height + 'px';
    }

    // ── 内容自动保存 ──

    function scheduleContentSave() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            localStorage.setItem(STORAGE_KEYS.content, textarea.value);
        }, SAVE_DEBOUNCE_MS);
    }

    // ── 显示 / 隐藏 ──

    function _show(persist = true) {
        isVisible = true;
        panel.classList.add('is-visible');
        statusBtn?.classList.add('is-active');
        if (persist) saveJson(STORAGE_KEYS.visible, true);
        textarea.focus();
    }

    function _hide(persist = true) {
        isVisible = false;
        panel.classList.remove('is-visible');
        statusBtn?.classList.remove('is-active');
        if (persist) saveJson(STORAGE_KEYS.visible, false);
    }

    function show()   { _show(); }
    function hide()   { _hide(); }
    function toggle() { isVisible ? _hide() : _show(); }

    // ── 拖拽移动（计算新的 right/bottom，右下角锚点自然跟窗口走） ──

    function setupDrag() {
        let startX, startY, startRight, startBottom;

        header.addEventListener('pointerdown', (e) => {
            if (e.target.closest('button')) return;
            header.setPointerCapture(e.pointerId);

            const rect  = panel.getBoundingClientRect();
            startX      = e.clientX;
            startY      = e.clientY;
            startRight  = window.innerWidth  - rect.right;
            startBottom = window.innerHeight - rect.bottom;
        });

        header.addEventListener('pointermove', (e) => {
            if (!header.hasPointerCapture(e.pointerId)) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;

            // 向右拖 → right 减小；向下拖 → bottom 减小
            const newRight  = Math.max(0, Math.min(window.innerWidth - 220, startRight - dx));
            const newBottom = Math.max(0, startBottom - dy);

            panel.style.right  = newRight  + 'px';
            panel.style.bottom = newBottom + 'px';

            saveJson(STORAGE_KEYS.position, { right: newRight, bottom: newBottom });
        });
    }

    // ── Resize（左上角 handle，右下角锚点不动，只改宽高） ──

    function setupResize() {
        let startX, startY, startW, startH;

        resizeHandle.addEventListener('pointerdown', (e) => {
            resizeHandle.setPointerCapture(e.pointerId);
            startX = e.clientX;
            startY = e.clientY;
            startW = panel.offsetWidth;
            startH = panel.offsetHeight;
            e.preventDefault();
        });

        resizeHandle.addEventListener('pointermove', (e) => {
            if (!resizeHandle.hasPointerCapture(e.pointerId)) return;
            const newW = Math.max(220, startW - (e.clientX - startX));
            const newH = Math.max(120, startH - (e.clientY - startY));

            panel.style.width  = newW + 'px';
            panel.style.height = newH + 'px';

            saveJson(STORAGE_KEYS.size, { width: newW, height: newH });
        });
    }

    // ── 初始化 ──

    function initialize() {
        const content = localStorage.getItem(STORAGE_KEYS.content) ?? '';
        const pos     = loadJson(STORAGE_KEYS.position, DEFAULT_POSITION);
        const size    = loadJson(STORAGE_KEYS.size, DEFAULT_SIZE);
        const visible = loadJson(STORAGE_KEYS.visible, false);

        textarea.value = content;
        applyPosition(pos);
        applySize(size);
        if (visible) _show(false);

        textarea.addEventListener('input', scheduleContentSave);
        addClickHandler(closeBtn,  hide);
        addClickHandler(statusBtn, toggle);

        setupDrag();
        setupResize();
    }

    return { initialize, show, hide, toggle };
}
