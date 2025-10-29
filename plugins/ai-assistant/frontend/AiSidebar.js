import { addClickHandler } from '../../../src/utils/PointerHelper.js';
import { aiService } from './aiService.js';
import { DualAgentOrchestrator } from './agents/DualAgentOrchestrator.js';
import { ExecutorAgent } from './agents/ExecutorAgent.js';
import { trimTextPreview } from './utils/textPreview.js';

const STATUS_HINT_DEFAULT = '可输入消息或让 AI 阅读当前文档';
const STATUS_HINT_MISSING_KEY = '请先在设置中配置 API Key';

export class AiSidebar {
    constructor(containerElement, contextOptionsOrGetEditorContext, callbacks = {}) {
        this.container = containerElement;
        this.callbacks = callbacks || {};

        if (typeof contextOptionsOrGetEditorContext === 'function') {
            this.app = null;
            this.getEditorContext = contextOptionsOrGetEditorContext;
            this.getDocumentContent = contextOptionsOrGetEditorContext;
            this.getActiveViewMode = async () => 'markdown';
            this.documentApi = null;
        } else {
            const options = contextOptionsOrGetEditorContext || {};
            this.app = options.app || null;
            this.getEditorContext = options.getEditorContext || (async (innerOptions = {}) => {
                if (this.app?.getEditorContext) {
                    return await this.app.getEditorContext(innerOptions);
                }
                return '';
            });
            this.getDocumentContent = options.getDocumentContent || (async () => {
                if (this.app?.getDocumentContent) {
                    return await this.app.getDocumentContent();
                }
                return await this.getEditorContext({ preferSelection: false });
            });
            this.getActiveViewMode = options.getActiveViewMode || (async () => {
                if (this.app?.getActiveViewMode) {
                    return await this.app.getActiveViewMode();
                }
                return 'markdown';
            });
            this.documentApi = options.documentApi || null;
        }

        if (!this.documentApi && this.app?.document) {
            this.documentApi = this.app.document;
        }

        this.isVisible = false;
        this.isBusy = false;
        this.messages = [];
        this.streamStates = new Map();
        this.unsubscribe = null;
        this.pendingTaskQueue = [];
        this.taskContexts = new Map();
        this.executorAgent = new ExecutorAgent();
        this.activeSessionToken = null;
        this.sessionLog = [];
        this.statusHintText = STATUS_HINT_DEFAULT;
        this.editorRefs = {
            markdownEditor: null,
            codeEditor: null,
        };
        this.orchestrator = new DualAgentOrchestrator({
            document: this.documentApi,
            executeWithStreaming: (request, requestOptions) => this.executeExecutorRequest(request, requestOptions),
            executor: this.executorAgent,
            onAction: action => this.handleOrchestratorAction(action),
            fallbackReadDocument: async () => {
                if (typeof this.getDocumentContent === 'function') {
                    return await this.getDocumentContent({ preferSelection: false });
                }
                return '';
            },
        });

        this.render();
        this.bindEvents();
        this.attachController();
    }

    setEditorReferences(refs = {}) {
        this.editorRefs.markdownEditor = refs.markdownEditor || null;
        this.editorRefs.codeEditor = refs.codeEditor || null;
    }

    render() {
        this.container.classList.add('ai-sidebar');
        this.container.innerHTML = `
            <div class="ai-sidebar__header">
                <div>
                    <h3 class="ai-sidebar__title">AI 助手</h3>
                    <p class="ai-sidebar__subtitle">双智能体调度模式</p>
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
                    void this.handleSend();
                }
            });
        }

        if (this.promptField) {
            this.promptField.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !this.isBusy) {
                    event.preventDefault();
                    void this.handleSend();
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
        this.unsubscribe = aiService.subscribe(event => {
            switch (event.type) {
                case 'task-started': {
                    const pending = this.pendingTaskQueue.shift() || null;
                    const fallbackPrompt = pending?.requestOptions?.prompt || pending?.context?.originalPrompt || '';
                    const taskContext = pending?.context || {
                        originalPrompt: fallbackPrompt,
                        runCount: 0,
                        displayPrompt: pending?.displayPrompt !== false,
                    };

                    taskContext.currentTaskId = event.id;
                    taskContext.lastRequestOptions = pending?.requestOptions || event.payload || {};
                    taskContext.displayMessage = pending?.displayMessage ?? taskContext.originalPrompt ?? fallbackPrompt;
                    taskContext.runCount = (taskContext.runCount || 0) + 1;
                    taskContext.displayPrompt = pending?.displayPrompt !== false;
                    this.taskContexts.set(event.id, taskContext);

                    this.setBusy(true);

                    if (taskContext.displayPrompt) {
                        const messageContent = pending?.displayMessage ?? taskContext.originalPrompt ?? event.payload?.prompt ?? '';
                        if (messageContent) {
                            this.appendMessage({
                                id: `${event.id}-user`,
                                role: 'user',
                                content: messageContent,
                            });
                        }
                    }
                    break;
                }

                case 'task-stream-start':
                    this.streamStates.set(event.id, { streaming: true });
                    break;

                case 'task-stream-chunk':
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
                    this.cleanupTaskContext(event.id);
                    break;

                case 'task-failed':
                    this.appendMessage({
                        id: `${event.id}-assistant`,
                        role: 'assistant',
                        content: `错误: ${event.error}`,
                        isError: true,
                    });
                    this.streamStates.delete(event.id);
                    this.cleanupTaskContext(event.id);
                    this.setBusy(false);
                    break;

                case 'task-cancelled':
                    this.appendMessage({
                        id: `${event.id}-cancelled`,
                        role: 'assistant',
                        content: '已取消',
                        isError: true,
                    });
                    this.cleanupTaskContext(event.id);
                    this.setBusy(false);
                    break;

                case 'config':
                    this.updateStatusHint(event.data);
                    break;

                default:
                    break;
            }
        });

        const config = aiService.getConfig();
        this.updateStatusHint(config);
    }

    destroy() {
        if (this.unsubscribe) {
            this.unsubscribe();
            this.unsubscribe = null;
        }
        this.pendingTaskQueue = [];
        this.taskContexts.clear();
    }

    updateStatusHint(config) {
        if (!this.statusLabel) return;

        if (!config || !config.apiKey) {
            this.statusHintText = STATUS_HINT_MISSING_KEY;
            this.statusLabel.classList.add('is-warning');
        } else {
            this.statusHintText = STATUS_HINT_DEFAULT;
            this.statusLabel.classList.remove('is-warning');
        }

        this.statusLabel.textContent = this.statusHintText;
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
        if (message) {
            this.statusLabel.textContent = message;
        } else {
            this.statusLabel.textContent = this.statusHintText;
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
        this.pendingTaskQueue = [];
        this.taskContexts.clear();
        this.sessionLog = [];
        if (this.messagesContainer) {
            this.messagesContainer.innerHTML = '';
        }
    }

    appendMessage(message) {
        if (!message) return null;

        const id = message.id || `msg-${Date.now()}`;
        const existingIndex = this.messages.findIndex(entry => entry.id === id);

        if (existingIndex !== -1) {
            const existing = this.messages[existingIndex];
            Object.assign(existing, message);
            this.renderMessageEntry(existing);
            return existing;
        }

        const entry = {
            id,
            role: message.role || 'assistant',
            content: message.content || '',
            isStreaming: message.isStreaming || false,
            isError: message.isError || false,
            isMeta: message.isMeta || false,
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
        element.classList.toggle('ai-message--meta', !!entry.isMeta);

        if (content) {
            content.textContent = entry.content || '';
        }
    }

    scrollMessagesToBottom() {
        if (!this.messagesContainer) return;
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    }

    buildConversationHistory() {
        return this.messages
            .filter(m => m.role && m.content && !m.isError)
            .slice(-10)
            .map(m => ({ role: m.role, content: m.content }));
    }

    async executeExecutorRequest(request, options = {}) {
        const taskContext = {
            originalPrompt: options.prompt || '',
            displayPrompt: options.displayPrompt ?? false,
            displayMessage: options.displayMessage ?? null,
        };

        const pendingEntry = {
            context: taskContext,
            requestOptions: request,
            displayPrompt: taskContext.displayPrompt,
            displayMessage: taskContext.displayMessage,
        };

        this.pendingTaskQueue.push(pendingEntry);

        try {
            const result = await aiService.runTask(request);
            return result;
        } catch (error) {
            const index = this.pendingTaskQueue.indexOf(pendingEntry);
            if (index !== -1) {
                this.pendingTaskQueue.splice(index, 1);
            }
            throw error;
        }
    }

    async handleSend() {
        if (this.isBusy) return;

        const prompt = (this.promptField?.value || '').trim();
        if (!prompt) {
            this.updateStatusMessage('请输入消息');
            return;
        }

        this.appendMessage({
            role: 'user',
            content: prompt,
        });

        if (this.promptField) {
            this.promptField.value = '';
        }

        const sessionToken = Symbol('session');
        this.activeSessionToken = sessionToken;
        this.sessionLog = [];
        this.updateStatusMessage('调度中…');
        this.setBusy(true);

        try {
            const conversationHistory = this.buildConversationHistory();
            const normalizedPrompt = prompt;
            const session = await this.orchestrator.runSession({
                userPrompt: normalizedPrompt,
                conversationHistory,
            });

            if (this.activeSessionToken !== sessionToken) {
                return;
            }

            this.handleSessionCompletion(session);
        } catch (error) {
            if (this.activeSessionToken === sessionToken) {
                const errorMessage = `错误: ${error.message}`;
                const lastMessage = this.messages[this.messages.length - 1];
                if (!lastMessage || lastMessage.content !== errorMessage) {
                    this.appendMessage({
                        role: 'assistant',
                        content: errorMessage,
                        isError: true,
                    });
                }
                this.updateStatusMessage(errorMessage);
            }
        } finally {
            if (this.activeSessionToken === sessionToken) {
                this.setBusy(false);
                this.activeSessionToken = null;
            }
        }
    }

    handleSessionCompletion(session) {
        if (!session) {
            return;
        }

        if (session.status === 'finished') {
            const answerCandidate = session.finalAnswer ?? session.lastExecutorAnswer ?? '';
            let finalAnswer = typeof answerCandidate === 'string'
                ? answerCandidate.trim()
                : (answerCandidate && typeof answerCandidate === 'object'
                    ? JSON.stringify(answerCandidate)
                    : '');

            if (!finalAnswer) {
                const reasoning = session.finishMetadata?.metadata?.reasoning;
                if (typeof reasoning === 'string' && reasoning.trim()) {
                    finalAnswer = reasoning.trim();
                } else {
                    finalAnswer = '（本次调度未生成回答，请重试或补充指令。）';
                }
            }

            if (finalAnswer) {
                this.appendMessage({
                    role: 'assistant',
                    content: finalAnswer,
                });
            }

            const notes = session.finishMetadata?.notes || '✅ 调度完成';
            if (notes) {
                this.appendMessage({
                    role: 'assistant',
                    content: notes,
                    isMeta: true,
                });
            }
            this.updateStatusMessage('调度完成');
            return;
        }

        if (session.status === 'max_iterations') {
            this.appendMessage({
                role: 'assistant',
                content: '已达到最大调度轮数，结果可能不完整。',
                isError: true,
            });
            this.updateStatusMessage('调度超时');
            return;
        }

        if (session.status === 'running') {
            this.updateStatusMessage('调度进行中');
        }
    }

    handleOrchestratorAction(actionEvent) {
        if (!actionEvent) {
            return;
        }

        this.sessionLog.push(actionEvent);

        switch (actionEvent.event) {
            case 'coordinator_decision': {
                const { decision } = actionEvent.payload || {};
                if (!decision) break;
                const action = decision.action || 'unknown';
                const reasoning = decision.metadata?.reasoning || '';
                const confidence = decision.metadata?.confidence ? `（置信度：${decision.metadata.confidence}）` : '';
                const parts = [`🧭 调度动作：${action}`, reasoning ? `理由：${reasoning}` : null, confidence || null];
                const content = parts.filter(Boolean).join(' ');
                this.appendMessage({
                    role: 'assistant',
                    content,
                    isMeta: true,
                });
                break;
            }

            case 'read_document': {
                const { range, preview } = actionEvent.payload || {};
                let content = '📄 调度请求读取文档';
                if (actionEvent.payload?.message === 'empty') {
                    if (range) {
                        content = `📄 第 ${range.startLine}-${range.endLine} 行暂无可用内容`;
                    } else {
                        content = '📄 当前范围没有可用内容';
                    }
                } else if (range) {
                    content = `📄 读取文档第 ${range.startLine}-${range.endLine} 行`;
                } else if (actionEvent.payload?.message === 'reached_end') {
                    content = '📄 已到达文档末尾，无法继续读取';
                }

                const suffix = preview ? `：${trimTextPreview(preview, 80)}` : '';
                this.appendMessage({
                    role: 'assistant',
                    content: `${content}${suffix}`,
                    isMeta: true,
                });
                break;
            }

            case 'delegate_to_executor': {
                this.appendMessage({
                    role: 'assistant',
                    content: '🤖 正在交由解答 AI 生成答案...',
                    isMeta: true,
                });
                break;
            }

            case 'insert_after_range': {
                const { range, appliedRange, preview } = actionEvent.payload || {};
                const target = appliedRange || range;
                const label = target
                    ? `第 ${target.startLine}-${target.endLine} 行`
                    : '文档末尾';
                const suffix = preview ? `：${trimTextPreview(preview, 80)}` : '';
                this.appendMessage({
                    role: 'assistant',
                    content: `✏️ 已在 ${label} 后插入内容${suffix}`,
                    isMeta: true,
                });
                break;
            }

            case 'replace_range': {
                const { range, appliedRange, preview } = actionEvent.payload || {};
                const target = range || appliedRange;
                const label = target
                    ? `第 ${target.startLine}-${target.endLine} 行`
                    : '指定范围';
                const suffix = preview ? `：${trimTextPreview(preview, 80)}` : '';
                this.appendMessage({
                    role: 'assistant',
                    content: `✏️ 已替换 ${label} 的内容${suffix}`,
                    isMeta: true,
                });
                break;
            }

            case 'append_to_document': {
                const { preview } = actionEvent.payload || {};
                const suffix = preview ? `：${trimTextPreview(preview, 80)}` : '';
                this.appendMessage({
                    role: 'assistant',
                    content: `✏️ 已追加内容到文档结尾${suffix}`,
                    isMeta: true,
                });
                break;
            }

            default:
                break;
        }
    }

    cleanupTaskContext(taskId) {
        if (taskId && this.taskContexts.has(taskId)) {
            this.taskContexts.delete(taskId);
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
