/**
 * AI Agent Sidebar
 * 右侧 AI 助手面板，支持多轮对话 + 工具调用（读写文件、管理目录）
 */

import MarkdownIt from 'markdown-it';
import { aiService } from './aiService.js';
import { AgentLoop } from './AgentLoop.js';
import {
    getCloudProvider,
    listCloudProviders,
    subscribeRegistry,
} from './cloudProviderRegistry.js';
import { TOOL_DEFINITIONS, createToolExecutor } from './AgentTools.js';
import { addClickHandler } from '../../utils/PointerHelper.js';
import { basename } from '../../utils/pathUtils.js';
import { writeFile } from '../../api/filesystem.js';
import { untitledFileManager } from '../untitledFileManager.js';
import { t } from '../../i18n/index.js';
import { createStore } from '../../services/storage.js';

const store = createStore('ai');
store.migrateFrom('mark2_ai_sidebar_width_v1', 'sidebarWidth', { parse: (raw) => Number(raw) });
store.migrateFrom('mark2_ai_chat_history_v1', 'chatHistory');
store.migrateFrom('mark2_ai_agent_messages_v1', 'agentMessages');

const AGENT_MESSAGES_MAX_SIZE = 200_000; // localStorage 字符数上限

const AI_SIDEBAR_DEFAULT_WIDTH = 380;
const AI_SIDEBAR_MIN_WIDTH = 320;
const AI_SIDEBAR_MAX_WIDTH = 720;

// 轻量 markdown 渲染器，仅用于 AI 回复展示（不开 html，防 XSS）。
// 表格规则保持开启，但在渲染前会把“结构不合法的伪表格示例”降级成代码块，
// 避免解释 Markdown 语法时把坏表格示例误渲染成真正表格。
const md = new MarkdownIt({ html: false, linkify: true, typographer: false });

/**
 * 判断一行是否可能是 GFM 表格分隔线。
 * @param {string} line - 原始文本行
 * @returns {boolean} 是否是表格分隔线候选
 */
function isTableSeparatorLine(line) {
    const cells = splitTableCells(line);
    if (cells.length === 0) return false;
    return cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

/**
 * 按未转义的 `|` 拆分表格单元格，并忽略两端包裹用的竖线。
 * @param {string} line - 原始文本行
 * @returns {string[]} 单元格数组
 */
function splitTableCells(line) {
    const source = typeof line === 'string' ? line.trim() : '';
    if (!source.includes('|')) return [];

    let working = source;
    if (working.startsWith('|')) working = working.slice(1);
    if (working.endsWith('|')) working = working.slice(0, -1);

    const cells = [];
    let current = '';
    let escaped = false;
    for (const ch of working) {
        if (escaped) {
            current += ch;
            escaped = false;
            continue;
        }
        if (ch === '\\') {
            current += ch;
            escaped = true;
            continue;
        }
        if (ch === '|') {
            cells.push(current);
            current = '';
            continue;
        }
        current += ch;
    }
    cells.push(current);
    return cells;
}

/**
 * 判断一个候选表格块是否结构完整。
 * 要求 header / separator / body 的列数一致，且 separator 每列都是 `---` / `:---:` 形式。
 * @param {string[]} lines - 连续的候选表格行
 * @returns {boolean} 是否可作为真实表格渲染
 */
function isValidMarkdownTableBlock(lines) {
    if (!Array.isArray(lines) || lines.length < 2) return false;
    const headerCells = splitTableCells(lines[0]);
    const separatorCells = splitTableCells(lines[1]);
    if (headerCells.length === 0 || headerCells.length !== separatorCells.length) return false;
    if (!separatorCells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()))) return false;

    for (let i = 2; i < lines.length; i++) {
        const cells = splitTableCells(lines[i]);
        if (cells.length !== headerCells.length) return false;
    }
    return true;
}

/**
 * 预处理 AI 回复中的表格。
 * 合法表格保持原样；结构不合法但长得像表格的块改成 fenced code，保留用户想看的原始 Markdown。
 * @param {string} source - markdown 原文
 * @returns {string} 预处理后的 markdown
 */
function normalizeAiMarkdownTables(source) {
    const text = typeof source === 'string' ? source : '';
    if (!text.includes('|')) return text;

    const lines = text.split('\n');
    const output = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const nextLine = lines[i + 1] ?? '';
        const maybeTableStart = line.includes('|') && isTableSeparatorLine(nextLine);

        if (!maybeTableStart) {
            output.push(line);
            continue;
        }

        const block = [line, nextLine];
        i += 1;
        while (i + 1 < lines.length) {
            const candidate = lines[i + 1];
            if (!candidate.trim()) break;
            if (!candidate.includes('|')) break;
            block.push(candidate);
            i += 1;
        }

        if (isValidMarkdownTableBlock(block)) {
            output.push(...block);
        } else {
            output.push('```text', ...block, '```');
        }
    }

    return output.join('\n');
}

/**
 * 渲染 AI markdown。
 * @param {string} source - markdown 原文
 * @returns {string} 安全 HTML
 */
function renderAiMarkdown(source) {
    return md.render(normalizeAiMarkdownTables(source));
}

/**
 * 给 AI 消息中的代码块挂载复制按钮。
 * 作用域严格限制在 AI markdown 容器内，不复用编辑器的全局代码复制按钮。
 *
 * @param {HTMLElement | null | undefined} rootEl - AI markdown 容器
 */
function enhanceAiMarkdownCodeBlocks(rootEl) {
    if (!(rootEl instanceof HTMLElement)) {
        return;
    }

    rootEl.querySelectorAll('pre').forEach((pre) => {
        if (!(pre instanceof HTMLElement)) {
            return;
        }

        let wrap = pre.parentElement;
        if (!(wrap instanceof HTMLElement) || !wrap.classList.contains('ai-code-block-wrap')) {
            wrap = document.createElement('div');
            wrap.className = 'ai-code-block-wrap';
            pre.parentNode?.insertBefore(wrap, pre);
            wrap.appendChild(pre);
        }

        if (wrap.querySelector('.ai-code-copy-button')) {
            return;
        }

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'ai-code-copy-button';
        button.innerHTML = AI_COPY_ICON;
        button.setAttribute('aria-label', '复制代码块');
        button.setAttribute('title', '复制代码块');

        addClickHandler(button, () => {
            const codeEl = pre.querySelector('code');
            const text = (codeEl?.textContent || pre.textContent || '').trimEnd();
            navigator.clipboard.writeText(text).then(() => {
                button.innerHTML = AI_COPY_CHECK_ICON;
                button.classList.add('is-copied');
                setTimeout(() => {
                    button.innerHTML = AI_COPY_ICON;
                    button.classList.remove('is-copied');
                }, 1500);
            });
        });

        wrap.appendChild(button);
    });
}

// 工具标签（按 toolName 从 i18n 查词条，未定义则返回 undefined 让调用方回退到 toolName）
const TOOL_LABELS = new Proxy({}, {
    get(_, toolName) {
        const key = `ai.tool.${toolName}`;
        const val = t(key);
        return val === key ? undefined : val;
    },
});

// 工具执行中的状态文字
const TOOL_STATUS_RUNNING = new Proxy({}, {
    get(_, toolName) {
        const key = `ai.toolRunning.${toolName}`;
        const val = t(key);
        return val === key ? undefined : val;
    },
});

/**
 * 判断工具错误是否需要直接暴露给用户。
 * 默认将工具执行错误视为 agent 的内部尝试结果，仅当工具明确标记为需要用户介入
 * 或属于阻断性错误时，才在卡片上显示失败状态。
 *
 * @param {object} result - 工具执行结果
 * @returns {boolean} 是否需要展示错误
 */
function shouldShowToolError(result) {
    if (!result?.error) {
        return false;
    }
    return Boolean(result.userActionRequired || result.blocking || result.fatal);
}

/** 格式化工具执行耗时：< 1s → "< 1s"，否则 "1.2s" / "5s" / "1m 3s" */
function formatToolElapsed(startTime) {
    const ms = Date.now() - startTime;
    if (ms < 1000) return '< 1s';
    const sec = ms / 1000;
    if (sec < 10) return `${sec.toFixed(1)}s`;
    if (sec < 60) return `${Math.round(sec)}s`;
    const min = Math.floor(sec / 60);
    const rem = Math.round(sec % 60);
    return rem ? `${min}m ${rem}s` : `${min}m`;
}

// ── 简单行级 diff（LCS算法） ──────────────────────────────
function diffLines(oldText, newText) {
    const a = oldText.split('\n');
    const b = newText.split('\n');
    const m = a.length;
    const n = b.length;

    // LCS dp table
    const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            dp[i][j] = a[i - 1] === b[j - 1]
                ? dp[i - 1][j - 1] + 1
                : Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
    }

    // 回溯
    const result = [];
    let i = m, j = n;
    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
            result.unshift({ type: 'eq', value: a[i - 1] });
            i--; j--;
        } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
            result.unshift({ type: 'add', value: b[j - 1] });
            j--;
        } else {
            result.unshift({ type: 'del', value: a[i - 1] });
            i--;
        }
    }
    return result;
}

// ── 带上下文行的压缩 diff ──────────────────────────────────
function buildDiffChunks(diffResult, contextLines = 3) {
    const CONTEXT = contextLines;
    const changed = new Set();
    diffResult.forEach((line, idx) => {
        if (line.type !== 'eq') changed.add(idx);
    });

    const visible = new Set();
    changed.forEach((idx) => {
        for (let k = Math.max(0, idx - CONTEXT); k <= Math.min(diffResult.length - 1, idx + CONTEXT); k++) {
            visible.add(k);
        }
    });

    const chunks = [];
    let skipped = 0;
    for (let idx = 0; idx < diffResult.length; idx++) {
        if (visible.has(idx)) {
            if (skipped > 0) {
                chunks.push({ type: 'skip', count: skipped });
                skipped = 0;
            }
            chunks.push(diffResult[idx]);
        } else {
            skipped++;
        }
    }
    if (skipped > 0) chunks.push({ type: 'skip', count: skipped });
    return chunks;
}

/**
 * 解析 assistant 文本中的 think 标签。
 * 将 think 内容从正文中剥离出来，避免把标签原样渲染到消息正文。
 */
function extractThinkBlocks(text) {
    const source = typeof text === 'string' ? text : '';
    if (!source) {
        return { content: '', thinking: '' };
    }

    let content = '';
    let thinking = '';
    let cursor = 0;

    while (cursor < source.length) {
        const openIndex = source.indexOf('<think>', cursor);
        if (openIndex === -1) {
            content += source.slice(cursor);
            break;
        }

        content += source.slice(cursor, openIndex);
        const thinkingStart = openIndex + '<think>'.length;
        const closeIndex = source.indexOf('</think>', thinkingStart);

        if (closeIndex === -1) {
            thinking += source.slice(thinkingStart);
            break;
        }

        thinking += source.slice(thinkingStart, closeIndex);
        cursor = closeIndex + '</think>'.length;
    }

    return {
        content: content.trim(),
        thinking: thinking.trim(),
    };
}

/**
 * 合并显式推理流和正文中的 think 标签内容，尽量避免重复展示。
 */
function mergeThinkingText(streamThinking, inlineThinking) {
    const explicit = typeof streamThinking === 'string' ? streamThinking.trim() : '';
    const inline = typeof inlineThinking === 'string' ? inlineThinking.trim() : '';

    if (!explicit) {
        return inline;
    }
    if (!inline) {
        return explicit;
    }
    if (explicit === inline) {
        return explicit;
    }
    if (explicit.includes(inline)) {
        return explicit;
    }
    if (inline.includes(explicit)) {
        return inline;
    }
    return `${explicit}\n\n${inline}`;
}

/**
 * 约束 AI Sidebar 宽度，避免拖拽到不可用尺寸。
 * @param {number} width - 目标宽度
 * @returns {number} 合法宽度
 */
function clampSidebarWidth(width) {
    const numericWidth = Number(width);
    if (!Number.isFinite(numericWidth)) {
        return AI_SIDEBAR_DEFAULT_WIDTH;
    }
    return Math.min(AI_SIDEBAR_MAX_WIDTH, Math.max(AI_SIDEBAR_MIN_WIDTH, Math.round(numericWidth)));
}

/**
 * 从本地存储读取 AI Sidebar 宽度。
 * @returns {number} 上次保存的宽度
 */
function loadSidebarWidth() {
    return clampSidebarWidth(store.get('sidebarWidth', AI_SIDEBAR_DEFAULT_WIDTH));
}

/**
 * 持久化 AI Sidebar 宽度。
 * @param {number} width - 需要保存的宽度
 */
function saveSidebarWidth(width) {
    store.set('sidebarWidth', clampSidebarWidth(width));
}

// ── 聊天持久化 ──────────────────────────────────────────
function saveChatHistory(history) {
    store.set('chatHistory', history);
}

function loadChatHistory() {
    return store.get('chatHistory', []) || [];
}

function saveAgentMessages(messages) {
    try {
        const json = JSON.stringify(messages);
        if (json.length <= AGENT_MESSAGES_MAX_SIZE) {
            store.set('agentMessages', messages);
        } else {
            // 超限则丢弃 LLM 上下文,仅保留展示历史
            store.remove('agentMessages');
        }
    } catch { /* ignore */ }
}

function loadAgentMessages() {
    return store.get('agentMessages', []) || [];
}

function clearChatStorage() {
    store.remove('chatHistory');
    store.remove('agentMessages');
}

// ── 内联卡片：对话中的 assistant 消息 ────────────────────
class AssistantCard {
    constructor(listEl, { onDelete } = {}) {
        this.onDelete = onDelete;
        this.el = document.createElement('div');
        this.el.className = 'ai-message ai-message-assistant';
        this.el.innerHTML = `
            ${roleHeaderHTML('ai')}
            <div class="ai-message-thinking is-collapsed" style="display:none">
                <button class="ai-message-thinking-toggle" type="button">
                    <span>Thinking</span>
                    <span class="ai-thinking-expand">›</span>
                </button>
                <div class="ai-message-thinking-preview"></div>
                <div class="ai-message-thinking-full"></div>
            </div>
            <div class="ai-message-body"></div>
        `;
        listEl.appendChild(this.el);

        this.thinkingEl = this.el.querySelector('.ai-message-thinking');
        this.thinkingPreviewEl = this.el.querySelector('.ai-message-thinking-preview');
        this.thinkingFullEl = this.el.querySelector('.ai-message-thinking-full');
        this.thinkingToggleEl = this.el.querySelector('.ai-message-thinking-toggle');
        this.bodyEl = this.el.querySelector('.ai-message-body');
        this.toolCards = new Map(); // id -> {el, startTime, segment}
        this.toolGroup = null;

        // 唯一的 loading 指示器，始终 append 在 bodyEl 末尾
        this.loadingEl = document.createElement('div');
        this.loadingEl.className = 'ai-message-content ai-message-loading';
        this.loadingTextEl = document.createElement('span');
        this.loadingTextEl.className = 'ai-loading-text';
        this.loadingTextEl.textContent = t('ai.generating.thinking');
        this.loadingEl.appendChild(this.loadingTextEl);
        this.bodyEl.appendChild(this.loadingEl);

        // 当前文字 content box，按需创建
        this.currentContentEl = null;
        this.streamThinkingText = '';
        this.inlineThinkingText = '';
        // 记录每个 content box 对应的 markdown 源,用于持久化(不存渲染后的 HTML)
        this.markdownSegments = [];
        // 按 DOM 出现顺序记录每段（markdown / tool），用于会话恢复时还原原顺序
        this.bodySegments = [];
        this.currentMarkdownSegment = null;
        this.completionSummary = '';

        addClickHandler(this.thinkingToggleEl, () => this._toggleThinking());
    }

    _toggleThinking() {
        const collapsed = this.thinkingEl.classList.toggle('is-collapsed');
        const icon = this.thinkingEl.querySelector('.ai-thinking-expand');
        icon.textContent = collapsed ? '›' : '‹';
    }

    /** 新一轮 LLM 迭代开始：重置 content box，让 loadingEl 显示在底部 */
    newContentBox() {
        this.currentContentEl = null;
        this.currentMarkdownSegment = null;
        this.loadingTextEl.textContent = t('ai.generating.thinking');
        this.loadingEl.style.display = '';
        this.bodyEl.appendChild(this.loadingEl); // 移到最底部
        scrollToBottom(this.el);
    }

    /** 工具调用开始流式生成时：重新显示 loading 指示器 */
    showGenerating(toolName) {
        const key = `ai.generating.${toolName}`;
        const val = t(key);
        this.loadingTextEl.textContent = val === key ? t('ai.generating.thinking') : val;
        this.loadingEl.style.display = '';
        this.bodyEl.appendChild(this.loadingEl);
        scrollToBottom(this.el);
    }

    /** 流式文本到来：首次时在 loadingEl 前插入 content box 并隐藏 loading */
    setContent(text) {
        const parsed = extractThinkBlocks(text);
        const hasRenderableContent = typeof parsed.content === 'string' && parsed.content.trim().length > 0;
        if (!hasRenderableContent) {
            this.inlineThinkingText = parsed.thinking;
            this._renderThinking();
            scrollToBottom(this.el);
            return;
        }
        if (!this.currentContentEl) {
            this.currentContentEl = document.createElement('div');
            this.currentContentEl.className = 'ai-message-content ai-message-markdown';
            this.bodyEl.insertBefore(this.currentContentEl, this.loadingEl);
            this.loadingEl.style.display = 'none';
            this.markdownSegments.push('');
            this.currentMarkdownSegment = { type: 'markdown', content: '' };
            this.bodySegments.push(this.currentMarkdownSegment);
        }
        this.currentContentEl.innerHTML = renderAiMarkdown(parsed.content);
        enhanceAiMarkdownCodeBlocks(this.currentContentEl);
        if (this.markdownSegments.length > 0) {
            this.markdownSegments[this.markdownSegments.length - 1] = parsed.content;
        }
        if (this.currentMarkdownSegment) {
            this.currentMarkdownSegment.content = parsed.content;
        }
        this.inlineThinkingText = parsed.thinking;
        this._renderThinking();
        scrollToBottom(this.el);
    }

    setThinking(text) {
        this.streamThinkingText = typeof text === 'string' ? text : '';
        this._renderThinking();
        scrollToBottom(this.el);
    }

    _renderThinking() {
        const mergedThinking = mergeThinkingText(this.streamThinkingText, this.inlineThinkingText);
        if (!mergedThinking) {
            this.thinkingEl.style.display = 'none';
            this.thinkingPreviewEl.textContent = '';
            this.thinkingFullEl.textContent = '';
            return;
        }
        this.thinkingEl.style.display = '';
        this.thinkingPreviewEl.textContent = mergedThinking.slice(0, 120);
        this.thinkingFullEl.textContent = mergedThinking;
    }

    /** Agent 完成，隐藏 loading */
    done({ showCompletionSummary = true } = {}) {
        this.loadingEl.style.display = 'none';
        if (this.currentContentEl && !this.currentContentEl.textContent?.trim()) {
            this.currentContentEl.remove();
            this.currentContentEl = null;
        }
        if (showCompletionSummary) {
            const toolSegments = this.bodySegments.filter((segment) => segment?.type === 'tool');
            this.completionSummary = buildCompletionSummary(toolSegments);
            if (this.completionSummary && !this.bodyEl.querySelector('.ai-message-completion')) {
                this.bodyEl.appendChild(buildCompletionNoteElement(this.completionSummary));
            }
        } else {
            this.completionSummary = '';
        }
        // 给整个消息容器加操作按钮
        if (!this.el.querySelector('.ai-message-actions-bar')) {
            const contentEls = this.bodyEl.querySelectorAll('.ai-message-content.ai-message-markdown');
            if (contentEls.length > 0) appendMessageActions(this.el, this.bodyEl, { onDelete: this.onDelete });
        }
        // action bar 是这一帧才追加的,scrollHeight 又涨了一截。
        // 等 layout 真把它纳入再 scroll,否则量到的还是旧高度。
        requestAnimationFrame(() => scrollToBottom(this.el));
    }

    addToolCard({ id, name }) {
        // 工具执行有自己的状态卡，loading 先隐藏
        this.loadingEl.style.display = 'none';
        const statusText = TOOL_STATUS_RUNNING[name] || '...';
        const card = document.createElement('div');
        card.className = 'ai-tool-card ai-tool-card-running';
        card.innerHTML = `
            <span class="ai-tool-card-icon"></span>
            <span class="ai-tool-card-name">${TOOL_LABELS[name] || name}</span>
            <span class="ai-tool-card-status">${statusText}</span>
        `;
        const segment = { type: 'tool', name, status: 'running', durationMs: 0, error: null };
        this.bodySegments.push(segment);
        if (!this.toolGroup) {
            this.toolGroup = createToolGroupElement();
            this.bodyEl.insertBefore(this.toolGroup.wrap, this.loadingEl);
        }
        this.toolGroup.listEl.appendChild(card);
        this.toolGroup.segments.push(segment);
        this.toolGroup.summaryEl.textContent = formatToolGroupSummary(this.toolGroup.segments);
        this.toolCards.set(id, { el: card, startTime: Date.now(), segment });
        // 一旦进入工具调用阶段，下次 markdown 文本应当作为新的段落显示
        this.currentContentEl = null;
        this.currentMarkdownSegment = null;
        scrollToBottom(this.el);
    }

    updateToolCard({ id, name, result }) {
        const entry = this.toolCards.get(id);
        if (!entry) return;
        const { el, startTime, segment } = entry;
        el.classList.remove('ai-tool-card-running');

        const elapsed = formatToolElapsed(startTime);
        const statusEl = el.querySelector('.ai-tool-card-status');
        if (segment) segment.durationMs = Date.now() - startTime;
        if (shouldShowToolError(result)) {
            el.classList.add('ai-tool-card-error');
            statusEl.textContent = t('ai.status.fail', { error: result.error });
            if (segment) {
                segment.status = 'error';
                segment.error = result.error || null;
            }
        } else if (result?.error) {
            el.classList.add('ai-tool-card-done');
            statusEl.textContent = elapsed;
            if (segment) {
                segment.status = 'done';
                segment.error = result.error;
            }
            console.warn('[AiSidebar] 工具执行失败，已交由 agent 自行处理', {
                tool: name,
                error: result.error,
            });
        } else if (result?.cancelled) {
            el.classList.add('ai-tool-card-cancelled');
            statusEl.textContent = t('ai.status.cancelled');
            if (segment) segment.status = 'cancelled';
        } else {
            el.classList.add('ai-tool-card-done');
            statusEl.textContent = elapsed;
            if (segment) segment.status = 'done';
        }
        if (this.toolGroup?.summaryEl) {
            this.toolGroup.summaryEl.textContent = formatToolGroupSummary(this.toolGroup.segments);
        }
        scrollToBottom(this.el);
    }

    /**
     * 取持久化快照，按 DOM 顺序保留 thinking + markdown / tool 段。
     * 不持久化具体工具结果数据，只留状态与耗时（避免把大文件读取结果撑爆 localStorage）。
     */
    getPersistSnapshot() {
        const thinking = mergeThinkingText(this.streamThinkingText, this.inlineThinkingText) || '';
        const segments = this.bodySegments
            .map((seg) => {
                if (!seg) return null;
                if (seg.type === 'markdown') {
                    const content = typeof seg.content === 'string' ? seg.content : '';
                    if (!content.trim()) return null;
                    return { type: 'markdown', content };
                }
                if (seg.type === 'tool') {
                    return {
                        type: 'tool',
                        name: seg.name,
                        status: seg.status || 'done',
                        durationMs: seg.durationMs || 0,
                        error: seg.error || null,
                    };
                }
                return null;
            })
            .filter(Boolean);
        return { v: 2, thinking, segments, completionSummary: this.completionSummary || '' };
    }

    setError(msg) {
        this.loadingEl.style.display = 'none';
        if (!this.currentContentEl) {
            this.currentContentEl = document.createElement('div');
            this.currentContentEl.className = 'ai-message-content';
            this.bodyEl.insertBefore(this.currentContentEl, this.loadingEl);
        }
        this.currentContentEl.textContent = t('ai.status.errorPrefix', { message: msg });
        this.currentContentEl.style.color = 'var(--ai-tool-error, #ef4444)';
    }

    /**
     * 在 body 内渲染 diff 视图（默认收起），返回 Promise<{applied: boolean}>
     */
    addDiffCard({ path, oldContent, newContent }) {
        // diff 出现 = 内容已生成完毕，把 running 工具卡改为「完成」
        for (const { el, startTime } of this.toolCards.values()) {
            if (el.classList.contains('ai-tool-card-running')) {
                el.classList.remove('ai-tool-card-running');
                el.classList.add('ai-tool-card-done');
                el.querySelector('.ai-tool-card-status').textContent = formatToolElapsed(startTime);
            }
        }
        return new Promise((resolve) => {
            const diffResult = diffLines(oldContent, newContent);
            const chunks = buildDiffChunks(diffResult);
            const hasChanges = diffResult.some((l) => l.type !== 'eq');

            const card = document.createElement('div');
            card.className = 'ai-diff-card is-collapsed';

            const fileName = basename(path);
            card.innerHTML = `
                <div class="ai-diff-header">
                    <span class="ai-diff-file">${escapeHtml(fileName)}</span>
                    <span class="ai-diff-summary">${this._diffSummary(diffResult)}</span>
                    <span class="ai-diff-toggle">›</span>
                </div>
                <div class="ai-diff-body"></div>
                <div class="ai-diff-actions">
                    ${hasChanges ? `<button class="ai-diff-apply-btn">${t('ai.diff.apply')}</button>` : ''}
                    <button class="ai-diff-cancel-btn">${hasChanges ? t('ai.cancel') : t('ai.diff.close')}</button>
                </div>
            `;

            const diffBodyEl = card.querySelector('.ai-diff-body');
            chunks.forEach((chunk) => {
                if (chunk.type === 'skip') {
                    const skip = document.createElement('div');
                    skip.className = 'ai-diff-skip';
                    skip.textContent = t('ai.diff.skipLines', { count: chunk.count });
                    diffBodyEl.appendChild(skip);
                } else {
                    const line = document.createElement('div');
                    line.className = `ai-diff-line ai-diff-line-${chunk.type}`;
                    const prefix = chunk.type === 'add' ? '+' : chunk.type === 'del' ? '-' : ' ';
                    line.textContent = `${prefix} ${chunk.value}`;
                    diffBodyEl.appendChild(line);
                }
            });

            const headerEl = card.querySelector('.ai-diff-header');
            const toggleEl = card.querySelector('.ai-diff-toggle');
            addClickHandler(headerEl, () => {
                card.classList.toggle('is-collapsed');
            });

            const applyBtn = card.querySelector('.ai-diff-apply-btn');
            const cancelBtn = card.querySelector('.ai-diff-cancel-btn');

            if (applyBtn) {
                addClickHandler(applyBtn, () => {
                    applyBtn.disabled = true;
                    cancelBtn.disabled = true;
                    card.classList.add('ai-diff-card-applied');
                    resolve({ applied: true });
                });
            }

            addClickHandler(cancelBtn, () => {
                applyBtn && (applyBtn.disabled = true);
                cancelBtn.disabled = true;
                card.classList.add('ai-diff-card-cancelled');
                resolve({ applied: false });
            });

            this.bodyEl.insertBefore(card, this.loadingEl);
            scrollToBottom(this.el);
        });
    }

    /**
     * 在 body 内渲染删除确认，返回 Promise<boolean>
     */
    addDeleteConfirmCard(path) {
        return new Promise((resolve) => {
            const fileName = basename(path);
            const card = document.createElement('div');
            card.className = 'ai-confirm-card';
            card.innerHTML = `
                <div class="ai-confirm-text">${t('ai.confirmDelete.prompt', { name: escapeHtml(fileName) })}</div>
                <div class="ai-confirm-path">${escapeHtml(path)}</div>
                <div class="ai-confirm-actions">
                    <button class="ai-confirm-ok-btn">${t('ai.confirmDelete.ok')}</button>
                    <button class="ai-confirm-cancel-btn">${t('ai.cancel')}</button>
                </div>
            `;

            const okBtn = card.querySelector('.ai-confirm-ok-btn');
            const cancelBtn = card.querySelector('.ai-confirm-cancel-btn');

            addClickHandler(okBtn, () => {
                okBtn.disabled = true;
                cancelBtn.disabled = true;
                card.classList.add('ai-confirm-resolved');
                resolve(true);
            });

            addClickHandler(cancelBtn, () => {
                okBtn.disabled = true;
                cancelBtn.disabled = true;
                card.classList.add('ai-confirm-resolved');
                resolve(false);
            });

            this.bodyEl.insertBefore(card, this.loadingEl);
            scrollToBottom(this.el);
        });
    }

    _diffSummary(diffResult) {
        const added = diffResult.filter((l) => l.type === 'add').length;
        const deleted = diffResult.filter((l) => l.type === 'del').length;
        const parts = [];
        if (added) parts.push(`<span class="ai-diff-added">+${added}</span>`);
        if (deleted) parts.push(`<span class="ai-diff-deleted">-${deleted}</span>`);
        return parts.join(' ') || t('ai.diff.noChange');
    }
}

// ── 工具函数 ──────────────────────────────────────────────
function escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 角色头像:You 用线条 person,AI 用实心 sparkle(与 titlebar AI 图标呼应)
const AVATAR_USER_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.6"/><path d="M5 20a7 7 0 0 1 14 0"/></svg>';
const AVATAR_AI_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9z"/></svg>';

/**
 * 角色署名行(头像 + 名称)。内容全为内部常量,无用户数据,拼 HTML 安全。
 * @param {'user'|'ai'} kind
 */
function roleHeaderHTML(kind) {
    const isAi = kind === 'ai';
    return `<div class="ai-message-role ai-message-role--${isAi ? 'ai' : 'user'}">`
        + `<span class="ai-message-avatar">${isAi ? AVATAR_AI_SVG : AVATAR_USER_SVG}</span>`
        + `<span class="ai-message-name">${isAi ? 'AI' : 'You'}</span>`
        + '</div>';
}

/**
 * 从原始文本构造用户消息 DOM。
 * 用户文本走 textContent(不可信数据不拼 innerHTML);
 * 角色署名行 roleHeaderHTML 仅含内部常量,无用户数据。
 */
function buildUserMessageElement(text, { onDelete } = {}) {
    const el = document.createElement('div');
    el.className = 'ai-message ai-message-user';

    el.insertAdjacentHTML('beforeend', roleHeaderHTML('user'));

    const contentEl = document.createElement('div');
    contentEl.className = 'ai-message-content';
    contentEl.textContent = text;
    el.appendChild(contentEl);

    appendMessageActions(el, contentEl, { onDelete });
    return el;
}

/**
 * 从 chatHistory 条目里提取拼接后的 markdown 文本（兼容 v1 / v2 结构）。
 * 用于 _rebuildAgentMessages 把展示历史回灌成 LLM 上下文。
 */
function getEntryMarkdown(entry) {
    if (!entry) return '';
    if (Array.isArray(entry.segments)) {
        return entry.segments
            .filter((s) => s && s.type === 'markdown' && typeof s.content === 'string')
            .map((s) => s.content)
            .join('\n\n')
            .trim();
    }
    return entry.markdown || '';
}

/** 创建一个折叠的 thinking 区块（与实时卡片样式一致） */
function buildThinkingBlock(text) {
    const wrap = document.createElement('div');
    wrap.className = 'ai-message-thinking is-collapsed';

    const toggle = document.createElement('button');
    toggle.className = 'ai-message-thinking-toggle';
    toggle.type = 'button';
    const labelSpan = document.createElement('span');
    labelSpan.textContent = 'Thinking';
    const iconSpan = document.createElement('span');
    iconSpan.className = 'ai-thinking-expand';
    iconSpan.textContent = '›';
    toggle.appendChild(labelSpan);
    toggle.appendChild(iconSpan);

    const previewEl = document.createElement('div');
    previewEl.className = 'ai-message-thinking-preview';
    previewEl.textContent = text.slice(0, 120);

    const fullEl = document.createElement('div');
    fullEl.className = 'ai-message-thinking-full';
    fullEl.textContent = text;

    wrap.appendChild(toggle);
    wrap.appendChild(previewEl);
    wrap.appendChild(fullEl);

    addClickHandler(toggle, () => {
        const collapsed = wrap.classList.toggle('is-collapsed');
        iconSpan.textContent = collapsed ? '›' : '‹';
    });

    return wrap;
}

/** 重建一个工具卡片 DOM（最终态，仅展示状态/耗时/错误） */
function buildToolCardElement(segment) {
    const card = document.createElement('div');
    const status = segment?.status || 'done';
    const cls = status === 'error'
        ? 'ai-tool-card-error'
        : status === 'cancelled'
            ? 'ai-tool-card-cancelled'
            : 'ai-tool-card-done';
    card.className = `ai-tool-card ${cls}`;

    const iconSpan = document.createElement('span');
    iconSpan.className = 'ai-tool-card-icon';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'ai-tool-card-name';
    nameSpan.textContent = TOOL_LABELS[segment?.name] || segment?.name || '';
    const statusSpan = document.createElement('span');
    statusSpan.className = 'ai-tool-card-status';
    if (status === 'error') {
        statusSpan.textContent = t('ai.status.fail', { error: segment?.error || '' });
    } else if (status === 'cancelled') {
        statusSpan.textContent = t('ai.status.cancelled');
    } else {
        statusSpan.textContent = formatPersistedToolElapsed(segment?.durationMs);
    }
    card.appendChild(iconSpan);
    card.appendChild(nameSpan);
    card.appendChild(statusSpan);
    return card;
}

function formatPersistedToolElapsed(ms) {
    const dur = typeof ms === 'number' && ms > 0 ? ms : 0;
    if (dur < 1000) return '< 1s';
    const sec = dur / 1000;
    if (sec < 10) return `${sec.toFixed(1)}s`;
    if (sec < 60) return `${Math.round(sec)}s`;
    const min = Math.floor(sec / 60);
    const rem = Math.round(sec % 60);
    return rem ? `${min}m ${rem}s` : `${min}m`;
}

/**
 * 生成一条简洁的完成汇报，让用户知道 agent 已结束而不是还在工作。
 */
function buildCompletionSummary(toolSegments = []) {
    const names = toolSegments.map((segment) => segment?.name).filter(Boolean);
    const toolCount = names.length;
    if (toolCount === 0) {
        return '已完成这次回复。';
    }

    const touchedCurrentDocument = names.includes('write_current_document');
    const touchedWorkspaceFiles = names.some((name) => [
        'write_file',
        'create_files',
        'delete_file',
        'rename_file',
        'create_directory',
    ].includes(name));
    const inspectedOnly = names.every((name) => [
        'get_document_info',
        'read_document_lines',
        'search_in_document',
        'get_file_info',
        'read_file_chunk',
        'read_file',
        'list_directory',
    ].includes(name));

    if (touchedCurrentDocument) {
        return `已完成本次处理，并已更新当前文档。共执行 ${toolCount} 次工具调用。`;
    }
    if (touchedWorkspaceFiles) {
        return `已完成本次处理，并已更新相关文件。共执行 ${toolCount} 次工具调用。`;
    }
    if (inspectedOnly) {
        return `已完成本次检查。共执行 ${toolCount} 次工具调用。`;
    }
    return `已完成本次处理。共执行 ${toolCount} 次工具调用。`;
}

function buildCompletionNoteElement(text) {
    const el = document.createElement('div');
    el.className = 'ai-message-completion';
    el.textContent = text;
    return el;
}

/**
 * 工具调用区摘要：默认只展示数量与运行状态，减少正文噪音。
 */
function formatToolGroupSummary(segments = []) {
    const toolCount = segments.length;
    const runningCount = segments.filter((segment) => segment?.status === 'running').length;
    if (runningCount > 0) {
        return `${toolCount} tool${toolCount > 1 ? 's' : ''} · ${runningCount} running`;
    }
    return `${toolCount} tool call${toolCount > 1 ? 's' : ''}`;
}

/**
 * 创建一个默认折叠的工具调用分组。
 */
function createToolGroupElement(segments = []) {
    const wrap = document.createElement('div');
    wrap.className = 'ai-tool-group is-collapsed';

    const toggle = document.createElement('button');
    toggle.className = 'ai-tool-group-toggle';
    toggle.type = 'button';

    const titleEl = document.createElement('span');
    titleEl.className = 'ai-tool-group-title';
    titleEl.textContent = 'Tool calls';

    const summaryEl = document.createElement('span');
    summaryEl.className = 'ai-tool-group-summary';
    summaryEl.textContent = formatToolGroupSummary(segments);

    const iconEl = document.createElement('span');
    iconEl.className = 'ai-tool-group-expand';
    iconEl.textContent = '›';

    toggle.append(titleEl, summaryEl, iconEl);

    const listEl = document.createElement('div');
    listEl.className = 'ai-tool-calls';

    wrap.append(toggle, listEl);

    addClickHandler(toggle, () => {
        const collapsed = wrap.classList.toggle('is-collapsed');
        iconEl.textContent = collapsed ? '›' : '‹';
    });

    return { wrap, listEl, summaryEl, segments };
}

/**
 * 从原始 markdown 或 v2 快照构造助手消息 DOM。
 * 唯一的 innerHTML 来源是 renderAiMarkdown(),且 MarkdownIt 配置为 html: false,
 * 会把任何原始 HTML 标签当纯文本转义。
 */
function buildAssistantMessageElement(input, { onDelete } = {}) {
    // 兼容旧调用：传字符串 → 当作纯 markdown
    const entry = typeof input === 'string' ? { markdown: input } : (input || {});

    const el = document.createElement('div');
    el.className = 'ai-message ai-message-assistant';

    el.insertAdjacentHTML('beforeend', roleHeaderHTML('ai'));

    if (typeof entry.thinking === 'string' && entry.thinking.trim()) {
        el.appendChild(buildThinkingBlock(entry.thinking));
    }

    const bodyEl = document.createElement('div');
    bodyEl.className = 'ai-message-body';
    const toolSegments = [];

    if (Array.isArray(entry.segments) && entry.segments.length > 0) {
        for (const seg of entry.segments) {
            if (!seg) continue;
            if (seg.type === 'markdown') {
                const content = typeof seg.content === 'string' ? seg.content : '';
                if (!content.trim()) continue;
                const mdEl = document.createElement('div');
                mdEl.className = 'ai-message-content ai-message-markdown';
                mdEl.innerHTML = renderAiMarkdown(content);
                enhanceAiMarkdownCodeBlocks(mdEl);
                bodyEl.appendChild(mdEl);
            } else if (seg.type === 'tool') {
                toolSegments.push(seg);
            }
        }
    } else {
        const contentEl = document.createElement('div');
        contentEl.className = 'ai-message-content ai-message-markdown';
        contentEl.innerHTML = renderAiMarkdown(entry.markdown || '');
        enhanceAiMarkdownCodeBlocks(contentEl);
        bodyEl.appendChild(contentEl);
    }

    if (toolSegments.length > 0) {
        const toolGroup = createToolGroupElement();
        toolSegments.forEach((seg) => {
            toolGroup.listEl.appendChild(buildToolCardElement(seg));
            toolGroup.segments.push(seg);
        });
        toolGroup.summaryEl.textContent = formatToolGroupSummary(toolGroup.segments);
        bodyEl.appendChild(toolGroup.wrap);
    }

    if (typeof entry.completionSummary === 'string' && entry.completionSummary.trim()) {
        bodyEl.appendChild(buildCompletionNoteElement(entry.completionSummary.trim()));
    }

    el.appendChild(bodyEl);
    appendMessageActions(el, bodyEl, { onDelete });
    return el;
}

const AI_COPY_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
const AI_COPY_CHECK_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
const AI_DELETE_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path></svg>';

function appendMessageActions(messageEl, copySourceEl, { onDelete } = {}) {
    const bar = document.createElement('div');
    bar.className = 'ai-message-actions-bar';

    // copy
    const copyBtn = document.createElement('button');
    copyBtn.className = 'ai-msg-action-btn';
    copyBtn.type = 'button';
    copyBtn.innerHTML = AI_COPY_ICON;
    addClickHandler(copyBtn, () => {
        const markdownEls = copySourceEl.querySelectorAll?.('.ai-message-content.ai-message-markdown');
        const text = markdownEls?.length
            ? [...markdownEls].map(el => el.textContent).join('\n\n').trim()
            : copySourceEl.textContent.trim();
        navigator.clipboard.writeText(text).then(() => {
            copyBtn.innerHTML = AI_COPY_CHECK_ICON;
            copyBtn.classList.add('is-copied');
            setTimeout(() => {
                copyBtn.innerHTML = AI_COPY_ICON;
                copyBtn.classList.remove('is-copied');
            }, 1500);
        });
    });
    bar.appendChild(copyBtn);

    // delete
    const delBtn = document.createElement('button');
    delBtn.className = 'ai-msg-action-btn ai-msg-delete-btn';
    delBtn.type = 'button';
    delBtn.innerHTML = AI_DELETE_ICON;
    addClickHandler(delBtn, () => {
        if (onDelete) onDelete(messageEl);
    });
    bar.appendChild(delBtn);

    messageEl.appendChild(bar);
}

function scrollToBottom(refEl, force = false) {
    const list = refEl?.closest?.('.ai-conversation-list')
        || refEl?.querySelector?.('.ai-conversation-list');
    if (!list) return;
    if (force || list._shouldAutoScroll !== false) {
        list.scrollTop = list.scrollHeight;
    }
}

// ── 主类 ─────────────────────────────────────────────────
export class AiSidebar {
    /**
     * @param {Object} options
     * @param {() => import('../../state/AppState.js').AppState} options.getAppState
     * @param {() => import('../../state/EditorRegistry.js').EditorRegistry} options.getEditorRegistry
     * @param {(path: string) => Promise<void>} options.reloadCurrentFile
     * @param {(message: string, options?: Object) => Promise<boolean>|boolean} [options.confirm]
     */
    constructor({ getAppState, getEditorRegistry, reloadCurrentFile, confirm }) {
        this.getAppState = getAppState;
        this.getEditorRegistry = getEditorRegistry;
        this.reloadCurrentFile = reloadCurrentFile;
        this.confirm = confirm;

        this.el = document.querySelector('.ai-sidebar');
        if (!this.el) {
            console.error('[AiSidebar] .ai-sidebar 元素不存在');
            return;
        }

        this.listEl = this.el.querySelector('.ai-conversation-list-items');
        this.emptyEl = this.el.querySelector('.ai-conversation-empty');
        this.inputEl = this.el.querySelector('.ai-sidebar-input-field');
        this.sendBtn = this.el.querySelector('.ai-sidebar-send-btn');
        this.cancelBtn = this.el.querySelector('.ai-sidebar-cancel-btn');
        this.clearBtn = this.el.querySelector('.ai-sidebar-clear-btn');
        this.closeBtn = this.el.querySelector('.ai-sidebar-close-btn');
        this.fileNameEl = this.el.querySelector('.ai-context-file-name');
        this.resizeHandleEl = this.el.querySelector('.ai-sidebar-resize-handle');
        this.autoEditCheckboxEl = this.el.querySelector('.ai-auto-edit-checkbox');
        this.modelSelectEl = this.el.querySelector('.ai-model-select');

        // 对话历史（仅用于 LLM，含 system/user/assistant/tool 消息）
        this.agentMessages = [];
        // 展示历史（用于持久化，每条 {role, html}）
        this.chatHistory = [];
        this.agentLoop = null;
        this.isProcessing = false;
        this.processingPath = null;
        this.processingTabId = null;

        // 当前活跃的 assistant 卡片（用于关联 diff/confirm 到正确的卡片）
        this._activeCard = null;

        // auto-edit 开关状态
        this.autoEdit = store.get('autoEdit', false);
        this.autoEditStateEl = this.el.querySelector('.ai-auto-edit-state');
        if (this.autoEditCheckboxEl) {
            this.autoEditCheckboxEl.checked = this.autoEdit;
            this._updateAutoEditState();
        }

        // 事件清理函数集合
        this._cleanups = [];

        this._setupToolExecutor();
        this._restoreSidebarWidth();
        this._bindEvents();
        this._initModelSelect();
        this._bindFileChangeListener();
        this._bindResizeHandle();
        this._updateContextBar();
        this._restoreChatHistory();
    }

    // ── 初始化 ────────────────────────────────────────────

    _restoreChatHistory() {
        const history = loadChatHistory();
        if (!history.length) return;
        // 旧格式把渲染后的 HTML 存在 entry.html,会把信任边界扩大到 localStorage;
        // 检测到任一旧条目就整体丢弃,强制用户从干净状态开始
        if (history.some(e => e && typeof e.html === 'string')) {
            clearChatStorage();
            return;
        }
        this.chatHistory = history;
        this.agentMessages = loadAgentMessages();
        this.emptyEl.style.display = 'none';
        const onDelete = (msgEl) => this._deleteMessage(msgEl);
        for (const entry of history) {
            const el = entry.role === 'user'
                ? buildUserMessageElement(entry.text || '', { onDelete })
                : buildAssistantMessageElement(entry, { onDelete });
            if (el) this.listEl.appendChild(el);
        }
        const listContainer = this.el.querySelector('.ai-conversation-list');
        if (listContainer) listContainer.scrollTop = listContainer.scrollHeight;
    }

    _persistChat() {
        saveChatHistory(this.chatHistory);
        saveAgentMessages(this.agentMessages);
    }

    // 从编辑器内存读取当前文档内容（优先于磁盘）
    _getEditorContent() {
        const appState = this.getAppState();
        const viewMode = appState.getActiveViewMode();
        const reg = this.getEditorRegistry?.();
        if (!reg) return null;
        if (viewMode === 'markdown') {
            const content = reg.getMarkdownEditor?.()?.getMarkdown?.();
            return typeof content === 'string' ? content : null;
        }
        if (viewMode === 'code') {
            const content = reg.getCodeEditor?.()?.getValue?.();
            return typeof content === 'string' ? content : null;
        }
        return null;
    }

    _setupToolExecutor() {
        this.toolExecutor = createToolExecutor({
            getCurrentFile: () => this.getAppState().getCurrentFile(),
            // 相对路径基准：sidebar 上当前 tab 所属的 root folder
            // 没匹配到（多 root 全部不包含当前文件）就 fallback 到唯一 root；
            // 没 root 时返回 null，让 resolveRelativePath 退回 dirname(currentFile)
            getRootDir: () => {
                const tree = this.getAppState().getFileTree?.();
                const roots = tree?.getRootPaths?.() || [];
                if (roots.length === 0) return null;
                const file = this.getAppState().getCurrentFile();
                if (!file) return roots.length === 1 ? roots[0] : null;
                let best = null;
                for (const root of roots) {
                    if (file === root || file.startsWith(root.endsWith('/') ? root : root + '/')) {
                        if (!best || root.length > best.length) best = root;
                    }
                }
                return best || (roots.length === 1 ? roots[0] : null);
            },
            getCurrentContent: () => this._getEditorContent(),
            onWriteCurrentDocument: ({ path, oldContent, newContent, patchPlan, mode }) =>
                this._handleWriteCurrentDocument({ path, oldContent, newContent, patchPlan, mode }),
            onDeleteConfirm: (path) => this._handleDeleteConfirm(path),
        });
    }

    _bindEvents() {
        this._cleanups.push(
            addClickHandler(this.sendBtn, () => this._handleSend()),
            addClickHandler(this.cancelBtn, () => this._handleCancel()),
            addClickHandler(this.clearBtn, () => this._handleClear()),
            addClickHandler(this.closeBtn, () => this.hide()),
        );

        if (this.autoEditCheckboxEl) {
            const onAutoEditChange = () => {
                this.autoEdit = this.autoEditCheckboxEl.checked;
                store.set('autoEdit', this.autoEdit);
                this._updateAutoEditState();
            };
            this.autoEditCheckboxEl.addEventListener('change', onAutoEditChange);
            this._cleanups.push(() => this.autoEditCheckboxEl.removeEventListener('change', onAutoEditChange));
        }

        this._isComposing = false;
        this._compositionJustEnded = false;

        const onCompositionStart = () => {
            this._isComposing = true;
            this._compositionJustEnded = false;
        };
        const onCompositionEnd = () => {
            this._isComposing = false;
            this._compositionJustEnded = true;
        };
        const onKeydown = (e) => {
            const justEnded = this._compositionJustEnded;
            this._compositionJustEnded = false;
            if (e.key === 'Enter' && !e.shiftKey && !this._isComposing && !justEnded) {
                e.preventDefault();
                void this._handleSend();
            }
        };

        this.inputEl.addEventListener('compositionstart', onCompositionStart);
        this.inputEl.addEventListener('compositionend', onCompositionEnd);
        this.inputEl.addEventListener('keydown', onKeydown);

        // 自动撑高：跟随内容增高，达到 max-height 后内部滚动
        const onAutoResize = () => this._autoResizeInput();
        this.inputEl.addEventListener('input', onAutoResize);
        this._autoResizeInput();

        this._cleanups.push(() => {
            this.inputEl.removeEventListener('compositionstart', onCompositionStart);
            this.inputEl.removeEventListener('compositionend', onCompositionEnd);
            this.inputEl.removeEventListener('keydown', onKeydown);
            this.inputEl.removeEventListener('input', onAutoResize);
        });

        // 自动滚动:
        //  - 向上滚 → 暂停(用户在回看),5s 后自动恢复
        //  - 向下滚 → 恢复(用户在主动追内容,不必非要精确滑到底)
        //  - 滚到底 → 直接恢复 + 取消 resume 计时
        const listContainer = this.el.querySelector('.ai-conversation-list');
        if (listContainer) {
            listContainer._shouldAutoScroll = true;
            const BOTTOM_THRESHOLD = 80;
            const AUTO_RESUME_DELAY = 5000;
            let resumeTimer = null;
            let lastScrollTop = listContainer.scrollTop;
            const onScroll = () => {
                const { scrollTop, scrollHeight, clientHeight } = listContainer;
                const delta = scrollTop - lastScrollTop;
                lastScrollTop = scrollTop;
                const atBottom = scrollHeight - scrollTop - clientHeight < BOTTOM_THRESHOLD;
                if (atBottom) {
                    listContainer._shouldAutoScroll = true;
                    clearTimeout(resumeTimer);
                    return;
                }
                if (delta < 0) {
                    // 向上滚 → 暂停,5s 内不操作自动恢复
                    listContainer._shouldAutoScroll = false;
                    clearTimeout(resumeTimer);
                    resumeTimer = setTimeout(() => {
                        listContainer._shouldAutoScroll = true;
                    }, AUTO_RESUME_DELAY);
                } else if (delta > 0) {
                    // 向下滚 → 立刻恢复(意图明显是要追新内容)
                    listContainer._shouldAutoScroll = true;
                    clearTimeout(resumeTimer);
                }
                // delta === 0 不动状态
            };
            listContainer.addEventListener('scroll', onScroll, { passive: true });
            this._cleanups.push(() => {
                listContainer.removeEventListener('scroll', onScroll);
                clearTimeout(resumeTimer);
            });
        }
    }

    /**
     * 恢复上次保存的 sidebar 宽度。
     */
    _restoreSidebarWidth() {
        this._applySidebarWidth(loadSidebarWidth());
    }

    /**
     * 将宽度写入 CSS 变量与面板样式，统一布局依赖。
     * @param {number} width - 目标宽度
     */
    _applySidebarWidth(width) {
        const nextWidth = clampSidebarWidth(width);
        this.el.style.width = `${nextWidth}px`;
        document.documentElement.style.setProperty('--ai-sidebar-width', `${nextWidth}px`);
    }

    /**
     * 绑定 AI Sidebar 左侧拖拽手柄。
     */
    _bindResizeHandle() {
        if (!this.resizeHandleEl) {
            return;
        }

        let startX = 0;
        let startWidth = AI_SIDEBAR_DEFAULT_WIDTH;

        const onDown = (event) => {
            this.resizeHandleEl.setPointerCapture(event.pointerId);
            startX = event.clientX;
            startWidth = this.el.offsetWidth || loadSidebarWidth();
            document.body.classList.add('ai-sidebar-resizing');
            event.preventDefault();
        };

        const onMove = (event) => {
            if (!this.resizeHandleEl.hasPointerCapture(event.pointerId)) {
                return;
            }
            const widthDelta = startX - event.clientX;
            const nextWidth = clampSidebarWidth(startWidth + widthDelta);
            this._applySidebarWidth(nextWidth);
            saveSidebarWidth(nextWidth);
        };

        const stopResize = (event) => {
            if (event && this.resizeHandleEl.hasPointerCapture(event.pointerId)) {
                this.resizeHandleEl.releasePointerCapture(event.pointerId);
            }
            document.body.classList.remove('ai-sidebar-resizing');
        };

        this.resizeHandleEl.addEventListener('pointerdown', onDown);
        this.resizeHandleEl.addEventListener('pointermove', onMove);
        this.resizeHandleEl.addEventListener('pointerup', stopResize);
        this.resizeHandleEl.addEventListener('pointercancel', stopResize);

        this._cleanups.push(() => {
            this.resizeHandleEl.removeEventListener('pointerdown', onDown);
            this.resizeHandleEl.removeEventListener('pointermove', onMove);
            this.resizeHandleEl.removeEventListener('pointerup', stopResize);
            this.resizeHandleEl.removeEventListener('pointercancel', stopResize);
        });
    }

    _bindFileChangeListener() {
        this.getAppState().onCurrentFileChange((path) => {
            this._updateContextBar(path);
        });
        this._cleanups.push(() => {
            this.getAppState().onCurrentFileChange(null);
        });
    }

    /**
     * 在文档真正切换前，判断当前 AI 任务是否允许离开当前文档。
     * 这是唯一的切换守卫出口：允许切换时会先停止 AI，取消切换时返回 false。
     * @param {string|null} nextPath - 目标文档路径
     * @returns {Promise<boolean>}
     */
    async confirmBeforeDocumentChange(nextPath) {
        if (!this.isProcessing || !this.processingPath) {
            return true;
        }
        if (nextPath === this.processingPath) {
            return true;
        }

        const shouldLeave = await this._confirmProcessingDocumentChange(nextPath);
        if (!shouldLeave) {
            return false;
        }
        this._abortProcessingWithMessage(t('ai.abort.switchDoc'));
        return true;
    }

    /**
     * 弹出确认框，询问用户是否在 AI 运行中切换文档。
     * @param {string|null} nextPath - 新切换到的文档路径
     * @returns {Promise<boolean>} `true` 表示继续离开当前文档，`false` 表示留在原文档
     */
    async _confirmProcessingDocumentChange(nextPath) {
        const nextLabel = nextPath ? basename(nextPath) : t('ai.noFile');
        const currentLabel = this.processingPath ? basename(this.processingPath) : t('ai.switchDoc.currentDocFallback');
        const message = t('ai.switchDoc.message', { current: currentLabel, next: nextLabel });

        if (typeof this.confirm === 'function') {
            return await this.confirm(message, {
                okText: t('ai.switchDoc.ok'),
                cancelText: t('ai.switchDoc.cancel'),
            });
        }
        if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
            return window.confirm(message);
        }
        return true;
    }

    _updateAutoEditState() {
        if (!this.autoEditStateEl) return;
        this.autoEditStateEl.textContent = this.autoEdit ? t('ai.autoEdit.on') : t('ai.autoEdit.off');
    }

    _autoResizeInput() {
        const el = this.inputEl;
        if (!el) return;
        // 先 collapse 再读 scrollHeight,否则只能"长高"不能"变矮"
        el.style.height = 'auto';
        const cs = getComputedStyle(el);
        const maxH = parseFloat(cs.maxHeight) || 160;
        const minH = parseFloat(cs.minHeight) || 20;
        const sh = el.scrollHeight;
        const next = Math.max(minH, Math.min(sh, maxH));
        el.style.height = next + 'px';
        el.style.overflowY = sh > maxH ? 'auto' : 'hidden';
    }

    _initModelSelect() {
        if (!this.modelSelectEl) return;
        this._populateModelSelect();

        const onChange = () => {
            const val = this.modelSelectEl.value;
            if (!val) return;
            const sep = val.indexOf('::');
            if (sep === -1) return;
            const providerId = val.slice(0, sep);
            const model = val.slice(sep + 2);
            const cfg = aiService.getConfig();
            aiService.saveConfig({ ...cfg, assistantModel: { providerId, model } });
        };
        this.modelSelectEl.addEventListener('change', onChange);
        this._cleanups.push(() => this.modelSelectEl.removeEventListener('change', onChange));

        const unsub = aiService.subscribe((event) => {
            if (event.type === 'config') this._populateModelSelect();
        });
        this._cleanups.push(unsub);

        // cloud plugin 登录态 / models 变化也需要重渲下拉
        const unsubCloud = subscribeRegistry(() => this._populateModelSelect());
        this._cleanups.push(unsubCloud);
    }

    _populateModelSelect() {
        if (!this.modelSelectEl) return;
        const cfg = aiService.getConfig();
        const slot = cfg.assistantModel;
        const providers = cfg.providers ?? [];

        this.modelSelectEl.innerHTML = '';

        // 收集所有可用的 provider 的模型：
        // - 普通 provider：要求填了 apiKey
        // - cloud plugin：仅在 plugin.isAvailable() 时可见，不可用时即使 cfg 里残留也过滤
        const configured = providers.filter(p => {
            const cloudPlugin = getCloudProvider(p.id);
            if (cloudPlugin) return cloudPlugin.isAvailable();
            return !!p.apiKey;
        });
        // 已可用的 cloud plugin 自动注入到下拉（无需用户在 ai-keys 里手动添加）
        for (const plugin of listCloudProviders()) {
            if (plugin.isAvailable() && !configured.some(p => p.id === plugin.id)) {
                configured.unshift({ id: plugin.id, apiKey: '' });
            }
        }
        if (!configured.length) {
            const opt = document.createElement('option');
            opt.textContent = t('ai.model.noConfig');
            this.modelSelectEl.appendChild(opt);
            this.modelSelectEl.disabled = true;
            return;
        }

        this.modelSelectEl.disabled = false;
        const currentVal = slot ? `${slot.providerId}::${slot.model}` : '';
        let currentFound = false;

        for (const p of configured) {
            const providerCfg = aiService.getProviderConfig(p.id);
            const models = (p.fetchedModels?.length ? p.fetchedModels : null)
                ?? providerCfg?.models ?? [];
            if (!models.length) continue;

            const group = document.createElement('optgroup');
            group.label = providerCfg?.name || p.id;

            for (const model of models) {
                const val = `${p.id}::${model}`;
                const opt = document.createElement('option');
                opt.value = val;
                opt.textContent = model;
                if (val === currentVal) {
                    opt.selected = true;
                    currentFound = true;
                }
                group.appendChild(opt);
            }
            this.modelSelectEl.appendChild(group);
        }

        // 当前选中的模型不在任何列表里时，单独补一个
        if (!currentFound && slot?.model) {
            const opt = document.createElement('option');
            opt.value = currentVal;
            opt.textContent = slot.model;
            opt.selected = true;
            this.modelSelectEl.insertBefore(opt, this.modelSelectEl.firstChild);
        }
    }

    _updateContextBar(path) {
        const resolvedPath = path ?? this.getAppState().getCurrentFile();
        if (resolvedPath) {
            const name = basename(resolvedPath);
            this.fileNameEl.textContent = name;
            this.fileNameEl.classList.remove('is-empty');
            this.fileNameEl.title = resolvedPath;
        } else {
            this.fileNameEl.textContent = t('ai.noFile');
            this.fileNameEl.classList.add('is-empty');
            this.fileNameEl.title = '';
        }
    }

    // ── 显示/隐藏 ─────────────────────────────────────────

    show() {
        document.body.classList.add('ai-sidebar-visible');
        this._updateContextBar();
        requestAnimationFrame(() => scrollToBottom(this.el, true));
        this.inputEl.focus();
    }

    hide() {
        document.body.classList.remove('ai-sidebar-visible');
    }

    toggle() {
        document.body.classList.contains('ai-sidebar-visible') ? this.hide() : this.show();
    }

    // ── 发送消息 ──────────────────────────────────────────

    async _handleSend() {
        if (this.isProcessing) return;
        const text = this.inputEl.value.trim();
        if (!text) return;

        if (!aiService_hasConfig()) {
            this._appendSystemMessage(t('ai.system.configureFirst'));
            return;
        }

        this.inputEl.value = '';
        this._autoResizeInput();
        this._appendUserMessage(text);
        this.processingPath = this.getAppState().getCurrentFile() || null;
        this.processingTabId = this.getAppState().getTabManager?.()?.activeTabId || null;
        this._startProcessing();

        // 刷新 system prompt（每次发送都更新，确保当前文件路径是最新的）
        const systemContent = this._buildSystemPrompt();
        if (this.agentMessages.length > 0 && this.agentMessages[0].role === 'system') {
            this.agentMessages[0] = { role: 'system', content: systemContent };
        } else {
            this.agentMessages.unshift({ role: 'system', content: systemContent });
        }

        this.agentMessages.push({ role: 'user', content: text });

        const card = new AssistantCard(this.listEl, { onDelete: (msgEl) => this._deleteMessage(msgEl) });
        this._activeCard = card;
        this.emptyEl.style.display = 'none';

        this.agentLoop = new AgentLoop({
            toolExecutor: this.toolExecutor,
            toolDefinitions: TOOL_DEFINITIONS,
            onIterationStart: () => card.newContentBox(),
            onChunk: (_delta, buffer) => card.setContent(buffer),
            onThink: (_delta, buffer) => card.setThinking(buffer),
            onToolCall: ({ id, name }) => card.addToolCard({ id, name }),
            onToolResult: ({ id, name, result }) => card.updateToolCard({ id, name, result }),
            onToolCallStreaming: ({ name }) => card.showGenerating(name),
            onError: (err) => {
                card.setError(err.message || t('ai.system.unknownError'));
                this._stopProcessing();
            },
        });

        try {
            const updatedMessages = await this.agentLoop.run(this.agentMessages);
            this.agentMessages = updatedMessages;
            const wasAborted = Boolean(this.agentLoop?.aborted);
            card.done({ showCompletionSummary: !wasAborted });
            // 按 DOM 顺序持久化 thinking + 各段（markdown / tool 状态），仅存源数据避免 HTML 进 localStorage
            const snapshot = card.getPersistSnapshot();
            const hasContent = (snapshot.thinking && snapshot.thinking.trim())
                || (snapshot.completionSummary && snapshot.completionSummary.trim())
                || snapshot.segments.some((s) => s.type === 'tool' || (s.type === 'markdown' && s.content.trim()));
            if (hasContent) {
                this.chatHistory.push({ role: 'assistant', ...snapshot });
            }
            this._persistChat();
        } catch {
            // onError 已处理
        } finally {
            this.agentLoop = null;
            this._activeCard = null;
            this._stopProcessing();
            this.processingPath = null;
            this.processingTabId = null;
        }
    }

    _handleCancel() {
        this._abortProcessingWithMessage(t('ai.abort.cancelled'));
    }

    _handleClear() {
        if (this.isProcessing) return;
        this.agentMessages = [];
        this.chatHistory = [];
        this.listEl.innerHTML = '';
        this.emptyEl.style.display = '';
        clearChatStorage();
    }

    _deleteMessage(msgEl) {
        if (this.isProcessing) return;
        // 找到 DOM 索引（只算 .ai-message-user 和 .ai-message-assistant）
        const allMsgEls = [...this.listEl.querySelectorAll('.ai-message-user, .ai-message-assistant')];
        const idx = allMsgEls.indexOf(msgEl);
        if (idx !== -1) this.chatHistory.splice(idx, 1);
        msgEl.remove();
        // 从 chatHistory 重建 agentMessages（最可靠）
        this._rebuildAgentMessages();
        this._persistChat();
        if (!this.listEl.querySelector('.ai-message')) {
            this.emptyEl.style.display = '';
        }
    }

    _rebuildAgentMessages() {
        // 保留 system prompt（第一条）
        const system = this.agentMessages.find(m => m.role === 'system');
        const rebuilt = system ? [system] : [];
        for (const entry of this.chatHistory) {
            if (entry.role === 'user') {
                rebuilt.push({ role: 'user', content: entry.text || '' });
            } else if (entry.role === 'assistant') {
                rebuilt.push({ role: 'assistant', content: getEntryMarkdown(entry) });
            }
        }
        this.agentMessages = rebuilt;
    }

    // ── 工具回调 ──────────────────────────────────────────

    async _handleWriteCurrentDocument({ path, oldContent, newContent }) {
        const card = this._activeCard;
        if (!card) return { applied: false };

        if (this.autoEdit) {
            try {
                const latestContent = this._getEditorContent();
                if (typeof latestContent === 'string' && latestContent !== oldContent) {
                    this._appendSystemMessage(t('ai.system.docChangedDuringGen'));
                    return { applied: false };
                }
                if (untitledFileManager.isUntitledPath(path)) {
                    untitledFileManager.setContent(path, newContent);
                } else {
                    await writeFile(path, newContent);
                }
                await this.reloadCurrentFile(path);
                return { applied: true };
            } catch (err) {
                this._appendSystemMessage(t('ai.system.writeFileFail', { error: err.message }));
                return { applied: false };
            }
        }

        const result = await card.addDiffCard({ path, oldContent, newContent });

        if (result.applied) {
            try {
                const latestContent = this._getEditorContent();
                if (typeof latestContent === 'string' && latestContent !== oldContent) {
                    this._appendSystemMessage(t('ai.system.docChangedDuringGen'));
                    return { applied: false };
                }
                if (untitledFileManager.isUntitledPath(path)) {
                    untitledFileManager.setContent(path, newContent);
                } else {
                    await writeFile(path, newContent);
                }
                await this.reloadCurrentFile(path);
            } catch (err) {
                this._appendSystemMessage(t('ai.system.writeFileFail', { error: err.message }));
                return { applied: false };
            }
        }

        return result;
    }

    async _handleDeleteConfirm(path) {
        const card = this._activeCard;
        if (!card) return false;
        return card.addDeleteConfirmCard(path);
    }

    // ── UI 辅助 ───────────────────────────────────────────

    _appendUserMessage(text) {
        this.emptyEl.style.display = 'none';
        const el = buildUserMessageElement(text, { onDelete: (msgEl) => this._deleteMessage(msgEl) });
        this.listEl.appendChild(el);
        this.chatHistory.push({ role: 'user', text });
        scrollToBottom(el);
    }

    _appendSystemMessage(text) {
        const el = document.createElement('div');
        el.className = 'ai-message ai-message-system';
        el.innerHTML = `<div class="ai-message-content">${escapeHtml(text)}</div>`;
        this.listEl.appendChild(el);
        scrollToBottom(el);
    }

    _startProcessing() {
        this.isProcessing = true;
        this.sendBtn.disabled = true;
        this.el.classList.add('is-processing');
        this.el.querySelector('.ai-conversation-list').classList.add('ai-processing');
    }

    _stopProcessing() {
        this.isProcessing = false;
        this.sendBtn.disabled = false;
        this.el.classList.remove('is-processing');
        this.el.querySelector('.ai-conversation-list').classList.remove('ai-processing');
    }

    /**
     * 停止当前 AI 执行，并追加一条原因提示。
     * @param {string} message - 停止原因文案
     */
    _abortProcessingWithMessage(message) {
        if (this.agentLoop) {
            this.agentLoop.abort();
            this.agentLoop = null;
        }
        this._stopProcessing();
        if (message) {
            this._appendSystemMessage(message);
        }
    }

    // ── 销毁 ──────────────────────────────────────────────

    destroy() {
        if (this.agentLoop) {
            this.agentLoop.abort();
            this.agentLoop = null;
        }
        this._cleanups.forEach(fn => typeof fn === 'function' && fn());
        this._cleanups.length = 0;
        this.agentMessages = [];
        this._activeCard = null;
    }

    // ── System Prompt 构建 ────────────────────────────────

    _buildSystemPrompt() {
        const appState = this.getAppState();
        const currentFile = appState.getCurrentFile();
        const workspaceFolder = appState.getFileTree()?.rootPaths?.[0] || null;

        const fileInfo = currentFile
            ? `当前打开的文档：${currentFile}`
            : '当前没有打开的文档';

        const workspaceInfo = workspaceFolder
            ? `工作区文件夹：${workspaceFolder}`
            : '';

        return `你是一个文档 Agent，帮助用户管理和编辑文档。

## 工作流程
1. 先理解用户指令
2. 用工具获取必要信息（先用 get_document_info 了解文件规模，再按需分块读取或搜索）
3. 完成操作

## 注意事项
- 优先一次读取足够多的内容（500 行以内可以一次读完），超长文档再用 read_document_lines 分块或 search_in_document 定位
- 如果任务是改整篇稿子、通篇润色、重写全文，调用 write_current_document 时用 mode=rewrite_full
- 如果任务只修改你刚读取的某一段，调用 write_current_document 时用 mode=replace_range，并直接复用读取结果里的 start_line、end_line、document_version
- replace_range 时同时传 source_excerpt，内容就是你刚读取到的原片段正文；如果文档已变化，系统会用它在最新文档中自动重定位
- replace_range 的 content 只写替换后的正文片段，不要带行号前缀
- 删除操作会自动请求用户确认
- 回复简洁，直接说做了什么

## 当前状态
${fileInfo}${workspaceInfo ? '\n' + workspaceInfo : ''}`;
    }
}

// ── 检查 AI 是否已配置 ────────────────────────────────────
function aiService_hasConfig() {
    return !!aiService.getActiveApiKey();
}

/**
 * 工厂函数
 */
export function initAiSidebar({ getAppState, getEditorRegistry, reloadCurrentFile, confirm }) {
    return new AiSidebar({ getAppState, getEditorRegistry, reloadCurrentFile, confirm });
}
