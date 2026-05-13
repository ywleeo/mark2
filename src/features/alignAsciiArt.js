/**
 * 在 markdown 代码块右上角加一个按钮：让 AI 识别 ASCII 流程图结构，
 * 客户端把 JSON spec 转成 mermaid 代码，替换 code block 为 mermaidBlock 节点
 * 由现成的 mermaid 渲染器接管展示。
 */

import { addClickHandler } from '../utils/PointerHelper.js';
import { aiService } from '../modules/ai-assistant/aiService.js';
import { startAiProxyStream } from '../api/aiProxy.js';
import { renderMermaidIn } from '../utils/mermaidRenderer.js';
import { closeHistory } from '@tiptap/pm/history';

// 图标：几条带对齐感的横线（沿用之前的"整理"图标）
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

**分叉点的关键规则**：父节点分出多个分支时，每条分支线上常常带一段短文字（比较表达式、状态名等），**紧接着才到下一个真正的子节点**。这段短文字是 **edge.label**，绝不是独立节点。识别信号：

\`\`\`
   ┌─父─┐
   └─┬─┘
     │
  ┌──┼──┐
  │  │  │
  A  B  C    ← 这一行是 edge.label（短文字 + 单入单出连接到下方节点）
  │  │  │
  ▽  ▽  ▽
  X  Y  Z    ← 这一行才是真正的子节点
\`\`\`

错误输出（多了 3 个空节点 A/B/C）：
\`{from:父,to:A},{from:A,to:X},{from:父,to:B},{from:B,to:Y}…\`

正确输出（A/B/C 是 label）：
\`{from:父,to:X,label:"A"},{from:父,to:Y,label:"B"},{from:父,to:Z,label:"C"}\`

判断标准：如果一行的多个短文字（≤6 字符或含 \`>/<\`/\`=\` 等符号）下方还各自连着一个真节点，**那些短文字必定是 edge.label**。

**严禁**：
- 不要尝试重画 ASCII，只输出 JSON
- 不要增减节点或边（label 不算节点）
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
        btn.setAttribute('title', 'AI 转 Mermaid 流程图');
        btn.setAttribute('aria-label', 'AI 转 Mermaid 流程图');
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

            // fallback：如果 AI 把"父→A→子"这种分叉 label 错认成节点，自动消解
            spec = collapseLabelNodes(spec);

            const mermaid = specToMermaid(spec);
            console.log('[alignAsciiArt] mermaid:\n' + mermaid);
            this._replaceWithMermaidBlock(pre, mermaid);
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
            // SSE 跨 chunk 缓冲：chunk 不保证以 \n 结尾，必须把残行留到下一次再拼
            let sseBuffer = '';
            let firstChunkAt = null;
            const t0 = performance.now();
            const requestId = `align-${Date.now()}`;
            let cleanup = null;

            const finish = (err) => {
                if (cleanup) { try { cleanup(); } catch (_) {} cleanup = null; }
                if (err) reject(err);
                else resolve(buffer.trim());
            };

            const processLine = (line) => {
                const l = line.trim();
                if (!l.startsWith('data:')) return;
                const data = l.slice(5).trim();
                if (!data || data === '[DONE]') return;
                try {
                    const j = JSON.parse(data);
                    const delta = j.choices?.[0]?.delta?.content;
                    if (delta) buffer += delta;
                } catch (_) { /* ignore parse error */ }
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
                    sseBuffer += chunk;
                    const lines = sseBuffer.split('\n');
                    // 最后一段可能是不完整的，留到下次再拼
                    sseBuffer = lines.pop() ?? '';
                    for (const line of lines) processLine(line);
                },
                onError: (msg) => {
                    console.error('[alignAsciiArt] stream error:', msg);
                    finish(new Error(msg || 'stream error'));
                },
                onEnd: () => {
                    // 流结束时把残留的最后一行处理掉（避免最后一条 SSE 没换行被丢）
                    if (sseBuffer) {
                        processLine(sseBuffer);
                        sseBuffer = '';
                    }
                    console.log(`[alignAsciiArt] stream end, total ${Math.round(performance.now() - t0)}ms, buffer length ${buffer.length}`);
                    finish();
                },
            }).then((c) => { cleanup = c; }).catch((e) => finish(e));
        });
    }

    /**
     * 把整个 codeBlock 节点替换成 mermaidBlock 节点。
     * mermaidBlock 是 atom，code 放在 attrs.code 里，由 MermaidNodeView 渲染。
     */
    _replaceWithMermaidBlock(pre, mermaidCode) {
        if (!this.editor) return;
        const view = this.editor.view;
        const schema = view.state.schema;
        const pos = view.posAtDOM(pre, 0);
        if (pos == null || pos < 0) return;
        const $pos = view.state.doc.resolve(pos);
        let blockPos = -1;
        let blockNode = null;
        for (let depth = $pos.depth; depth > 0; depth--) {
            const node = $pos.node(depth);
            if (node?.type?.name === 'codeBlock') {
                blockPos = $pos.before(depth);
                blockNode = node;
                break;
            }
        }
        if (blockPos < 0 || !blockNode) return;
        const mermaidType = schema.nodes.mermaidBlock;
        if (mermaidType) {
            const mermaidNode = mermaidType.create({ code: mermaidCode });
            let tr = view.state.tr.replaceWith(blockPos, blockPos + blockNode.nodeSize, mermaidNode);
            // 强制本次 transaction 单独成为一个 undo group，避免和前后操作合并（连点两次按钮 cmd+z 一次撤销两个的问题）
            tr = closeHistory(tr);
            view.dispatch(tr);
            // 触发 mermaid 渲染：把刚插入的 <div class="mermaid"> 转成 SVG
            requestAnimationFrame(() => {
                renderMermaidIn(this.element).catch(e => console.warn('[alignAsciiArt] mermaid render failed:', e));
            });
            return;
        }
        // fallback：schema 没有 mermaidBlock，退化为改 codeBlock.language=mermaid + 替换内容
        const textNode = mermaidCode.length > 0 ? schema.text(mermaidCode) : null;
        const innerFrom = blockPos + 1;
        const innerTo = blockPos + blockNode.nodeSize - 1;
        let tr = textNode
            ? view.state.tr.replaceWith(innerFrom, innerTo, textNode)
            : view.state.tr.delete(innerFrom, innerTo);
        tr = tr.setNodeMarkup(blockPos, null, { ...blockNode.attrs, language: 'mermaid' });
        tr = closeHistory(tr);
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

/**
 * 把 spec JSON 转成 mermaid flowchart 代码。
 * boxed: true → 矩形 `[text]`；boxed: false → 圆角 `(text)`；
 * side_note → 单独节点，用虚线连接；edge.label → `-->|label|` 标注。
 */
function specToMermaid(spec) {
    const lines = ['flowchart TD'];
    const sanitizeId = (id) => {
        const s = String(id || '').replace(/[^a-zA-Z0-9_]/g, '_');
        return s || 'n';
    };
    const escapeText = (s) => String(s || '').replace(/"/g, '#quot;').replace(/\n/g, '<br/>');
    const formatNodeText = (textArr) => {
        const arr = Array.isArray(textArr) ? textArr : [String(textArr || '')];
        return arr.map(l => escapeText(String(l || ''))).join('<br/>');
    };

    // 节点 id 可能冲突（sanitize 后）——加序号兜底
    const usedIds = new Set();
    const idMap = {};
    for (const node of spec.nodes || []) {
        let id = sanitizeId(node.id);
        let i = 1;
        while (usedIds.has(id)) id = sanitizeId(node.id) + '_' + (++i);
        usedIds.add(id);
        idMap[node.id] = id;
    }

    for (const node of spec.nodes || []) {
        const id = idMap[node.id];
        const text = formatNodeText(node.text);
        const shape = node.boxed !== false ? `["${text}"]` : `("${text}")`;
        lines.push(`    ${id}${shape}`);
        if (node.side_note) {
            const noteId = `${id}_note`;
            const noteText = escapeText(String(node.side_note).replace(/^[←→]\s*/, '').trim());
            if (noteText) {
                lines.push(`    ${noteId}["${noteText}"]`);
                lines.push(`    ${id} -.- ${noteId}`);
            }
        }
    }

    for (const edge of spec.edges || []) {
        const from = idMap[edge.from];
        const to = idMap[edge.to];
        if (!from || !to) continue;
        if (edge.label) {
            lines.push(`    ${from} -->|"${escapeText(edge.label)}"| ${to}`);
        } else {
            lines.push(`    ${from} --> ${to}`);
        }
    }

    return lines.join('\n');
}

/**
 * 后处理：消解被错认成节点的 edge label。
 * 触发条件：一个父节点的"所有"出边子节点都是 boxed:false + 单入单出 + 自己也有出边
 * → 这些"子"实际是 label，把它们 collapse 到父→孙的 edge.label 上。
 *
 * 例如 AI 错误地输出：父→A→X，父→B→Y，父→C→Z（A/B/C 都是 boxed:false 单入单出）
 * 修正为：父→X(label:A)，父→Y(label:B)，父→Z(label:C)
 */
function collapseLabelNodes(spec) {
    if (!spec || !Array.isArray(spec.nodes) || !Array.isArray(spec.edges)) return spec;
    const incoming = {};
    const outgoing = {};
    for (const e of spec.edges) {
        (outgoing[e.from] ||= []).push(e);
        (incoming[e.to] ||= []).push(e);
    }
    const nodeMap = Object.fromEntries(spec.nodes.map(n => [n.id, n]));

    // 单入单出 + boxed:false + 自己有出边 = "中转 label 节点"特征
    const looksLikeLabel = (id) => {
        const n = nodeMap[id];
        if (!n || n.boxed !== false) return false;
        return (incoming[id]?.length === 1) && (outgoing[id]?.length === 1);
    };

    // 收集要 collapse 的节点：父节点的多个子节点全都是 label-like 才认定
    const toCollapse = new Set();
    for (const parent of spec.nodes) {
        const outs = outgoing[parent.id] || [];
        if (outs.length < 2) continue;
        if (outs.every(e => looksLikeLabel(e.to))) {
            for (const e of outs) toCollapse.add(e.to);
        }
    }

    if (toCollapse.size === 0) return spec;

    const labelText = (n) => Array.isArray(n.text) ? n.text.join(' ') : String(n.text || '');
    const newEdges = [];
    for (const e of spec.edges) {
        // 来自被消解节点的出边：跳过（已被入边吸收）
        if (toCollapse.has(e.from)) continue;
        // 指向被消解节点的入边：把目标改成被消解节点的孙节点，把被消解节点的文字塞进 label
        if (toCollapse.has(e.to)) {
            const mid = nodeMap[e.to];
            const out = outgoing[e.to][0];
            const lbl = labelText(mid);
            newEdges.push({
                from: e.from,
                to: out.to,
                label: e.label ? `${e.label} ${lbl}` : lbl,
            });
            continue;
        }
        newEdges.push(e);
    }

    return {
        ...spec,
        nodes: spec.nodes.filter(n => !toCollapse.has(n.id)),
        edges: newEdges,
    };
}
