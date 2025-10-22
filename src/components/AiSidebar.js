import { addClickHandler } from '../utils/PointerHelper.js';
import { splitThinkAndAnswer } from '../utils/aiStreamUtils.js';

const QUICK_ACTIONS = [];

export class AiSidebar {
    constructor(containerElement, runtime, callbacks = {}) {
        this.container = containerElement;
        this.runtime = runtime;
        this.callbacks = callbacks;

        this.isVisible = false;
        this.isBusy = false;
        this.messages = [];
        this.streamStates = new Map();
        this.currentMode = 'custom';
        this.unsubscribe = null;

        this.render();
        this.bindEvents();
        this.attachController();
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

            <div class="ai-sidebar__footer">
                <div class="ai-sidebar__input">
                    <textarea data-role="prompt-input" placeholder="告诉 AI 你想做什么，比如：‘请润色这一段，让语气更柔和’"></textarea>
                    <div class="ai-sidebar__actions">
                        <span class="ai-sidebar__status" data-role="status"></span>
                        <button type="button" class="ai-sidebar__send-btn" data-role="send">发送</button>
                    </div>
                </div>
            </div>
        `;

        this.messagesContainer = this.container.querySelector('[data-role="messages"]');
        this.sendButton = this.container.querySelector('[data-role="send"]');
        this.promptField = this.container.querySelector('[data-role="prompt-input"]');
        this.statusLabel = this.container.querySelector('[data-role="status"]');
        this.closeButton = this.container.querySelector('.ai-sidebar__close');
        this.clearButton = this.container.querySelector('[data-role="clear-messages"]');
        this.quickButtons = [];
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
                if (typeof this.callbacks.onClearMessages === 'function') {
                    this.callbacks.onClearMessages();
                }
                this.updateStatusMessage('');
            });
            this.clearButton.dataset.cleanup = cleanup;
        }
    }

    attachController() {
        if (!this.runtime) {
            return;
        }

        this.unsubscribe = this.runtime.subscribe(event => {
            switch (event.type) {
                case 'task-started': {
                    this.setBusy(true);
                    const mode = event.payload?.mode || 'custom';
                    this.streamStates.set(event.id, { mode });
                    this.appendMessage({
                        id: `${event.id}-user`,
                        role: 'user',
                        mode,
                        content: event.payload?.prompt || '',
                        context: event.payload?.context,
                    });
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
                    break;
                }
                case 'task-failed': {
                    this.setBusy(false);
                    this.streamStates.delete(event.id);
                    this.removeMessage(`${event.id}-think`);
                    const errorMessage = `⚠️ 请求失败：${event.error?.message || event.error || '未知错误'}`;
                    this.appendMessage({
                        id: `${event.id}-answer`,
                        role: 'assistant',
                        content: errorMessage,
                        isError: true,
                        isStreaming: false,
                    });
                    this.updateStatusMessage(errorMessage, 'warning');
                    break;
                }
                case 'config':
                    this.updateStatusHint(event.data);
                    break;
                case 'task-cancelled': {
                    this.setBusy(false);
                    this.updateStatusMessage('生成已终止');
                    break;
                }
                default:
                    break;
            }
        });

        this.runtime.ensureConfig().catch(error => {
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
        if (isBusy) {
            this.updateStatusMessage('AI 正在生成...');
        } else {
            this.updateStatusMessage('');
        }
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
        if (!this.runtime) {
            return;
        }
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
            await this.runtime.runTask({
                prompt,
                mode: this.currentMode,
                useSelection: true,
            });
            if (this.promptField) {
                this.promptField.value = '';
            }
        } catch (error) {
            const message = typeof error === 'string' ? error : error?.message || '请求失败';
            this.appendMessage({
                id: `${Date.now()}`,
                role: 'assistant',
                content: `⚠️ ${message}`,
                isError: true,
            });
        }
    }

    async handleInterrupt() {
        if (!this.runtime?.cancelActiveTask) {
            return;
        }
        this.updateStatusMessage('正在尝试打断...');
        try {
            const success = await this.runtime.cancelActiveTask();
            if (!success) {
                this.updateStatusMessage('没有正在执行的任务', 'warning');
            }
        } catch (error) {
            console.warn('打断 AI 会话失败', error);
            this.updateStatusMessage('打断失败', 'warning');
        }
    }
}
