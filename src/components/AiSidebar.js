import { addClickHandler } from '../utils/PointerHelper.js';
import { aiService } from '../modules/aiService.js';

export class AiSidebar {
    constructor(containerElement, getEditorContext, callbacks = {}) {
        this.container = containerElement;
        this.getEditorContext = getEditorContext;
        this.callbacks = callbacks;

        this.isVisible = false;
        this.isBusy = false;
        this.messages = [];
        this.streamStates = new Map();
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
                    <h3 class="ai-sidebar__title">AI 助手</h3>
                    <p class="ai-sidebar__subtitle">支持流式对话</p>
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
                    <textarea data-role="prompt-input" placeholder="输入消息..."></textarea>
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
    }

    bindEvents() {
        if (this.sendButton) {
            this.sendButton.addEventListener('click', () => {
                if (this.isBusy) {
                    this.handleInterrupt();
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
            addClickHandler(this.closeButton, () => this.hide());
        }

        if (this.clearButton) {
            addClickHandler(this.clearButton, () => {
                this.clearMessages();
                this.updateStatusMessage('');
            });
        }
    }

    attachController() {
        // 订阅 aiService 的事件
        this.unsubscribe = aiService.subscribe(event => {
            switch (event.type) {
                case 'task-started':
                    this.setBusy(true);
                    this.appendMessage({
                        id: `${event.id}-user`,
                        role: 'user',
                        content: event.payload?.prompt || '',
                    });
                    break;

                case 'task-stream-start':
                    this.streamStates.set(event.id, { streaming: true });
                    break;

                case 'task-stream-chunk':
                    // 只有当有内容时才显示 assistant 消息
                    if (event.buffer && event.buffer.trim()) {
                        this.appendMessage({
                            id: `${event.id}-assistant`,
                            role: 'assistant',
                            content: event.buffer,
                            isStreaming: true,
                        });
                        this.scrollMessagesToBottom();
                    }
                    break;

                case 'task-stream-end':
                    this.appendMessage({
                        id: `${event.id}-assistant`,
                        role: 'assistant',
                        content: event.buffer || '',
                        isStreaming: false,
                    });
                    this.streamStates.delete(event.id);
                    this.setBusy(false);
                    break;

                case 'task-failed':
                    this.appendMessage({
                        id: `${event.id}-assistant`,
                        role: 'assistant',
                        content: `错误: ${event.error}`,
                        isError: true,
                    });
                    this.streamStates.delete(event.id);
                    this.setBusy(false);
                    break;

                case 'task-cancelled':
                    this.appendMessage({
                        id: `${event.id}-cancelled`,
                        role: 'assistant',
                        content: '已取消',
                        isError: true,
                    });
                    this.setBusy(false);
                    break;

                case 'config':
                    this.updateStatusHint(event.data);
                    break;
            }
        });

        // 初始化配置提示
        const config = aiService.getConfig();
        this.updateStatusHint(config);
    }

    destroy() {
        if (this.unsubscribe) {
            this.unsubscribe();
            this.unsubscribe = null;
        }
    }

    updateStatusHint(config) {
        if (!this.statusLabel) return;

        if (!config || !config.apiKey) {
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
    }

    updateStatusMessage(message) {
        if (!this.statusLabel) return;
        this.statusLabel.textContent = message || '';
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
        this.messages.forEach(entry => {
            if (entry?.element?.parentElement) {
                entry.element.parentElement.removeChild(entry.element);
            }
        });
        this.messages = [];
        this.streamStates.clear();
        if (this.messagesContainer) {
            this.messagesContainer.innerHTML = '';
        }
    }

    appendMessage(message) {
        if (!message) return null;

        const id = message.id || `msg-${Date.now()}`;
        const existingIndex = this.messages.findIndex(entry => entry.id === id);

        if (existingIndex !== -1) {
            // 更新现有消息
            const existing = this.messages[existingIndex];
            Object.assign(existing, message);
            this.renderMessageEntry(existing);
            return existing;
        }

        // 创建新消息
        const entry = {
            id,
            role: message.role || 'assistant',
            content: message.content || '',
            isStreaming: message.isStreaming || false,
            isError: message.isError || false,
        };

        entry.element = this.buildMessageElement(entry);
        this.renderMessageEntry(entry);
        this.messages.push(entry);

        if (this.messagesContainer && entry.element) {
            this.messagesContainer.appendChild(entry.element);
            this.scrollMessagesToBottom();
        }

        return entry;
    }

    buildMessageElement(entry) {
        const element = document.createElement('div');
        element.classList.add('ai-message', `ai-message--${entry.role}`);
        element.dataset.messageId = entry.id;

        const content = document.createElement('div');
        content.className = 'ai-message__content';
        element.appendChild(content);

        entry.dom = { element, content };
        return element;
    }

    renderMessageEntry(entry) {
        if (!entry?.dom?.element) return;

        const { element, content } = entry.dom;

        element.classList.toggle('ai-message--error', !!entry.isError);
        element.classList.toggle('ai-message--streaming', !!entry.isStreaming);

        if (content) {
            content.textContent = entry.content || '';
        }
    }

    scrollMessagesToBottom() {
        if (!this.messagesContainer) return;
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    }

    async handleSend() {
        if (this.isBusy) return;

        const prompt = (this.promptField?.value || '').trim();
        if (!prompt) {
            this.updateStatusMessage('请输入消息');
            return;
        }

        this.updateStatusMessage('');

        try {
            // 获取对话历史（最近 10 条消息）
            const history = this.messages
                .filter(m => m.role && m.content && !m.isError)
                .slice(-10)
                .map(m => ({ role: m.role, content: m.content }));

            await aiService.runTask({
                prompt,
                history,
            });

            if (this.promptField) {
                this.promptField.value = '';
            }
        } catch (error) {
            this.updateStatusMessage(`错误: ${error.message}`);
        }
    }

    async handleInterrupt() {
        try {
            const activeTasks = Array.from(aiService.activeTasks.keys());
            if (activeTasks.length > 0) {
                const taskId = activeTasks[activeTasks.length - 1];
                await aiService.cancelTask(taskId);
            }
        } catch (error) {
            console.warn('取消任务失败', error);
        }
    }
}
