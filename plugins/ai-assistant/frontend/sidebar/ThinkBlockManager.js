export class ThinkBlockManager {
    constructor(options = {}) {
        this.getMessagesContainer =
            typeof options.getMessagesContainer === 'function'
                ? options.getMessagesContainer
                : () => null;
        this.renderMarkdown =
            typeof options.renderMarkdown === 'function'
                ? options.renderMarkdown
                : () => null;
        this.applyMarkdown =
            typeof options.applyMarkdown === 'function'
                ? options.applyMarkdown
                : () => false;
        this.scrollMessagesToBottom =
            typeof options.scrollMessagesToBottom === 'function'
                ? options.scrollMessagesToBottom
                : () => {};
        this.onToggle =
            typeof options.onToggle === 'function' ? options.onToggle : () => {};

        this.thinkStates = new Map();
    }

    getState(taskId) {
        return this.thinkStates.get(taskId) || null;
    }

    updateStream(taskId, buffer) {
        if (!taskId || !buffer) {
            return;
        }
        let state = this.getState(taskId);
        if (!state) {
            state = this.createThinkBlock(taskId);
            this.thinkStates.set(taskId, state);
        }
        state.buffer = buffer;
        state.complete = false;
        this.refreshThinkBlock(state);
        this.scrollMessagesToBottom();
    }

    finalize(taskId, finalBuffer = null) {
        if (!taskId) {
            return;
        }
        let state = this.getState(taskId);
        const hasFinalText = typeof finalBuffer === 'string' && finalBuffer.trim().length > 0;
        if (!state) {
            if (!hasFinalText) {
                return;
            }
            state = this.createThinkBlock(taskId);
            this.thinkStates.set(taskId, state);
        }
        if (!state) {
            return;
        }
        if (typeof finalBuffer === 'string') {
            state.buffer = finalBuffer;
        }
        state.complete = true;
        this.refreshThinkBlock(state);
    }

    clearAll() {
        this.thinkStates.forEach(entry => {
            if (entry?.element?.parentElement) {
                entry.element.parentElement.removeChild(entry.element);
            }
        });
        this.thinkStates.clear();
    }

    destroy() {
        this.clearAll();
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

        const body = document.createElement('div');
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
            this.onToggle(state);
        });

        state.element = element;
        state.body = body;
        state.hint = hint;

        const container = this.getMessagesContainer();
        if (container) {
            container.appendChild(element);
            this.scrollMessagesToBottom();
        }

        return state;
    }

    refreshThinkBlock(state) {
        if (!state?.body) {
            return;
        }

        const fullText = state.buffer || '';
        const preview = this.getPreview(fullText);
        const displayText = state.expanded ? fullText : preview;
        const hasContent = !!(displayText && displayText.trim());
        const fallback = '(无思考内容)';

        if (hasContent) {
            this.applyMarkdown(state.body, displayText, {
                allowMarkdown: true,
                fallbackText: fallback,
            });
        } else {
            this.applyMarkdown(state.body, '', {
                allowMarkdown: false,
                fallbackText: fallback,
            });
        }

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

    getPreview(text) {
        if (!text) {
            return '';
        }
        const normalized = text.replace(/\r/g, '');
        const lines = normalized.split('\n');

        while (lines.length > 0 && !lines[lines.length - 1].trim()) {
            lines.pop();
        }

        if (lines.length === 0) {
            return '';
        }

        const previewLines = lines.slice(-3);
        return previewLines.join('\n');
    }
}
