/**
 * 翻译浮动面板
 * 右下角浮动，由 status bar 按钮 / ⌘⇧Space 触发。
 * 输入词或句子，调大模型做中英互译；句子会挑出生僻词重点解释。
 * 全程用 right/bottom 定位，自动跟随窗口移动和缩放。
 */

import { addClickHandler } from '../../utils/PointerHelper.js';
import { createStore } from '../../services/storage.js';
import { t } from '../../i18n/index.js';
import { translate } from './translator.js';

const store = createStore('translator');

const DEFAULT_SIZE     = { width: 360, height: 340 };
const DEFAULT_POSITION = { right: 0, bottom: 28 };
const SAVE_DEBOUNCE_MS = 400;

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

export function createTranslatorPanel() {
    const panel        = document.getElementById('translatorPanel');
    const header       = panel?.querySelector('.translator-header');
    const input        = panel?.querySelector('.translator-input');
    const submitBtn    = panel?.querySelector('.translator-submit');
    const resultEl     = panel?.querySelector('.translator-result');
    const closeBtn     = panel?.querySelector('.translator-close-btn');
    const resizeHandle = panel?.querySelector('.translator-resize-handle');
    const statusBtn    = document.getElementById('statusBarTranslator');

    if (!panel || !input || !resultEl) {
        console.warn('[Translator] DOM 节点未找到');
        return null;
    }

    let isVisible     = false;
    let isTranslating = false;
    let saveTimer     = null;

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

    // ── 输入自动保存（重开面板恢复上次输入） ──

    function scheduleInputSave() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            store.set('input', input.value);
        }, SAVE_DEBOUNCE_MS);
    }

    // ── 显示 / 隐藏 ──

    function _show(persist = true) {
        isVisible = true;
        panel.classList.add('is-visible');
        statusBtn?.classList.add('is-active');
        if (persist) store.set('visible', true);
        input.focus();
    }

    function _hide(persist = true) {
        isVisible = false;
        panel.classList.remove('is-visible');
        statusBtn?.classList.remove('is-active');
        if (persist) store.set('visible', false);
    }

    function show()   { _show(); }
    function hide()   { _hide(); }
    function toggle() { isVisible ? _hide() : _show(); }

    // ── 结果渲染 ──

    function renderEmpty() {
        resultEl.innerHTML = `<div class="translator-placeholder">${escapeHtml(t('translator.hint'))}</div>`;
    }

    function renderLoading() {
        resultEl.innerHTML = `<div class="translator-placeholder">${escapeHtml(t('translator.loading'))}</div>`;
    }

    function renderError(message) {
        resultEl.innerHTML = `<div class="translator-error">${escapeHtml(message)}</div>`;
    }

    function renderResult(result) {
        const parts = [`<div class="translator-translation">${escapeHtml(result.translation)}</div>`];

        // 音标 + 词性
        const meta = [];
        if (result.phonetic) {
            meta.push(`<span class="translator-phonetic">${escapeHtml(result.phonetic)}</span>`);
        }
        if (result.type === 'word' && result.partOfSpeech) {
            meta.push(`<span class="translator-pos">${escapeHtml(result.partOfSpeech)}</span>`);
        }
        if (meta.length > 0) {
            parts.push(`<div class="translator-meta">${meta.join('')}</div>`);
        }

        // 词：用法说明 + 例句
        if (result.type === 'word') {
            if (result.usage) {
                parts.push(`<div class="translator-section-title">${escapeHtml(t('translator.usage'))}</div>`);
                parts.push(`<div class="translator-usage">${escapeHtml(result.usage)}</div>`);
            }
            if (result.examples.length > 0) {
                const items = result.examples.map((ex) => `
                    <li class="translator-example">
                        ${ex.en ? `<div class="translator-example-en">${escapeHtml(ex.en)}</div>` : ''}
                        ${ex.zh ? `<div class="translator-example-zh">${escapeHtml(ex.zh)}</div>` : ''}
                    </li>
                `).join('');
                parts.push(`<div class="translator-section-title">${escapeHtml(t('translator.examples'))}</div>`);
                parts.push(`<ul class="translator-examples">${items}</ul>`);
            }
        }

        // 句子：生僻词
        if (result.type === 'sentence' && result.terms.length > 0) {
            const items = result.terms.map((term) => `
                <li class="translator-term">
                    <div class="translator-term-head">
                        <span class="translator-term-word">${escapeHtml(term.word)}</span>
                        ${term.phonetic ? `<span class="translator-term-phonetic">${escapeHtml(term.phonetic)}</span>` : ''}
                    </div>
                    ${term.explanation ? `<div class="translator-term-explain">${escapeHtml(term.explanation)}</div>` : ''}
                </li>
            `).join('');
            parts.push(`<div class="translator-section-title">${escapeHtml(t('translator.terms'))}</div>`);
            parts.push(`<ul class="translator-terms">${items}</ul>`);
        }

        resultEl.innerHTML = parts.join('');
    }

    async function runTranslate() {
        if (isTranslating) return;
        const text = input.value.trim();
        if (!text) {
            renderEmpty();
            input.focus();
            return;
        }

        isTranslating = true;
        submitBtn?.setAttribute('disabled', 'true');
        renderLoading();
        try {
            const result = await translate(text);
            renderResult(result);
        } catch (error) {
            renderError(error?.message || t('translator.error.unknown'));
        } finally {
            isTranslating = false;
            submitBtn?.removeAttribute('disabled');
        }
    }

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

            const newRight  = Math.max(0, Math.min(window.innerWidth - 260, startRight - dx));
            const newBottom = Math.max(0, startBottom - dy);

            panel.style.right  = newRight  + 'px';
            panel.style.bottom = newBottom + 'px';

            store.set('position', { right: newRight, bottom: newBottom });
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
            const newW = Math.max(260, startW - (e.clientX - startX));
            const newH = Math.max(200, startH - (e.clientY - startY));

            panel.style.width  = newW + 'px';
            panel.style.height = newH + 'px';

            store.set('size', { width: newW, height: newH });
        });
    }

    // ── 初始化 ──

    function initialize() {
        const savedInput = store.get('input', '') ?? '';
        const pos        = store.get('position', DEFAULT_POSITION);
        const size       = store.get('size', DEFAULT_SIZE);
        const visible    = store.get('visible', false);

        input.value = savedInput;
        applyPosition(pos);
        applySize(size);
        renderEmpty();
        if (visible) _show(false);

        input.addEventListener('input', scheduleInputSave);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
                e.preventDefault();
                runTranslate();
            }
        });
        // Esc 关闭面板（焦点在面板内时生效，不影响其它 Esc 处理）
        panel.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !e.isComposing) {
                e.preventDefault();
                e.stopPropagation();
                hide();
            }
        });
        addClickHandler(submitBtn, runTranslate);
        addClickHandler(closeBtn,  hide);
        addClickHandler(statusBtn, toggle);

        setupDrag();
        setupResize();
    }

    return { initialize, show, hide, toggle };
}
