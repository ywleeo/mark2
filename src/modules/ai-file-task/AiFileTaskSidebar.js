import { basename } from '../../utils/pathUtils.js';
import { addClickHandler } from '../../utils/PointerHelper.js';
import { createStore } from '../../services/storage.js';
import { t } from '../../i18n/index.js';
import { copyButtonIcon } from '../../icons/uiIcons.js';
import { AiFileTaskService } from './AiFileTaskService.js';
import { DocumentTaskResultStore } from './DocumentTaskResultStore.js';
import { DocumentTaskSession } from './DocumentTaskSession.js';
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
 * 当前文档的 AI 工作稿侧栏。
 * 每次提示词都作为新的当前任务交给自主执行器，不保存聊天历史。
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
     * @param {()=>object|null} [options.getStatusBarController] - 状态栏访问器
     */
    constructor(options = {}) {
        this.fileService = options.fileService;
        this.getFileContent = options.getFileContent || null;
        this.untitledFileManager = options.untitledFileManager || null;
        this.saveCurrentEditorContentToCache = options.saveCurrentEditorContentToCache || null;
        this.openResultAsUntitled = options.openResultAsUntitled || null;
        this.insertResult = options.insertResult || null;
        this.getStatusBarController = options.getStatusBarController || (() => null);
        this.service = options.service || new AiFileTaskService();
        this.resultStore = options.resultStore || new DocumentTaskResultStore();
        this.session = new DocumentTaskSession();
        this.root = null;
        this.currentPath = '';
        this.result = null;
        this.initialInstruction = '';
        this.lastInstruction = '';
        this.previousContent = '';
        this.filename = '';
        this.pendingPath = '';
        this.cleanups = [];
        this.isVisible = false;
        this.isRunning = false;
        this.isEditing = false;
        this.copyFeedbackTimer = null;
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
        if (path !== this.currentPath) this.loadDocument(path);
        this.root.style.display = 'flex';
        this.root.classList.add('is-visible');
        this.isVisible = true;
        document.getElementById('statusBarAiTask')?.classList.add('is-active');
        this.syncView();
        this.root.querySelector('[name="instruction"]')?.focus();
    }

    /**
     * 已打开侧栏时跟随当前标签页切换工作稿。
     * @param {string|null} path - 当前文件路径
     */
    updateCurrentFile(path) {
        if (!this.isVisible) return;
        if (!path) {
            this.close();
            return;
        }
        if (path === this.currentPath) return;
        if (this.isRunning) {
            this.pendingPath = path;
            return;
        }
        this.loadDocument(path);
        this.syncView();
    }

    /** 创建并挂载侧栏 DOM。 */
    ensureElement() {
        if (this.root) return;
        const contentArea = document.getElementById('contentArea');
        if (!contentArea) throw new Error('AiFileTaskSidebar requires #contentArea');

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
                <button type="button" class="ai-file-task-sidebar__icon-button" data-action="close" aria-label="${escapeHtml(t('common.cancel'))}">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
                </button>
            </header>
            <div class="ai-file-task-sidebar__body">
                <section class="ai-file-task-sidebar__request">
                    <label for="aiFileTaskInstruction" data-ref="instruction-label">${escapeHtml(t('aiFileTask.instruction'))}</label>
                    <textarea id="aiFileTaskInstruction" name="instruction" rows="4"></textarea>
                    <div class="ai-file-task-sidebar__request-footer">
                        <span data-ref="request-hint"></span>
                        <button type="button" class="ai-file-task-sidebar__run" data-action="run">${escapeHtml(t('aiFileTask.run'))}</button>
                    </div>
                </section>
                <section class="ai-file-task-sidebar__processing" data-ref="processing" hidden role="status" aria-live="polite">
                    <div><strong>AI</strong><span>${escapeHtml(t('aiFileTask.running'))}</span><i></i><i></i><i></i></div>
                    <span>${escapeHtml(t('aiFileTask.processingDetail'))}</span>
                </section>
                <section class="ai-file-task-sidebar__draft" data-ref="draft">
                    <div class="ai-file-task-sidebar__empty">${escapeHtml(t('aiFileTask.workspacePlaceholder'))}</div>
                </section>
            </div>
            <footer class="ai-file-task-sidebar__footer" data-ref="footer">
                <span class="ai-file-task-sidebar__status" data-ref="status"></span>
                <div class="ai-file-task-sidebar__footer-actions">
                    <button type="button" class="ai-file-task-sidebar__text-button" data-action="new-task" hidden>${escapeHtml(t('aiFileTask.newTask'))}</button>
                    <button type="button" class="ai-file-task-sidebar__text-button" data-action="insert-result" hidden>${escapeHtml(t('aiFileTask.insertResult'))}</button>
                    <button type="button" class="ai-file-task-sidebar__text-button" data-action="open-result" hidden>${escapeHtml(t('aiFileTask.openResult'))}</button>
                    <button type="button" class="code-copy-button is-visible ai-file-task-sidebar__copy" data-action="copy-result" title="${escapeHtml(t('aiFileTask.copyResult'))}" aria-label="${escapeHtml(t('aiFileTask.copyResult'))}" hidden>${copyButtonIcon()}</button>
                </div>
            </footer>
        `;
        contentArea.appendChild(root);
        this.root = root;

        const savedWidth = Number(layoutStore.get('width', DEFAULT_WIDTH));
        root.style.flexBasis = `${Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, savedWidth))}px`;
        this.bindEvents();
        this.resizeCleanup = this.setupResize();
    }

    /** 绑定组件级交互。 */
    bindEvents() {
        this.cleanups.push(addClickHandler(this.root, (event) => {
            const action = event.target?.closest?.('[data-action]')?.dataset?.action;
            if (!action) return;
            if (action === 'close') this.close();
            if (action === 'run') void this.run();
            if (action === 'copy-result') void this.copyResult();
            if (action === 'open-result') void this.openResult();
            if (action === 'insert-result') this.insertCurrentResult();
            if (action === 'toggle-edit') this.toggleEdit();
            if (action === 'undo-result') this.undoResult();
            if (action === 'new-task') this.startNewTask();
        }, {
            shouldHandle: event => Boolean(event.target?.closest?.('[data-action]')),
            preventDefault: true,
        }));

        const onInput = (event) => {
            if (!event.target?.matches?.('[data-ref="draft-editor"]')) return;
            this.result = { ...(this.result || {}), content: event.target.value };
            this.schedulePersist();
        };
        this.root.addEventListener('input', onInput);
        this.cleanups.push(() => this.root?.removeEventListener('input', onInput));

        const onKeydown = (event) => {
            if (!this.isVisible || !this.root?.contains(event.target)) return;
            if (event.key === 'Escape' && !this.isRunning) this.close();
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault();
                void this.run();
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
            this.root.style.flexBasis = `${width}px`;
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

    /** 从持久层载入指定文档的 AI 工作稿。 */
    loadDocument(path) {
        this.flushPersist();
        const saved = this.resultStore.get(path);
        this.currentPath = path;
        this.pendingPath = '';
        this.result = saved?.content ? { content: saved.content } : null;
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
        // 保留最近一次提示词，方便用户核对、微调后继续提交。
        if (instruction) instruction.value = this.lastInstruction || '';
        const label = this.root.querySelector('[data-ref="instruction-label"]');
        if (label) label.textContent = this.result ? t('aiFileTask.refineInstruction') : t('aiFileTask.instruction');
        const hint = this.root.querySelector('[data-ref="request-hint"]');
        if (hint) hint.textContent = this.result ? t('aiFileTask.refineHint') : t('aiFileTask.firstRunHint');
        this.renderDraft();
        this.syncActions();
        this.setStatus(this.result ? t('aiFileTask.draftReady') : '');
    }

    /** 渲染工作稿预览或 Markdown 编辑器。 */
    renderDraft() {
        const draft = this.root?.querySelector('[data-ref="draft"]');
        if (!draft) return;
        if (!this.result?.content) {
            draft.innerHTML = `<div class="ai-file-task-sidebar__empty">${escapeHtml(t('aiFileTask.workspacePlaceholder'))}</div>`;
            return;
        }
        const editLabel = this.isEditing ? t('aiFileTask.previewResult') : t('aiFileTask.editResult');
        draft.innerHTML = `
            <div class="ai-file-task-sidebar__draft-header">
                <strong>${escapeHtml(t('aiFileTask.draftTitle'))}</strong>
                <div>
                    <button type="button" data-action="undo-result" ${this.previousContent ? '' : 'disabled'}>${escapeHtml(t('common.undo'))}</button>
                    <button type="button" data-action="toggle-edit">${escapeHtml(editLabel)}</button>
                </div>
            </div>
            ${this.isEditing
                ? `<textarea class="ai-file-task-sidebar__draft-editor" data-ref="draft-editor" spellcheck="true">${escapeHtml(this.result.content)}</textarea>`
                : `<article class="ai-file-task__answer ai-file-task-sidebar__preview">${renderBasicMarkdown(this.result.content)}</article>`}
        `;
    }

    /** 根据是否存在工作稿启用底部操作。 */
    syncActions() {
        const hasResult = Boolean(this.result?.content?.trim());
        ['new-task', 'insert-result', 'open-result', 'copy-result'].forEach(action => {
            const button = this.root?.querySelector(`[data-action="${action}"]`);
            if (button) button.hidden = !hasResult;
        });
    }

    /** 把最新提示词和可用资料交给同一个自主任务执行器。 */
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
        const oldContent = this.result?.content || '';
        this.setBusy(true);
        try {
            const fileContent = await this.readCurrentFileContent(task.sourcePath);
            if (!this.session.isCurrent(task) || !this.isVisible) return;
            const result = await this.service.runTask({
                filePath: task.sourcePath,
                fileContent,
                currentResult: oldContent,
                initialInstruction: this.initialInstruction,
                instruction,
            });
            if (!this.initialInstruction) this.initialInstruction = instruction;
            if (!this.filename) this.filename = createFallbackFilename(task.sourcePath);
            if (!this.session.isCurrent(task) || !this.isVisible) return;
            this.previousContent = oldContent;
            this.lastInstruction = instruction;
            this.result = { content: result.content };
            this.isEditing = false;
            this.persistCurrentResult();
            this.renderDraft();
            this.syncActions();
            this.setStatus(t('aiFileTask.done'), 'success');
        } catch (error) {
            if (!this.session.isCurrent(task) || !this.isVisible) return;
            this.setStatus(error?.message || String(error), 'error');
        } finally {
            if (!this.session.isCurrent(task)) return;
            this.setBusy(false);
            if (this.pendingPath && this.isVisible) {
                const nextPath = this.pendingPath;
                this.pendingPath = '';
                this.loadDocument(nextPath);
                this.syncView();
            }
        }
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

    /** 清空当前文档的工作稿，开始一次独立任务。 */
    startNewTask() {
        if (this.isRunning) return;
        this.resultStore.remove(this.currentPath);
        this.result = null;
        this.initialInstruction = '';
        this.lastInstruction = '';
        this.previousContent = '';
        this.filename = '';
        this.isEditing = false;
        this.syncView();
        this.root?.querySelector('[name="instruction"]')?.focus();
    }

    /** 把当前工作稿插入当前活动编辑器。 */
    insertCurrentResult() {
        this.captureDraftEditor();
        const content = this.result?.content?.trim();
        if (!content || typeof this.insertResult !== 'function') return;
        const inserted = this.insertResult(content);
        this.setStatus(
            inserted === false ? t('aiFileTask.error.insertUnavailable') : t('aiFileTask.inserted'),
            inserted === false ? 'error' : 'success',
        );
    }

    /** 将当前工作稿打开为临时 Markdown 文档。 */
    async openResult() {
        this.captureDraftEditor();
        const content = this.result?.content?.trim();
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

    /** 复制当前工作稿，并复用全局复制按钮反馈。 */
    async copyResult() {
        this.captureDraftEditor();
        const content = this.result?.content?.trim();
        if (!content) return;
        try {
            await navigator.clipboard.writeText(content);
            const button = this.root?.querySelector('[data-action="copy-result"]');
            if (button) {
                button.classList.add('copy-success');
                button.innerHTML = copyButtonIcon({ success: true });
            }
            this.setStatus(t('aiFileTask.copied'), 'success');
            this.clearCopyFeedback();
            this.copyFeedbackTimer = window.setTimeout(() => this.restoreCopyButton(), 1600);
        } catch (error) {
            this.setStatus(error?.message || String(error), 'error');
        }
    }

    /** 清理复制反馈定时器。 */
    clearCopyFeedback() {
        if (this.copyFeedbackTimer !== null) window.clearTimeout(this.copyFeedbackTimer);
        this.copyFeedbackTimer = null;
    }

    /** 恢复复制按钮默认图标。 */
    restoreCopyButton() {
        this.copyFeedbackTimer = null;
        const button = this.root?.querySelector('[data-action="copy-result"]');
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

    /** 持久化当前文档的单一工作稿状态。 */
    persistCurrentResult() {
        const content = this.result?.content?.trim();
        if (!this.currentPath || !content) return;
        this.resultStore.set(this.currentPath, {
            content,
            initialInstruction: this.initialInstruction,
            lastInstruction: this.lastInstruction,
            previousContent: this.previousContent,
            filename: this.filename,
        });
    }

    /** 设置运行状态，保留当前工作稿但锁定会冲突的操作。 */
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

    /** 更新底部状态。 */
    setStatus(message, state = 'info') {
        const status = this.root?.querySelector('[data-ref="status"]');
        if (!status) return;
        status.textContent = message || '';
        status.dataset.state = state;
    }

    /** 关闭侧栏并停止接收当前请求结果。 */
    close() {
        this.flushPersist();
        this.session.cancel();
        this.pendingPath = '';
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
