import { save, message } from '@tauri-apps/plugin-dialog';
import { join } from '@tauri-apps/api/path';
import { captureScreenshot } from '../../api/native.js';
import { buildDefaultCardImagePath } from '../../utils/exportUtils.js';
import { pickPaths } from '../../api/filesystem.js';
import { addClickHandler } from '../../utils/PointerHelper.js';
import { CARD_TEMPLATES } from './cardTemplates.js';
import { renderCardToDataUrl } from './cardExportPipeline.js';
import { aiService } from '../ai-assistant/aiService.js';
import { aiProxyJsonRequest } from '../../api/aiProxy.js';
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
    }

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
                            <button type="button" class="card-export-flow__ai-btn" aria-label="AI 美化" disabled>
                                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                                    <path d="M8 2l1.2 3.5L13 7l-3.8 1.5L8 12l-1.2-3.5L3 7l3.8-1.5Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
                                    <path d="M13 11l.6 1.4 1.4.6-1.4.6L13 15l-.6-1.4-1.4-.6 1.4-.6Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
                                </svg>
                            </button>
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
                            <button type="button" class="card-export-flow__expand-ai-btn" aria-label="AI 重排">
                                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                                    <path d="M8 2l1.2 3.5L13 7l-3.8 1.5L8 12l-1.2-3.5L3 7l3.8-1.5Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
                                    <path d="M13 11l.6 1.4 1.4.6-1.4.6L13 15l-.6-1.4-1.4-.6 1.4-.6Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
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
        this._aiBtn = el.querySelector('.card-export-flow__ai-btn');
        this._expandBtn = el.querySelector('.card-export-flow__expand-btn');
        this._exportBtn = el.querySelector('.card-export-flow__export-btn');
        this._expandAiBtn = el.querySelector('.card-export-flow__expand-ai-btn');
        this._downloadAllBtn = el.querySelector('.card-export-flow__download-all-btn');
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
            addClickHandler(this._aiBtn, () => this._handleAIBeautify()),
            addClickHandler(this._expandBtn, () => this._handleExpandClick()),
            addClickHandler(this._exportBtn, () => { if (this._selectedItem) this._handleExport(this._selectedItem); }),
            addClickHandler(this._expandAiBtn, () => this._handleExpandAI()),
            addClickHandler(this._downloadAllBtn, () => this._handleDownloadAll()),
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

        const errorEl = document.createElement('div');
        errorEl.className = 'card-export-flow__item-error hidden';
        errorEl.innerHTML = `<span>AI 处理失败</span><span class="card-export-flow__item-retry">点击重试</span>`;
        previewWrap.appendChild(errorEl);

        root.appendChild(previewWrap);

        const item = {
            tpl, root, previewWrap, cardEl, loadingEl, errorEl,
            textEl: cardEl.querySelector('.card-preview-card__content'),
            state: 'idle',
            _multiCards: null,
        };

        this._cleanups.push(
            addClickHandler(previewWrap, () => this._selectItem(item)),
        );

        return item;
    }

    _buildExpandItem(html, tpl, index, total, isRaw = false) {
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
        // code mode raw: html already _sanitizeRaw'd, preserve all syntax highlighting classes
        textEl.innerHTML = isRaw
            ? (tpl.codeMode ? html : this._sanitizeRawForCard(html))
            : this._sanitizeLLMHtml(html);
        if (!isRaw) textEl.classList.add('is-ai-formatted');
        // Expand cards use uniform base font size — no auto-scaling across cards
        textEl.style.fontSize = `${tpl.baseFontSize || 13.5}px`;
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
            item._multiCards = null;
            item.root.classList.remove('is-active', 'is-done', 'is-selected', 'has-overflow');
            item.loadingEl.classList.add('hidden');
            item.errorEl.classList.add('hidden');
            item.textEl.style.fontSize = '';
            item.textEl.style.fontWeight = '';
            item.textEl.classList.remove('is-ai-formatted');
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
        const anyProcessing = this.items.some(i => i.state === 'processing');
        const canExpand = item && (
            item.root.classList.contains('has-overflow') || !!item._multiCards
        );
        this._exportBtn.disabled = !item;
        this._expandBtn.disabled = !canExpand;
        this._aiBtn.disabled = !item || anyProcessing || !!item?.tpl?.noLLM;
    }

    // ── Normal mode: AI beautify ──────────────────────────────

    async _handleAIBeautify() {
        const item = this._selectedItem;
        if (!item || item.state === 'processing') return;

        const hasOverflow = item.root.classList.contains('has-overflow');

        item.state = 'processing';
        item.root.classList.add('is-active');
        item.loadingEl.classList.remove('hidden');
        item.errorEl.classList.add('hidden');
        this._aiBtn.disabled = true;
        this._expandBtn.disabled = true;

        let multiCards = null;

        try {
            if (hasOverflow) {
                // Multi-card: code splits first, LLM beautifies each page
                const rawPages = this._rawSplit(item.tpl);
                const pages = await this._beautifyPages(rawPages, item.tpl);
                item._multiCards = pages;
                multiCards = pages;
                // Show first card in style view
                item.textEl.innerHTML = this._sanitizeLLMHtml(pages[0]);
                item.textEl.classList.add('is-ai-formatted');
                item.root.classList.remove('has-overflow', 'is-active');
                item.root.classList.add('is-done');
                item.state = 'done';
                this._applyFontScale(item);
            } else {
                // Single card: LLM formats only
                const html = await this._formatSingleCard(this._selectedText, item.tpl);
                item.textEl.innerHTML = this._sanitizeLLMHtml(html);
                item.textEl.classList.add('is-ai-formatted');
                item.state = 'done';
                item.root.classList.remove('is-active');
                item.root.classList.add('is-done');
                this._applyFontScale(item);
            }
        } catch (err) {
            console.warn('[CardExportFlow] LLM 处理失败', err);
            item.state = 'error';
            item.root.classList.remove('is-active');
            item.errorEl.querySelector('span:first-child').textContent = err?.message || 'AI 处理失败';
            item.errorEl.classList.remove('hidden');
        } finally {
            item.loadingEl.classList.add('hidden');
            this._updateNormalButtons();
        }

        // Auto-enter expand mode after multi-card generation
        if (multiCards && item.state === 'done') {
            this._enterExpandMode(multiCards, item.tpl);
        }
    }

    // ── Normal mode: Expand ───────────────────────────────────

    _handleExpandClick() {
        const item = this._selectedItem;
        if (!item) return;

        let pages;
        if (item._multiCards) {
            pages = item._multiCards;
        } else {
            pages = this._rawSplit(item.tpl);
        }

        const isRaw = !item._multiCards;
        if (pages.length) this._enterExpandMode(pages, item.tpl, isRaw);
    }

    // ── Expand mode ───────────────────────────────────────────

    _enterExpandMode(pages, tpl, isRaw = false) {
        this._expandMode = true;
        this._expandTpl = tpl;

        // Detach normal items from strip (keep in memory)
        this.items.forEach(i => i.root.remove());

        // Build expand cards
        this._expandItems = pages.map((html, i) => this._buildExpandItem(html, tpl, i, pages.length, isRaw));
        this._expandItems.forEach(i => this.stripEl.appendChild(i.root));

        // Switch header
        this._titleEl.textContent = t('cardExport.title');
        this._backBtn.style.display = '';
        this._normalActions.style.display = 'none';
        this._expandActions.style.display = '';
        this._expandAiBtn.disabled = !!tpl.noLLM;
    }

    _exitExpandMode() {
        this._expandMode = false;
        this._expandTpl = null;

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

    // ── Expand mode: AI re-layout ─────────────────────────────

    async _handleExpandAI() {
        if (!this._expandTpl) return;

        this._expandAiBtn.disabled = true;
        this._downloadAllBtn.disabled = true;
        this._expandItems.forEach(item => item.loadingEl.classList.remove('hidden'));

        try {
            const rawPages = this._rawSplit(this._expandTpl);
            const pages = await this._beautifyPages(rawPages, this._expandTpl);
            // Rebuild expand cards in place
            this._expandItems.forEach(i => i.root.remove());
            this._expandItems = pages.map((html, i) =>
                this._buildExpandItem(html, this._expandTpl, i, pages.length)
            );
            this._expandItems.forEach(i => this.stripEl.appendChild(i.root));

            // Update stored multi-cards on the selected item
            if (this._selectedItem) this._selectedItem._multiCards = pages;
        } catch (err) {
            console.warn('[CardExportFlow] Expand AI 失败', err);
            this._expandItems.forEach(item => item.loadingEl.classList.add('hidden'));
            await message(`AI 排版失败：${err?.message || err}`, { title: '排版失败', kind: 'error' });
        } finally {
            this._expandAiBtn.disabled = false;
            this._downloadAllBtn.disabled = false;
        }
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

    _rawSplit(tpl) {
        const maxH = tpl.contentMaxHeight;
        const baseHtml = this._sanitizeRaw(this._selectedHtml);
        if (!maxH) return [baseHtml || this._selectedText];

        const div = document.createElement('div');
        div.innerHTML = baseHtml || '';
        let nodes = [...div.children];

        if (!nodes.length) {
            nodes = this._selectedText.split('\n')
                .filter(l => l.trim())
                .map(l => { const p = document.createElement('p'); p.textContent = l; return p; });
        }

        // Hidden measurement card
        const measureCard = this._buildCardDOM(tpl);
        const measureContent = measureCard.querySelector('.card-preview-card__content');
        measureCard.style.cssText = `position:fixed;left:-10000px;top:0;width:${DISPLAY_WIDTH}px;height:${DISPLAY_HEIGHT}px;visibility:hidden;pointer-events:none;`;
        document.body.appendChild(measureCard);

        const pages = [];
        let current = [];

        for (const node of nodes) {
            const tag = node.tagName?.toLowerCase();

            // h1 always gets its own solo page
            if (tag === 'h1') {
                if (current.length) { pages.push(current.join('')); current = []; }
                pages.push(node.outerHTML);
                continue;
            }

            // h2-h6 must start at the top of a page — flush preceding content first
            if (/^h[2-6]$/.test(tag) && current.length > 0) {
                pages.push(current.join(''));
                current = [];
            }

            current.push(node.outerHTML);
            measureContent.innerHTML = current.join('');
            if (measureContent.scrollHeight > maxH && current.length > 1) {
                current.pop();
                pages.push(current.join(''));
                current = [node.outerHTML];
                measureContent.innerHTML = current.join('');
            }
        }
        if (current.length) pages.push(current.join(''));

        document.body.removeChild(measureCard);
        return pages.length ? pages : [baseHtml || this._selectedText];
    }

    // ── LLM formatting ────────────────────────────────────────

    async _formatSingleCard(text, tpl) {
        const provider = aiService.getFastProvider();
        const model = aiService.getFastModel();
        if (!provider?.apiKey || !model) throw new Error('未配置 AI');

        const naturalLines = text.trim().split('\n').filter(l => l.trim()).length;
        const isShort = naturalLines <= 2 && text.trim().length <= 80;
        const lineHint = tpl?.charsPerLine
            ? `\n\n【行宽限制】每行最多容纳约 ${tpl.charsPerLine} 个汉字。句子超过此长度时，在语义完整处用 <br> 断行。`
            : '';

        const prompt = isShort
            ? `将以下文字重新排版为卡片 HTML，让它在视觉上更有节奏感。只使用 <p><strong><em><br> 标签。禁止添加、删减或改写任何文字。主动在语义完整处用 <br> 分行；用 <strong> 标记最重要的词，用 <em> 修饰意象或情绪词。\n\n${text}`
            : tpl?.llmPrompt
                ? `${tpl.llmPrompt}${lineHint}\n\n【补充】原文中 Markdown 标题（# ## ###）用 <h3> 标签输出（视觉上会放大显示）；也可在内容的核心小节开头加 <h3> 标题行。\n\n原文：\n${text}`
                : `将以下内容排版为卡片 HTML，只使用 <h3><p><strong><em><br> 标签，字字保留不改写。原文中 Markdown 标题用 <h3> 输出。${lineHint}\n\n${text}`;

        const tool = {
            type: 'function',
            function: {
                name: 'format_card_content',
                description: '输出格式化后的卡片 HTML',
                parameters: {
                    type: 'object',
                    properties: {
                        html: { type: 'string', description: 'HTML，只使用 <h3><p><strong><em><br> 标签，Markdown 标题用 <h3>' },
                    },
                    required: ['html'],
                },
            },
        };

        const result = await this._callLLM(provider, model, [{ role: 'user', content: prompt }], tool);
        if (!result.html) throw new Error('LLM 返回空结果');
        return this._postProcessLLMHtml(result.html);
    }

    async _beautifyPages(rawPages, tpl) {
        const pages = [];
        for (const pageHtml of rawPages) {
            pages.push(await this._highlightPageHtml(pageHtml, tpl));
        }
        return pages;
    }

    async _highlightPageHtml(html, tpl) {
        const provider = aiService.getFastProvider();
        const model = aiService.getFastModel();
        if (!provider?.apiKey || !model) throw new Error('未配置 AI');

        const clean = this._sanitizeRawForCard(html);
        const styleDesc = tpl.styleDesc || '';
        const layoutHint = tpl.layoutHint || '';

        const prompt = `以下是已分好页的卡片 HTML，请只加 <strong> 或 <em> 高亮标记，不要改变任何文字、结构或标签。

【规则】
- 禁止增加、删减或改写任何文字
- 禁止改变 <p><h3><br> 等结构，禁止新增 <p> 或 <br>
- 只允许在已有文字上套 <strong> 或 <em>${styleDesc ? `\n- 风格：${styleDesc}` : ''}${layoutHint ? `\n- 高亮侧重：${layoutHint}` : ''}

原 HTML：
${clean}`;

        const tool = {
            type: 'function',
            function: {
                name: 'highlight_card',
                description: '只加 strong/em 高亮，不改结构',
                parameters: {
                    type: 'object',
                    properties: {
                        html: { type: 'string', description: '加了 <strong>/<em> 的 HTML，结构与原始完全相同' },
                    },
                    required: ['html'],
                },
            },
        };

        const result = await this._callLLM(provider, model, [{ role: 'user', content: prompt }], tool);
        return result.html ? this._postProcessLLMHtml(result.html) : clean;
    }

    async _callLLM(provider, model, messages, tool) {
        const res = await aiProxyJsonRequest({
            method: 'POST',
            url: `${provider.baseUrl}/chat/completions`,
            apiKey: provider.apiKey,
            body: {
                model,
                messages,
                tools: [tool],
                tool_choice: { type: 'function', function: { name: tool.function.name } },
                max_tokens: 4096,
                temperature: 0.5,
            },
            timeoutMs: 30000,
        });

        if (res.status < 200 || res.status >= 300) {
            const errData = (() => { try { return JSON.parse(res.body || '{}'); } catch { return {}; } })();
            const errMsg = errData.error?.message || res.body || '';
            if (/tool|function/i.test(errMsg)) {
                throw new Error('当前模型不支持 Function Call，请切换支持工具调用的模型（如 GPT-4o、Claude 3.5、DeepSeek-V3 等）');
            }
            throw new Error(`API 错误 ${res.status}: ${errMsg}`);
        }

        const data = JSON.parse(res.body || '{}');
        const msg = data.choices?.[0]?.message;
        const toolCall = msg?.tool_calls?.find(tc => tc.function?.name === tool.function.name);

        if (toolCall) {
            try {
                return JSON.parse(toolCall.function.arguments || '{}');
            } catch {
                throw new Error('解析 Function Call 返回值失败');
            }
        }

        throw new Error('当前模型不支持 Function Call，请切换支持工具调用的模型（如 GPT-4o、Claude 3.5、DeepSeek-V3 等）');
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

    _sanitizeLLMHtml(html) {
        const div = document.createElement('div');
        div.innerHTML = this._normalizeHeadings(html);
        const allowed = new Set(['p', 'br', 'strong', 'em', 'span', 'h3', 'pre', 'code']);
        const walk = (node) => {
            for (const child of [...node.childNodes]) {
                if (child.nodeType !== Node.ELEMENT_NODE) continue;
                const tag = child.tagName.toLowerCase();
                if (allowed.has(tag)) {
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

    _sanitizeRawForCard(html) {
        if (!html) return '';
        const div = document.createElement('div');
        div.innerHTML = html;
        div.querySelectorAll('script, style, img, video, audio, iframe').forEach(el => el.remove());
        const kept = new Set(['p', 'br', 'strong', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
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

    _normalizeHeadings(html) {
        if (!html) return html;
        const div = document.createElement('div');
        div.innerHTML = html;
        div.querySelectorAll('h1, h2, h4, h5, h6').forEach(el => {
            const h3 = document.createElement('h3');
            h3.innerHTML = el.innerHTML;
            el.parentNode.replaceChild(h3, el);
        });
        return div.innerHTML;
    }

    _postProcessLLMHtml(html) {
        html = html.replace(/(?<![<\/\w])(\/?(?:em|strong|br|p))>/g, '<$1>');
        const div = document.createElement('div');
        div.innerHTML = html;
        const paras = [...div.querySelectorAll('p')];
        for (let i = 0; i < paras.length - 1; i++) {
            if (/^\d+\.\s*$/.test(paras[i].textContent.trim())) {
                paras[i].innerHTML = paras[i].textContent.trim() + ' ' + paras[i + 1].innerHTML;
                paras[i + 1].remove();
            }
        }
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
