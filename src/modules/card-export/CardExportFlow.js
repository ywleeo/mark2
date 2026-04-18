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

    // 合并 LLM 生成的独立数字行（如 <p>2.</p><p>内容</p> → <p>2. 内容</p>）
    // 并去掉 HTML 前面的非标签说明文字
    _postProcessLLMHtml(html) {
        // 修复 LLM 偶发的漏 < 问题，如 em> → <em>、/strong> → </strong>
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
        item.textEl.style.textWrap = '';

        requestAnimationFrame(() => {
            const contentH = item.textEl.scrollHeight;
            if (maxH && contentH > 0 && contentH < maxH * 0.55) {
                let finalSize = Math.min(baseSize * ((maxH * 0.72) / contentH), 36);
                item.textEl.style.fontSize = `${finalSize.toFixed(1)}px`;

                // 折行增多可能导致实际高度超出，按比例缩回
                const scaledH = item.textEl.scrollHeight;
                if (scaledH > maxH) {
                    finalSize = finalSize * (maxH * 0.92 / scaledH);
                    item.textEl.style.fontSize = `${finalSize.toFixed(1)}px`;
                }

                if (finalSize > baseSize * 1.15) {
                    item.textEl.style.fontWeight = '600';
                }

                // 纯文本（无 <p>）放大后用 balance 均匀折行，避免孤字
                // 有 <p> 的内容靠 CSS p:only-child/pretty 规则处理，不在此干预
                if (!item.textEl.querySelector('p') && finalSize > baseSize * 1.2) {
                    item.textEl.style.textWrap = 'balance';
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
            item.textEl.classList.add('is-ai-formatted');
            item.state = 'done';
            item.root.classList.remove('is-active');
            item.root.classList.add('is-done');
            this._applyFontScale(item);
        } catch (err) {
            console.warn('[CardExportFlow] LLM 处理失败', err);
            item.state = 'error';
            item.root.classList.remove('is-active');
            item.errorEl.querySelector('span:first-child').textContent = err?.message || 'AI 处理失败';
            item.errorEl.classList.remove('hidden');
        } finally {
            item.loadingEl.classList.add('hidden');
            this._aiBtn.disabled = false;
        }
    }

    async _formatWithLLM(text, tpl) {
        const provider = aiService.getFastProvider();
        const model = aiService.getFastModel();
        if (!provider?.apiKey || !model) throw new Error('未配置 AI');

        const naturalLines = text.trim().split('\n').filter(l => l.trim()).length;
        const isShort = naturalLines <= 2 && text.trim().length <= 80;
        const lineHint = tpl?.charsPerLine
            ? `\n\n【行宽限制】每行最多容纳约 ${tpl.charsPerLine} 个汉字（含标点、英文字母按半字宽计）。句子超过此长度时，务必主动在语义完整处用 <br> 断行，禁止依赖浏览器自动折行。`
            : '';
        const prompt = isShort
            ? `将以下文字重新排版为卡片 HTML，让它在视觉上更有节奏感。只使用 <p><strong><em><br> 标签。禁止添加、删减或改写任何文字。主动在语义完整的词语或短语边界处用 <br> 分行；用 <strong> 标记最重要的词，用 <em> 修饰意象或情绪词。\n\n${text}`
            : tpl?.llmPrompt
                ? `${tpl.llmPrompt}${lineHint}\n\n原文：\n${text}`
                : `请将以下内容整理为适合图片卡片的简洁文案，使用 <p><strong><em><br> 标签排版，不超过150字。${lineHint}\n\n${text}`;

        let content = await this._callLLM(provider, model, [{ role: 'user', content: prompt }]);
        content = this._postProcessLLMHtml(content);

        if (tpl?.maxLines) {
            const actual = (content.match(/<p/gi) || []).length;
            if (actual > tpl.maxLines) {
                const retryPrompt = `以下卡片文案共 ${actual} 行（每个 <p> 算一行），超过了上限 ${tpl.maxLines} 行。请在保持语义完整、内容连贯的前提下，压缩为不超过 ${tpl.maxLines} 行。\n\n${content}`;
                content = await this._callLLM(provider, model, [{ role: 'user', content: retryPrompt }]);
                content = this._postProcessLLMHtml(content);
            }
        }

        return content;
    }

    async _callLLM(provider, model, messages) {
        const tool = {
            type: 'function',
            function: {
                name: 'format_card_content',
                description: '输出格式化后的卡片 HTML',
                parameters: {
                    type: 'object',
                    properties: {
                        html: { type: 'string', description: '格式化后的 HTML，只使用 <p><strong><em><br> 标签' },
                    },
                    required: ['html'],
                },
            },
        };

        const res = await aiProxyJsonRequest({
            method: 'POST',
            url: `${provider.baseUrl}/chat/completions`,
            apiKey: provider.apiKey,
            body: {
                model,
                messages,
                tools: [tool],
                tool_choice: { type: 'function', function: { name: 'format_card_content' } },
                max_tokens: 4096,
                temperature: 0.5,
            },
            timeoutMs: 30000,
        });

        if (res.status < 200 || res.status >= 300) {
            const errData = (() => { try { return JSON.parse(res.body || '{}'); } catch { return {}; } })();
            const errMsg = errData.error?.message || res.body || '';
            if (/tool|function/i.test(errMsg)) {
                throw new Error('当前模型不支持 Function Call，请在 AI 设置中切换支持工具调用的模型（如 GPT-4o、Claude 3.5、DeepSeek-V3 等）');
            }
            throw new Error(`API 错误 ${res.status}: ${errMsg}`);
        }

        const data = JSON.parse(res.body || '{}');
        const msg = data.choices?.[0]?.message;
        const toolCall = msg?.tool_calls?.find(tc => tc.function?.name === 'format_card_content');

        if (toolCall) {
            try {
                const args = JSON.parse(toolCall.function.arguments || '{}');
                const html = args.html?.trim();
                if (html) return html;
            } catch {
                throw new Error('解析 Function Call 返回值失败');
            }
        }

        // tool_calls 缺失 → 模型忽略了 tool_choice，不支持工具调用
        throw new Error('当前模型不支持 Function Call，请在 AI 设置中切换支持工具调用的模型（如 GPT-4o、Claude 3.5、DeepSeek-V3 等）');
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
