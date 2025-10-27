import { addClickHandler } from '../../../src/utils/PointerHelper.js';
import { aiService } from './aiService.js';

const APPEND_PATTERNS = [
    /(写|生成)[^。！?？\n]*(到|至)[^。！?？\n]*(文件|文档|文章)/i,
    /(在|向)[^。！?？\n]*(文件|文档|文章|当前内容|当前文件)[^。！?？\n]*(追加|添加|附加|写)/i,
    /(末尾|最后)[^。！?？\n]*(追加|添加|写)/i,
];

const REWRITE_KEYWORDS = /(精简|精炼|简化|改写|润色|优化|重写|重述|压缩|缩写|改成|改为|缩短)/i;
const REPLACE_KEYWORDS = /(替换|覆盖)/i;
const SUMMARIZE_KEYWORDS = /(总结|概括|归纳|整理|总结一下|总结下|简介)/i;
const ASK_KEYWORDS = /(是什么|说了什么|讲了什么|意思|含义|解释|说明|解读)/i;
const FIRST_PARAGRAPH_KEYWORDS = /(第一段|首段|开头|第一段落)/i;
const FIRST_ITEM_KEYWORDS = /(第一(条|则|项|点|句|个|条新闻|段内容|则内容|个要点|条消息))/i;
const DOCUMENT_KEYWORDS = /(文档|文章|文件|内容|文本|段落|段|章节|当前|新闻|列表|要点)/i;

const DOCUMENT_CHUNK_LINE_COUNT = 40;
const MORE_CONTEXT_TOKEN = 'MORE_CONTEXT_NEEDED';

function analyzeUserPrompt(rawPrompt) {
    const prompt = (rawPrompt || '').trim();
    if (!prompt) {
        return {
            intent: 'chat',
            outputMode: 'chat',
            needsDocumentForPrompt: false,
            needsDocumentForEdit: false,
            promptContextScope: 'none',
            editContextScope: 'none',
        };
    }

    const appendMatch = APPEND_PATTERNS.some(pattern => pattern.test(prompt));
    const mentionsFirstParagraph = FIRST_PARAGRAPH_KEYWORDS.test(prompt);
    const mentionsFirstItem = FIRST_ITEM_KEYWORDS.test(prompt);
    const mentionsFirstSegment = mentionsFirstParagraph || mentionsFirstItem;
    const mentionsDocument = DOCUMENT_KEYWORDS.test(prompt) || mentionsFirstSegment;
    const wantsSummary = SUMMARIZE_KEYWORDS.test(prompt) || ASK_KEYWORDS.test(prompt);
    const wantsRewrite = REWRITE_KEYWORDS.test(prompt) || REPLACE_KEYWORDS.test(prompt);

    if (appendMatch) {
        return {
            intent: 'append',
            outputMode: 'append-document',
            needsDocumentForPrompt: false,
            needsDocumentForEdit: true,
            promptContextScope: 'none',
            editContextScope: 'full',
        };
    }

    if (wantsRewrite && mentionsFirstSegment) {
        return {
            intent: 'rewrite-first-paragraph',
            outputMode: 'replace-first-paragraph',
            needsDocumentForPrompt: true,
            needsDocumentForEdit: true,
            promptContextScope: 'first-paragraph',
            editContextScope: 'full',
        };
    }

    if (wantsSummary && mentionsFirstSegment) {
        return {
            intent: 'summarize-first-paragraph',
            outputMode: 'chat',
            needsDocumentForPrompt: true,
            needsDocumentForEdit: false,
            promptContextScope: 'first-paragraph',
            editContextScope: 'none',
        };
    }

    if (wantsSummary && mentionsDocument) {
        return {
            intent: 'summarize-document',
            outputMode: 'chat',
            needsDocumentForPrompt: true,
            needsDocumentForEdit: false,
            promptContextScope: 'full',
            editContextScope: 'none',
        };
    }

    if (mentionsFirstSegment && mentionsDocument) {
        return {
            intent: 'qa-first-paragraph',
            outputMode: 'chat',
            needsDocumentForPrompt: true,
            needsDocumentForEdit: false,
            promptContextScope: 'first-paragraph',
            editContextScope: 'none',
        };
    }

    return {
        intent: 'chat',
        outputMode: 'chat',
        needsDocumentForPrompt: false,
        needsDocumentForEdit: false,
        promptContextScope: 'none',
        editContextScope: 'none',
    };
}

function normalizeNewlines(value) {
    return (value ?? '').replace(/\r\n/g, '\n');
}

function extractFirstParagraph(text) {
    const source = normalizeNewlines(text);
    const prefixMatch = source.match(/^\s*/);
    const leadingWhitespace = prefixMatch ? prefixMatch[0] : '';
    const withoutLeadingWhitespace = source.slice(leadingWhitespace.length);
    if (!withoutLeadingWhitespace) {
        return {
            prefix: leadingWhitespace,
            rawParagraph: '',
            trimmedParagraph: '',
            separator: '',
            remainder: '',
        };
    }

    const enumeratedBlockRegex = /(?:^|\n\s*)((?:第?一[\.．、:：\s]|1[\.．、:：\s])[\s\S]*?)(?=(?:\n\s*(?:第?[二两三四五六七八九十\d]+)[\.．、:：\s])|$)/;
    const enumeratedMatch = enumeratedBlockRegex.exec(withoutLeadingWhitespace);

    if (enumeratedMatch) {
        const rawEnumerated = enumeratedMatch[1];
        const enumeratedStart = withoutLeadingWhitespace.indexOf(rawEnumerated);
        const prefix = source.slice(0, leadingWhitespace.length + enumeratedStart);

        const afterEnumerated = withoutLeadingWhitespace.slice(enumeratedStart + rawEnumerated.length);
        const separatorMatch = afterEnumerated.match(/^\n+\s*/);
        const separator = separatorMatch ? separatorMatch[0] : '';
        const remainder = withoutLeadingWhitespace.slice(enumeratedStart + rawEnumerated.length + separator.length);
        return {
            prefix,
            rawParagraph: rawEnumerated,
            trimmedParagraph: rawEnumerated.trim(),
            separator,
            remainder,
        };
    }

    const paragraphMatch = withoutLeadingWhitespace.match(/([\s\S]*?)(\n\s*\n|$)/);
    const rawParagraph = paragraphMatch ? paragraphMatch[1] : withoutLeadingWhitespace;
    const separator = paragraphMatch && paragraphMatch[2] ? paragraphMatch[2] : '';
    const remainder = withoutLeadingWhitespace.slice(rawParagraph.length + separator.length);
    return {
        prefix: leadingWhitespace,
        rawParagraph,
        trimmedParagraph: rawParagraph.trim(),
        separator,
        remainder,
    };
}

function sanitizeModelOutput(rawOutput) {
    if (typeof rawOutput !== 'string') {
        return '';
    }
    const normalized = rawOutput.trim();
    const fenceMatch = normalized.match(/^```(?:[\w-]+)?\n([\s\S]*?)\n```$/);
    if (fenceMatch) {
        return fenceMatch[1].trim();
    }
    return normalized;
}

function mergeParagraphChange(fullText, nextParagraph, info) {
    if (!info) {
        return sanitizeModelOutput(nextParagraph);
    }
    const safeParagraph = sanitizeModelOutput(nextParagraph);
    const prefix = info.prefix || '';
    const remainder = info.remainder || '';
    let separator = info.separator || '';
    if (!separator && remainder) {
        separator = '\n\n';
    }
    const degenerate = `${prefix}${safeParagraph}`;
    return remainder ? `${degenerate}${separator}${remainder}` : `${degenerate}${separator}`;
}

function appendToDocument(fullText, addition) {
    const base = normalizeNewlines(fullText);
    const extra = sanitizeModelOutput(addition);
    if (!extra) {
        return base;
    }
    if (!base) {
        return extra;
    }
    const hasDoubleBlank = /\n\s*\n\s*$/.test(base);
    const hasSingleBlank = /\n\s*$/.test(base);
    const separator = hasDoubleBlank ? '' : (hasSingleBlank ? '\n' : '\n\n');
    return `${base}${separator}${extra}`;
}

function hasActiveFile() {
    if (typeof window === 'undefined') {
        return false;
    }
    return !!window.currentFile;
}

function createChunkedDocument(fullText, chunkSize = DOCUMENT_CHUNK_LINE_COUNT) {
    const normalized = normalizeNewlines(fullText);
    const lines = normalized.split('\n');
    return {
        mode: 'chunked',
        full: fullText,
        normalized,
        lines,
        totalLines: lines.length,
        chunkSize: Math.max(1, chunkSize),
        cursor: 0,
        chunks: [],
        collectedText: '',
        lastChunkInfo: null,
        hasMore: lines.length > 0,
        rangeStartLine: null,
        rangeEndLine: null,
    };
}

function consumeNextDocumentChunk(documentContext) {
    if (!documentContext || documentContext.mode !== 'chunked') {
        return null;
    }

    const lines = documentContext.lines || [];
    const totalLines = lines.length;
    const chunkSize = documentContext.chunkSize || DOCUMENT_CHUNK_LINE_COUNT;

    if (documentContext.cursor >= totalLines) {
        documentContext.hasMore = false;
        return null;
    }

    let chunkText = '';
    let startIndex = documentContext.cursor;
    let endIndex = startIndex;

    while (documentContext.cursor < totalLines && chunkText.trim().length === 0) {
        startIndex = documentContext.cursor;
        endIndex = Math.min(totalLines, startIndex + chunkSize);
        const chunkLines = lines.slice(startIndex, endIndex);
        chunkText = chunkLines.join('\n');
        documentContext.cursor = endIndex;
    }

    if (chunkText.trim().length === 0) {
        documentContext.hasMore = false;
        return null;
    }

    documentContext.hasMore = documentContext.cursor < totalLines;
    documentContext.chunks.push(chunkText);
    documentContext.collectedText = documentContext.chunks.join('\n\n');
    documentContext.lastChunkInfo = {
        startLine: startIndex + 1,
        endLine: documentContext.cursor,
        chunkText,
    };
    if (documentContext.rangeStartLine == null) {
        documentContext.rangeStartLine = documentContext.lastChunkInfo.startLine;
    }
    documentContext.rangeEndLine = documentContext.lastChunkInfo.endLine;
    return documentContext.lastChunkInfo;
}

function isMoreContextRequest(output) {
    if (typeof output !== 'string') {
        return false;
    }
    const normalized = output.trim().toUpperCase();
    if (!normalized) {
        return false;
    }
    if (normalized === MORE_CONTEXT_TOKEN) {
        return true;
    }
    return normalized.startsWith(`${MORE_CONTEXT_TOKEN}\n`);
}

export class AiSidebar {
    constructor(containerElement, contextOptionsOrGetEditorContext, callbacks = {}) {
        this.container = containerElement;
        this.callbacks = callbacks || {};

        if (typeof contextOptionsOrGetEditorContext === 'function') {
            this.app = null;
            this.getEditorContext = contextOptionsOrGetEditorContext;
            this.getDocumentContent = contextOptionsOrGetEditorContext;
            this.getActiveViewMode = async () => 'markdown';
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
        }

        this.isVisible = false;
        this.isBusy = false;
        this.messages = [];
        this.streamStates = new Map();
        this.unsubscribe = null;
        this.pendingTaskQueue = [];
        this.taskContexts = new Map();
        this.editorRefs = {
            markdownEditor: null,
            codeEditor: null,
        };

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
                    let taskContext = pending?.context || null;

                    if (taskContext) {
                        taskContext.currentTaskId = event.id;
                        taskContext.lastRequestOptions = pending?.requestOptions || event.payload || {};
                        taskContext.displayMessage = pending?.displayMessage ?? taskContext.originalPrompt;
                        taskContext.runCount = (taskContext.runCount || 0) + 1;
                        taskContext.displayPrompt = pending?.displayPrompt !== false;
                        this.taskContexts.set(event.id, taskContext);
                    } else {
                        taskContext = {
                            analysis: null,
                            originalPrompt: '',
                            runCount: 1,
                            displayPrompt: true,
                        };
                        this.taskContexts.set(event.id, taskContext);
                    }

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
                    this.handleTaskCompletion(event.id, event.buffer || '');
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
        this.pendingTaskQueue = [];
        this.taskContexts.clear();
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

    async startAiTask(taskContext, options = {}) {
        const request = {
            prompt: options.prompt,
            history: options.history,
        };
        if (options.systemPrompt) {
            request.systemPrompt = options.systemPrompt;
        }

        const pendingEntry = {
            context: taskContext,
            requestOptions: request,
            displayPrompt: options.displayPrompt !== false,
            displayMessage: options.displayMessage ?? taskContext.originalPrompt,
        };

        this.pendingTaskQueue.push(pendingEntry);

        try {
            await aiService.runTask(request);
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

        this.updateStatusMessage('');

        try {
            const analysis = analyzeUserPrompt(prompt);
            const prepared = await this.prepareTaskContext(prompt, analysis);

            if (prepared.error === 'no-active-file' && (analysis.needsDocumentForPrompt || analysis.needsDocumentForEdit)) {
                this.appendMessage({
                    role: 'user',
                    content: prompt,
                });
                this.appendMessage({
                    role: 'assistant',
                    content: '当前没有打开的文档，无法执行该操作。',
                    isError: true,
                });
                return;
            }

            const documentContext = prepared.document || null;

            if (analysis.needsDocumentForPrompt) {
                if (documentContext?.mode === 'chunked') {
                    const hasContent = (documentContext.collectedText || '').trim().length > 0;
                    if (!hasContent && !documentContext.hasMore) {
                        this.appendMessage({
                            role: 'user',
                            content: prompt,
                        });
                        this.appendMessage({
                            role: 'assistant',
                            content: '当前文档没有可用内容。',
                            isError: true,
                        });
                        return;
                    }
                } else if (!documentContext?.promptContext || !documentContext.promptContext.trim()) {
                    this.appendMessage({
                        role: 'user',
                        content: prompt,
                    });
                    this.appendMessage({
                        role: 'assistant',
                        content: '当前文档没有可用内容。',
                        isError: true,
                    });
                    return;
                }
            }


            const history = this.buildConversationHistory();
            const taskContext = {
                analysis,
                originalPrompt: prompt,
                document: documentContext,
            };

            const promptPayload = this.buildPrompt(taskContext);
            if (!promptPayload) {
                this.appendMessage({
                    role: 'assistant',
                    content: '无法生成请求，请稍后再试。',
                    isError: true,
                });
                return;
            }

            await this.startAiTask(taskContext, {
                prompt: promptPayload,
                history,
                displayPrompt: true,
                displayMessage: prompt,
            });

            if (this.promptField) {
                this.promptField.value = '';
            }
        } catch (error) {
            this.updateStatusMessage(`错误: ${error.message}`);
        }
    }

    async prepareTaskContext(prompt, analysis) {
        const result = {
            analysis,
            originalPrompt: prompt,
            document: null,
        };

        const needsDocument = !!analysis.needsDocumentForPrompt || !!analysis.needsDocumentForEdit;
        if (!needsDocument) {
            return result;
        }

        if (!hasActiveFile()) {
            result.error = 'no-active-file';
            return result;
        }

        try {
            const documentContent = await this.getDocumentContent();
            const fullDocument = typeof documentContent === 'string' ? documentContent : '';
            const useChunked = analysis.needsDocumentForPrompt && analysis.outputMode === 'chat';

            if (useChunked) {
                const chunkedDocument = createChunkedDocument(fullDocument);
                consumeNextDocumentChunk(chunkedDocument);
                result.document = chunkedDocument;
            } else {
                const document = {
                    mode: 'full',
                    full: fullDocument,
                    promptContext: null,
                    firstParagraph: null,
                };

                if (analysis.promptContextScope === 'first-paragraph' || analysis.editContextScope === 'first-paragraph') {
                    document.firstParagraph = extractFirstParagraph(fullDocument);
                    if (analysis.promptContextScope === 'first-paragraph') {
                        document.promptContext = document.firstParagraph.trimmedParagraph || document.firstParagraph.rawParagraph;
                    }
                }

                if (analysis.promptContextScope === 'full') {
                    document.promptContext = fullDocument;
                }

                if (!analysis.promptContextScope && analysis.needsDocumentForPrompt) {
                    document.promptContext = fullDocument;
                }

                result.document = document;
            }

            if (analysis.needsDocumentForEdit) {
                if (!result.document) {
                    result.document = {};
                }
                result.document.full = fullDocument;
            }

            return result;
        } catch (error) {
            console.warn('[AiSidebar] 读取文档内容失败:', error);
            if (!result.document) {
                result.document = {};
            }
            result.document.full = '';
            return result;
        }
    }

    buildPrompt(taskContext) {
        const { analysis, document } = taskContext;
        const trimmedPrompt = (taskContext.originalPrompt || '').trim();

        if (!trimmedPrompt) {
            return '';
        }

        if (analysis.outputMode === 'replace-first-paragraph') {
            const snippet = document?.firstParagraph?.trimmedParagraph || document?.firstParagraph?.rawParagraph || '';
            return [
                '请根据以下段落完成改写，并仅输出改写后的段落文本。',
                '',
                '原始段落：',
                snippet || '(空)',
                '',
                `用户指令：${trimmedPrompt}`,
                '',
                '请勿添加解释或额外说明。'
            ].join('\n');
        }

        if (analysis.outputMode === 'append-document') {
            return [
                trimmedPrompt,
                '',
                '请直接返回需要写入文档的新内容，不要包含解释或额外文本。'
            ].join('\n');
        }

        if (document?.mode === 'chunked') {
            const totalLines = document.totalLines || 0;
            const rangeStart = document.rangeStartLine || 1;
            const rangeEnd = document.rangeEndLine || rangeStart;
            const snippet = document.collectedText || '';
            const directive = analysis.intent?.startsWith('summarize')
                ? '请根据以下文档片段总结用户问题涉及的内容'
                : '请根据以下文档片段回答用户问题';
            return [
                `${directive}。`,
                `如果信息不足以回答，请仅回复 ${MORE_CONTEXT_TOKEN}。`,
                '',
                `文档片段（第 ${rangeStart}-${rangeEnd} 行，共 ${totalLines} 行）：`,
                '```markdown',
                snippet || '(空)',
                '```',
                '',
                `用户问题：${trimmedPrompt}`
            ].join('\n');
        }

        if (analysis.needsDocumentForPrompt && document?.promptContext) {
            const isParagraph = analysis.promptContextScope === 'first-paragraph';
            const label = isParagraph ? '段落内容' : '文档内容';
            const guidance = analysis.intent?.startsWith('summarize')
                ? '请根据提供的内容直接给出总结。'
                : '请根据提供的内容回答用户问题。';
            return [
                guidance,
                '',
                `${label}：`,
                document.promptContext,
                '',
                `用户提问：${trimmedPrompt}`
            ].join('\n');
        }

        return trimmedPrompt;
    }

    handleTaskCompletion(taskId, rawOutput) {
        const context = this.taskContexts.get(taskId);
        if (!context) {
            return;
        }

        this.taskContexts.delete(taskId);

        const cleanOutput = sanitizeModelOutput(rawOutput);
        const analysis = context.analysis || {};
        const document = context.document || null;

        if (document?.mode === 'chunked' && isMoreContextRequest(cleanOutput)) {
            const assistantMessageId = `${taskId}-assistant`;
            this.appendMessage({
                id: assistantMessageId,
                role: 'assistant',
                content: '需要更多上下文，正在继续读取文档...',
                isStreaming: false,
            });

            const nextChunk = consumeNextDocumentChunk(document);
            if (!nextChunk) {
                this.appendMessage({
                    id: assistantMessageId,
                    role: 'assistant',
                    content: '文档已全部读取，但仍无法回答该问题。',
                    isError: true,
                });
                return;
            }

            const followupPrompt = this.buildPrompt(context);
            const history = this.buildConversationHistory();

            void this.startAiTask(context, {
                prompt: followupPrompt,
                history,
                displayPrompt: false,
                displayMessage: null,
            }).catch(error => {
                console.error('[AiSidebar] 追加上下文失败:', error);
                this.appendMessage({
                    id: assistantMessageId,
                    role: 'assistant',
                    content: `错误: ${error.message}`,
                    isError: true,
                });
            });
            return;
        }

        if (!cleanOutput) {
            return;
        }

        if (analysis.outputMode === 'replace-first-paragraph' && document?.full) {
            const nextDocument = mergeParagraphChange(
                document.full,
                cleanOutput,
                document.firstParagraph
            );
            this.applyDocumentUpdate(nextDocument);
            this.updateStatusMessage('已替换第一段内容');
            return;
        }

        if (analysis.outputMode === 'append-document' && document?.full != null) {
            const nextDocument = appendToDocument(document.full, cleanOutput);
            this.applyDocumentUpdate(nextDocument);
            this.updateStatusMessage('已追加内容到文档结尾');
            return;
        }
    }

    cleanupTaskContext(taskId) {
        if (taskId && this.taskContexts.has(taskId)) {
            this.taskContexts.delete(taskId);
        }
    }

    applyDocumentUpdate(nextMarkdown) {
        const content = normalizeNewlines(nextMarkdown);
        if (!content && content !== '') {
            return;
        }

        const { markdownEditor, codeEditor } = this.editorRefs;

        if (markdownEditor?.editor && markdownEditor.md) {
            try {
                const html = markdownEditor.md.render(content);
                markdownEditor.editor.commands.setContent(html);
            } catch (error) {
                console.warn('[AiSidebar] 更新 Markdown 编辑器失败:', error);
            }
        }

        if (codeEditor?.editor) {
            try {
                const model = codeEditor.editor.getModel();
                const monaco = codeEditor.monaco;
                if (model && monaco) {
                    const fullRange = model.getFullModelRange();
                    codeEditor.editor.pushUndoStop();
                    codeEditor.editor.executeEdits('ai-assistant', [
                        {
                            range: fullRange,
                            text: content,
                            forceMoveMarkers: true,
                        },
                    ]);
                    codeEditor.editor.pushUndoStop();
                } else if (model) {
                    model.setValue(content);
                }
            } catch (error) {
                console.warn('[AiSidebar] 更新代码编辑器失败:', error);
            }
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
