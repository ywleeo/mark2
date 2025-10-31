import { addClickHandler } from '../../../src/utils/PointerHelper.js';
import { aiService } from './aiService.js';
import { ExecutorAgent } from './agents/ExecutorAgent.js';
import { AnswerActions } from './sidebar/AnswerActions.js';
import { SidebarRenderer } from './sidebar/SidebarRenderer.js';

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
        this.thinkStates = new Map();
        this.statusHintText = STATUS_HINT_DEFAULT;
        this.editorRefs = {
            markdownEditor: null,
            codeEditor: null,
        };
        this.answerActions = new AnswerActions(this);
        this.renderer = new SidebarRenderer(this.container);

        this.render();
        this.bindEvents();
        this.attachController();
    }

    setEditorReferences(refs = {}) {
        console.log('[AiSidebar] setEditorReferences', refs);
        this.editorRefs.markdownEditor = refs.markdownEditor || null;
        this.editorRefs.codeEditor = refs.codeEditor || null;
    }

    render() {
        const refs = this.renderer.render();
        this.messagesContainer = refs.messagesContainer;
        this.sendButton = refs.sendButton;
        this.promptField = refs.promptField;
        this.statusLabel = refs.statusLabel;
        this.closeButton = refs.closeButton;
        this.clearButton = refs.clearButton;
    }

    bindEvents() {
        if (this.sendButton) {
            this.sendButton.addEventListener('click', () => {
                if (this.isBusy) {
                    void this.handleInterrupt();
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
                    const fallbackPrompt = pending?.requestOptions?.prompt || '';
                    const taskContext = pending?.context || {
                        originalPrompt: fallbackPrompt,
                        runCount: 0,
                        displayPrompt: false,
                    };

                    taskContext.currentTaskId = event.id;
                    taskContext.lastRequestOptions = pending?.requestOptions || event.payload || {};
                    taskContext.displayPrompt = pending?.displayPrompt === true;
                    taskContext.displayMessage = pending?.displayMessage ?? null;
                    taskContext.runCount = (taskContext.runCount || 0) + 1;
                    taskContext.userMessageId = pending?.userMessageId || null;
                    this.taskContexts.set(event.id, taskContext);

                    this.setBusy(true);
                    this.updateStatusMessage('AI 正在生成回答…');
                    break;
                }

                case 'task-stream-start':
                    this.streamStates.set(event.id, { streaming: true });
                    break;

                case 'task-stream-think':
                    this.updateThinkStream(event.id, typeof event.buffer === 'string' ? event.buffer : (event.delta || ''));
                    break;

                case 'task-stream-chunk': {
                    const taskContext = this.taskContexts.get(event.id);
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
                }

                case 'task-stream-end': {
                    const taskContext = this.taskContexts.get(event.id);
                    this.appendMessage({
                        id: `${event.id}-assistant`,
                        role: 'assistant',
                        content: event.buffer || '',
                        isStreaming: false,
                    });
                    this.streamStates.delete(event.id);
                    if (taskContext?.userMessageId) {
                        this.resolvePendingConversation(taskContext.userMessageId);
                    }
                    this.cleanupTaskContext(event.id);
                    this.finalizeThinkBlock(event.id, event.thinkBuffer || '');
                    this.setBusy(false);
                    this.updateStatusMessage('');
                    break;
                }

                case 'task-failed': {
                    const taskContext = this.taskContexts.get(event.id);
                    this.appendMessage({
                        id: `${event.id}-assistant`,
                        role: 'assistant',
                        content: `错误: ${event.error}`,
                        isError: true,
                    });
                    this.streamStates.delete(event.id);
                    if (taskContext?.userMessageId) {
                        this.resolvePendingConversation(taskContext.userMessageId);
                    }
                    this.cleanupTaskContext(event.id);
                    this.finalizeThinkBlock(event.id);
                    this.setBusy(false);
                    this.updateStatusMessage(event.error || '请求失败');
                    break;
                }

                case 'task-cancelled': {
                    const taskContext = this.taskContexts.get(event.id);
                    this.appendMessage({
                        id: `${event.id}-cancelled`,
                        role: 'assistant',
                        content: '已取消',
                        isError: true,
                    });
                    if (taskContext?.userMessageId) {
                        this.resolvePendingConversation(taskContext.userMessageId);
                    }
                    this.cleanupTaskContext(event.id);
                    this.finalizeThinkBlock(event.id);
                    this.setBusy(false);
                    this.updateStatusMessage('已取消');
                    break;
                }

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
        this.thinkStates.forEach(state => {
            if (state?.element?.parentElement) {
                state.element.parentElement.removeChild(state.element);
            }
        });
        this.thinkStates.clear();
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
        this.thinkStates.forEach(state => {
            if (state?.element?.parentElement) {
                state.element.parentElement.removeChild(state.element);
            }
        });
        this.thinkStates.clear();
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
            isStreaming: !!message.isStreaming,
            isError: !!message.isError,
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

        if (entry.role === 'assistant' && !entry.isError) {
            element.classList.add('ai-message--answer');
            this.answerActions.render(entry);
        }
    }

    showToast(message, type = 'info') {
        if (this.app?.showNotification) {
            this.app.showNotification({ message, type, duration: 2200 });
        } else {
            console.log(`[AI Sidebar ${type}] ${message}`);
        }
    }

    updateThinkStream(taskId, buffer) {
        if (!buffer) {
            return;
        }
        let state = this.thinkStates.get(taskId);
        if (!state) {
            state = this.createThinkBlock(taskId);
            this.thinkStates.set(taskId, state);
        }
        state.buffer = buffer;
        state.complete = false;
        this.refreshThinkBlock(state);
        this.scrollMessagesToBottom();
    }

    finalizeThinkBlock(taskId, finalBuffer = null) {
        const state = this.thinkStates.get(taskId);
        if (!state && (finalBuffer || finalBuffer === '')) {
            if (finalBuffer) {
                const newState = this.createThinkBlock(taskId);
                newState.buffer = finalBuffer;
                newState.complete = true;
                this.thinkStates.set(taskId, newState);
                this.refreshThinkBlock(newState);
            }
            return;
        }
        if (!state) return;

        if (typeof finalBuffer === 'string') {
            state.buffer = finalBuffer;
        }
        state.complete = true;
        this.refreshThinkBlock(state);
    }

    createThinkBlock(taskId) {
        const state = {
            id: taskId,
            buffer: '',
            expanded: false,
            complete: false,
            element: null,
            body: null,
            hint: null,
        };

        const element = document.createElement('div');
        element.classList.add('ai-message', 'ai-message--assistant', 'ai-message--think');
        element.dataset.taskId = taskId;

        const content = document.createElement('div');
        content.className = 'ai-message__content ai-message__content--think';

        const title = document.createElement('div');
        title.className = 'ai-message__think-title';
        title.textContent = '🤔 模型思考';

        const body = document.createElement('pre');
        body.className = 'ai-message__think-body';
        body.textContent = '';

        const hint = document.createElement('div');
        hint.className = 'ai-message__think-hint';

        content.appendChild(title);
        content.appendChild(body);
        content.appendChild(hint);
        element.appendChild(content);

        element.addEventListener('click', () => {
            state.expanded = !state.expanded;
            this.refreshThinkBlock(state);
        });

        state.element = element;
        state.body = body;
        state.hint = hint;

        if (this.messagesContainer) {
            this.messagesContainer.appendChild(element);
            this.scrollMessagesToBottom();
        }

        return state;
    }

    refreshThinkBlock(state) {
        if (!state?.body) {
            return;
        }
        const fullText = state.buffer || '';
        const preview = this.getThinkPreview(fullText);
        const displayText = state.expanded ? fullText : preview;
        state.body.textContent = displayText || '(无思考内容)';
        if (state.hint) {
            if (state.expanded) {
                state.hint.textContent = '点击收起思考';
            } else if (state.complete && fullText && fullText !== preview) {
                state.hint.textContent = '点击展开查看完整思考';
            } else if (state.complete) {
                state.hint.textContent = '思考完成';
            } else {
                state.hint.textContent = '思考生成中…点击展开查看完整思考';
            }
        }
        if (state.element) {
            state.element.classList.toggle('is-expanded', !!state.expanded);
        }
    }

    getThinkPreview(text) {
        if (!text) {
            return '';
        }
        const normalized = text.replace(/\r/g, '');
        const lines = normalized.split('\n');

        // 去掉末尾连续空行
        while (lines.length > 0 && !lines[lines.length - 1].trim()) {
            lines.pop();
        }

        if (lines.length === 0) {
            return '';
        }

        const previewLines = lines.slice(-3);
        return previewLines.join('\n');
    }

    resolvePendingConversation(messageId) {
        if (!messageId) return;
        const message = this.messages.find(entry => entry.id === messageId);
        if (message) {
            message.isPendingConversation = false;
        }
    }

    scrollMessagesToBottom() {
        if (!this.messagesContainer) return;
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    }

    buildConversationHistory({ includePending = false } = {}) {
        return this.messages
            .filter(m => m.role && m.content && !m.isError && (includePending || !m.isPendingConversation))
            .slice(-10)
            .map(m => ({ role: m.role, content: m.content }));
    }


    async buildDocumentContext() {
        if (typeof this.getDocumentContent !== 'function') {
            return null;
        }

        try {
            const mode = typeof this.getActiveViewMode === 'function'
                ? await this.getActiveViewMode()
                : 'markdown';

            const rawContent = await this.getDocumentContent({ preferSelection: false });
            const content = typeof rawContent === 'string' ? rawContent.trim() : '';
            if (!content) {
                return null;
            }

            const normalized = content.replace(/\r\n/g, '\n');
            const MAX_CONTEXT_LENGTH = 6000;
            let truncated = false;
            let snippet = normalized;
            if (normalized.length > MAX_CONTEXT_LENGTH) {
                snippet = normalized.slice(0, MAX_CONTEXT_LENGTH);
                truncated = true;
            }

            const labelBase = mode === 'markdown' ? '当前 Markdown 文档' : '当前文档';
            const label = truncated
                ? `${labelBase}（截取前 ${MAX_CONTEXT_LENGTH} 字）`
                : labelBase;

            return {
                label,
                content: snippet,
            };
        } catch (error) {
            console.warn('[AiSidebar] 读取文档内容失败', error);
            return null;
        }
    }

    async executeExecutorRequest(request, options = {}) {
        const pendingEntry = {
            context: {
                originalPrompt: options.prompt || '',
                displayPrompt: options.displayPrompt === true,
                displayMessage: options.displayMessage ?? null,
            },
            requestOptions: request,
            displayPrompt: options.displayPrompt === true,
            displayMessage: options.displayMessage ?? null,
            userMessageId: options.userMessageId || null,
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
        if (this.isBusy) {
            return;
        }

        const prompt = (this.promptField?.value || '').trim();
        if (!prompt) {
            this.updateStatusMessage('请输入消息');
            return;
        }

        const userEntry = this.appendMessage({
            role: 'user',
            content: prompt,
        });
        if (userEntry) {
            userEntry.isPendingConversation = true;
        }

        if (this.promptField) {
            this.promptField.value = '';
        }

        const conversationHistory = this.buildConversationHistory({ includePending: false });
        const documentContext = await this.buildDocumentContext();

        const request = this.executorAgent.buildRequest({
            prompt,
            history: conversationHistory,
            context: documentContext ? [documentContext] : [],
        });

        this.updateStatusMessage('AI 正在生成回答…');
        this.setBusy(true);

        try {
            await this.executeExecutorRequest(request, {
                prompt,
                displayPrompt: false,
                userMessageId: userEntry?.id || null,
            });
        } catch (error) {
            this.appendMessage({
                role: 'assistant',
                content: `错误: ${error.message}`,
                isError: true,
            });
            this.updateStatusMessage(error.message || '请求失败');
            this.setBusy(false);
            if (userEntry?.id) {
                this.resolvePendingConversation(userEntry.id);
            }
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

    showToast(message, type = 'info') {
        if (this.app?.showNotification) {
            this.app.showNotification({ message, type, duration: 2200 });
        } else {
            console.log(`[AI Sidebar ${type}] ${message}`);
        }
    }

}
