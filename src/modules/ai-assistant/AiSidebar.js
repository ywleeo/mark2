/**
 * AI Agent Sidebar
 * 右侧 AI 助手面板，支持多轮对话 + 工具调用（读写文件、管理目录）
 */

import MarkdownIt from 'markdown-it';
import { aiService } from './aiService.js';
import { AgentLoop } from './AgentLoop.js';
import { TOOL_DEFINITIONS, createToolExecutor } from './AgentTools.js';
import { addClickHandler } from '../../utils/PointerHelper.js';
import { basename } from '../../utils/pathUtils.js';
import { writeFile } from '../../api/filesystem.js';
import { untitledFileManager } from '../untitledFileManager.js';

const AI_SIDEBAR_STORAGE_KEYS = {
    width: 'mark2_ai_sidebar_width_v1',
};

const AI_SIDEBAR_DEFAULT_WIDTH = 380;
const AI_SIDEBAR_MIN_WIDTH = 320;
const AI_SIDEBAR_MAX_WIDTH = 720;

// 轻量 markdown 渲染器，仅用于 AI 回复展示（不开 html，防 XSS）
const md = new MarkdownIt({ html: false, linkify: true, typographer: false });

// ── 工具中文标签 ──────────────────────────────────────────
const TOOL_LABELS = {
    get_document_info: '获取文档信息',
    read_document_lines: '读取文档片段',
    search_in_document: '搜索文档内容',
    write_current_document: '修改当前文档',
    read_file: '读取文件',
    write_file: '写入文件',
    delete_file: '删除文件',
    rename_file: '重命名文件',
    list_directory: '列出目录',
    create_directory: '创建目录',
};

// 工具执行中的状态文字
const TOOL_STATUS_RUNNING = {
    write_current_document: '修改文件中',
    write_file: '写入文件中',
    delete_file: '删除文件中',
    rename_file: '重命名中',
    create_directory: '创建目录中',
};

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
    try {
        return clampSidebarWidth(localStorage.getItem(AI_SIDEBAR_STORAGE_KEYS.width));
    } catch {
        return AI_SIDEBAR_DEFAULT_WIDTH;
    }
}

/**
 * 持久化 AI Sidebar 宽度。
 * @param {number} width - 需要保存的宽度
 */
function saveSidebarWidth(width) {
    try {
        localStorage.setItem(AI_SIDEBAR_STORAGE_KEYS.width, String(clampSidebarWidth(width)));
    } catch {
        // 忽略本地存储异常，避免影响主功能
    }
}

// ── 内联卡片：对话中的 assistant 消息 ────────────────────
class AssistantCard {
    constructor(listEl) {
        this.el = document.createElement('div');
        this.el.className = 'ai-message ai-message-assistant';
        this.el.innerHTML = `
            <div class="ai-message-role">AI</div>
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
        this.toolCards = new Map(); // id -> {el}

        // 唯一的 loading 指示器，始终 append 在 bodyEl 末尾
        this.loadingEl = document.createElement('div');
        this.loadingEl.className = 'ai-message-content ai-message-loading';
        this.loadingTextEl = document.createElement('span');
        this.loadingTextEl.className = 'ai-loading-text';
        this.loadingTextEl.textContent = '思考中...';
        this.loadingEl.appendChild(this.loadingTextEl);
        this.bodyEl.appendChild(this.loadingEl);

        // 当前文字 content box，按需创建
        this.currentContentEl = null;
        this.streamThinkingText = '';
        this.inlineThinkingText = '';

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
        this.loadingTextEl.textContent = '思考中...';
        this.loadingEl.style.display = '';
        this.bodyEl.appendChild(this.loadingEl); // 移到最底部
        scrollToBottom(this.el);
    }

    /** 工具调用开始流式生成时：重新显示 loading 指示器 */
    showGenerating(toolName) {
        const GENERATING_LABELS = {
            write_current_document: '生成修改内容中...',
            write_file: '生成文件内容中...',
        };
        this.loadingTextEl.textContent = GENERATING_LABELS[toolName] || '思考中...';
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
        }
        this.currentContentEl.innerHTML = md.render(parsed.content);
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
    done() {
        this.loadingEl.style.display = 'none';
        if (this.currentContentEl && !this.currentContentEl.textContent?.trim()) {
            this.currentContentEl.remove();
            this.currentContentEl = null;
        }
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
        this.bodyEl.insertBefore(card, this.loadingEl);
        this.toolCards.set(id, { el: card });
        scrollToBottom(this.el);
    }

    updateToolCard({ id, name, result }) {
        const entry = this.toolCards.get(id);
        if (!entry) return;
        const { el } = entry;
        el.classList.remove('ai-tool-card-running');

        const statusEl = el.querySelector('.ai-tool-card-status');
        if (shouldShowToolError(result)) {
            el.classList.add('ai-tool-card-error');
            statusEl.textContent = `失败: ${result.error}`;
        } else if (result?.error) {
            el.classList.add('ai-tool-card-done');
            statusEl.textContent = '完成';
            console.warn('[AiSidebar] 工具执行失败，已交由 agent 自行处理', {
                tool: name,
                error: result.error,
            });
        } else if (result?.cancelled) {
            el.classList.add('ai-tool-card-cancelled');
            statusEl.textContent = '已取消';
        } else {
            el.classList.add('ai-tool-card-done');
            statusEl.textContent = '完成';
        }
        scrollToBottom(this.el);
    }

    setError(msg) {
        this.loadingEl.style.display = 'none';
        if (!this.currentContentEl) {
            this.currentContentEl = document.createElement('div');
            this.currentContentEl.className = 'ai-message-content';
            this.bodyEl.insertBefore(this.currentContentEl, this.loadingEl);
        }
        this.currentContentEl.textContent = `错误: ${msg}`;
        this.currentContentEl.style.color = 'var(--ai-tool-error, #ef4444)';
    }

    /**
     * 在 body 内渲染 diff 视图（默认收起），返回 Promise<{applied: boolean}>
     */
    addDiffCard({ path, oldContent, newContent }) {
        // diff 出现 = 内容已生成完毕，把 running 工具卡改为「完成」
        for (const { el } of this.toolCards.values()) {
            if (el.classList.contains('ai-tool-card-running')) {
                el.classList.remove('ai-tool-card-running');
                el.classList.add('ai-tool-card-done');
                el.querySelector('.ai-tool-card-status').textContent = '完成';
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
                    ${hasChanges ? `<button class="ai-diff-apply-btn">应用修改</button>` : ''}
                    <button class="ai-diff-cancel-btn">${hasChanges ? '取消' : '关闭'}</button>
                </div>
            `;

            const diffBodyEl = card.querySelector('.ai-diff-body');
            chunks.forEach((chunk) => {
                if (chunk.type === 'skip') {
                    const skip = document.createElement('div');
                    skip.className = 'ai-diff-skip';
                    skip.textContent = `··· ${chunk.count} 行未改动 ···`;
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
                <div class="ai-confirm-text">确认删除 <strong>${escapeHtml(fileName)}</strong>？</div>
                <div class="ai-confirm-path">${escapeHtml(path)}</div>
                <div class="ai-confirm-actions">
                    <button class="ai-confirm-ok-btn">确认删除</button>
                    <button class="ai-confirm-cancel-btn">取消</button>
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
        return parts.join(' ') || '无变化';
    }
}

// ── 工具函数 ──────────────────────────────────────────────
function escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function scrollToBottom(refEl) {
    const list = refEl.closest?.('.ai-conversation-list');
    if (list) list.scrollTop = list.scrollHeight;
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

        // 对话历史（仅用于 LLM，含 system/user/assistant/tool 消息）
        this.agentMessages = [];
        this.agentLoop = null;
        this.isProcessing = false;
        this.processingPath = null;
        this.processingTabId = null;

        // 当前活跃的 assistant 卡片（用于关联 diff/confirm 到正确的卡片）
        this._activeCard = null;

        // 事件清理函数集合
        this._cleanups = [];

        this._setupToolExecutor();
        this._restoreSidebarWidth();
        this._bindEvents();
        this._bindFileChangeListener();
        this._bindResizeHandle();
        this._updateContextBar();
    }

    // ── 初始化 ────────────────────────────────────────────

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
        this._cleanups.push(() => {
            this.inputEl.removeEventListener('compositionstart', onCompositionStart);
            this.inputEl.removeEventListener('compositionend', onCompositionEnd);
            this.inputEl.removeEventListener('keydown', onKeydown);
        });
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
        this._abortProcessingWithMessage('已因切换文档而停止执行');
        return true;
    }

    /**
     * 弹出确认框，询问用户是否在 AI 运行中切换文档。
     * @param {string|null} nextPath - 新切换到的文档路径
     * @returns {Promise<boolean>} `true` 表示继续离开当前文档，`false` 表示留在原文档
     */
    async _confirmProcessingDocumentChange(nextPath) {
        const nextLabel = nextPath ? basename(nextPath) : '未打开文件';
        const currentLabel = this.processingPath ? basename(this.processingPath) : '当前文档';
        const message = `AI 助手仍在处理“${currentLabel}”。\n\n切换到“${nextLabel}”会停止当前执行。\n\n点击“确定”继续切换，点击“取消”留在当前标签页。`;

        if (typeof this.confirm === 'function') {
            return await this.confirm(message, {
                okText: '继续切换',
                cancelText: '留在当前标签页',
            });
        }
        if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
            return window.confirm(message);
        }
        return true;
    }

    _updateContextBar(path) {
        const resolvedPath = path ?? this.getAppState().getCurrentFile();
        if (resolvedPath) {
            const name = basename(resolvedPath);
            this.fileNameEl.textContent = name;
            this.fileNameEl.classList.remove('is-empty');
            this.fileNameEl.title = resolvedPath;
        } else {
            this.fileNameEl.textContent = '未打开文件';
            this.fileNameEl.classList.add('is-empty');
            this.fileNameEl.title = '';
        }
    }

    // ── 显示/隐藏 ─────────────────────────────────────────

    show() {
        document.body.classList.add('ai-sidebar-visible');
        this._updateContextBar();
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
            this._appendSystemMessage('请先在设置中配置 AI Provider 和 API Key');
            return;
        }

        this.inputEl.value = '';
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

        const card = new AssistantCard(this.listEl);
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
                card.setError(err.message || '未知错误');
                this._stopProcessing();
            },
        });

        try {
            const updatedMessages = await this.agentLoop.run(this.agentMessages);
            this.agentMessages = updatedMessages;
            card.done();
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
        this._abortProcessingWithMessage('已取消');
    }

    _handleClear() {
        if (this.isProcessing) return;
        this.agentMessages = [];
        this.listEl.innerHTML = '';
        this.emptyEl.style.display = '';
    }

    // ── 工具回调 ──────────────────────────────────────────

    async _handleWriteCurrentDocument({ path, oldContent, newContent }) {
        const card = this._activeCard;
        if (!card) return { applied: false };

        const result = await card.addDiffCard({ path, oldContent, newContent });

        if (result.applied) {
            try {
                const latestContent = this._getEditorContent();
                if (typeof latestContent === 'string' && latestContent !== oldContent) {
                    this._appendSystemMessage('当前文档在 AI 生成修改期间已发生变化，请重新生成修改。');
                    return { applied: false };
                }
                if (untitledFileManager.isUntitledPath(path)) {
                    untitledFileManager.setContent(path, newContent);
                } else {
                    await writeFile(path, newContent);
                }
                await this.reloadCurrentFile(path);
            } catch (err) {
                this._appendSystemMessage(`写入文件失败: ${err.message}`);
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
        const el = document.createElement('div');
        el.className = 'ai-message ai-message-user';
        el.innerHTML = `<div class="ai-message-role">You</div><div class="ai-message-content">${escapeHtml(text)}</div>`;
        this.listEl.appendChild(el);
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
        this.cancelBtn.style.display = '';
        this.el.querySelector('.ai-conversation-list').classList.add('ai-processing');
    }

    _stopProcessing() {
        this.isProcessing = false;
        this.sendBtn.disabled = false;
        this.cancelBtn.style.display = 'none';
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
- 不要一次读取超过需要的内容，大文件用 read_document_lines 分块或用 search_in_document 定位
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
