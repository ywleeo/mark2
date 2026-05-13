/**
 * 在 markdown 代码块右上角加一个"对齐"按钮：让 AI 按等宽字体规则
 * （CJK 字符宽度 = 2 倍 ASCII 字符宽度）重新调整 ASCII 字符画的对齐。
 * 替换原 code block 内的文本内容，不改变 language（仍是 ASCII，不是 mermaid）。
 */

import { addClickHandler } from '../utils/PointerHelper.js';
import { aiService } from '../modules/ai-assistant/aiService.js';
import { startAiProxyStream } from '../api/aiProxy.js';
import { renderFlowchart } from './asciiFlowchart/render.js';

// 对齐图标：几条对齐的横线
const ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line class="l1" x1="3" y1="6" x2="21" y2="6"/><line class="l2" x1="3" y1="12" x2="15" y2="12"/><line class="l3" x1="3" y1="18" x2="18" y2="18"/></svg>';

const SYSTEM_PROMPT = `你是流程图结构识别专家。用户提供一段 ASCII 字符画流程图（可能字符位置错乱），你的任务是**识别其结构**并输出 JSON。

**只输出 JSON 本身**，不要 \`\`\` 包裹，不要任何解释文字。

JSON schema：

\`\`\`
{
  "direction": "TD",
  "nodes": [
    {
      "id": "n1",                          // 任意唯一字符串
      "text": ["第一行", "第二行"],          // 节点内文字（数组每个元素是一行）
      "boxed": true,                       // 是否带 ┌─┐ 框（原图有方框的设 true，纯文字的设 false）
      "side_note": "← 易激惹度上升"          // 可选：节点右侧附注（不带框，仅水平指向）
    }
  ],
  "edges": [
    { "from": "n1", "to": "n2", "label": "脱颗粒" }   // label 可选
  ]
}
\`\`\`

**识别规则**：
- 矩形框（┌─┐│└─┘ 或 +-| 形式）= boxed: true 的节点
- 纯文字段落、列表式短词 = boxed: false 的节点
- 节点内多行文字保持原顺序
- 边的方向按原图箭头/线条走向
- 边上短文字（如"脱颗粒"、"产生 > 降解"）= edge.label
- 节点右侧的水平箭头注释（如"← 易激惹度上升"）= node.side_note，不算独立节点

**严禁**：
- 不要尝试重画 ASCII，只输出 JSON
- 不要增减节点或边
- 节点 id 任意但必须唯一`;

const HIDE_DELAY = 140;
const BUTTON_SIZE = 28;
const BUTTON_OFFSET = 8;
const COPY_BUTTON_SLOT = BUTTON_SIZE + BUTTON_OFFSET;

export class AlignAsciiArtManager {
    constructor(containerElement, editor) {
        this.element = containerElement;
        this.editor = editor;
        this.button = null;
        this.activeTarget = null;
        this.hideTimer = null;
        this.observer = null;
        this.listeners = new Map();
        this.busy = false;
        this.clickCleanup = null;
        this._scrollHandler = () => this._reposition();

        this._startObserver();
    }

    _startObserver() {
        if (!this.element || typeof MutationObserver === 'undefined') return;
        this.observer = new MutationObserver((mutations) => {
            for (const m of mutations) {
                for (const n of m.addedNodes) {
                    if (n.nodeType !== 1) continue;
                    if (n.nodeName === 'PRE') this._attach(n);
                    else if (n.querySelectorAll) {
                        n.querySelectorAll('pre').forEach((p) => this._attach(p));
                    }
                }
                for (const n of m.removedNodes) {
                    if (n.nodeType !== 1) continue;
                    if (n.nodeName === 'PRE') this._detach(n);
                    else if (n.querySelectorAll) {
                        n.querySelectorAll('pre').forEach((p) => this._detach(p));
                    }
                }
            }
        });
        this.observer.observe(this.element, { childList: true, subtree: true });
        this.element.querySelectorAll('pre').forEach((p) => this._attach(p));
    }

    _attach(pre) {
        if (this.listeners.has(pre)) return;
        this._ensureButton();
        const handlers = {
            enter: () => {
                if (!this._looksLikeFlowchart(pre)) return;
                this._show(pre);
            },
            leave: () => this._scheduleHide(),
        };
        pre.addEventListener('mouseenter', handlers.enter);
        pre.addEventListener('mouseleave', handlers.leave);
        this.listeners.set(pre, handlers);
    }

    /**
     * 判断 code block 是否像流程图：必须含有矩形框上角字符 ┌ 或 ┐ 或 +。
     * 单纯的树形列表（只用 ├ └ │）、缩进文本不算流程图，避免误触。
     */
    _looksLikeFlowchart(pre) {
        const codeEl = pre.querySelector('code');
        const text = codeEl?.textContent ?? '';
        if (!text) return false;
        // 上角框字符：Unicode 框线（┌ ┐）或 ASCII +
        if (/[┌┐╔╗]/.test(text)) return true;
        // ASCII 风格：同一行里有两个及以上 +，且周围有 - 或 |
        if (/\+[-=]+\+/.test(text)) return true;
        return false;
    }

    _detach(pre) {
        const h = this.listeners.get(pre);
        if (!h) return;
        pre.removeEventListener('mouseenter', h.enter);
        pre.removeEventListener('mouseleave', h.leave);
        this.listeners.delete(pre);
        if (this.activeTarget === pre) this._hide(true);
    }

    _ensureButton() {
        if (this.button || !this.element) return;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'align-ascii-button';
        btn.innerHTML = ICON;
        btn.setAttribute('title', 'AI 重新对齐 ASCII 字符画');
        btn.setAttribute('aria-label', 'AI 重新对齐 ASCII 字符画');
        btn.addEventListener('mouseenter', () => this._cancelHide());
        btn.addEventListener('mouseleave', () => this._scheduleHide());
        this.clickCleanup = addClickHandler(btn, () => this._handleClick(), { preventDefault: true });

        if (getComputedStyle(this.element).position === 'static') {
            this.element.style.position = 'relative';
        }
        this.element.appendChild(btn);
        this.button = btn;

        if (typeof window !== 'undefined') {
            window.addEventListener('scroll', this._scrollHandler, true);
            window.addEventListener('resize', this._scrollHandler);
        }
    }

    _show(pre) {
        if (!this.button) return;
        this._cancelHide();
        this.activeTarget = pre;
        this._reposition();
        this.button.classList.add('is-visible');
    }

    _reposition() {
        if (!this.button || !this.activeTarget) return;
        const pre = this.activeTarget;
        if (!pre.isConnected) { this._hide(true); return; }
        const preRect = pre.getBoundingClientRect();
        const containerRect = this.element.getBoundingClientRect();
        const top = preRect.top - containerRect.top + this.element.scrollTop + BUTTON_OFFSET;
        // 放在 copy 按钮的左边
        const left = preRect.right - containerRect.left - COPY_BUTTON_SLOT - BUTTON_OFFSET - BUTTON_SIZE;
        this.button.style.top = `${top}px`;
        this.button.style.left = `${left}px`;
    }

    _hide(immediate = false) {
        if (!this.button) return;
        this.button.classList.remove('is-visible', 'is-error');
        if (immediate) {
            this.button.style.top = '-9999px';
            this.button.style.left = '-9999px';
        }
        this.activeTarget = null;
    }

    _scheduleHide(delay = HIDE_DELAY) {
        this._cancelHide();
        this.hideTimer = setTimeout(() => {
            if (this.button?.matches(':hover')) return;
            this._hide();
        }, delay);
    }

    _cancelHide() {
        if (this.hideTimer) {
            clearTimeout(this.hideTimer);
            this.hideTimer = null;
        }
    }

    async _handleClick() {
        if (this.busy) return;
        const pre = this.activeTarget;
        if (!pre) return;
        const codeEl = pre.querySelector('code');
        const text = (codeEl?.textContent ?? '').replace(/​/g, '');
        if (!text.trim()) return;

        this.busy = true;
        this.button.classList.add('is-busy');

        try {
            let raw = await this._callAiStream(text);
            console.log('[alignAsciiArt] AI raw length:', raw.length);
            raw = raw.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
            if (!raw) throw new Error('AI 返回为空');

            // 容错：从字符串里捞出第一个 { 到最后一个 } 的部分
            const firstBrace = raw.indexOf('{');
            const lastBrace = raw.lastIndexOf('}');
            if (firstBrace < 0 || lastBrace <= firstBrace) throw new Error('AI 返回不是 JSON');
            const jsonStr = raw.slice(firstBrace, lastBrace + 1);

            let spec;
            try {
                spec = JSON.parse(jsonStr);
            } catch (e) {
                console.error('[alignAsciiArt] JSON parse failed, raw:', jsonStr);
                throw new Error('AI 返回的 JSON 解析失败');
            }
            console.log('[alignAsciiArt] parsed spec:', spec);

            const aligned = renderFlowchart(spec);
            console.log('[alignAsciiArt] rendered:\n' + aligned);
            this._replaceCodeBlockText(pre, aligned);
            this._hide(true);
        } catch (err) {
            console.error('[alignAsciiArt] failed:', err);
            this.button?.classList.add('is-error');
            setTimeout(() => this.button?.classList.remove('is-error'), 2000);
        } finally {
            this.busy = false;
            this.button?.classList.remove('is-busy');
        }
    }

    _callAiStream(text) {
        const baseUrl = aiService.getActiveBaseUrl();
        const apiKey = aiService.getActiveApiKey();
        const model = aiService.getActiveModel();
        if (!apiKey) return Promise.reject(new Error('AI 未配置'));

        return new Promise((resolve, reject) => {
            let buffer = '';
            let firstChunkAt = null;
            const t0 = performance.now();
            const requestId = `align-${Date.now()}`;
            let cleanup = null;

            const finish = (err) => {
                if (cleanup) { try { cleanup(); } catch (_) {} cleanup = null; }
                if (err) reject(err);
                else resolve(buffer.trim());
            };

            startAiProxyStream({
                requestId,
                url: `${baseUrl}/chat/completions`,
                apiKey,
                body: {
                    model,
                    messages: [
                        { role: 'system', content: SYSTEM_PROMPT },
                        { role: 'user', content: text },
                    ],
                    temperature: 0.2,
                    stream: true,
                    enable_thinking: false,
                    reasoning_effort: 'low',
                },
                onChunk: (chunk) => {
                    if (firstChunkAt == null) {
                        firstChunkAt = performance.now();
                        console.log(`[alignAsciiArt] first chunk at ${Math.round(firstChunkAt - t0)}ms`);
                    }
                    for (const line of chunk.split('\n')) {
                        const l = line.trim();
                        if (!l.startsWith('data:')) continue;
                        const data = l.slice(5).trim();
                        if (!data || data === '[DONE]') continue;
                        try {
                            const j = JSON.parse(data);
                            const delta = j.choices?.[0]?.delta?.content;
                            if (delta) buffer += delta;
                        } catch (_) { /* ignore parse error */ }
                    }
                },
                onError: (msg) => {
                    console.error('[alignAsciiArt] stream error:', msg);
                    finish(new Error(msg || 'stream error'));
                },
                onEnd: () => {
                    console.log(`[alignAsciiArt] stream end, total ${Math.round(performance.now() - t0)}ms, buffer length ${buffer.length}`);
                    finish();
                },
            }).then((c) => { cleanup = c; }).catch((e) => finish(e));
        });
    }

    _replaceCodeBlockText(pre, newText) {
        if (!this.editor) return;
        const view = this.editor.view;
        const pos = view.posAtDOM(pre, 0);
        if (pos == null || pos < 0) return;
        const $pos = view.state.doc.resolve(pos);
        let from, to;
        for (let depth = $pos.depth; depth > 0; depth--) {
            const node = $pos.node(depth);
            if (node?.type?.name === 'codeBlock') {
                from = $pos.start(depth);  // codeBlock 内部内容开始
                to = $pos.end(depth);      // codeBlock 内部内容结束
                break;
            }
        }
        if (from == null) return;
        const schema = view.state.schema;
        const textNode = newText.length > 0 ? schema.text(newText) : null;
        const tr = textNode
            ? view.state.tr.replaceWith(from, to, textNode)
            : view.state.tr.delete(from, to);
        view.dispatch(tr);
    }

    destroy() {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
        this._cancelHide();
        for (const [pre, h] of this.listeners) {
            pre.removeEventListener('mouseenter', h.enter);
            pre.removeEventListener('mouseleave', h.leave);
        }
        this.listeners.clear();
        if (this.clickCleanup) { this.clickCleanup(); this.clickCleanup = null; }
        if (this.button) {
            this.button.remove();
            this.button = null;
        }
        if (typeof window !== 'undefined') {
            window.removeEventListener('scroll', this._scrollHandler, true);
            window.removeEventListener('resize', this._scrollHandler);
        }
    }
}
