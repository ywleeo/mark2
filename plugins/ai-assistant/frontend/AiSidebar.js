import { addClickHandler } from '../../../src/utils/PointerHelper.js';
import { aiService } from './aiService.js';
import { ExecutorAgent } from './agents/ExecutorAgent.js';
import { AnswerActions } from './sidebar/AnswerActions.js';
import { SidebarRenderer } from './sidebar/SidebarRenderer.js';
import { ThinkBlockManager } from './sidebar/ThinkBlockManager.js';
import MarkdownIt from 'markdown-it';
import markdownItTaskLists from 'markdown-it-task-lists';

const STATUS_HINT_DEFAULT = '';
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
        this.statusHintText = STATUS_HINT_DEFAULT;
        this.editorRefs = {
            markdownEditor: null,
            codeEditor: null,
        };
        this.relayoutFrame = null;
        this.answerActions = new AnswerActions(this);
        this.renderer = new SidebarRenderer(this.container);
        this.markdownRenderer = this.createMarkdownRenderer();
        this.roles = [];
        this.selectedRoleId = null;
        this.config = null;
        this.handleRoleSelectChange = this.handleRoleSelectChange.bind(this);

        this.render();
        this.bindEvents();
        this.thinkBlockManager = new ThinkBlockManager({
            getMessagesContainer: () => this.messagesContainer,
            renderMarkdown: (markdown) => this.renderMarkdown(markdown),
            applyMarkdown: (target, text, options) => this.applyMarkdownToElement(target, text, options),
            scrollMessagesToBottom: () => this.scrollMessagesToBottom(),
        });
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
        this.roleSelect = refs.roleSelect;
        if (this.roleSelect) {
            this.roleSelect.addEventListener('change', this.handleRoleSelectChange);
        }
    }

    createMarkdownRenderer() {
        // Use markdown-it to render assistant replies with a controlled feature set.
        const md = new MarkdownIt({
            html: false,
            linkify: true,
            breaks: true,
        });

        md.use(markdownItTaskLists, {
            enabled: true,
            label: true,
            labelAfter: true,
        });

        const defaultRender =
            md.renderer.rules.link_open ||
            ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));

        // Keep assistant links from hijacking the current window.
        md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
            const targetIndex = tokens[idx].attrIndex('target');
            if (targetIndex < 0) {
                tokens[idx].attrPush(['target', '_blank']);
            } else {
                tokens[idx].attrs[targetIndex][1] = '_blank';
            }
            tokens[idx].attrSet('rel', 'noopener noreferrer');
            return defaultRender(tokens, idx, options, env, self);
        };

        return md;
    }

    renderMarkdown(markdownText) {
        if (!this.markdownRenderer) {
            return null;
        }
        const text = typeof markdownText === 'string' ? markdownText : '';
        if (!text.trim()) {
            return '';
        }
        try {
            return this.markdownRenderer.render(text);
        } catch (error) {
            console.warn('[AiSidebar] Markdown 渲染失败', error);
            return null;
        }
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
                    this.thinkBlockManager.updateStream(
                        event.id,
                        typeof event.buffer === 'string' ? event.buffer : (event.delta || '')
                    );
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
                    this.thinkBlockManager.finalize(event.id, event.thinkBuffer || '');
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
                    this.thinkBlockManager.finalize(event.id);
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
                    this.thinkBlockManager.finalize(event.id);
                    this.setBusy(false);
                    this.updateStatusMessage('已取消');
                    break;
                }

                case 'config':
                    this.applyConfig(event.data);
                    break;

                default:
                    break;
            }
        });

        const config = aiService.getConfig();
        this.applyConfig(config);
    }

    applyConfig(config = null) {
        if (config) {
            this.config = config;
        }
        const effectiveConfig = config || this.config || { roles: [], activeRoleId: null };
        this.roles = Array.isArray(effectiveConfig.roles)
            ? effectiveConfig.roles.map(role => ({
                ...role,
                name: role?.name || '未命名角色',
            }))
            : [];

        const preferredId = effectiveConfig.activeRoleId;
        if (preferredId && this.roles.some(role => role.id === preferredId)) {
            this.selectedRoleId = preferredId;
        } else {
            this.selectedRoleId = this.roles[0]?.id || null;
        }

        this.populateRoleSelector();
        this.updateStatusHint(effectiveConfig);
    }

    populateRoleSelector() {
        if (!this.roleSelect) {
            return;
        }
        if (!Array.isArray(this.roles) || this.roles.length === 0) {
            this.roleSelect.innerHTML = '';
            this.roleSelect.disabled = true;
            return;
        }

        const fragment = document.createDocumentFragment();
        this.roles.forEach(role => {
            const option = document.createElement('option');
            const baseLabel = role.name || '未命名角色';
            option.value = role.id;
            option.textContent = role.isDefault ? `${baseLabel}` : baseLabel;
            fragment.appendChild(option);
        });

        this.roleSelect.innerHTML = '';
        this.roleSelect.appendChild(fragment);

        const hasSelected = this.selectedRoleId && this.roles.some(role => role.id === this.selectedRoleId);
        const activeId = hasSelected ? this.selectedRoleId : this.roles[0].id;
        this.selectedRoleId = activeId;
        this.roleSelect.value = activeId;
        this.roleSelect.disabled = false;
    }

    getActiveRole() {
        if (!Array.isArray(this.roles) || this.roles.length === 0) {
            return null;
        }
        const activeId = this.selectedRoleId && this.roles.some(role => role.id === this.selectedRoleId)
            ? this.selectedRoleId
            : this.roles[0].id;
        return this.roles.find(role => role.id === activeId) || this.roles[0] || null;
    }

    getActiveRoleId() {
        const role = this.getActiveRole();
        return role?.id || null;
    }

    destroy() {
        if (this.unsubscribe) {
            this.unsubscribe();
            this.unsubscribe = null;
        }
        if (this.roleSelect) {
            this.roleSelect.removeEventListener('change', this.handleRoleSelectChange);
            this.roleSelect = null;
        }
        if (this.relayoutFrame !== null) {
            cancelAnimationFrame(this.relayoutFrame);
            this.relayoutFrame = null;
        }
        this.pendingTaskQueue = [];
        this.taskContexts.clear();
        this.thinkBlockManager?.destroy();
    }

    updateStatusHint(config) {
        if (!this.statusLabel) return;

        if (!config || !config.apiKey) {
            this.statusHintText = STATUS_HINT_MISSING_KEY;
            this.statusLabel?.classList.add('is-warning');
            this.statusLabel.textContent = this.statusHintText;
            return;
        }

        this.statusHintText = '';
        this.statusLabel?.classList.remove('is-warning');
        if (this.statusLabel) {
            this.statusLabel.textContent = '';
        }
    }

    handleRoleSelectChange(event) {
        const nextId = event?.target?.value || null;
        if (!nextId || nextId === this.selectedRoleId) {
            return;
        }
        if (!this.roles.some(role => role.id === nextId)) {
            return;
        }

        const previousId = this.selectedRoleId;
        this.selectedRoleId = nextId;
        if (this.config) {
            this.config.activeRoleId = nextId;
        }
        this.updateStatusHint(this.config || aiService.getConfig());

        if (previousId !== nextId) {
            const updated = aiService.saveConfig({ activeRoleId: nextId });
            if (updated) {
                this.config = updated;
            }
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
        if (message) {
            this.statusLabel.textContent = message;
        } else if (!this.statusHintText) {
            this.statusLabel.textContent = '';
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
        this.scheduleEditorRelayout();
    }

    hide() {
        this.container.classList.remove('is-visible');
        this.isVisible = false;
        this.scheduleEditorRelayout();
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
        this.thinkBlockManager?.clearAll();
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
            if (entry.role === 'assistant' && !entry.isError) {
                const rendered = this.renderMarkdown(entry.content || '');
                if (rendered !== null) {
                    content.innerHTML = rendered;
                    content.classList.add('ai-message__content--markdown');
                } else {
                    content.textContent = entry.content || '';
                    content.classList.remove('ai-message__content--markdown');
                }
            } else {
                content.textContent = entry.content || '';
                content.classList.remove('ai-message__content--markdown');
            }
        }

        if (entry.role === 'assistant' && !entry.isError) {
            element.classList.add('ai-message--answer');
            this.answerActions.render(entry);
        }
    }

    applyMarkdownToElement(target, text, options = {}) {
        if (!target) {
            return false;
        }
        const {
            allowMarkdown = true,
            fallbackText = '',
        } = options;
        const content = typeof text === 'string' ? text.trim() : '';
        if (!content) {
            const fallback = typeof fallbackText === 'string' ? fallbackText : '';
            target.textContent = fallback;
            target.classList.remove('ai-message__content--markdown');
            return false;
        }
        if (allowMarkdown) {
            const rendered = this.renderMarkdown(content);
            if (rendered !== null) {
                target.innerHTML = rendered;
                target.classList.add('ai-message__content--markdown');
                return true;
            }
        }
        target.textContent = content;
        target.classList.remove('ai-message__content--markdown');
        return false;
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
        const activeRoleId = this.getActiveRoleId();
        if (activeRoleId && !request.roleId) {
            request.roleId = activeRoleId;
        }
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
            roleId: this.getActiveRoleId(),
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

    scheduleEditorRelayout() {
        if (this.relayoutFrame !== null) {
            cancelAnimationFrame(this.relayoutFrame);
        }
        this.relayoutFrame = window.requestAnimationFrame(() => {
            this.relayoutFrame = null;
            const codeEditor = this.editorRefs.codeEditor;
            if (codeEditor?.requestLayout) {
                codeEditor.requestLayout();
            } else if (codeEditor?.editor?.layout) {
                codeEditor.editor.layout();
            }
        });
    }

}
