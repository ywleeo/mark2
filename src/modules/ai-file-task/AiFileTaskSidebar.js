/** 按文档隔离的 AI 对话侧栏，消息操作绑定各自回复，输入区固定在底部。 */
import { basename } from '../../utils/pathUtils.js';
import { addClickHandler } from '../../utils/PointerHelper.js';
import { createStore } from '../../services/storage.js';
import { t } from '../../i18n/index.js';
import { copyButtonIcon } from '../../icons/uiIcons.js';
import { AiFileTaskService } from './AiFileTaskService.js';
import { DocumentTaskResultStore } from './DocumentTaskResultStore.js';
import { DocumentTaskSession } from './DocumentTaskSession.js';
import { normalizeConversation, restoreConversation } from './DocumentTaskConversation.js';
import MarkdownIt from 'markdown-it';

const layoutStore = createStore('ai-file-task-sidebar');
const DEFAULT_WIDTH = 340;
const MIN_WIDTH = 280;
const MAX_WIDTH = 560;
const markdown = new MarkdownIt({ html: false, linkify: false, typographer: false, breaks: false });

/**
 * 转义界面文本，避免路径和模型内容污染组件 DOM。
 * @param {string} value - 原始文本
 * @returns {string} 安全 HTML 文本
 */
function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    }[character]));
}

/**
 * 渲染受限 Markdown 预览，不允许模型输出内嵌 HTML。
 * @param {string} value - Markdown 原文
 * @returns {string} 渲染后的 HTML
 */
function renderBasicMarkdown(value) {
    return markdown.render(String(value || '').trim());
}

/**
 * 统一渲染消息气泡，每条 AI 回复附带独立操作，最新回复支持编辑与撤销。
 * @param {'user'|'assistant'} role - 消息角色
 * @param {string} content - 消息正文
 * @param {{editable?:boolean,isEditing?:boolean,previousContent?:string}} [options] - 最新回复的编辑状态
 * @returns {string} 消息内部 HTML
 */
function renderMessageContents(role, content, { editable = false, isEditing = false, previousContent = '' } = {}) {
    const isUser = role === 'user';
    const author = isUser ? escapeHtml(t('aiFileTask.you')) : 'AI';
    const avatar = isUser ? '' : `<span class="ai-file-task-sidebar__message-avatar" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="m12 3 2.7 6.3L21 12l-6.3 2.7L12 21l-2.7-6.3L3 12l6.3-2.7Z"/></svg>
    </span>`;
    const actions = editable ? `<div class="ai-file-task-sidebar__message-actions">
        <button type="button" data-action="undo-result" ${previousContent ? '' : 'disabled'}>${escapeHtml(t('common.undo'))}</button>
        <button type="button" data-action="toggle-edit">${escapeHtml(t(isEditing ? 'aiFileTask.previewResult' : 'aiFileTask.editResult'))}</button>
    </div>` : '';
    const body = isUser
        ? `<div class="ai-file-task-sidebar__user-text">${escapeHtml(content)}</div>`
        : (isEditing
            ? `<textarea class="ai-file-task-sidebar__draft-editor" data-ref="draft-editor" spellcheck="true">${escapeHtml(content)}</textarea>`
            : `<div class="ai-file-task__answer ai-file-task-sidebar__preview">${renderBasicMarkdown(content)}</div>`);
    const replyActions = isUser ? '' : `<div class="ai-file-task-sidebar__reply-actions">
        <button type="button" class="ai-file-task-sidebar__text-button" data-action="insert-result">${escapeHtml(t('aiFileTask.insertResult'))}</button>
        <button type="button" class="ai-file-task-sidebar__text-button" data-action="open-result">${escapeHtml(t('aiFileTask.openResult'))}</button>
        <button type="button" class="code-copy-button is-visible ai-file-task-sidebar__copy" data-action="copy-result" title="${escapeHtml(t('aiFileTask.copyResult'))}" aria-label="${escapeHtml(t('aiFileTask.copyResult'))}">${copyButtonIcon()}</button>
    </div>`;
    return `<div class="ai-file-task-sidebar__message-header">
        <span class="ai-file-task-sidebar__message-author">${avatar}<span>${author}</span></span>
        ${actions}
    </div><div class="ai-file-task-sidebar__message-bubble">${body}</div>${replyActions}`;
}

/**
 * 基于源文档名生成不带意图猜测的工作稿文件名。
 * @param {string} sourcePath - 源文档路径
 * @returns {string} 建议文件名
 */
function createFallbackFilename(sourcePath) {
    const sourceName = basename(sourcePath) || 'document.md';
    const dotIndex = sourceName.lastIndexOf('.');
    const base = dotIndex > 0 ? sourceName.slice(0, dotIndex) : sourceName;
    return `${base}-ai.md`;
}

/**
 * 清理模型建议的新文档名，禁止路径片段进入 untitled 虚拟路径。
 * @param {string} value - 模型建议文件名
 * @param {string} sourcePath - 当前源文档路径
 * @returns {string} 安全的 Markdown 文件名
 */
function normalizeAgentFilename(value, sourcePath) {
    const rawName = basename(String(value || '').trim())
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .trim();
    const fallback = createFallbackFilename(sourcePath);
    const name = rawName || fallback;
    return /\.md$/i.test(name) ? name : `${name}.md`;
}

/**
 * 当前文档的 AI 工作稿侧栏。
 * 问答历史按文档隔离，输入区固定在底部，每条回答保留独立的内容操作。
 */
export class AiFileTaskSidebar {
    /**
     * @param {object} options - 依赖注入
     * @param {object} options.fileService - 文件服务
     * @param {(path:string, options?:object)=>Promise<{content:string}>} [options.getFileContent] - 文档快照读取器
     * @param {{isUntitledPath?:(path:string)=>boolean,getContent?:(path:string)=>string}} [options.untitledFileManager] - 临时文档管理器
     * @param {()=>void} [options.saveCurrentEditorContentToCache] - 同步当前编辑器快照
     * @param {(args:{content:string,filename:string})=>Promise<string>} [options.openResultAsUntitled] - 打开工作稿文档
     * @param {(content:string)=>boolean|void} [options.insertResult] - 把工作稿插入当前编辑器
     * @param {(path:string)=>void} [options.pinDocument] - 将 AI 任务源文档固定为独立 file tab
     * @param {(path:string,state:'working'|'done'|'error'|'idle')=>void} [options.onTaskStateChange] - 通知源文档 tab 的 AI 工作状态
     * @param {()=>object|null} [options.getStatusBarController] - 状态栏访问器
     */
    constructor(options = {}) {
        this.fileService = options.fileService;
        this.getFileContent = options.getFileContent || null;
        this.untitledFileManager = options.untitledFileManager || null;
        this.saveCurrentEditorContentToCache = options.saveCurrentEditorContentToCache || null;
        this.openResultAsUntitled = options.openResultAsUntitled || null;
        this.insertResult = options.insertResult || null;
        this.pinDocument = options.pinDocument || null;
        this.onTaskStateChange = options.onTaskStateChange || null;
        this.getStatusBarController = options.getStatusBarController || (() => null);
        this.service = options.service || new AiFileTaskService();
        this.resultStore = options.resultStore || new DocumentTaskResultStore();
        this.session = new DocumentTaskSession();
        this.root = null;
        this.currentPath = '';
        this.currentDocumentId = '';
        this.result = null;
        this.messages = [];
        this.inputInstruction = '';
        this.pendingInstruction = '';
        this.inputDrafts = new Map();
        this.initialInstruction = '';
        this.lastInstruction = '';
        this.previousContent = '';
        this.filename = '';
        this.pendingPath = '';
        this.pendingVisibility = false;
        this.cleanups = [];
        this.isVisible = false;
        this.isRunning = false;
        this.isEditing = false;
        this.copyFeedbackTimer = null;
        this.copyFeedbackButton = null;
        this.persistTimer = null;
        this.resizeCleanup = null;
    }

    /**
     * 打开侧栏并绑定当前文档。
     * @param {{path:string}} params - 当前文件
     */
    open({ path }) {
        if (!path) return;
        this.ensureElement();
        if (this.isRunning && path !== this.currentPath) {
            this.pendingPath = path;
            this.pendingVisibility = true;
            this.hideForTabSwitch();
            return;
        }
        if (path !== this.currentPath || this.getDocumentId(path) !== this.currentDocumentId) this.loadDocument(path);
        this.showForTab(true);
    }

    /**
     * 在当前文档的 AI 工作稿侧栏打开与关闭之间切换。
     * @param {{path:string}} params - 当前文件。
     * @returns {boolean} 切换后侧栏是否可见。
     */
    toggle({ path } = {}) {
        if (this.isVisible) {
            this.close();
            return false;
        }
        this.open({ path });
        return this.isVisible;
    }

    /**
     * 跟随活动文档 tab 切换侧栏上下文；运行中的任务继续绑定原文档并在后台完成。
     * @param {string|null} path - 活动文档路径
     * @param {boolean} visible - 目标文档的 AI 侧栏是否打开
     */
    setTabContext(path, visible) {
        if (!path) {
            this.pendingPath = '';
            this.pendingVisibility = false;
            this.hideForTabSwitch();
            return;
        }

        if (this.isRunning && path !== this.currentPath) {
            this.pendingPath = path;
            this.pendingVisibility = Boolean(visible);
            this.hideForTabSwitch();
            return;
        }

        if (path === this.currentPath && this.getDocumentId(path) === this.currentDocumentId) {
            this.pendingPath = '';
            this.pendingVisibility = false;
        } else {
            this.loadDocument(path);
        }

        if (visible) {
            this.showForTab(false);
        } else {
            this.hideForTabSwitch();
        }
    }

    /**
     * 查询指定 tab 的 AI 侧栏逻辑状态，也覆盖运行中尚待恢复的 tab。
     * @param {string} path - 文档路径
     * @returns {boolean} 对应 tab 的 AI 侧栏是否打开
     */
    isOpenForTab(path) {
        if (!path) return false;
        if (this.isRunning && this.pendingPath === path) {
            return this.pendingVisibility;
        }
        return this.currentPath === path && this.isVisible;
    }

    /** 显示当前 tab 的 AI 侧栏，不改变文档任务会话。 */
    showForTab(focusInput = false) {
        if (!this.root) return;
        this.root.style.display = 'flex';
        this.root.classList.add('is-visible');
        this.isVisible = true;
        document.getElementById('statusBarAiTask')?.classList.add('is-active');
        this.syncView();
        if (focusInput) this.root.querySelector('[name="instruction"]')?.focus();
    }

    /** 隐藏侧栏但不取消 AI 请求，用于切换到其他文档 tab。 */
    hideForTabSwitch() {
        if (!this.root) {
            this.isVisible = false;
            return;
        }
        this.root.classList.remove('is-visible');
        this.root.style.display = 'none';
        this.isVisible = false;
        document.getElementById('statusBarAiTask')?.classList.remove('is-active');
    }

    /** 创建并挂载侧栏 DOM。 */
    ensureElement() {
        if (this.root) return;
        const workspace = document.querySelector('.content-wrapper');
        if (!workspace) throw new Error('AiFileTaskSidebar requires .content-wrapper');

        const root = document.createElement('aside');
        root.className = 'ai-file-task-sidebar';
        root.style.display = 'none';
        root.innerHTML = `
            <div class="ai-file-task-sidebar__resizer" aria-hidden="true"></div>
            <header class="ai-file-task-sidebar__header">
                <div class="ai-file-task-sidebar__identity">
                    <span class="ai-file-task__badge">AI</span>
                    <div class="ai-file-task-sidebar__heading">
                        <strong>${escapeHtml(t('aiFileTask.workspaceTitle'))}</strong>
                        <span data-ref="path"></span>
                    </div>
                </div>
                <div class="ai-file-task-sidebar__header-actions">
                    <button type="button" class="ai-file-task-sidebar__text-button" data-action="new-task" hidden>${escapeHtml(t('aiFileTask.newTask'))}</button>
                    <button type="button" class="ai-file-task-sidebar__icon-button" data-action="close" aria-label="${escapeHtml(t('common.cancel'))}">
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
                    </button>
                </div>
            </header>
            <div class="ai-file-task-sidebar__body">
                <section class="ai-file-task-sidebar__conversation" data-ref="conversation" role="log" aria-label="${escapeHtml(t('aiFileTask.workspaceTitle'))}">
                    <div class="ai-file-task-sidebar__messages" data-ref="messages"></div>
                    <section class="ai-file-task-sidebar__draft" data-ref="draft">
                        <div class="ai-file-task-sidebar__empty">${escapeHtml(t('aiFileTask.workspacePlaceholder'))}</div>
                    </section>
                    <div class="ai-file-task-sidebar__status" data-ref="status" role="status" aria-live="polite" hidden></div>
                </section>
            </div>
            <section class="ai-file-task-sidebar__request">
                <div class="ai-file-task-sidebar__processing" data-ref="processing" hidden role="status" aria-live="polite">
                    <div><span>${escapeHtml(t('aiFileTask.processingLabel'))}</span><i aria-hidden="true"></i><i aria-hidden="true"></i><i aria-hidden="true"></i></div>
                </div>
                <textarea id="aiFileTaskInstruction" name="instruction" rows="3" placeholder="${escapeHtml(t('aiFileTask.instruction'))}" aria-label="${escapeHtml(t('aiFileTask.instruction'))}" aria-describedby="aiFileTaskRequestHint"></textarea>
                <div class="ai-file-task-sidebar__request-footer">
                    <span id="aiFileTaskRequestHint" data-ref="request-hint"></span>
                    <button type="button" class="ai-file-task-sidebar__run" data-action="run">${escapeHtml(t('aiFileTask.run'))}</button>
                </div>
            </section>
        `;
        // 侧栏与文档区域同级，从工具栏顶部开始；不占用文档内容区内部的高度。
        workspace.appendChild(root);
        this.root = root;

        const savedWidth = Number(layoutStore.get('width', DEFAULT_WIDTH));
        root.style.width = `${Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, savedWidth))}px`;
        this.bindEvents();
        this.resizeCleanup = this.setupResize();
    }

    /** 绑定组件级交互。 */
    bindEvents() {
        this.cleanups.push(addClickHandler(this.root, (event) => {
            const button = event.target?.closest?.('[data-action]');
            const action = button?.dataset?.action;
            if (!action || button.disabled) return;
            const message = button.closest('.ai-file-task-sidebar__message');
            if (action === 'close') this.close();
            if (action === 'run') void this.run();
            if (action === 'copy-result') void this.copyResult(message, button);
            if (action === 'open-result') void this.openResult(message);
            if (action === 'insert-result') this.insertCurrentResult(message);
            if (action === 'toggle-edit') this.toggleEdit();
            if (action === 'undo-result') this.undoResult();
            if (action === 'new-task') this.startNewTask();
        }, {
            shouldHandle: event => Boolean(event.target?.closest?.('[data-action]')),
            preventDefault: true,
        }));

        const onInput = (event) => {
            if (event.target?.matches?.('[name="instruction"]')) {
                this.inputInstruction = event.target.value;
                this.inputDrafts.set(this.currentDocumentId || this.currentPath, this.inputInstruction);
                return;
            }
            if (!event.target?.matches?.('[data-ref="draft-editor"]')) return;
            this.result = { ...(this.result || {}), content: event.target.value };
            this.schedulePersist();
        };
        this.root.addEventListener('input', onInput);
        this.cleanups.push(() => this.root?.removeEventListener('input', onInput));

        const onKeydown = (event) => {
            if (!this.isVisible || !this.root?.contains(event.target)) return;
            if (event.key === 'Escape' && !this.isRunning) this.close();
            // Enter 发送，Shift+Enter 换行；WebKit 的输入法确认可能只通过 keyCode 229 标记。
            if (event.key === 'Enter' && !event.shiftKey && !event.altKey
                && !event.isComposing && event.keyCode !== 229
                && event.target?.matches?.('[name="instruction"]')) {
                event.preventDefault();
                event.stopPropagation();
                if (!event.repeat) void this.run();
            }
        };
        document.addEventListener('keydown', onKeydown, true);
        this.cleanups.push(() => document.removeEventListener('keydown', onKeydown, true));
    }

    /** 绑定侧栏宽度拖动，并持久化用户选择。 */
    setupResize() {
        const resizer = this.root?.querySelector('.ai-file-task-sidebar__resizer');
        if (!resizer) return null;
        let pointerId = null;
        let startX = 0;
        let startWidth = 0;

        const stop = event => {
            if (pointerId === null || event.pointerId !== pointerId) return;
            if (resizer.hasPointerCapture(pointerId)) resizer.releasePointerCapture(pointerId);
            pointerId = null;
            document.body.classList.remove('ai-file-task-resizing');
            document.body.style.userSelect = '';
            layoutStore.set('width', this.root.getBoundingClientRect().width);
        };
        const onDown = event => {
            if (pointerId !== null) return;
            pointerId = event.pointerId;
            startX = event.clientX;
            startWidth = this.root.getBoundingClientRect().width;
            resizer.setPointerCapture(pointerId);
            document.body.classList.add('ai-file-task-resizing');
            document.body.style.userSelect = 'none';
            event.preventDefault();
        };
        const onMove = event => {
            if (pointerId === null || event.pointerId !== pointerId) return;
            const width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth - (event.clientX - startX)));
            this.root.style.width = `${width}px`;
        };
        resizer.addEventListener('pointerdown', onDown);
        resizer.addEventListener('pointermove', onMove);
        resizer.addEventListener('pointerup', stop);
        resizer.addEventListener('pointercancel', stop);
        return () => {
            resizer.removeEventListener('pointerdown', onDown);
            resizer.removeEventListener('pointermove', onMove);
            resizer.removeEventListener('pointerup', stop);
            resizer.removeEventListener('pointercancel', stop);
        };
    }

    /** 获取临时文档生命周期身份；磁盘文档继续按完整路径隔离。 */
    getDocumentId(path) {
        return this.untitledFileManager?.getDocumentId?.(path) || '';
    }

    /** 从持久层载入指定文档的 AI 工作稿。 */
    loadDocument(path) {
        this.flushPersist();
        const documentId = this.getDocumentId(path);
        const saved = this.resultStore.get(path, documentId);
        this.currentPath = path;
        this.currentDocumentId = documentId;
        this.pendingPath = '';
        this.result = saved?.content ? { content: saved.content } : null;
        this.messages = restoreConversation(saved);
        this.inputInstruction = this.inputDrafts.get(documentId || path) || '';
        this.pendingInstruction = '';
        this.initialInstruction = saved?.initialInstruction || '';
        this.lastInstruction = saved?.lastInstruction || '';
        this.previousContent = saved?.previousContent || '';
        this.filename = saved?.filename || '';
        this.isEditing = false;
    }

    /** 同步当前文档、输入区、工作稿和操作状态。 */
    syncView() {
        if (!this.root) return;
        const path = this.root.querySelector('[data-ref="path"]');
        if (path) {
            path.textContent = basename(this.currentPath);
            path.title = this.currentPath;
        }
        const instruction = this.root.querySelector('[name="instruction"]');
        if (instruction) instruction.value = this.inputInstruction;
        this.syncComposer();
        this.renderConversation();
        this.syncActions();
        this.setStatus(this.isRunning ? t('aiFileTask.running') : (this.result ? t('aiFileTask.draftReady') : ''));
    }

    /** 渲染完整问答；最新回答由工作稿区域承接，先前消息保持只读。 */
    renderConversation() {
        const container = this.root?.querySelector('[data-ref="messages"]');
        if (!container) return;
        this.root.querySelector('[data-ref="pending-message"]')?.remove();
        // 最后一条助手回复显示为可编辑工作稿，避免在时间线中重复展示。
        const visibleMessages = this.result && this.messages.at(-1)?.role === 'assistant'
            ? this.messages.slice(0, -1) : this.messages;
        container.innerHTML = visibleMessages.map((message, index) => `
            <article class="ai-file-task-sidebar__message" data-role="${message.role}" data-message-index="${index}">
                ${renderMessageContents(message.role, message.content)}
            </article>
        `).join('');
        this.renderDraft();
        if (this.pendingInstruction) {
            const pending = document.createElement('article');
            pending.className = 'ai-file-task-sidebar__message';
            pending.dataset.role = 'user';
            pending.dataset.ref = 'pending-message';
            pending.innerHTML = renderMessageContents('user', this.pendingInstruction);
            container.parentElement.insertBefore(pending, this.root.querySelector('[data-ref="status"]'));
        }
        this.scrollConversationToBottom();
    }

    /** 将新问答滚入可见区域，不影响底部输入框的位置。 */
    scrollConversationToBottom() {
        const conversation = this.root?.querySelector('[data-ref="conversation"]');
        if (conversation) conversation.scrollTop = conversation.scrollHeight;
    }

    /** 渲染工作稿预览或 Markdown 编辑器。 */
    renderDraft() {
        const draft = this.root?.querySelector('[data-ref="draft"]');
        if (!draft) return;
        const hasResult = Boolean(this.result?.content);
        draft.classList.toggle('ai-file-task-sidebar__message', hasResult);
        if (hasResult) draft.dataset.role = 'assistant';
        else delete draft.dataset.role;
        if (!hasResult) {
            draft.innerHTML = this.pendingInstruction ? '' : `<div class="ai-file-task-sidebar__empty">${escapeHtml(t('aiFileTask.workspacePlaceholder'))}</div>`;
            return;
        }
        draft.innerHTML = renderMessageContents('assistant', this.result.content, {
            editable: true,
            isEditing: this.isEditing,
            previousContent: this.previousContent,
        });
    }

    /** 新对话属于对话头部；各条回复的操作随生成状态统一启用或禁用。 */
    syncActions() {
        const hasResult = Boolean(this.result?.content?.trim());
        const newChat = this.root?.querySelector('[data-action="new-task"]');
        if (newChat) newChat.hidden = !hasResult && this.messages.length === 0;
        this.root?.querySelectorAll('button, textarea').forEach(element => {
            if (element.dataset.action === 'close') return;
            element.disabled = this.isRunning
                || (element.dataset.action === 'undo-result' && !this.previousContent);
        });
    }

    /** 提交当前提问与已完成的问答，失败或取消时保留此前工作稿和历史。 */
    async run() {
        if (!this.root || !this.currentPath || this.isRunning) return;
        this.captureDraftEditor();
        const input = this.root.querySelector('[name="instruction"]');
        const instruction = String(input?.value || '').trim();
        if (!instruction) {
            this.setStatus(t('aiFileTask.error.emptyInstruction'), 'error');
            return;
        }

        const task = this.session.begin(this.currentPath);
        task.documentId = this.currentDocumentId;
        // shared 预览槽会在用户打开其他文件时被复用；固定源文档后，AI 任务期间仍可从独立 tab 返回。
        this.pinDocument?.(task.sourcePath);
        this.onTaskStateChange?.(task.sourcePath, 'working');
        const oldContent = this.result?.content || '';
        this.flushPersist();
        const history = normalizeConversation(this.messages);
        this.pendingInstruction = instruction;
        // 点击发送即提交输入；处理中仅在时间线保留本轮提问，不在输入框重复显示。
        this.inputInstruction = '';
        this.inputDrafts.delete(this.currentDocumentId || this.currentPath);
        if (input) input.value = '';
        this.isEditing = false;
        this.renderConversation();
        this.syncActions();
        this.setBusy(true);
        try {
            const fileContent = await this.readCurrentFileContent(task.sourcePath);
            if (!this.session.isCurrent(task) || this.getDocumentId(task.sourcePath) !== task.documentId) return;
            const result = await this.service.runTask({
                filePath: task.sourcePath,
                fileContent,
                currentResult: oldContent,
                initialInstruction: this.initialInstruction,
                messages: history,
                instruction,
                createDocument: async ({ filename, content }) => {
                    if (!this.session.isCurrent(task) || this.getDocumentId(task.sourcePath) !== task.documentId) {
                        throw new Error('当前文档任务已经失效');
                    }
                    if (typeof this.openResultAsUntitled !== 'function') {
                        throw new Error('当前界面无法创建新文档');
                    }
                    const safeFilename = normalizeAgentFilename(filename, task.sourcePath);
                    const path = await this.openResultAsUntitled({
                        content: String(content || ''),
                        filename: safeFilename,
                    });
                    return { path, filename: safeFilename };
                },
            });
            if (!this.session.isCurrent(task) || this.getDocumentId(task.sourcePath) !== task.documentId) return;
            if (!this.initialInstruction) this.initialInstruction = instruction;
            if (!this.filename) this.filename = createFallbackFilename(task.sourcePath);
            this.previousContent = oldContent;
            this.lastInstruction = instruction;
            this.result = { content: result.content };
            this.messages = normalizeConversation([
                ...history,
                { role: 'user', content: instruction },
                { role: 'assistant', content: result.content },
            ]);
            this.pendingInstruction = '';
            this.inputInstruction = '';
            this.inputDrafts.delete(task.documentId || task.sourcePath);
            if (input) input.value = '';
            this.isEditing = false;
            this.persistCurrentResult();
            this.onTaskStateChange?.(task.sourcePath, 'done');
            this.renderConversation();
            this.syncActions();
            this.setStatus(t('aiFileTask.done'), 'success');
        } catch (error) {
            if (!this.session.isCurrent(task)) return;
            this.restorePendingInstruction();
            this.pendingInstruction = '';
            this.renderConversation();
            this.onTaskStateChange?.(task.sourcePath, 'error');
            this.setStatus(error?.message || String(error), 'error');
        } finally {
            if (!this.session.isCurrent(task)) return;
            this.setBusy(false);
            this.syncActions();
            this.syncComposer(true);
            if (this.pendingPath) {
                const nextPath = this.pendingPath;
                const shouldShow = this.pendingVisibility;
                this.pendingPath = '';
                this.pendingVisibility = false;
                this.loadDocument(nextPath);
                if (shouldShow) this.showForTab(false);
                else this.hideForTabSwitch();
            }
        }
    }

    /** 失败或取消时恢复尚未完成的提问，确保用户可以直接重试。 */
    restorePendingInstruction() {
        if (!this.pendingInstruction) return;
        this.inputInstruction = this.pendingInstruction;
        this.inputDrafts.set(this.currentDocumentId || this.currentPath, this.inputInstruction);
        const input = this.root?.querySelector('[name="instruction"]');
        if (input) input.value = this.inputInstruction;
    }

    /** 用输入框占位文字与无障碍名称提示续聊，不额外占用一行标题。 */
    syncComposer(focusInput = false) {
        const input = this.root?.querySelector('[name="instruction"]');
        if (input) {
            const label = this.result ? t('aiFileTask.refineInstruction') : t('aiFileTask.instruction');
            input.placeholder = label;
            input.setAttribute('aria-label', label);
        }
        const hint = this.root?.querySelector('[data-ref="request-hint"]');
        if (hint) hint.textContent = this.result ? t('aiFileTask.refineHint') : t('aiFileTask.firstRunHint');
        if (focusInput && this.isVisible && !this.pendingPath) input?.focus();
    }

    /** 读取当前文档内容，优先取编辑器内存快照。 */
    async readCurrentFileContent(path = this.currentPath) {
        this.saveCurrentEditorContentToCache?.();
        if (this.untitledFileManager?.isUntitledPath?.(path)) {
            return this.untitledFileManager.getContent?.(path) || '';
        }
        if (typeof this.getFileContent === 'function') {
            const snapshot = await this.getFileContent(path);
            if (snapshot && typeof snapshot.content === 'string') return snapshot.content;
        }
        return this.fileService.readText(path);
    }

    /** 把正在编辑的 Markdown 同步到组件状态。 */
    captureDraftEditor() {
        const editor = this.root?.querySelector('[data-ref="draft-editor"]');
        if (editor && this.result) this.result.content = editor.value;
    }

    /** 在预览和 Markdown 源文编辑之间切换。 */
    toggleEdit() {
        if (!this.result?.content || this.isRunning) return;
        this.captureDraftEditor();
        this.isEditing = !this.isEditing;
        this.persistCurrentResult();
        this.renderDraft();
        if (this.isEditing) this.root?.querySelector('[data-ref="draft-editor"]')?.focus();
    }

    /** 恢复模型生成前的上一版工作稿。 */
    undoResult() {
        if (!this.previousContent || !this.result || this.isRunning) return;
        const currentContent = this.result.content;
        this.result.content = this.previousContent;
        this.previousContent = currentContent;
        this.persistCurrentResult();
        this.renderDraft();
        this.setStatus(t('aiFileTask.undoDone'), 'success');
    }

    /** 清空当前文档的工作稿与问答历史，开始一次新对话。 */
    startNewTask() {
        if (this.isRunning) return;
        if (this.persistTimer !== null) window.clearTimeout(this.persistTimer);
        this.persistTimer = null;
        this.resultStore.remove(this.currentPath);
        this.result = null;
        this.messages = [];
        this.inputInstruction = '';
        this.pendingInstruction = '';
        this.inputDrafts.delete(this.currentDocumentId || this.currentPath);
        this.initialInstruction = '';
        this.lastInstruction = '';
        this.previousContent = '';
        this.filename = '';
        this.isEditing = false;
        this.syncView();
        this.root?.querySelector('[name="instruction"]')?.focus();
    }

    /** 读取指定回复正文；最新回复优先同步编辑器，历史回复按消息索引读取。 */
    getReplyContent(message) {
        if (!message || message.dataset.ref === 'draft') {
            this.captureDraftEditor();
            return this.result?.content?.trim() || '';
        }
        const index = Number(message.dataset.messageIndex);
        const reply = Number.isInteger(index) ? this.messages[index] : null;
        return reply?.role === 'assistant' ? reply.content.trim() : '';
    }

    /** 将选中的回复插入当前活动编辑器。 */
    insertCurrentResult(message) {
        const content = this.getReplyContent(message);
        if (!content || typeof this.insertResult !== 'function') return;
        const inserted = this.insertResult(content);
        this.setStatus(
            inserted === false ? t('aiFileTask.error.insertUnavailable') : t('aiFileTask.inserted'),
            inserted === false ? 'error' : 'success',
        );
    }

    /** 将选中的回复打开为临时 Markdown 文档。 */
    async openResult(message) {
        const content = this.getReplyContent(message);
        if (!content || typeof this.openResultAsUntitled !== 'function') return;
        try {
            await this.openResultAsUntitled({
                content,
                filename: this.filename || createFallbackFilename(this.currentPath),
            });
        } catch (error) {
            this.setStatus(error?.message || String(error), 'error');
        }
    }

    /** 复制选中的回复，反馈只显示在本条回复的复制按钮上。 */
    async copyResult(message, button = message?.querySelector('[data-action="copy-result"]')) {
        const content = this.getReplyContent(message);
        if (!content) return;
        const sourcePath = this.currentPath;
        try {
            await navigator.clipboard.writeText(content);
            if (this.currentPath !== sourcePath) return;
            this.restoreCopyButton();
            if (button && this.root?.contains(button)) {
                this.copyFeedbackButton = button;
                button.classList.add('copy-success');
                button.innerHTML = copyButtonIcon({ success: true });
                this.copyFeedbackTimer = window.setTimeout(() => this.restoreCopyButton(), 1600);
            }
            this.setStatus(t('aiFileTask.copied'), 'success');
        } catch (error) {
            if (this.currentPath === sourcePath) this.setStatus(error?.message || String(error), 'error');
        }
    }

    /** 清理复制反馈定时器。 */
    clearCopyFeedback() {
        if (this.copyFeedbackTimer !== null) window.clearTimeout(this.copyFeedbackTimer);
        this.copyFeedbackTimer = null;
    }

    /** 恢复复制按钮默认图标。 */
    restoreCopyButton() {
        this.clearCopyFeedback();
        const button = this.copyFeedbackButton;
        this.copyFeedbackButton = null;
        if (!button) return;
        button.classList.remove('copy-success');
        button.innerHTML = copyButtonIcon();
    }

    /** 延迟持久化用户正在编辑的工作稿，减少连续输入的存储写入。 */
    schedulePersist() {
        if (this.persistTimer !== null) window.clearTimeout(this.persistTimer);
        this.persistTimer = window.setTimeout(() => {
            this.persistTimer = null;
            this.persistCurrentResult();
        }, 300);
    }

    /** 立即提交尚未落盘的工作稿编辑。 */
    flushPersist() {
        if (this.persistTimer !== null) window.clearTimeout(this.persistTimer);
        this.persistTimer = null;
        this.captureDraftEditor();
        this.persistCurrentResult();
    }

    /** 持久化当前文档的工作稿与完整问答历史。 */
    persistCurrentResult() {
        const content = this.result?.content?.trim();
        if (!this.currentPath || !content) return;
        // 已关闭文档的延迟持久化不得覆盖复用同一路径的新文档。
        if (this.getDocumentId(this.currentPath) !== this.currentDocumentId) return;
        // 工作稿允许用户编辑或撤销，下一轮历史与界面上的最新回答保持一致。
        const latest = this.messages.at(-1);
        if (latest?.role === 'assistant') latest.content = content;
        this.resultStore.set(this.currentPath, {
            documentId: this.currentDocumentId,
            content,
            initialInstruction: this.initialInstruction,
            lastInstruction: this.lastInstruction,
            previousContent: this.previousContent,
            filename: this.filename,
            messages: this.messages,
        });
    }

    /** 设置运行状态并锁定会与生成流程冲突的操作。 */
    setBusy(busy) {
        this.isRunning = busy;
        this.root?.classList.toggle('is-busy', busy);
        const processing = this.root?.querySelector('[data-ref="processing"]');
        if (processing) processing.hidden = !busy;
        this.root?.querySelectorAll('button, textarea').forEach(element => {
            if (element.dataset.action === 'close') return;
            element.disabled = busy;
        });
        if (busy) {
            this.setStatus('');
            this.getStatusBarController()?.showProgress?.(t('aiFileTask.running'));
        } else {
            this.getStatusBarController()?.hideProgress?.({ delay: 300 });
        }
    }

    /** 将操作状态显示在对话末尾，随消息滚动，不占用固定输入区域。 */
    setStatus(message, state = 'info') {
        const status = this.root?.querySelector('[data-ref="status"]');
        if (!status) return;
        const conversation = this.root.querySelector('[data-ref="conversation"]');
        const isAtBottom = conversation
            && conversation.scrollHeight - conversation.scrollTop - conversation.clientHeight <= 2;
        status.textContent = message || '';
        status.dataset.state = state;
        status.hidden = !message;
        // 状态出现会增加时间线高度；只在用户已位于底部时继续跟随，保留历史阅读位置。
        if (isAtBottom) this.scrollConversationToBottom();
    }

    /** 关闭侧栏并停止接收当前请求结果。 */
    close() {
        this.flushPersist();
        if (this.isRunning && this.currentPath) {
            this.onTaskStateChange?.(this.currentPath, 'idle');
        }
        this.session.cancel();
        this.restorePendingInstruction();
        this.pendingInstruction = '';
        this.renderConversation();
        this.pendingPath = '';
        this.pendingVisibility = false;
        this.setBusy(false);
        this.root?.classList.remove('is-visible');
        if (this.root) this.root.style.display = 'none';
        this.isVisible = false;
        document.getElementById('statusBarAiTask')?.classList.remove('is-active');
    }

    /** 销毁侧栏和全部事件监听。 */
    destroy() {
        this.flushPersist();
        this.session.cancel();
        this.clearCopyFeedback();
        this.resizeCleanup?.();
        this.resizeCleanup = null;
        this.cleanups.forEach(cleanup => cleanup?.());
        this.cleanups = [];
        this.root?.remove();
        this.root = null;
    }
}
