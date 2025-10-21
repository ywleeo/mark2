import { addClickHandler } from '../utils/PointerHelper.js';

const QUICK_ACTIONS = [];

export class AiSidebar {
    constructor(containerElement, controller, callbacks = {}) {
        this.container = containerElement;
        this.controller = controller;
        this.callbacks = callbacks;

        this.isVisible = false;
        this.isBusy = false;
        this.messages = [];
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
                    <button type="button" class="ai-sidebar__settings" title="AI 设置">⚙</button>
                    <button type="button" class="ai-sidebar__close" title="关闭">×</button>
                </div>
            </div>

            <div class="ai-sidebar__messages" data-role="messages"></div>

            <div class="ai-sidebar__footer">
                <div class="ai-sidebar__context">
                    <label>
                        <input type="checkbox" data-role="use-selection" checked />
                        优先使用当前选中内容
                    </label>
                </div>
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
        this.settingsButton = this.container.querySelector('.ai-sidebar__settings');
        this.useSelectionToggle = this.container.querySelector('[data-role="use-selection"]');
        this.quickButtons = [];
    }

    bindEvents() {
        if (this.sendButton) {
            this.sendButton.addEventListener('click', () => this.handleSend());
        }

        if (this.promptField) {
            this.promptField.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
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

        if (this.settingsButton) {
            const cleanup = addClickHandler(this.settingsButton, () => {
                if (typeof this.callbacks.onOpenSettings === 'function') {
                    this.callbacks.onOpenSettings();
                }
            });
            this.settingsButton.dataset.cleanup = cleanup;
        }
    }

    attachController() {
        if (!this.controller) {
            return;
        }

        this.unsubscribe = this.controller.subscribe(event => {
            switch (event.type) {
                case 'task-started':
                    this.setBusy(true);
                    this.appendMessage({
                        id: event.id,
                        role: 'user',
                        mode: event.payload.mode || 'custom',
                        content: event.payload.prompt,
                        context: event.payload.context,
                    });
                    break;
                case 'task-completed': {
                    this.setBusy(false);
                    const rawContent = typeof event.content === 'string' ? event.content : '';
                    const { think, answer } = this.splitCompletionContent(rawContent);
                    if (think) {
                        const thinkMessage = {
                            id: `${event.id}-think`,
                            role: 'assistant',
                            content: think,
                            metadata: {
                                raw: rawContent,
                                think,
                                answer,
                            },
                        };
                        this.appendMessage(thinkMessage);
                    }
                    if (typeof this.callbacks.onAutoInsert === 'function') {
                        this.callbacks.onAutoInsert({
                            id: event.id,
                            content: answer || rawContent,
                            think,
                            raw: rawContent,
                        });
                    }
                    if (answer && this.callbacks.onDisplayAnswer === 'function') {
                        this.callbacks.onDisplayAnswer({
                            id: `${event.id}-answer`,
                            content: answer,
                            raw: rawContent,
                        });
                    }
                    break;
                }
                case 'task-failed':
                    this.setBusy(false);
                    this.appendMessage({
                        id: event.id,
                        role: 'assistant',
                        content: `⚠️ 请求失败：${event.error?.message || event.error || '未知错误'}`,
                        isError: true,
                    });
                    break;
                case 'config':
                    this.updateStatusHint(event.data);
                    break;
                default:
                    break;
            }
        });

        this.controller.ensureConfig().catch(error => {
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

        [this.closeButton, this.settingsButton].forEach((button) => {
            if (!button) return;
            const cleanup = button.dataset?.cleanup;
            if (typeof cleanup === 'function') {
                cleanup();
            }
        });
    }

    splitCompletionContent(text) {
        if (typeof text !== 'string' || text.length === 0) {
            return { think: '', answer: '' };
        }

        const THINK_START = '<think>';
        const THINK_END = '</think>';
        const startIndex = text.indexOf(THINK_START);
        const endIndex = text.indexOf(THINK_END);

        if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
            const think = text.slice(startIndex + THINK_START.length, endIndex).trim();
            const answer = text.slice(endIndex + THINK_END.length).trim();
            return { think, answer };
        }

        return { think: '', answer: text.trim() };
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
            this.sendButton.disabled = isBusy;
            this.sendButton.textContent = isBusy ? '生成中...' : '发送';
        }
        if (this.promptField) {
            this.promptField.disabled = isBusy;
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
        this.messages = [];
        if (this.messagesContainer) {
            this.messagesContainer.innerHTML = '';
        }
    }

    appendMessage(message) {
        this.messages.push(message);
        if (!this.messagesContainer) return;

        const messageElement = document.createElement('div');
        messageElement.className = `ai-message ai-message--${message.role}`;

        if (message.isError) {
            messageElement.classList.add('ai-message--error');
        }

        const displayContent = typeof message.content === 'string' ? message.content : '';

        messageElement.innerHTML = `
            <div class="ai-message__header">
                <span class="ai-message__role">${message.role === 'assistant' ? 'AI' : '我'}</span>
                ${message.mode ? `<span class="ai-message__mode">${this.describeMode(message.mode)}</span>` : ''}
            </div>
            <div class="ai-message__content">${this.escapeHtml(displayContent)}</div>
        `;

        const contentElement = messageElement.querySelector('.ai-message__content');
        if (contentElement) {
            contentElement.innerHTML = this.formatMarkdownLikeHtml(displayContent);
        }

        this.messagesContainer.appendChild(messageElement);
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
        if (!this.controller) {
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

        const context = this.useSelectionToggle?.checked && typeof this.callbacks.onRequestContext === 'function'
            ? await this.callbacks.onRequestContext()
            : null;

        try {
            await this.controller.runTask({
                prompt,
                context,
                mode: this.currentMode,
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
}
