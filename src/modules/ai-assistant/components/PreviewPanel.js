import { aiService } from '../aiService.js';
import { buildAiRequest } from '../prompts/promptComposer.js';
import { ACTION_LABELS } from '../prompts/taskPrompts.js';
import MarkdownIt from 'markdown-it';
import { addClickHandler } from '../../../../src/utils/PointerHelper.js';

/**
 * 浮动预览窗口 - 显示 AI 处理结果
 * 简单模式：选中 → 处理 → 预览 → 应用
 */
export class PreviewPanel {
    constructor() {
        this.element = null;
        this.isVisible = false;
        this.currentTask = null;
        this.originalText = '';
        this.resultText = '';
        this.thinkText = '';
        this.isThinkingExpanded = false;
        this.onApply = null;
        this.onCancel = null;
        this.md = new MarkdownIt({
            html: false,
            linkify: true,
            breaks: true,
        });
        this.streamUnsubscribe = null;
        this.currentTaskId = null;
        this.isDragging = false;
        this.dragOffset = { x: 0, y: 0 };
        this.dragSize = { width: 0, height: 0 };
        this.handleDragMove = null;
        this.handleDragEnd = null;
        this.clickCleanups = [];
    }

    /**
     * 显示预览窗口并开始处理
     * @param {string} action - 操作类型
     * @param {string} selectedText - 选中的文本
     * @param {string} documentContent - 完整文档内容
     * @param {Object} callbacks - 回调函数 { onApply, onCancel }
     */
    async show(action, selectedText, documentContent, callbacks = {}) {
        this.originalText = selectedText;
        this.resultText = '';
        this.thinkText = '';
        this.isThinkingExpanded = false;
        this.onApply = callbacks.onApply || null;
        this.onCancel = callbacks.onCancel || null;
        this.cleanupStreamSubscription();

        // 创建窗口
        if (!this.element) {
            this.createElement();
        }

        // 显示窗口
        this.element.classList.add('is-visible');
        this.isVisible = true;
        this.centerDialog();

        // 更新标题
        this.updateTitle(ACTION_LABELS[action] || action);

        // 隐藏思考部分（初始状态）
        const thinkSection = this.element.querySelector('.ai-preview-think');
        if (thinkSection) {
            thinkSection.style.display = 'none';
        }

        // 显示加载状态
        this.showLoading();

        // 开始处理
        try {
            await this.processText(action, selectedText, documentContent);
        } catch (error) {
            this.showError(error.message);
        }
    }

    /**
     * 创建窗口元素
     */
    createElement() {
        this.element = document.createElement('div');
        this.element.className = 'ai-preview-panel';
        this.element.innerHTML = `
            <div class="ai-preview-header">
                <span class="ai-preview-title"></span>
            </div>
            <div class="ai-preview-content">
                <div class="ai-preview-loading">
                    <div class="ai-preview-spinner"></div>
                    <span>AI 正在处理...</span>
                </div>
                <div class="ai-preview-result">
                    <div class="ai-preview-think is-collapsed">
                        <button class="ai-preview-think-toggle" type="button">
                            <span>思考过程</span>
                            <span class="ai-preview-think-toggle-icon">展开</span>
                        </button>
                        <div class="ai-preview-think-preview"></div>
                        <pre class="ai-preview-think-full"></pre>
                    </div>
                    <div class="ai-preview-answer">
                        <div class="ai-preview-answer-title">AI 输出</div>
                        <pre class="ai-preview-answer-body"></pre>
                    </div>
                </div>
                <div class="ai-preview-error"></div>
            </div>
            <div class="ai-preview-actions">
                <button class="ai-preview-btn ai-preview-btn-cancel" type="button">取消</button>
                <button class="ai-preview-btn ai-preview-btn-append" type="button">增加</button>
                <button class="ai-preview-btn ai-preview-btn-replace" type="button">替换</button>
            </div>
        `;

        document.body.appendChild(this.element);
        this.bindEvents();
    }

    /**
     * 绑定事件
     */
    bindEvents() {
        const cancelBtn = this.element.querySelector('.ai-preview-btn-cancel');
        const appendBtn = this.element.querySelector('.ai-preview-btn-append');
        const replaceBtn = this.element.querySelector('.ai-preview-btn-replace');
        const thinkToggleBtn = this.element.querySelector('.ai-preview-think-toggle');
        const header = this.element.querySelector('.ai-preview-header');

        const registerClickHandler = (cleanup) => {
            if (typeof cleanup === 'function') {
                this.clickCleanups.push(cleanup);
            }
        };

        if (cancelBtn) {
            registerClickHandler(addClickHandler(cancelBtn, () => this.handleCancel()));
        }

        if (appendBtn) {
            registerClickHandler(addClickHandler(appendBtn, () => this.handleApply('append')));
        }

        if (replaceBtn) {
            registerClickHandler(addClickHandler(replaceBtn, () => this.handleApply('replace')));
        }

        if (thinkToggleBtn) {
            registerClickHandler(addClickHandler(thinkToggleBtn, () => this.toggleThinkingSection()));
        }

        header?.addEventListener('mousedown', (event) => this.handleDragStart(event));

        // 键盘快捷键
        this.handleKeydown = (e) => {
            if (!this.isVisible) return;

            if (e.key === 'Escape') {
                e.preventDefault();
                this.handleCancel();
            } else if (e.key === 'Tab') {
                e.preventDefault();
                // Tab 快捷键也要检查按钮是否可用
                const replaceBtn = this.element?.querySelector('.ai-preview-btn-replace');
                if (!replaceBtn?.disabled) {
                    this.handleApply('replace');
                }
            }
        };
        document.addEventListener('keydown', this.handleKeydown);
    }

    /**
     * 更新标题
     */
    updateTitle(title) {
        const titleEl = this.element.querySelector('.ai-preview-title');
        if (titleEl) {
            titleEl.textContent = `✨ ${title}结果`;
        }
    }

    /**
     * 显示加载状态
     */
    showLoading() {
        const loading = this.element.querySelector('.ai-preview-loading');
        const result = this.element.querySelector('.ai-preview-result');
        const error = this.element.querySelector('.ai-preview-error');

        if (loading) loading.style.display = 'flex';
        if (result) result.style.display = 'none';
        if (error) {
            error.style.display = 'none';
            error.textContent = '';
        }
        this.setThinkingExpanded(false);
        this.setApplyButtonsEnabled(false);
    }

    showContent() {
        const loading = this.element.querySelector('.ai-preview-loading');
        const result = this.element.querySelector('.ai-preview-result');
        const error = this.element.querySelector('.ai-preview-error');

        if (loading) loading.style.display = 'none';
        if (result) result.style.display = 'flex';
        if (error) error.style.display = 'none';
    }

    /**
     * 设置应用按钮的启用/禁用状态
     */
    setApplyButtonsEnabled(enabled) {
        const appendBtn = this.element?.querySelector('.ai-preview-btn-append');
        const replaceBtn = this.element?.querySelector('.ai-preview-btn-replace');

        if (appendBtn) {
            appendBtn.disabled = !enabled;
        }
        if (replaceBtn) {
            replaceBtn.disabled = !enabled;
        }
    }

    /**
     * 将对话框居中并使用固定像素定位，便于拖拽
     */
    centerDialog() {
        if (!this.element) return;
        const width = this.element.offsetWidth;
        const height = this.element.offsetHeight;
        const left = (window.innerWidth - width) / 2;
        const top = (window.innerHeight - height) / 2;
        this.element.style.left = `${Math.max(left, 8)}px`;
        this.element.style.top = `${Math.max(top, 8)}px`;
        this.element.style.transform = 'none';
    }

    /**
     * 设置对话框位置
     */
    setDialogPosition(left, top) {
        if (!this.element) return;
        const width = this.dragSize.width || this.element.offsetWidth;
        const height = this.dragSize.height || this.element.offsetHeight;
        const maxLeft = Math.max(0, window.innerWidth - width - 8);
        const maxTop = Math.max(0, window.innerHeight - height - 8);
        const clampedLeft = Math.min(Math.max(left, 8), maxLeft);
        const clampedTop = Math.min(Math.max(top, 8), maxTop);
        this.element.style.left = `${clampedLeft}px`;
        this.element.style.top = `${clampedTop}px`;
        this.element.style.transform = 'none';
    }

    handleDragStart(event) {
        if (event.button !== 0 || !this.element) {
            return;
        }
        event.preventDefault();
        const rect = this.element.getBoundingClientRect();
        this.isDragging = true;
        this.dragOffset = {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
        };
        this.dragSize = {
            width: rect.width,
            height: rect.height,
        };
        // remove centering transform but keep current visual position
        this.element.style.transform = 'none';
        this.element.style.left = `${rect.left}px`;
        this.element.style.top = `${rect.top}px`;
        this.element.classList.add('is-dragging');

        this.handleDragMove = (moveEvent) => {
            if (!this.isDragging) return;
            moveEvent.preventDefault();
            const nextLeft = moveEvent.clientX - this.dragOffset.x;
            const nextTop = moveEvent.clientY - this.dragOffset.y;
            this.setDialogPosition(nextLeft, nextTop);
        };

        this.handleDragEnd = () => {
            if (!this.isDragging) return;
            this.isDragging = false;
            this.element?.classList.remove('is-dragging');
            document.removeEventListener('mousemove', this.handleDragMove);
            document.removeEventListener('mouseup', this.handleDragEnd);
            this.handleDragMove = null;
            this.handleDragEnd = null;
        };

        document.addEventListener('mousemove', this.handleDragMove);
        document.addEventListener('mouseup', this.handleDragEnd);
    }

    updateAnswer(text) {
        const answer = this.element.querySelector('.ai-preview-answer-body');
        this.resultText = text || '';
        if (answer) {
            answer.textContent = this.resultText || ' ';
        }
    }

    updateThinking(text) {
        const thinkSection = this.element.querySelector('.ai-preview-think');
        const thinkFull = this.element.querySelector('.ai-preview-think-full');
        const thinkPreview = this.element.querySelector('.ai-preview-think-preview');
        this.thinkText = text || '';
        const finalText = this.thinkText || ' ';

        // 如果没有思考内容，隐藏整个思考部分
        if (thinkSection) {
            if (!this.thinkText || this.thinkText.trim().length === 0) {
                thinkSection.style.display = 'none';
            } else {
                thinkSection.style.display = '';
            }
        }

        if (thinkFull) {
            thinkFull.textContent = finalText;
        }
        if (thinkPreview) {
            thinkPreview.textContent = this.getThinkPreviewText();
        }
    }

    getThinkPreviewText() {
        if (!this.thinkText) {
            return '';
        }
        const lines = this.thinkText.split(/\r?\n/).filter(line => line.trim().length > 0);
        if (lines.length <= 3) {
            return lines.join('\n');
        }
        const latest = lines.slice(-3);
        return `...${latest.join('\n')}`;
    }

    setThinkingExpanded(expanded) {
        this.isThinkingExpanded = !!expanded;
        const section = this.element?.querySelector('.ai-preview-think');
        if (!section) return;
        section.classList.toggle('is-collapsed', !this.isThinkingExpanded);
        const icon = section.querySelector('.ai-preview-think-toggle-icon');
        if (icon) {
            icon.textContent = this.isThinkingExpanded ? '收起' : '展开';
        }
    }

    toggleThinkingSection() {
        this.setThinkingExpanded(!this.isThinkingExpanded);
    }

    /**
     * 显示错误
     */
    showError(message) {
        const loading = this.element.querySelector('.ai-preview-loading');
        const result = this.element.querySelector('.ai-preview-result');
        const error = this.element.querySelector('.ai-preview-error');

        if (loading) loading.style.display = 'none';
        if (result) result.style.display = 'none';
        if (error) {
            error.style.display = 'block';
            error.textContent = `错误: ${message}`;
        }
    }

    /**
     * 处理文本
     */
    async processText(action, selectedText, documentContent) {
        // 构建请求
        const config = aiService.getConfig();
        const request = await buildAiRequest(
            action,
            selectedText,
            documentContent,
            config.preferences
        );

        const taskId = aiService.generateTaskId();

        this.cleanupStreamSubscription();
        this.streamUnsubscribe = aiService.subscribe((event) => {
            if (!event || event.id !== taskId) {
                return;
            }

            switch (event.type) {
                case 'task-stream-start':
                    this.showContent();
                    this.updateAnswer('');
                    this.updateThinking(''); // 会隐藏思考部分
                    break;
                case 'task-stream-chunk':
                    this.showContent();
                    this.updateAnswer(event.buffer || '');
                    break;
                case 'task-stream-think':
                    this.showContent();
                    this.updateThinking(event.buffer || '');
                    break;
                case 'task-stream-end':
                    this.showContent();
                    this.updateAnswer(event.buffer || '');
                    if (typeof event.thinkBuffer === 'string') {
                        this.updateThinking(event.thinkBuffer);
                    }
                    this.setApplyButtonsEnabled(true);
                    this.cleanupStreamSubscription();
                    break;
                case 'task-failed':
                    this.showError(event.error || 'AI 处理失败');
                    this.setApplyButtonsEnabled(true);
                    this.cleanupStreamSubscription();
                    break;
                case 'task-cancelled':
                    this.showError('任务已取消');
                    this.setApplyButtonsEnabled(true);
                    this.cleanupStreamSubscription();
                    break;
                default:
                    break;
            }
        });

        this.currentTask = aiService.runTask({
            messages: request.messages,
            temperature: request.temperature,
            taskId,
        }).catch((error) => {
            console.error('[PreviewPanel] AI 任务失败', error);
            this.showError(error?.message || 'AI 任务失败');
            this.setApplyButtonsEnabled(true);
            this.cleanupStreamSubscription();
        });
        this.currentTaskId = taskId;
    }

    /**
     * 应用结果
     * @param {string} mode - 应用模式：'replace' 替换选中内容，'append' 在选中内容后增加
     */
    handleApply(mode = 'replace') {
        // 检查按钮是否被禁用
        const appendBtn = this.element?.querySelector('.ai-preview-btn-append');
        const replaceBtn = this.element?.querySelector('.ai-preview-btn-replace');
        const targetBtn = mode === 'append' ? appendBtn : replaceBtn;

        if (targetBtn?.disabled) {
            return;
        }

        if (!this.resultText) return;

        if (typeof this.onApply === 'function') {
            this.onApply(this.resultText, mode);
        }

        this.hide();
    }

    /**
     * 取消
     */
    handleCancel() {
        // 取消正在进行的任务
        if (this.currentTaskId) {
            aiService.cancelTask(this.currentTaskId);
        }

        if (typeof this.onCancel === 'function') {
            this.onCancel();
        }

        this.hide();
    }

    /**
     * 隐藏窗口
     */
    hide() {
        if (this.element) {
            this.element.classList.remove('is-visible');
        }
        if (this.isDragging && typeof this.handleDragEnd === 'function') {
            this.handleDragEnd();
        }
        this.isVisible = false;
        this.currentTask = null;
        this.currentTaskId = null;
        this.cleanupStreamSubscription();
    }

    /**
     * 销毁窗口
     */
    destroy() {
        this.hide();
        if (this.handleKeydown) {
            document.removeEventListener('keydown', this.handleKeydown);
        }
        this.cleanupClickHandlers();
        if (this.element && this.element.parentNode) {
            this.element.parentNode.removeChild(this.element);
            this.element = null;
        }
    }

    cleanupStreamSubscription() {
        if (typeof this.streamUnsubscribe === 'function') {
            try {
                this.streamUnsubscribe();
            } catch (error) {
                console.warn('[PreviewPanel] 取消流式监听失败', error);
            }
        }
        this.streamUnsubscribe = null;
    }

    cleanupClickHandlers() {
        if (!Array.isArray(this.clickCleanups)) {
            return;
        }
        this.clickCleanups.forEach((cleanup) => {
            try {
                cleanup();
            } catch (error) {
                console.warn('[PreviewPanel] 清理 PointerHelper 处理器失败', error);
            }
        });
        this.clickCleanups = [];
    }
}
