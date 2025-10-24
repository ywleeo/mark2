import { addClickHandler } from '../utils/PointerHelper.js';
import { splitThinkAndAnswer } from '../utils/aiStreamUtils.js';
import { TodoList } from './TodoList.js';
import { createAiSessionManager } from '../modules/aiSession.js';
import { aiService } from '../modules/aiService.js';

const QUICK_ACTIONS = [];

export class AiSidebar {
    constructor(containerElement, getEditorContext, callbacks = {}) {
        this.container = containerElement;
        this.getEditorContext = getEditorContext;  // 直接保存获取编辑器上下文的函数
        this.callbacks = callbacks;

        this.isVisible = false;
        this.isBusy = false;
        this.messages = [];
        this.streamStates = new Map();
        this.currentMode = 'custom';
        this.unsubscribe = null;
        this.todoList = null; // TodoList 实例
        this.useTaskMode = false; // 是否启用任务模式

        // 初始化会话管理器
        this.sessionManager = createAiSessionManager();
        this.sessionManager.createSession({
            maxTokens: 128000,
            warningThreshold: 0.8,
            model: 'claude-3.5-sonnet',
        });

        // 订阅会话事件
        this.sessionManager.subscribe((event) => {
            if (event.type === 'context-warning') {
                this.showContextWarning(event);
            }
        });

        this.render();
        this.bindEvents();
        this.attachController();

        // 初始化上下文使用情况显示
        this.updateContextUsage();
    }

    render() {
        this.container.classList.add('ai-sidebar');
        this.container.innerHTML = `
            <div class="ai-sidebar__header">
                <div>
                    <h3 class="ai-sidebar__title">AI 写作助手</h3>
                    <p class="ai-sidebar__subtitle">与当前文档协同创作</p>
                </div>
                <div class="ai-sidebar__header-actions">
                    <button
                        type="button"
                        class="ai-sidebar__clear"
                        data-role="clear-messages"
                        title="清空对话"
                        aria-label="清空对话"
                    >
                        <svg class="ai-sidebar__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M4 20h16" />
                            <path d="M9 15l3-9 8 8-3 3" />
                            <path d="M5 16l4 4" />
                        </svg>
                    </button>
                    <button type="button" class="ai-sidebar__close" title="关闭">×</button>
                </div>
            </div>

            <div class="ai-sidebar__messages" data-role="messages"></div>

            <div class="ai-sidebar__todos" data-role="todos"></div>

            <div class="ai-sidebar__footer">
                <div class="ai-sidebar__context-info" data-role="context-info">
                    <span class="ai-sidebar__context-usage" data-role="context-usage"></span>
                </div>
                <div class="ai-sidebar__input">
                    <textarea data-role="prompt-input" placeholder="告诉 AI 你想做什么，比如：'请润色这一段，让语气更柔和'"></textarea>
                    <div class="ai-sidebar__actions">
                        <span class="ai-sidebar__status" data-role="status"></span>
                        <button type="button" class="ai-sidebar__send-btn" data-role="send">发送</button>
                    </div>
                </div>
            </div>
        `;

        this.messagesContainer = this.container.querySelector('[data-role="messages"]');
        this.todosContainer = this.container.querySelector('[data-role="todos"]');
        this.sendButton = this.container.querySelector('[data-role="send"]');
        this.promptField = this.container.querySelector('[data-role="prompt-input"]');
        this.statusLabel = this.container.querySelector('[data-role="status"]');
        this.closeButton = this.container.querySelector('.ai-sidebar__close');
        this.clearButton = this.container.querySelector('[data-role="clear-messages"]');
        this.contextUsageLabel = this.container.querySelector('[data-role="context-usage"]');
        this.quickButtons = [];

        // 初始化 TodoList
        if (this.todosContainer) {
            this.todoList = new TodoList(this.todosContainer);
        }
    }

    bindEvents() {
        if (this.sendButton) {
            this.sendButton.addEventListener('click', () => {
                if (this.isBusy) {
                    void this.handleInterrupt();
                } else {
                    this.handleSend();
                }
            });
        }

        if (this.promptField) {
            this.promptField.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !this.isBusy) {
                    event.preventDefault();
                    this.handleSend();
                }
            });
        }

        if (this.closeButton) {
            const cleanup = addClickHandler(this.closeButton, () => {
                this.hide();
            });
            this.closeButton.dataset.cleanup = cleanup;
        }

        if (this.clearButton) {
            const cleanup = addClickHandler(this.clearButton, () => {
                this.clearMessages();
                // 清除 TODO UI
                if (this.todoList) {
                    this.todoList.clear();
                }
                // 清除会话历史并创建新会话
                if (this.sessionManager) {
                    this.sessionManager.createSession({
                        maxTokens: 128000,
                        warningThreshold: 0.8,
                        model: 'claude-3.5-sonnet',
                    });
                }
                if (typeof this.callbacks.onClearMessages === 'function') {
                    this.callbacks.onClearMessages();
                }
                this.updateStatusMessage('');
                this.updateContextUsage();
            });
            this.clearButton.dataset.cleanup = cleanup;
        }
    }

    attachController() {
        // 订阅 aiService 的事件
        this.unsubscribe = aiService.subscribe(event => {
            switch (event.type) {
                case 'task-started': {
                    this.setBusy(true);

                    // 清除上一次的 TODO UI
                    if (this.todoList) {
                        this.todoList.clear();
                    }

                    const mode = event.payload?.mode || 'custom';
                    this.streamStates.set(event.id, { mode });
                    this.appendMessage({
                        id: `${event.id}-user`,
                        role: 'user',
                        mode,
                        content: event.payload?.prompt || '',
                        context: event.payload?.context,
                    });
                    // 添加一个"正在思考"的提示消息
                    this.appendMessage({
                        id: `${event.id}-thinking`,
                        role: 'assistant',
                        content: '⠋ 正在分析任务...',
                        isThinking: true,
                    });
                    // 启动动画定时器
                    this.startThinkingAnimation(event.id);
                    break;
                }
                case 'task-stream-start': {
                    const previous = this.streamStates.get(event.id) || {};
                    const mode = event.request?.mode || previous.mode || 'custom';
                    this.streamStates.set(event.id, { mode, stream: true });
                    this.removeMessage(`${event.id}-think`);
                    this.appendMessage({
                        id: `${event.id}-answer`,
                        role: 'assistant',
                        mode,
                        content: '',
                        isStreaming: true,
                    });
                    this.appendMessage({
                        id: `${event.id}-think`,
                        role: 'assistant',
                        content: '',
                        isThink: true,
                        isStreaming: true,
                        isHidden: true,
                        insertBeforeId: `${event.id}-answer`,
                    });
                    break;
                }
                case 'task-stream-chunk': {
                    const state = this.streamStates.get(event.id) || {};
                    const rawBuffer = typeof event.buffer === 'string' ? event.buffer : '';
                    const { think, answer } = splitThinkAndAnswer(rawBuffer, { trim: false });
                    const reasoning = typeof event.reasoning === 'string' ? event.reasoning : '';
                    const aggregatedThink = reasoning || think;
                    const normalizedThink = aggregatedThink ? aggregatedThink.trim() : '';

                    this.appendMessage({
                        id: `${event.id}-think`,
                        role: 'assistant',
                        content: normalizedThink,
                        isThink: true,
                        isStreaming: true,
                        isHidden: normalizedThink.length === 0,
                    });

                    this.appendMessage({
                        id: `${event.id}-answer`,
                        role: 'assistant',
                        mode: state.mode,
                        content: answer,
                        isStreaming: true,
                    });
                    this.scrollMessagesToBottom();
                    break;
                }
                case 'task-stream-end': {
                    const state = this.streamStates.get(event.id) || {};
                    const rawBuffer = typeof event.buffer === 'string' ? event.buffer : '';
                    const { think, answer } = splitThinkAndAnswer(rawBuffer);
                    const reasoning = typeof event.reasoning === 'string' ? event.reasoning : '';
                    const aggregatedThink = reasoning || think;
                    const normalizedThink = aggregatedThink ? aggregatedThink.trim() : '';
                    this.appendMessage({
                        id: `${event.id}-think`,
                        role: 'assistant',
                        content: normalizedThink,
                        isThink: true,
                        isStreaming: false,
                        isHidden: normalizedThink.length === 0,
                    });
                    this.appendMessage({
                        id: `${event.id}-answer`,
                        role: 'assistant',
                        mode: state.mode,
                        content: answer,
                        isStreaming: false,
                    });

                    // 添加助手响应到会话历史
                    if (this.sessionManager && answer) {
                        console.log('[AiSidebar] Adding assistant message:', answer.substring(0, 100));
                        this.sessionManager.addMessage('assistant', answer);
                        this.updateContextUsage();
                    }

                    this.streamStates.delete(event.id);
                    this.setBusy(false);
                    break;
                }
                case 'task-completed': {
                    if (event.stream) {
                        return;
                    }
                    this.setBusy(false);
                    const rawContent = typeof event.content === 'string' ? event.content : '';
                    const fallback = splitThinkAndAnswer(rawContent);
                    const thinkContent = typeof event.reasoning === 'string' && event.reasoning.trim().length > 0
                        ? event.reasoning
                        : fallback.think;
                    const answerContent = fallback.answer;
                    const mode = event.request?.mode || 'custom';
                    if (thinkContent) {
                        this.appendMessage({
                            id: `${event.id}-think`,
                            role: 'assistant',
                            content: thinkContent,
                            isThink: true,
                            isStreaming: false,
                        });
                    }
                    this.appendMessage({
                        id: `${event.id}-answer`,
                        role: 'assistant',
                        mode,
                        content: answerContent || rawContent,
                        isStreaming: false,
                    });

                    // 添加助手响应到会话历史
                    const assistantContent = answerContent || rawContent;
                    if (this.sessionManager && assistantContent) {
                        this.sessionManager.addMessage('assistant', assistantContent);
                        this.updateContextUsage();
                    }
                    break;
                }
                case 'task-failed': {
                    this.setBusy(false);
                    this.streamStates.delete(event.id);
                    this.removeMessage(`${event.id}-think`);
                    // 停止动画并移除 thinking 消息
                    this.stopThinkingAnimation();
                    this.removeMessage(`${event.id}-thinking`);
                    const errorMessage = `请求失败：${event.error?.message || event.error || '未知错误'}`;
                    this.appendMessage({
                        id: `${event.id}-answer`,
                        role: 'assistant',
                        content: errorMessage,
                        isError: true,
                        isStreaming: false,
                    });
                    break;
                }
                case 'config':
                    this.updateStatusHint(event.data);
                    break;
                case 'task-cancelled': {
                    this.setBusy(false);
                    // 停止动画并移除 thinking 消息
                    this.stopThinkingAnimation();
                    this.removeMessage(`${event.id}-thinking`);
                    // 在聊天框显示取消消息
                    this.appendMessage({
                        id: `${event.id}-cancelled`,
                        role: 'assistant',
                        content: '已取消',
                        isError: true,
                        isStreaming: false,
                    });
                    break;
                }
                case 'task-intent': {
                    // 任务意图识别完成
                    console.log('[AiSidebar] task-intent:', event);
                    if (event.intent === 'task') {
                        this.useTaskMode = true;
                    }
                    break;
                }
                case 'task-todo-list': {
                    // 收到 TODO 列表，移除"正在思考"消息
                    this.stopThinkingAnimation();
                    this.removeMessage(`${event.id}-thinking`);
                    console.log('[AiSidebar] task-todo-list:', event);
                    console.log('[AiSidebar] todoList instance:', this.todoList);
                    console.log('[AiSidebar] todos data:', event.todos);
                    if (this.todoList && event.todos) {
                        this.todoList.updateTodos(event.todos);
                        console.log('[AiSidebar] updateTodos called, container display:', this.todosContainer?.style?.display);
                    }
                    break;
                }
                case 'task-todo-update': {
                    // TODO 状态更新
                    console.log('[AiSidebar] task-todo-update:', event);
                    if (this.todoList && event.todoId) {
                        this.todoList.updateTodoStatus(event.todoId, event.status, event.output);
                    }

                    // 如果任务失败，停止动画并在聊天框显示错误
                    if (event.status === 'failed' && event.output) {
                        this.setBusy(false);
                        this.stopThinkingAnimation();
                        this.removeMessage(`${event.id}-thinking`);
                        this.appendMessage({
                            id: `${event.id}-error`,
                            role: 'assistant',
                            content: `请求失败：${event.output}`,
                            isError: true,
                            isStreaming: false,
                        });
                    }
                    break;
                }
                case 'task-summary': {
                    // 任务完成总结
                    this.setBusy(false);
                    this.useTaskMode = false;

                    // 停止动画并移除"正在分析任务"消息
                    this.stopThinkingAnimation();
                    this.removeMessage(`${event.id}-thinking`);

                    const summaryContent = event.message || event.summary;
                    // 只有当总结内容不是默认的"任务执行完成"时才显示
                    if (summaryContent && summaryContent !== '任务执行完成') {
                        this.appendMessage({
                            id: `${event.id}-summary`,
                            role: 'assistant',
                            content: summaryContent,
                            isStreaming: false,
                        });

                        // 添加助手响应到会话历史
                        if (this.sessionManager && summaryContent) {
                            console.log('[AiSidebar] Adding task summary to session:', summaryContent.substring(0, 100));
                            this.sessionManager.addMessage('assistant', summaryContent);
                            this.updateContextUsage();
                        }
                    }
                    break;
                }
                default:
                    break;
            }
        });

        aiService.ensureConfig().catch(error => {
            console.warn('加载 AI 配置失败', error);
            this.updateStatusHint(null);
        });
    }

    destroy() {
        if (this.unsubscribe) {
            this.unsubscribe();
            this.unsubscribe = null;
        }
        this.quickButtons.forEach(button => {
            const cleanup = button.dataset.cleanup;
            if (typeof cleanup === 'function') {
                cleanup();
            }
        });
        this.quickButtons = [];

        [this.closeButton, this.clearButton].forEach((button) => {
            if (!button) return;
            const cleanup = button.dataset?.cleanup;
            if (typeof cleanup === 'function') {
                cleanup();
            }
        });
    }

    suggestPromptForMode(mode) {
        switch (mode) {
            case 'extend':
                return '请继续撰写下一段，保持当前的语气与节奏。';
            case 'summarize':
                return '请总结选中的内容，输出 3 行以内的要点。';
            case 'rewrite':
                return '请保留原意，优化语句，让表达更自然。';
            default:
                return '';
        }
    }

    updateStatusHint(config) {
        if (!this.statusLabel) return;

        if (!config || !config.has_api_key) {
            this.statusLabel.textContent = '未配置 API Key';
            this.statusLabel.classList.add('is-warning');
        } else {
            this.statusLabel.textContent = '';
            this.statusLabel.classList.remove('is-warning');
        }
    }

    setBusy(isBusy) {
        this.isBusy = isBusy;
        if (this.sendButton) {
            this.sendButton.disabled = false;
            this.sendButton.textContent = isBusy ? '打断' : '发送';
            this.sendButton.classList.toggle('is-interrupt', isBusy);
        }
        if (this.promptField) {
            this.promptField.disabled = isBusy;
        }
        // 移除了 "AI 正在生成..." 的状态提示
    }

    updateStatusMessage(message, variant = 'info') {
        if (!this.statusLabel) {
            return;
        }
        const text = typeof message === 'string' ? message : '';
        this.statusLabel.textContent = text;
        if (variant === 'warning') {
            this.statusLabel.classList.add('is-warning');
        } else {
            this.statusLabel.classList.remove('is-warning');
        }
    }

    show() {
        this.container.classList.add('is-visible');
        this.isVisible = true;
        if (this.promptField) {
            this.promptField.disabled = false;
            this.promptField.focus();
        }
    }

    hide() {
        this.container.classList.remove('is-visible');
        this.isVisible = false;
        if (this.promptField) {
            this.promptField.blur();
        }
        if (typeof this.callbacks.onClose === 'function') {
            this.callbacks.onClose();
        }
    }

    toggle() {
        if (this.isVisible) {
            this.hide();
        } else {
            this.show();
        }
    }

    clearMessages() {
        if (Array.isArray(this.messages)) {
            this.messages.forEach(entry => {
                if (entry?.element?.parentElement) {
                    entry.element.parentElement.removeChild(entry.element);
                }
            });
        }
        this.messages = [];
        this.streamStates.clear();
        if (this.messagesContainer) {
            this.messagesContainer.innerHTML = '';
        }
    }

    appendMessage(message) {
        if (!message) {
            return null;
        }
        const id = message.id || `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        const normalizedRole = message.role || 'assistant';
        const existingIndex = this.messages.findIndex(entry => entry.id === id);
        if (existingIndex !== -1) {
            const existing = this.messages[existingIndex];
            const updates = { ...message };
            delete updates.insertBeforeId;
            Object.assign(existing, updates);
            existing.id = id;
            existing.role = normalizedRole;
            this.renderMessageEntry(existing);
            return existing;
        }

        const entry = {
            id,
            role: normalizedRole,
            content: '',
            ...message,
        };
        delete entry.insertBeforeId;
        entry.element = this.buildMessageElement(entry);
        this.renderMessageEntry(entry);
        const insertBeforeId = message.insertBeforeId;
        if (insertBeforeId) {
            const beforeIndex = this.messages.findIndex(entry => entry.id === insertBeforeId);
            if (beforeIndex !== -1) {
                this.messages.splice(beforeIndex, 0, entry);
            } else {
                this.messages.push(entry);
            }
        } else {
            this.messages.push(entry);
        }

        if (this.messagesContainer && entry.element) {
            if (insertBeforeId) {
                const beforeEntry = this.messages.find(
                    item => item.id === insertBeforeId && item.dom?.element
                );
                if (beforeEntry?.dom?.element) {
                    this.messagesContainer.insertBefore(entry.element, beforeEntry.dom.element);
                } else {
                    this.messagesContainer.appendChild(entry.element);
                }
            } else {
                this.messagesContainer.appendChild(entry.element);
            }
            if (!insertBeforeId) {
                this.scrollMessagesToBottom();
            }
        }

        return entry;
    }

    buildMessageElement(entry) {
        const element = document.createElement('div');
        element.classList.add('ai-message', `ai-message--${entry.role}`);
        if (entry.isError) {
            element.classList.add('ai-message--error');
        }
        element.dataset.messageId = entry.id;

        const header = document.createElement('div');
        header.className = 'ai-message__header';

        const modeLabel = document.createElement('span');
        modeLabel.className = 'ai-message__mode';
        modeLabel.style.display = 'none';
        header.appendChild(modeLabel);

        const content = document.createElement('div');
        content.className = 'ai-message__content';

        element.appendChild(header);
        element.appendChild(content);

        entry.dom = {
            element,
            header,
            modeLabel,
            content,
        };

        if (entry.isThink) {
            entry.isThinkExpanded = false;
        }

        return element;
    }

    renderMessageEntry(entry) {
        if (!entry?.dom?.element) {
            return;
        }
        const { element, header, modeLabel, content } = entry.dom;

        element.classList.remove('ai-message--user', 'ai-message--assistant');
        element.classList.add(`ai-message--${entry.role}`);
        element.classList.toggle('ai-message--error', !!entry.isError);
        element.classList.toggle('ai-message--streaming', !!entry.isStreaming);
        element.classList.toggle('is-thinking', !!entry.isThinking);
        const shouldHide = !!entry.isHidden
            || (entry.role === 'assistant'
                && !entry.isThink
                && typeof entry.content === 'string'
                && entry.content.trim().length === 0);
        element.classList.toggle('is-hidden', shouldHide);

        if (modeLabel) {
            const hasMode = typeof entry.mode === 'string' && entry.mode.length > 0 && entry.mode !== 'custom';
            if (hasMode) {
                modeLabel.textContent = this.describeMode(entry.mode);
                modeLabel.style.display = '';
                if (header) {
                    header.style.display = '';
                }
            } else {
                modeLabel.textContent = '';
                modeLabel.style.display = 'none';
                if (header) {
                    header.style.display = 'none';
                }
            }
        }

        if (content) {
            if (entry.isThink) {
                this.renderThinkMessage(entry);
            } else {
                const displayContent = typeof entry.content === 'string' ? entry.content : '';
                content.innerHTML = this.formatMarkdownLikeHtml(displayContent);
                content.classList.remove('ai-message__content--think');
                if (entry.dom.think) {
                    entry.dom.think = null;
                }
            }
        }
    }

    renderThinkMessage(entry) {
        const { content } = entry.dom;
        if (!content) {
            return;
        }

        const thinkDom = this.ensureThinkDom(entry);
        const thinkContent = typeof entry.content === 'string' ? entry.content : '';
        const formattedFull = this.formatMarkdownLikeHtml(thinkContent);
        const trimmedContent = thinkContent.replace(/[\s\n\r]+$/, '');
        const lines = trimmedContent ? trimmedContent.split(/\r?\n/) : [];
        const PREVIEW_LINE_LIMIT = 3;
        const previewSlice = lines.slice(-PREVIEW_LINE_LIMIT);
        const PREVIEW_CHAR_LIMIT = 320;
        let previewText = previewSlice.join('\n');
        if (previewText.length > PREVIEW_CHAR_LIMIT) {
            previewText = `...${previewText.slice(-PREVIEW_CHAR_LIMIT)}`;
        }
        const formattedPreview = this.formatMarkdownLikeHtml(previewText);
        const hiddenLineCount = Math.max(0, lines.length - previewSlice.length);

        thinkDom.preview.innerHTML = formattedPreview;
        thinkDom.full.innerHTML = formattedFull;

        if (hiddenLineCount === 0) {
            thinkDom.preview.style.display = 'none';
            thinkDom.full.style.display = '';
            thinkDom.toggle.style.display = 'none';
            thinkDom.toggle.setAttribute('aria-expanded', 'false');
            return;
        }

        thinkDom.toggle.style.display = '';
        if (entry.isThinkExpanded) {
            thinkDom.preview.style.display = 'none';
            thinkDom.full.style.display = '';
            thinkDom.toggle.textContent = '收起';
            thinkDom.toggle.setAttribute('aria-expanded', 'true');
        } else {
            thinkDom.preview.style.display = '';
            thinkDom.full.style.display = 'none';
            thinkDom.toggle.textContent = `展开全部（剩余 ${hiddenLineCount} 行）`;
            thinkDom.toggle.setAttribute('aria-expanded', 'false');
        }
    }

    ensureThinkDom(entry) {
        const { content } = entry.dom;
        content.classList.add('ai-message__content--think');
        if (entry.dom.think) {
            return entry.dom.think;
        }

        content.innerHTML = '';

        const title = document.createElement('div');
        title.className = 'ai-message__think-title';
        title.textContent = '思考';

        const body = document.createElement('div');
        body.className = 'ai-message__think-body';

        const preview = document.createElement('div');
        preview.className = 'ai-message__think-preview';

        const full = document.createElement('div');
        full.className = 'ai-message__think-full';

        body.appendChild(preview);
        body.appendChild(full);

        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'ai-message__think-toggle';
        toggle.textContent = '展开全部';
        toggle.setAttribute('aria-expanded', 'false');
        toggle.addEventListener('click', () => {
            entry.isThinkExpanded = !entry.isThinkExpanded;
            this.renderThinkMessage(entry);
        });

        content.appendChild(title);
        content.appendChild(body);
        content.appendChild(toggle);

        entry.dom.think = {
            title,
            body,
            preview,
            full,
            toggle,
        };

        return entry.dom.think;
    }

    removeMessage(messageId) {
        if (!messageId) {
            return;
        }
        const index = this.messages.findIndex(entry => entry.id === messageId);
        if (index === -1) {
            return;
        }
        const [entry] = this.messages.splice(index, 1);
        if (entry?.element?.parentElement) {
            entry.element.parentElement.removeChild(entry.element);
        }
    }

    scrollMessagesToBottom() {
        if (!this.messagesContainer) {
            return;
        }
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    }

    escapeHtml(value) {
        return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    formatMarkdownLikeHtml(value) {
        const escaped = this.escapeHtml(value);
        const withLineBreaks = escaped.replace(/\n/g, '<br />');
        return withLineBreaks.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    }

    describeMode(mode) {
        const found = QUICK_ACTIONS.find(action => action.id === mode);
        if (found) {
            return found.label;
        }
        switch (mode) {
            case 'custom':
                return '自定义';
            default:
                return mode;
        }
    }

    async handleSend() {
        if (this.isBusy) {
            return;
        }

        const prompt = (this.promptField?.value || '').trim();
        if (!prompt) {
            this.statusLabel.textContent = '请输入指令';
            this.statusLabel.classList.add('is-warning');
            return;
        }
        this.statusLabel.textContent = '';
        this.statusLabel.classList.remove('is-warning');

        try {
            // 添加用户消息到会话历史
            if (this.sessionManager) {
                this.sessionManager.addMessage('user', prompt);
                this.updateContextUsage();
            }

            // 获取编辑器上下文（文件内容）
            let context = null;
            if (typeof this.getEditorContext === 'function') {
                context = await this.getEditorContext({
                    preferSelection: true,  // 优先获取选中内容
                });
            }

            // 获取对话历史
            const history = this.sessionManager ? this.sessionManager.getHistory({ maxMessages: 20 }) : [];

            console.log('[AiSidebar] 发送请求:', {
                hasContext: !!context,
                contextLength: context?.length,
                hasHistory: !!history,
                historyLength: history?.length,
            });

            // 直接调用 aiService - 简化！
            await aiService.runTask({
                prompt,
                context,
                systemPrompt: null,
                mode: this.currentMode,
                history,
            }, {
                useTaskMode: true,
                currentFile: window.currentFile || null,
                workspaceRoot: null,
            });

            if (this.promptField) {
                this.promptField.value = '';
            }
        } catch (error) {
            const message = typeof error === 'string' ? error : error?.message || '请求失败';
            this.appendMessage({
                id: `${Date.now()}`,
                role: 'assistant',
                content: `${message}`,
                isError: true,
            });
        }
    }

    async handleInterrupt() {
        this.updateStatusMessage('正在尝试打断...');
        try {
            // 取消所有活动任务
            const activeTasks = Array.from(aiService.activeTasks.keys());
            if (activeTasks.length === 0) {
                this.updateStatusMessage('没有正在执行的任务', 'warning');
                return;
            }

            const taskId = activeTasks[activeTasks.length - 1];
            const success = await aiService.cancelTask(taskId);
            if (!success) {
                this.updateStatusMessage('打断失败', 'warning');
            }
        } catch (error) {
            console.warn('打断 AI 会话失败', error);
            this.updateStatusMessage('打断失败', 'warning');
        }
    }

    startThinkingAnimation(taskId) {
        const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
        let frameIndex = 0;

        this.thinkingAnimationTimer = setInterval(() => {
            const messageId = `${taskId}-thinking`;
            const message = this.messages.find(m => m.id === messageId);
            if (message) {
                message.content = `${frames[frameIndex]} 正在分析任务...`;
                // 直接更新 DOM
                if (message.dom?.content) {
                    message.dom.content.textContent = message.content;
                }
                frameIndex = (frameIndex + 1) % frames.length;
            } else {
                this.stopThinkingAnimation();
            }
        }, 80);
    }

    stopThinkingAnimation() {
        if (this.thinkingAnimationTimer) {
            clearInterval(this.thinkingAnimationTimer);
            this.thinkingAnimationTimer = null;
        }
    }

    /**
     * 显示上下文警告
     */
    showContextWarning(event) {
        const usage = Math.round(event.usage * 100);
        this.updateStatusMessage(event.message || `对话上下文已使用${usage}%`, 'warning');
    }

    /**
     * 更新上下文使用情况显示
     */
    updateContextUsage() {
        if (!this.contextUsageLabel || !this.sessionManager) {
            console.log('[AiSidebar] updateContextUsage: 缺少必要组件', {
                hasLabel: !!this.contextUsageLabel,
                hasManager: !!this.sessionManager
            });
            return;
        }

        const snapshot = this.sessionManager.getSessionSnapshot();
        console.log('[AiSidebar] Session snapshot:', snapshot);

        if (!snapshot) {
            this.contextUsageLabel.textContent = '';
            return;
        }

        const usage = Math.round((snapshot.totalTokens / snapshot.maxTokens) * 100);

        // 格式化 token 数量显示
        let tokensDisplay, maxTokensDisplay;
        if (snapshot.totalTokens < 1000) {
            tokensDisplay = `${snapshot.totalTokens}`;
        } else {
            tokensDisplay = `${(snapshot.totalTokens / 1000).toFixed(1)}k`;
        }

        if (snapshot.maxTokens < 1000) {
            maxTokensDisplay = `${snapshot.maxTokens}`;
        } else {
            maxTokensDisplay = `${Math.round(snapshot.maxTokens / 1000)}k`;
        }

        const displayText = `${usage}% (${tokensDisplay} / ${maxTokensDisplay} tokens)`;
        console.log('[AiSidebar] Updating context usage:', displayText);
        this.contextUsageLabel.textContent = displayText;

        // 根据使用率改变颜色
        if (usage >= 80) {
            this.contextUsageLabel.style.color = '#f44336'; // 红色警告
        } else if (usage >= 60) {
            this.contextUsageLabel.style.color = '#ff9800'; // 橙色提示
        } else {
            this.contextUsageLabel.style.color = '#999'; // 正常灰色
        }
    }
}
