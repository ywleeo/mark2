import { basename } from '../../utils/pathUtils.js';
import { addClickHandler } from '../../utils/PointerHelper.js';
import { createStore } from '../../services/storage.js';
import { t } from '../../i18n/index.js';
import { AiFileTaskService } from './AiFileTaskService.js';
import { DocumentTaskSession } from './DocumentTaskSession.js';
import MarkdownIt from 'markdown-it';

const store = createStore('ai-file-task');
const DEFAULT_SIZE = { width: 420, height: 360 };
const DEFAULT_POSITION = { right: 12, bottom: 58 };
const VIEWPORT_MARGIN = 8;
const markdown = new MarkdownIt({
    html: false,
    linkify: false,
    typographer: false,
    breaks: false,
});

/**
 * 转义 HTML 文本，避免路径和模型输出污染 UI。
 * @param {string} value - 原始文本
 * @returns {string}
 */
function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    }[ch]));
}

/**
 * 把 AI 返回内容渲染为受限 Markdown，保留基础格式但不允许 HTML 注入。
 * @param {string} value - Markdown 原文
 * @returns {string}
 */
function renderBasicMarkdown(value) {
    return markdown.render(String(value || '').trim());
}

/**
 * 根据用户指令生成一个轻量的临时文档建议名。
 * @param {string} instruction - 用户指令
 * @param {string} sourcePath - 源文档路径
 * @returns {string}
 */
function suggestResultFileName(instruction, sourcePath) {
    const text = String(instruction || '').toLowerCase();
    if (/(todo|to-do|待办|任务清单|任務清單)/i.test(text)) {
        return 'to-do-list.md';
    }
    const sourceName = basename(sourcePath) || 'document.md';
    const dotIndex = sourceName.lastIndexOf('.');
    const base = dotIndex > 0 ? sourceName.slice(0, dotIndex) : sourceName;
    return `${base}-ai.md`;
}

/**
 * 一次性 AI 文档任务面板。
 */
export class AiFileTaskDialog {
    /**
     * @param {object} options - 依赖注入
     * @param {object} options.fileService - 文件服务
     * @param {(path:string, options?:object)=>Promise<{content:string}>} [options.getFileContent] - 当前文档内容读取器
     * @param {{isUntitledPath?:(path:string)=>boolean,getContent?:(path:string)=>string}} [options.untitledFileManager] - untitled 虚拟文件管理器
     * @param {()=>void} [options.saveCurrentEditorContentToCache] - 读取前同步编辑器内存快照
     * @param {(args:{content:string,filename:string})=>Promise<string>} [options.openResultAsUntitled] - 打开临时结果文档
     * @param {()=>object|null} [options.getStatusBarController] - 状态栏访问器
     */
    constructor(options = {}) {
        this.fileService = options.fileService;
        this.getFileContent = options.getFileContent || null;
        this.untitledFileManager = options.untitledFileManager || null;
        this.saveCurrentEditorContentToCache = options.saveCurrentEditorContentToCache || null;
        this.openResultAsUntitled = options.openResultAsUntitled || null;
        this.getStatusBarController = options.getStatusBarController || (() => null);
        this.service = options.service || new AiFileTaskService();
        this.session = new DocumentTaskSession();
        this.root = null;
        this.currentPath = '';
        this.result = '';
        this.pendingPath = '';
        this.cleanups = [];
        this.isVisible = false;
        this.isRunning = false;
    }

    /**
     * 打开任务面板。
     * @param {{path:string}} params - 任务目标
     */
    open({ path }) {
        if (!path) return;
        this.session.cancel();
        this.pendingPath = '';
        this.currentPath = path;
        this.result = '';
        this.ensureElement();
        this.setBusy(false);
        this.render();
        this.applyStoredLayout();
        this.root.classList.add('is-visible');
        this.isVisible = true;
        document.getElementById('statusBarAiTask')?.classList.add('is-active');
        this.root.querySelector('[name="instruction"]')?.focus();
    }

    /**
     * 同步当前 tab 文件到已打开的 AI 任务面板。
     * @param {string|null} path - 当前激活文件路径
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
        this.currentPath = path;
        this.result = '';
        this.pendingPath = '';
        this.updateFileDisplay();
        this.resetResultDisplay();
        this.setStatus('');
    }

    /**
     * 创建 DOM 和事件绑定。
     */
    ensureElement() {
        if (this.root) return;
        const root = document.createElement('div');
        root.className = 'ai-file-task translator-panel';
        document.body.appendChild(root);
        this.root = root;

        this.cleanups.push(addClickHandler(root, (event) => {
            const action = event.target?.closest?.('[data-action]')?.dataset?.action;
            if (!action) return;
            if (action === 'close') this.close();
            if (action === 'run') void this.run();
        }, {
            shouldHandle: (event) => Boolean(event.target?.closest?.('[data-action]')),
            preventDefault: true,
        }));

        const onKeydown = (event) => {
            if (!this.isVisible) return;
            if (event.key === 'Escape') this.close();
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault();
                void this.run();
            }
        };
        document.addEventListener('keydown', onKeydown, true);
        this.cleanups.push(() => document.removeEventListener('keydown', onKeydown, true));
        this.setupDrag();
        this.setupResize();
    }

    /**
     * 渲染任务面板。
     */
    render() {
        if (!this.root) return;
        const fileName = basename(this.currentPath);
        this.root.innerHTML = `
            <div class="translator-resize-handle ai-file-task__resize-handle" aria-hidden="true"></div>
            <header class="translator-header ai-file-task__header">
                <div class="ai-file-task__header-main">
                    <span class="ai-file-task__badge">AI</span>
                    <div class="ai-file-task__heading">
                        <div class="ai-file-task__title">${escapeHtml(t('aiFileTask.title'))}</div>
                        <div class="ai-file-task__path" data-ref="path" title="${escapeHtml(this.currentPath)}">${escapeHtml(fileName)}</div>
                    </div>
                </div>
                <div class="translator-header-actions">
                    <button type="button" class="translator-close-btn ai-file-task__close" data-action="close" aria-label="${escapeHtml(t('common.cancel'))}">×</button>
                </div>
            </header>
            <main class="translator-body ai-file-task__body" role="dialog" aria-modal="false" aria-label="${escapeHtml(t('aiFileTask.title'))}">
                <label class="ai-file-task__field">
                    <span>${escapeHtml(t('aiFileTask.instruction'))}</span>
                    <textarea class="translator-input ai-file-task__input" name="instruction" rows="5">${escapeHtml(t('aiFileTask.defaultInstruction'))}</textarea>
                </label>
                <div class="ai-file-task__hint">${escapeHtml(t('aiFileTask.openHint'))}</div>
                <button type="button" class="translator-submit ai-file-task__submit" data-action="run">${escapeHtml(t('aiFileTask.run'))}</button>
                <div class="translator-result ai-file-task__result" data-ref="result">
                    <div class="translator-placeholder">${escapeHtml(t('aiFileTask.resultPlaceholder'))}</div>
                </div>
                <div class="ai-file-task__status" data-ref="status"></div>
            </main>
        `;
        if (this.result) this.renderResult(this.result);
    }

    /**
     * 更新标题区里的当前文件展示。
     */
    updateFileDisplay() {
        const el = this.root?.querySelector('[data-ref="path"]');
        if (!el) return;
        el.textContent = basename(this.currentPath);
        el.title = this.currentPath;
    }

    /**
     * 当前文件切换后重置旧结果展示，避免旧回答被误认为属于新文件。
     */
    resetResultDisplay() {
        const el = this.root?.querySelector('[data-ref="result"]');
        if (!el) return;
        el.innerHTML = `<div class="translator-placeholder">${escapeHtml(t('aiFileTask.resultPlaceholder'))}</div>`;
    }

    /**
     * 执行 AI 文档任务。
     */
    async run() {
        if (!this.root || !this.currentPath || this.isRunning) return;
        const instruction = this.root.querySelector('[name="instruction"]')?.value || '';
        const task = this.session.begin(this.currentPath);
        this.setBusy(true, t('aiFileTask.running'));
        try {
            const fileContent = await this.readCurrentFileContent(task.sourcePath);
            if (!this.session.isCurrent(task) || !this.isVisible) return;
            const result = await this.service.runFileTask({
                filePath: task.sourcePath,
                fileContent,
                instruction,
            });
            if (!this.session.isCurrent(task) || !this.isVisible) return;
            this.result = result;
            if (result.action === 'open_document') {
                const filename = result.filename || suggestResultFileName(instruction, task.sourcePath);
                try {
                    await this.openResult(result.content, filename);
                    if (!this.session.isCurrent(task) || !this.isVisible) return;
                    this.close();
                } catch (error) {
                    if (!this.session.isCurrent(task) || !this.isVisible) return;
                    result.action = 'show_answer';
                    this.renderResult(result);
                    this.setStatus(error?.message || String(error), 'error');
                }
            } else {
                this.renderResult(result);
                this.setStatus(t('aiFileTask.done'), 'success');
            }
        } catch (error) {
            if (!this.session.isCurrent(task) || !this.isVisible) return;
            this.setStatus(error?.message || String(error), 'error');
        } finally {
            if (!this.session.isCurrent(task)) return;
            this.setBusy(false);
            if (this.pendingPath && this.isVisible) {
                const nextPath = this.pendingPath;
                this.pendingPath = '';
                this.updateCurrentFile(nextPath);
            }
        }
    }

    /**
     * 读取当前文档内容，优先使用内存中的 DocumentRegistry 快照。
     * @param {string} [path] - 请求开始时绑定的源文件路径
     * @returns {Promise<string>}
     */
    async readCurrentFileContent(path = this.currentPath) {
        if (typeof this.saveCurrentEditorContentToCache === 'function') {
            this.saveCurrentEditorContentToCache();
        }
        if (this.untitledFileManager?.isUntitledPath?.(path)) {
            return this.untitledFileManager.getContent?.(path) || '';
        }
        if (typeof this.getFileContent === 'function') {
            const snapshot = await this.getFileContent(path);
            if (snapshot && typeof snapshot.content === 'string') {
                return snapshot.content;
            }
        }
        return this.fileService.readText(path);
    }

    /**
     * 打开 AI 结果为临时 Markdown 文档。
     * @param {string} content - 输出内容
     * @param {string} filename - 建议文件名
     * @returns {Promise<string|null>}
     */
    async openResult(content, filename) {
        if (typeof this.openResultAsUntitled === 'function') {
            const path = await this.openResultAsUntitled({ content, filename });
            return typeof path === 'string' && path ? path : null;
        }
        await navigator.clipboard.writeText(content);
        this.setStatus(t('aiFileTask.copied'), 'success');
        return null;
    }

    /**
     * 在 AI 面板内渲染无需打开新文档的回答。
     * @param {{content:string}} result - AI 任务结果
     */
    renderResult(result) {
        const el = this.root?.querySelector('[data-ref="result"]');
        if (!el) return;
        el.innerHTML = `<div class="ai-file-task__answer">${renderBasicMarkdown(result?.content || '')}</div>`;
        this.growToFitResult();
    }

    /**
     * 回答内容较长时自动增高浮层，减少用户手动拖拽成本。
     */
    growToFitResult() {
        if (!this.root) return;
        requestAnimationFrame(() => {
            if (!this.root?.isConnected || !this.isVisible) return;
            const resultEl = this.root.querySelector('[data-ref="result"]');
            if (!resultEl) return;
            const overflow = resultEl.scrollHeight - resultEl.clientHeight;
            if (overflow <= 8) return;

            const currentHeight = this.root.offsetHeight || DEFAULT_SIZE.height;
            const maxHeight = Math.max(DEFAULT_SIZE.height, window.innerHeight - VIEWPORT_MARGIN * 2);
            const nextHeight = Math.min(maxHeight, currentHeight + overflow + 16);
            if (nextHeight <= currentHeight) return;

            this.root.style.height = `${nextHeight}px`;
            this.applyPosition({
                right: Number.parseFloat(this.root.style.right) || DEFAULT_POSITION.right,
                bottom: Number.parseFloat(this.root.style.bottom) || DEFAULT_POSITION.bottom,
            });
        });
    }

    /**
     * 应用上次保存的浮动面板位置与尺寸。
     */
    applyStoredLayout() {
        const size = store.get('size') || DEFAULT_SIZE;
        const position = store.get('position') || DEFAULT_POSITION;
        this.applySize(size);
        this.applyPosition(position);
    }

    /**
     * 限制浮动面板不移出视窗。
     * @param {{right:number,bottom:number}} pos - 目标位置
     * @param {{width:number,height:number}} [size] - 面板尺寸
     * @returns {{right:number,bottom:number}}
     */
    clampPosition(pos, size = DEFAULT_SIZE) {
        const width = size.width || this.root?.offsetWidth || DEFAULT_SIZE.width;
        const height = size.height || this.root?.offsetHeight || DEFAULT_SIZE.height;
        const maxRight = Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN);
        const maxBottom = Math.max(VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN);
        return {
            right: Math.min(Math.max(VIEWPORT_MARGIN, pos.right ?? DEFAULT_POSITION.right), maxRight),
            bottom: Math.min(Math.max(VIEWPORT_MARGIN, pos.bottom ?? DEFAULT_POSITION.bottom), maxBottom),
        };
    }

    /**
     * 设置浮动面板位置。
     * @param {{right:number,bottom:number}} pos - 右下锚点位置
     */
    applyPosition(pos) {
        if (!this.root) return;
        const next = this.clampPosition(pos, {
            width: this.root.offsetWidth,
            height: this.root.offsetHeight,
        });
        this.root.style.left = 'auto';
        this.root.style.top = 'auto';
        this.root.style.right = `${next.right}px`;
        this.root.style.bottom = `${next.bottom}px`;
    }

    /**
     * 设置浮动面板尺寸。
     * @param {{width:number,height:number}} size - 面板尺寸
     */
    applySize(size) {
        if (!this.root) return;
        this.root.style.width = `${size.width || DEFAULT_SIZE.width}px`;
        this.root.style.height = `${size.height || DEFAULT_SIZE.height}px`;
    }

    /**
     * 绑定标题栏拖动。
     */
    setupDrag() {
        let startX = 0;
        let startY = 0;
        let startRight = 0;
        let startBottom = 0;

        this.root.addEventListener('pointerdown', (event) => {
            const header = event.target?.closest?.('.ai-file-task__header');
            if (!header || event.target?.closest?.('button')) return;
            header.setPointerCapture(event.pointerId);
            const rect = this.root.getBoundingClientRect();
            startX = event.clientX;
            startY = event.clientY;
            startRight = window.innerWidth - rect.right;
            startBottom = window.innerHeight - rect.bottom;
        });

        this.root.addEventListener('pointermove', (event) => {
            const header = this.root.querySelector('.ai-file-task__header');
            if (!header?.hasPointerCapture?.(event.pointerId)) return;
            const dx = event.clientX - startX;
            const dy = event.clientY - startY;
            const width = this.root.offsetWidth;
            const height = this.root.offsetHeight;
            const rawLeft = window.innerWidth - startRight - width + dx;
            const rawTop = window.innerHeight - startBottom - height + dy;
            const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN);
            const maxTop = Math.max(VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN);
            const nextLeft = Math.min(Math.max(VIEWPORT_MARGIN, rawLeft), maxLeft);
            const nextTop = Math.min(Math.max(VIEWPORT_MARGIN, rawTop), maxTop);
            const next = {
                right: window.innerWidth - nextLeft - width,
                bottom: window.innerHeight - nextTop - height,
            };
            this.root.style.right = `${next.right}px`;
            this.root.style.bottom = `${next.bottom}px`;
            store.set('position', next);
        });
    }

    /**
     * 绑定左上角 resize handle。
     */
    setupResize() {
        let startX = 0;
        let startY = 0;
        let startW = 0;
        let startH = 0;

        this.root.addEventListener('pointerdown', (event) => {
            const handle = event.target?.closest?.('.ai-file-task__resize-handle');
            if (!handle) return;
            handle.setPointerCapture(event.pointerId);
            startX = event.clientX;
            startY = event.clientY;
            startW = this.root.offsetWidth;
            startH = this.root.offsetHeight;
            event.preventDefault();
        });

        this.root.addEventListener('pointermove', (event) => {
            const handle = this.root.querySelector('.ai-file-task__resize-handle');
            if (!handle?.hasPointerCapture?.(event.pointerId)) return;
            const rect = this.root.getBoundingClientRect();
            const currentRight = window.innerWidth - rect.right;
            const currentBottom = window.innerHeight - rect.bottom;
            const maxW = Math.max(300, window.innerWidth - currentRight - VIEWPORT_MARGIN);
            const maxH = Math.max(240, window.innerHeight - currentBottom - VIEWPORT_MARGIN);
            const nextSize = {
                width: Math.min(maxW, Math.max(300, startW - (event.clientX - startX))),
                height: Math.min(maxH, Math.max(240, startH - (event.clientY - startY))),
            };
            this.applySize(nextSize);
            store.set('size', nextSize);
        });
    }

    /**
     * 设置本面板和状态栏的 busy 状态。
     * @param {boolean} busy - 是否运行中
     * @param {string} [message] - 状态文案
     */
    setBusy(busy, message = '') {
        this.isRunning = busy;
        this.root?.classList.toggle('is-busy', busy);
        this.root?.querySelectorAll('button, textarea, input, select').forEach(el => {
            if (el.dataset.action === 'close') return;
            el.disabled = busy;
        });
        if (busy && message) {
            this.setStatus(message);
            this.getStatusBarController()?.showProgress?.(message);
        } else {
            this.getStatusBarController()?.hideProgress?.({ delay: 300 });
        }
    }

    /**
     * 设置面板内状态提示。
     * @param {string} message - 提示文本
     * @param {'info'|'success'|'error'} [state] - 状态类型
     */
    setStatus(message, state = 'info') {
        const el = this.root?.querySelector('[data-ref="status"]');
        if (!el) return;
        el.textContent = message || '';
        el.dataset.state = state;
    }

    /**
     * 关闭任务面板。
     */
    close() {
        this.session.cancel();
        this.pendingPath = '';
        this.setBusy(false);
        this.root?.classList.remove('is-visible');
        this.isVisible = false;
        document.getElementById('statusBarAiTask')?.classList.remove('is-active');
        this.getStatusBarController()?.hideProgress?.();
    }

    /**
     * 销毁任务面板。
     */
    destroy() {
        this.session.cancel();
        this.cleanups.forEach(fn => {
            if (typeof fn === 'function') fn();
        });
        this.cleanups = [];
        this.root?.remove();
        this.root = null;
    }
}
