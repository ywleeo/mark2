import { save, message } from '@tauri-apps/plugin-dialog';
import { captureScreenshot } from '../../api/native.js';
import { buildDefaultCardImagePath } from '../../utils/exportUtils.js';
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
    }

    mount() {
        const el = document.createElement('div');
        el.className = 'card-export-flow hidden';
        el.innerHTML = `
            <div class="card-export-flow__backdrop"></div>
            <div class="card-export-flow__panel">
                <div class="card-export-flow__header">
                    <span class="card-export-flow__title">${t('cardExport.title')}</span>
                    <div class="card-export-flow__header-actions">
                        <button type="button" class="card-export-flow__ai-btn" aria-label="AI 美化" disabled>
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                                <path d="M8 2l1.2 3.5L13 7l-3.8 1.5L8 12l-1.2-3.5L3 7l3.8-1.5Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
                                <path d="M13 11l.6 1.4 1.4.6-1.4.6L13 15l-.6-1.4-1.4-.6 1.4-.6Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
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
                </div>
                <div class="card-export-flow__strip"></div>
            </div>
        `;
        this.element = el;
        this.stripEl = el.querySelector('.card-export-flow__strip');
        this._aiBtn = el.querySelector('.card-export-flow__ai-btn');
        this._exportBtn = el.querySelector('.card-export-flow__export-btn');

        CARD_TEMPLATES.forEach(tpl => {
            const item = this._buildItem(tpl);
            this.items.push(item);
            this.stripEl.appendChild(item.root);
        });

        document.body.appendChild(el);

        const onKeydown = (e) => { if (e.key === 'Escape') this.hide(); };
        window.addEventListener('keydown', onKeydown);

        this._cleanups.push(
            addClickHandler(el.querySelector('.card-export-flow__ai-btn'), () => {
                if (this._selectedItem) this._triggerAI(this._selectedItem);
            }),
            addClickHandler(el.querySelector('.card-export-flow__export-btn'), () => {
                if (this._selectedItem) this._handleExport(this._selectedItem);
            }),
            addClickHandler(el.querySelector('.card-export-flow__close'), () => this.hide()),
            addClickHandler(el.querySelector('.card-export-flow__backdrop'), () => this.hide()),
            () => window.removeEventListener('keydown', onKeydown),
        );
    }

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
        loadingEl.innerHTML = `<div class="card-export-flow__spinner"></div><span>AI 美化中…</span>`;
        previewWrap.appendChild(loadingEl);

        const errorEl = document.createElement('div');
        errorEl.className = 'card-export-flow__item-error hidden';
        errorEl.innerHTML = `<span>AI 处理失败</span><span class="card-export-flow__item-retry">点击重试</span>`;
        previewWrap.appendChild(errorEl);

        root.appendChild(previewWrap);

        const item = {
            tpl, root, previewWrap, cardEl, loadingEl, errorEl,
            textEl: cardEl.querySelector('.card-preview-card__content'),
            state: 'idle', // idle | processing | done | error
        };

        this._cleanups.push(
            addClickHandler(previewWrap, () => this._handleCardClick(item)),
        );

        return item;
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

    open({ text, html }) {
        this._selectedText = text;
        this._selectedHtml = html;
        this._selectedItem = null;

        this._exportBtn.disabled = true;
        this._aiBtn.disabled = true;

        this.items.forEach(item => {
            item.state = 'idle';
            item.root.classList.remove('is-active', 'is-done', 'is-selected', 'has-overflow');
            item.loadingEl.classList.add('hidden');
            item.errorEl.classList.add('hidden');
            item.textEl.style.fontSize = '';
            item.textEl.style.fontWeight = '';
            if (html) {
                item.textEl.innerHTML = this._sanitizeRaw(html);
            } else {
                item.textEl.textContent = text;
            }
            this._applySmartLayout(item);
            requestAnimationFrame(() => {
                const overflows = item.tpl.contentMaxHeight
                    && item.textEl.scrollHeight > item.tpl.contentMaxHeight;
                item.root.classList.toggle('has-overflow', !!overflows);
            });
        });

        this.element.classList.remove('hidden');
    }

    hide() {
        this.element?.classList.add('hidden');
    }

    _selectItem(item) {
        this._selectedItem = item;
        this.items.forEach(i => i.root.classList.toggle('is-selected', i === item));
        this._exportBtn.disabled = false;
        // AI 按钮：仅当没有卡片正在 processing 时才 enable
        const anyProcessing = this.items.some(i => i.state === 'processing');
        this._aiBtn.disabled = anyProcessing;
    }

    // 对编辑器选区 HTML 做基础清理（保留结构，去掉危险属性）
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

    // 对 LLM 输出的 HTML 做严格白名单过滤
    _sanitizeLLMHtml(html) {
        const div = document.createElement('div');
        div.innerHTML = html;
        const allowed = new Set(['p', 'br', 'strong', 'em', 'span']);
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

    _applySmartLayout(item) {
        const body = item.cardEl.querySelector('.card-preview-card__body');
        if (body) body.style.justifyContent = 'center';
    }

    // LLM 处理后：内容过少则放大字号填满画面，再做垂直对齐
    _applyFontScale(item) {
        const maxH = item.tpl.contentMaxHeight;
        const baseSize = item.tpl.baseFontSize || 13.5;
        item.textEl.style.fontSize = '';
        item.textEl.style.fontWeight = '';

        requestAnimationFrame(() => {
            const contentH = item.textEl.scrollHeight;
            if (maxH && contentH > 0 && contentH < maxH * 0.55) {
                const finalSize = Math.min(baseSize * ((maxH * 0.72) / contentH), 36);
                item.textEl.style.fontSize = `${finalSize.toFixed(1)}px`;
                if (finalSize > baseSize * 1.15) {
                    item.textEl.style.fontWeight = '600';
                }
            }
            this._applySmartLayout(item);
        });
    }

    _handleCardClick(item) {
        this._selectItem(item);
    }

    async _triggerAI(item) {
        if (item.state === 'processing') return;

        item.state = 'processing';
        item.root.classList.add('is-active');
        item.loadingEl.classList.remove('hidden');
        item.errorEl.classList.add('hidden');

        this._aiBtn.disabled = true;

        try {
            const html = await this._formatWithLLM(this._selectedText, item.tpl);
            item.textEl.innerHTML = this._sanitizeLLMHtml(html);
            item.state = 'done';
            item.root.classList.remove('is-active');
            item.root.classList.add('is-done');
            this._applyFontScale(item);
        } catch (err) {
            console.warn('[CardExportFlow] LLM 处理失败', err);
            item.state = 'error';
            item.root.classList.remove('is-active');
            item.errorEl.classList.remove('hidden');
        } finally {
            item.loadingEl.classList.add('hidden');
            this._aiBtn.disabled = false;
        }
    }

    async _formatWithLLM(text, tpl) {
        const provider = aiService.getActiveProvider();
        const model = aiService.getActiveModel();
        if (!provider?.apiKey || !model) throw new Error('未配置 AI');

        const prompt = tpl?.llmPrompt
            ? `${tpl.llmPrompt}\n\n原文：\n${text}`
            : `请将以下内容整理为适合图片卡片的简洁文案，输出 HTML，只使用 <p><strong><em><br> 标签，不超过150字：\n\n${text}`;

        let content = await this._callLLM(provider, model, [{ role: 'user', content: prompt }]);

        // 超行时让 LLM 自己压缩，保持语义完整
        if (tpl?.maxLines) {
            const actual = (content.match(/<p/gi) || []).length;
            if (actual > tpl.maxLines) {
                const retryPrompt = `以下卡片文案共 ${actual} 行（每个 <p> 算一行），超过了上限 ${tpl.maxLines} 行。请在保持语义完整、内容连贯的前提下，压缩为不超过 ${tpl.maxLines} 行。只输出 HTML，不加任何说明。\n\n${content}`;
                content = await this._callLLM(provider, model, [{ role: 'user', content: retryPrompt }]);
            }
        }

        return content;
    }

    async _callLLM(provider, model, messages) {
        const res = await aiProxyJsonRequest({
            method: 'POST',
            url: `${provider.baseUrl}/chat/completions`,
            apiKey: provider.apiKey,
            body: { model, messages, max_tokens: 4096, temperature: 0.5 },
            timeoutMs: 30000,
        });

        if (res.status < 200 || res.status >= 300) {
            throw new Error(`API 错误 ${res.status}: ${res.body}`);
        }

        const data = JSON.parse(res.body || '{}');
        const msg = data.choices?.[0]?.message || {};
        let content = msg.content?.trim() || '';

        if (!content && msg.reasoning_content) {
            const match = msg.reasoning_content.match(/(<(?:p|strong|em|br)[^>]*>[\s\S]+)/i);
            content = match?.[1]?.trim() || '';
        }

        if (!content) throw new Error('LLM 返回空结果');
        return content.replace(/^```(?:html)?\s*/i, '').replace(/\s*```$/, '').trim();
    }

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
                cardTextElement: item.textEl,
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
