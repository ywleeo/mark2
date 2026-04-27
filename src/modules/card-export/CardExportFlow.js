import { save, message } from '@tauri-apps/plugin-dialog';
import { join } from '@tauri-apps/api/path';
import { captureScreenshot } from '../../api/native.js';
import { buildDefaultCardImagePath } from '../../utils/exportUtils.js';
import { pickPaths } from '../../api/filesystem.js';
import { addClickHandler } from '../../utils/PointerHelper.js';
import { CARD_TEMPLATES } from './cardTemplates.js';
import { renderCardToDataUrl } from './cardExportPipeline.js';
import { t } from '../../i18n/index.js';

const DISPLAY_WIDTH = 340;
const DISPLAY_HEIGHT = Math.round(DISPLAY_WIDTH * (1280 / 960)); // 453px, 3:4
const EXPORT_WIDTH = 960;

export class CardExportFlow {
    constructor() {
        this.element = null;
        this.stripEl = null;
        this.items = [];
        this._cleanups = [];
        this._selectedText = '';
        this._selectedHtml = '';
        this._selectedItem = null;

        // Expand mode
        this._expandMode = false;
        this._expandTpl = null;
        this._expandItems = [];
        this._expandFontSize = null; // current font size in expand mode (not persisted)
    }

    static FONT_MIN = 10;
    static FONT_MAX = 24;
    static FONT_STEP = 1;

    mount() {
        const el = document.createElement('div');
        el.className = 'card-export-flow hidden';
        el.innerHTML = `
            <div class="card-export-flow__backdrop"></div>
            <div class="card-export-flow__panel">
                <div class="card-export-flow__header">
                    <div class="card-export-flow__header-left">
                        <button type="button" class="card-export-flow__back-btn" aria-label="返回" style="display:none">
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                                <path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </button>
                        <span class="card-export-flow__title">${t('cardExport.title')}</span>
                    </div>
                    <div class="card-export-flow__header-actions">
                        <div class="cef-normal-actions">
                            <button type="button" class="card-export-flow__expand-btn" aria-label="展开多卡" disabled>
                                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                                    <rect x="1.5" y="3" width="5.5" height="10" rx="1.2" stroke="currentColor" stroke-width="1.4"/>
                                    <rect x="9" y="3" width="5.5" height="10" rx="1.2" stroke="currentColor" stroke-width="1.4"/>
                                </svg>
                            </button>
                            <button type="button" class="card-export-flow__export-btn" aria-label="导出 PNG" disabled>
                                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                                    <path d="M8 2v8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                                    <path d="M5 7l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                                    <path d="M3 13h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                                </svg>
                            </button>
                            <button type="button" class="card-export-flow__close" aria-label="关闭">
                                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                                    <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                                </svg>
                            </button>
                        </div>
                        <div class="cef-expand-actions" style="display:none">
                            <button type="button" class="card-export-flow__font-down-btn" aria-label="减小字号">
                                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                                    <path d="M2.5 12L5.5 4l3 8M3.7 9.5h3.6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
                                    <path d="M10.5 8h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
                                </svg>
                            </button>
                            <button type="button" class="card-export-flow__font-up-btn" aria-label="放大字号">
                                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                                    <path d="M2.5 12L5.5 4l3 8M3.7 9.5h3.6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
                                    <path d="M10.5 8h4M12.5 6v4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
                                </svg>
                            </button>
                            <button type="button" class="card-export-flow__download-all-btn" aria-label="下载全部">
                                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                                    <path d="M5 2v6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
                                    <path d="M3 6.5l2 2 2-2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
                                    <path d="M11 2v6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
                                    <path d="M9 6.5l2 2 2-2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
                                    <path d="M2 13h12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
                                </svg>
                            </button>
                            <button type="button" class="card-export-flow__close" aria-label="关闭">
                                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                                    <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>
                <div class="card-export-flow__strip"></div>
            </div>
        `;

        this.element = el;
        this.stripEl = el.querySelector('.card-export-flow__strip');
        this._titleEl = el.querySelector('.card-export-flow__title');
        this._backBtn = el.querySelector('.card-export-flow__back-btn');
        this._expandBtn = el.querySelector('.card-export-flow__expand-btn');
        this._exportBtn = el.querySelector('.card-export-flow__export-btn');
        this._downloadAllBtn = el.querySelector('.card-export-flow__download-all-btn');
        this._fontDownBtn = el.querySelector('.card-export-flow__font-down-btn');
        this._fontUpBtn = el.querySelector('.card-export-flow__font-up-btn');
        this._normalActions = el.querySelector('.cef-normal-actions');
        this._expandActions = el.querySelector('.cef-expand-actions');

        CARD_TEMPLATES.forEach(tpl => {
            const item = this._buildItem(tpl);
            this.items.push(item);
            this.stripEl.appendChild(item.root);
        });

        document.body.appendChild(el);

        const onKeydown = (e) => { if (e.key === 'Escape') this.hide(); };
        window.addEventListener('keydown', onKeydown);

        this._cleanups.push(
            addClickHandler(this._expandBtn, () => this._handleExpandClick()),
            addClickHandler(this._exportBtn, () => { if (this._selectedItem) this._handleExport(this._selectedItem); }),
            addClickHandler(this._downloadAllBtn, () => this._handleDownloadAll()),
            addClickHandler(this._fontDownBtn, () => this._changeFontSize(-CardExportFlow.FONT_STEP)),
            addClickHandler(this._fontUpBtn, () => this._changeFontSize(+CardExportFlow.FONT_STEP)),
            addClickHandler(this._backBtn, () => this._exitExpandMode()),
            ...Array.from(el.querySelectorAll('.card-export-flow__close')).map(btn =>
                addClickHandler(btn, () => this.hide())
            ),
            addClickHandler(el.querySelector('.card-export-flow__backdrop'), () => this.hide()),
            () => window.removeEventListener('keydown', onKeydown),
        );
    }

    // ── Item builders ─────────────────────────────────────────

    _buildItem(tpl) {
        const root = document.createElement('div');
        root.className = 'card-export-flow__item';

        const previewWrap = document.createElement('div');
        previewWrap.className = 'card-export-flow__item-preview';
        previewWrap.style.cssText = `width:${DISPLAY_WIDTH}px;height:${DISPLAY_HEIGHT}px`;

        const cardEl = this._buildCardDOM(tpl);
        previewWrap.appendChild(cardEl);

        const loadingEl = document.createElement('div');
        loadingEl.className = 'card-export-flow__item-loading hidden';
        loadingEl.innerHTML = `<div class="card-export-flow__spinner"></div>`;
        previewWrap.appendChild(loadingEl);

        root.appendChild(previewWrap);

        const item = {
            tpl, root, previewWrap, cardEl, loadingEl,
            textEl: cardEl.querySelector('.card-preview-card__content'),
            state: 'idle',
        };

        this._cleanups.push(
            addClickHandler(previewWrap, () => this._selectItem(item)),
        );

        return item;
    }

    _buildExpandItem(html, tpl, index, total) {
        const root = document.createElement('div');
        root.className = 'card-export-flow__item card-export-flow__item--expand';

        const previewWrap = document.createElement('div');
        previewWrap.className = 'card-export-flow__item-preview';
        previewWrap.style.cssText = `width:${DISPLAY_WIDTH}px;height:${DISPLAY_HEIGHT}px`;

        const cardEl = this._buildCardDOM(tpl);
        previewWrap.appendChild(cardEl);

        const loadingEl = document.createElement('div');
        loadingEl.className = 'card-export-flow__item-loading hidden';
        loadingEl.innerHTML = `<div class="card-export-flow__spinner"></div>`;
        previewWrap.appendChild(loadingEl);

        root.appendChild(previewWrap);

        const label = document.createElement('div');
        label.className = 'card-export-flow__page-label';
        label.textContent = `${index + 1} / ${total}`;
        root.appendChild(label);

        const textEl = cardEl.querySelector('.card-preview-card__content');
        // code mode: preserve syntax highlighting classes; 其他模板做轻度清理
        textEl.innerHTML = tpl.codeMode ? html : this._sanitizeRawForCard(html);
        // Expand cards use a uniform font size (controlled by header A-/A+); no per-card auto-scaling
        const fontSize = this._expandFontSize ?? tpl.baseFontSize ?? 13.5;
        textEl.style.fontSize = `${fontSize}px`;
        requestAnimationFrame(() => this._applySmartLayout({ cardEl, textEl, tpl }));

        return { root, previewWrap, cardEl, textEl, loadingEl, html };
    }

    _buildCardDOM(tpl) {
        const card = document.createElement('div');
        card.className = `card-preview-card card-preview-card--${tpl.id}`;
        card.style.cssText = `width:${DISPLAY_WIDTH}px;height:${DISPLAY_HEIGHT}px`;
        card.dataset.cardTheme = tpl.theme;

        const bg = document.createElement('div');
        bg.className = `card-preview-card__background card-preview-card__background--${tpl.id}`;
        card.appendChild(bg);

        const body = document.createElement('div');
        body.className = 'card-preview-card__body';
        const content = document.createElement('div');
        content.className = 'card-preview-card__content';
        content.dataset.themeAppearance = tpl.theme;
        body.appendChild(content);
        card.appendChild(body);

        tpl.buildDecorations?.().forEach(deco => {
            const el = document.createElement('div');
            el.className = deco.class;
            el.textContent = deco.content;
            card.appendChild(el);
        });

        return card;
    }

    // ── Lifecycle ─────────────────────────────────────────────

    open({ text, html }) {
        this._selectedText = text;
        this._selectedHtml = html;
        this._selectedItem = null;

        if (this._expandMode) this._exitExpandMode();

        this.items.forEach(item => {
            item.state = 'idle';
            item.root.classList.remove('is-active', 'is-done', 'is-selected', 'has-overflow');
            item.loadingEl.classList.add('hidden');
            item.textEl.style.fontSize = '';
            item.textEl.style.fontWeight = '';
            if (html) {
                item.textEl.innerHTML = this._sanitizeRaw(html);
            } else {
                item.textEl.textContent = text;
            }
            this._applyFontScale(item);
            requestAnimationFrame(() => {
                const overflows = item.tpl.contentMaxHeight
                    && item.textEl.scrollHeight > item.tpl.contentMaxHeight;
                item.root.classList.toggle('has-overflow', !!overflows);
            });
        });

        this._updateNormalButtons();
        this.element.classList.remove('hidden');
    }

    hide() {
        if (this._expandMode) this._exitExpandMode();
        this.element?.classList.add('hidden');
    }

    // ── Selection & button state ──────────────────────────────

    _selectItem(item) {
        this._selectedItem = item;
        this.items.forEach(i => i.root.classList.toggle('is-selected', i === item));
        this._updateNormalButtons();
    }

    _updateNormalButtons() {
        if (this._expandMode) return;
        const item = this._selectedItem;
        const canExpand = item && item.root.classList.contains('has-overflow');
        this._exportBtn.disabled = !item;
        this._expandBtn.disabled = !canExpand;
    }

    // ── Expand ────────────────────────────────────────────────

    _handleExpandClick() {
        const item = this._selectedItem;
        if (!item) return;
        // 每次打开 expand 都重置为模板默认字号（不持久化）
        this._expandFontSize = Math.round(item.tpl.baseFontSize || 13.5);
        const pages = this._rawSplit(item.tpl, this._expandFontSize);
        if (pages.length) this._enterExpandMode(pages, item.tpl);
    }

    _changeFontSize(delta) {
        if (!this._expandMode) return;
        const next = Math.max(
            CardExportFlow.FONT_MIN,
            Math.min(CardExportFlow.FONT_MAX, this._expandFontSize + delta)
        );
        if (next === this._expandFontSize) return;
        this._expandFontSize = next;
        this._rebuildExpand();
    }

    _rebuildExpand() {
        if (!this._expandMode || !this._expandTpl) return;
        const tpl = this._expandTpl;
        const pages = this._rawSplit(tpl, this._expandFontSize);
        this._expandItems.forEach(i => i.root.remove());
        this._expandItems = pages.map((html, i) => this._buildExpandItem(html, tpl, i, pages.length));
        this._expandItems.forEach(i => this.stripEl.appendChild(i.root));
        this._updateFontButtons();
    }

    _updateFontButtons() {
        if (!this._fontDownBtn) return;
        this._fontDownBtn.disabled = this._expandFontSize <= CardExportFlow.FONT_MIN;
        this._fontUpBtn.disabled = this._expandFontSize >= CardExportFlow.FONT_MAX;
    }

    _enterExpandMode(pages, tpl) {
        this._expandMode = true;
        this._expandTpl = tpl;

        // Detach normal items from strip (keep in memory)
        this.items.forEach(i => i.root.remove());

        // Build expand cards
        this._expandItems = pages.map((html, i) => this._buildExpandItem(html, tpl, i, pages.length));
        this._expandItems.forEach(i => this.stripEl.appendChild(i.root));

        // Switch header
        this._titleEl.textContent = t('cardExport.title');
        this._backBtn.style.display = '';
        this._normalActions.style.display = 'none';
        this._expandActions.style.display = '';
        this._updateFontButtons();
    }

    _exitExpandMode() {
        this._expandMode = false;
        this._expandTpl = null;
        this._expandFontSize = null;

        // Remove expand cards
        this._expandItems.forEach(i => i.root.remove());
        this._expandItems = [];

        // Restore normal items
        this.items.forEach(i => this.stripEl.appendChild(i.root));

        // Restore header
        this._titleEl.textContent = t('cardExport.title');
        this._backBtn.style.display = 'none';
        this._normalActions.style.display = '';
        this._expandActions.style.display = 'none';

        this._updateNormalButtons();
    }

    // ── Expand mode: Download All ─────────────────────────────

    async _handleDownloadAll() {
        if (!this._expandItems.length) return;

        const selections = await pickPaths({ directory: true, multiple: false });
        if (!selections.length) return;
        const dir = selections[0].path;
        const ts = Date.now();

        this._downloadAllBtn.disabled = true;

        for (let i = 0; i < this._expandItems.length; i++) {
            const item = this._expandItems[i];
            item.loadingEl.classList.remove('hidden');
            try {
                const filename = `Mark2-Card-${String(i + 1).padStart(2, '0')}-${ts}.png`;
                const targetPath = await join(dir, filename);
                const dataUrl = await renderCardToDataUrl({
                    cardElement: item.cardEl,
                    previewInner: item.previewWrap,
                    width: EXPORT_WIDTH,
                    previewRenderedWidth: DISPLAY_WIDTH,
                });
                await captureScreenshot(targetPath, dataUrl);
            } catch (err) {
                console.error(`[CardExportFlow] 第 ${i + 1} 张导出失败`, err);
            } finally {
                item.loadingEl.classList.add('hidden');
            }
        }

        this._downloadAllBtn.disabled = false;
    }

    // ── Raw split (no LLM) ────────────────────────────────────

    _escapeHtml(text) {
        return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    _rawSplit(tpl, fontSize = null) {
        const maxH = tpl.contentMaxHeight;
        const baseHtml = this._sanitizeRaw(this._selectedHtml);
        if (!maxH) return [baseHtml || this._selectedText];

        const div = document.createElement('div');
        div.innerHTML = baseHtml || '';
        let topNodes = [...div.children];

        if (!topNodes.length) {
            topNodes = this._selectedText.split('\n')
                .filter(l => l.trim())
                .map(l => { const p = document.createElement('p'); p.textContent = l; return p; });
        }

        // 把最外层 <ol>/<ul> 展开为独立 li items，让长列表也能参与分页
        const items = [];
        for (const node of topNodes) {
            const tag = node.tagName?.toLowerCase();
            if (tag === 'ol' || tag === 'ul') {
                const lis = [...node.children].filter(c => c.tagName?.toLowerCase() === 'li');
                const baseStart = tag === 'ol'
                    ? parseInt(node.getAttribute('start') || '1', 10) || 1
                    : null;
                lis.forEach((li, i) => {
                    items.push({
                        kind: 'li',
                        listTag: tag,
                        start: baseStart != null ? baseStart + i : null,
                        html: li.outerHTML,
                    });
                });
            } else {
                items.push({ kind: 'block', tag, html: node.outerHTML });
            }
        }

        // 把 items 序列化为 HTML：连续同类型 li 合并回一个 <ol>/<ul>，并用 start 维持序号
        const itemsToHtml = (arr) => {
            let out = '';
            let i = 0;
            while (i < arr.length) {
                const it = arr[i];
                if (it.kind === 'li') {
                    let j = i + 1;
                    while (j < arr.length && arr[j].kind === 'li' && arr[j].listTag === it.listTag) j++;
                    const inner = arr.slice(i, j).map(g => g.html).join('');
                    const startAttr = it.listTag === 'ol' && it.start != null && it.start !== 1
                        ? ` start="${it.start}"` : '';
                    out += `<${it.listTag}${startAttr}>${inner}</${it.listTag}>`;
                    i = j;
                } else {
                    out += it.html;
                    i++;
                }
            }
            return out;
        };

        // Hidden measurement card — match font size to actual rendered expand cards
        const measureCard = this._buildCardDOM(tpl);
        const measureContent = measureCard.querySelector('.card-preview-card__content');
        measureCard.style.cssText = `position:fixed;left:-10000px;top:0;width:${DISPLAY_WIDTH}px;height:${DISPLAY_HEIGHT}px;visibility:hidden;pointer-events:none;`;
        if (fontSize != null) measureContent.style.fontSize = `${fontSize}px`;
        document.body.appendChild(measureCard);

        const pages = [];
        let current = [];

        for (const item of items) {
            // h1 always gets its own solo page
            if (item.kind === 'block' && item.tag === 'h1') {
                if (current.length) { pages.push(itemsToHtml(current)); current = []; }
                pages.push(item.html);
                continue;
            }

            // h2 must start at the top of a page — flush preceding content first.
            // 例外：current 仅剩 1 个普通段落（多为上一页溢出后留下的孤儿），
            // 允许 h2 跟它合页，避免单段孤儿。后续测量若放不下，会回退到常规拆页。
            // h3-h6 不强制换页，按高度自然流动；多个小节能合并就合并到一页。
            if (item.kind === 'block' && item.tag === 'h2' && current.length > 0) {
                const only = current[0];
                const isOrphanBlock = current.length === 1
                    && only.kind === 'block'
                    && !/^h[1-6]$/.test(only.tag);
                if (!isOrphanBlock) {
                    pages.push(itemsToHtml(current));
                    current = [];
                }
            }

            current.push(item);
            measureContent.innerHTML = itemsToHtml(current);
            if (measureContent.scrollHeight > maxH && current.length > 1) {
                current.pop();
                // 防孤儿标题：若当前页尾部是 h2-h6（或紧跟其后的 <hr> 分割线），
                // 把它们一起带到下一页，避免标题视觉上成为页面最后一行。
                const carry = [];
                while (current.length > 0) {
                    const last = current[current.length - 1];
                    const isHeading = last.kind === 'block' && /^h[2-6]$/.test(last.tag);
                    const isHr = last.kind === 'block' && last.tag === 'hr';
                    if (isHeading || isHr) {
                        carry.unshift(current.pop());
                    } else {
                        break;
                    }
                }
                // 仅当 carry 真包含标题时才搬走；否则尾部只是 content 后的 <hr>，回填本页
                const carryHasHeading = carry.some(c => /^h[2-6]$/.test(c.tag));
                if (!carryHasHeading) {
                    current.push(...carry);
                    carry.length = 0;
                }
                if (current.length === 0) {
                    // current 全部是标题（含可能的 hr）：保留以避免空页（极端边界情况）
                    current = carry;
                    carry.length = 0;
                }
                pages.push(itemsToHtml(current));
                current = [...carry, item];
                measureContent.innerHTML = itemsToHtml(current);
            }
        }
        if (current.length) pages.push(itemsToHtml(current));

        document.body.removeChild(measureCard);
        return pages.length ? pages : [baseHtml || this._selectedText];
    }

    // ── Sanitization ──────────────────────────────────────────

    _sanitizeRaw(html) {
        const div = document.createElement('div');
        div.innerHTML = html;
        div.querySelectorAll('script,style').forEach(el => el.remove());
        div.querySelectorAll('*').forEach(el => {
            [...el.attributes].forEach(attr => {
                if (attr.name.startsWith('on') || attr.name === 'style') el.removeAttribute(attr.name);
            });
        });
        return div.innerHTML;
    }

    _sanitizeRawForCard(html) {
        if (!html) return '';
        const div = document.createElement('div');
        div.innerHTML = html;
        div.querySelectorAll('script, style, img, video, audio, iframe').forEach(el => el.remove());
        const kept = new Set(['p', 'br', 'hr', 'strong', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
            'blockquote', 'ul', 'ol', 'li', 'code', 'pre']);
        const walk = (node) => {
            for (const child of [...node.childNodes]) {
                if (child.nodeType !== Node.ELEMENT_NODE) continue;
                const tag = child.tagName.toLowerCase();
                if (kept.has(tag)) {
                    while (child.attributes.length) child.removeAttribute(child.attributes[0].name);
                    walk(child);
                } else {
                    while (child.firstChild) child.parentNode.insertBefore(child.firstChild, child);
                    child.remove();
                }
            }
        };
        walk(div);
        return div.innerHTML;
    }

    // ── Layout helpers ────────────────────────────────────────

    _applySmartLayout(item) {
        const body = item.cardEl.querySelector('.card-preview-card__body');
        if (body) body.style.justifyContent = 'center';
    }

    _applyFontScale(item) {
        const maxH = item.tpl.contentMaxHeight;
        const baseSize = item.tpl.baseFontSize || 13.5;
        item.textEl.style.fontSize = '';
        item.textEl.style.fontWeight = '';

        requestAnimationFrame(() => {
            const contentH = item.textEl.scrollHeight;
            if (maxH && contentH > 0 && contentH < maxH * 0.55) {
                let finalSize = Math.min(baseSize * ((maxH * 0.72) / contentH), 36);
                item.textEl.style.fontSize = `${finalSize.toFixed(1)}px`;

                const scaledH = item.textEl.scrollHeight;
                if (scaledH > maxH) {
                    finalSize = finalSize * (maxH * 0.92 / scaledH);
                    item.textEl.style.fontSize = `${finalSize.toFixed(1)}px`;
                }

                if (finalSize > baseSize * 1.15) {
                    item.textEl.style.fontWeight = '600';
                }
            }
            this._applySmartLayout(item);
        });
    }

    // ── Single card export ────────────────────────────────────

    async _handleExport(item) {
        try {
            const defaultPath = await buildDefaultCardImagePath('卡片');
            const targetPath = await save({
                title: '导出卡片 PNG',
                filters: [{ name: 'PNG 图片', extensions: ['png'] }],
                defaultPath,
            });
            if (!targetPath) return;

            const dataUrl = await renderCardToDataUrl({
                cardElement: item.cardEl,
                previewInner: item.previewWrap,
                width: EXPORT_WIDTH,
                previewRenderedWidth: DISPLAY_WIDTH,
            });
            await captureScreenshot(targetPath, dataUrl);
        } catch (err) {
            console.error('[CardExportFlow] 导出失败', err);
            await message(`导出失败：${err?.message || err}`, { title: '导出失败', kind: 'error' });
        }
    }

    destroy() {
        this._cleanups.forEach(fn => fn?.());
        this._cleanups = [];
        this.element?.remove();
        this.element = null;
    }
}
