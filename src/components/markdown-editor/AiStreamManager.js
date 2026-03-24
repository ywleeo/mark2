/**
 * AI 流式输出管理器
 * 管理多个并发的 AI 流式会话，处理增量内容插入和最终替换
 */
export class AiStreamManager {
    /**
     * @param {Object} opts
     * @param {() => import('@tiptap/core').Editor} opts.getEditor
     * @param {() => import('prosemirror-markdown').MarkdownParser} opts.getMarkdownParser
     * @param {(content: string) => string} opts.preprocessMarkdown
     * @param {() => void} opts.onStreamFinalized
     */
    constructor({ getEditor, getMarkdownParser, preprocessMarkdown, onStreamFinalized }) {
        this._getEditor = getEditor;
        this._getMarkdownParser = getMarkdownParser;
        this._preprocessMarkdown = preprocessMarkdown;
        this._onStreamFinalized = onStreamFinalized;
        this._sessions = new Map();
    }

    beginSession(sessionId) {
        const editor = this._getEditor();
        if (!editor || !sessionId) return null;

        const currentSelection = editor.state.selection;
        if (!currentSelection) return null;

        let startPosition = Math.min(currentSelection.from, currentSelection.to);

        if (!currentSelection.empty) {
            editor.chain().focus().deleteSelection().run();
            startPosition = editor.state.selection.from;
        }

        const session = { id: sessionId, start: startPosition, current: startPosition, buffer: '' };
        this._sessions.set(sessionId, session);
        return session;
    }

    appendContent(sessionId, delta) {
        const editor = this._getEditor();
        if (!editor || !sessionId) return;

        const session = this._sessions.get(sessionId);
        if (!session) return;

        const chunk = typeof delta === 'string' ? delta : '';
        if (!chunk.length) return;

        const { state, view } = editor;
        view.dispatch(state.tr.insertText(chunk, session.current, session.current));
        session.current += chunk.length;
        session.buffer += chunk;
    }

    finalizeSession(sessionId, markdown) {
        const editor = this._getEditor();
        if (!editor || !sessionId) return;

        const session = this._sessions.get(sessionId);
        if (!session) return;

        const { start, current } = session;
        const content = typeof markdown === 'string' ? markdown.trim() : '';

        let chain = editor.chain().focus()
            .setTextSelection({ from: start, to: current })
            .deleteSelection();

        if (content.length > 0) {
            const processed = this._preprocessMarkdown(content);
            const parsed = this._getMarkdownParser()?.parse(processed);
            if (parsed) chain = chain.insertContent(parsed.content);
        }

        chain.run();
        this._sessions.delete(sessionId);
        this._onStreamFinalized?.();
    }

    abortSession(sessionId) {
        const editor = this._getEditor();
        if (!editor || !sessionId) return;

        const session = this._sessions.get(sessionId);
        if (!session) return;

        editor.chain().focus()
            .setTextSelection({ from: session.start, to: session.current })
            .deleteSelection()
            .run();
        this._sessions.delete(sessionId);
    }

    hasSession(sessionId) {
        return this._sessions.has(sessionId);
    }

    destroy() {
        this._sessions.clear();
    }
}
