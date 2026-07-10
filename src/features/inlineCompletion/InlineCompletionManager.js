import { TextSelection } from '@tiptap/pm/state';
import { buildInlineCompletionContext, requestInlineCompletion } from './InlineCompletionProvider.js';
import { createInlineCompletionPlugin, inlineCompletionPluginKey } from './InlineCompletionPlugin.js';
import { CompletionSession } from './CompletionSession.js';
import { createLogger } from '../../core/diagnostics/Logger.js';

const logger = createLogger('inline-completion');

/**
 * Markdown 编辑器内联续写控制器。
 */
export class InlineCompletionManager {
    constructor({ editor, getMarkdown, markdownSerializer, insertMarkdownAtCursor }) {
        this.editor = editor;
        this.getMarkdown = getMarkdown;
        this.markdownSerializer = markdownSerializer;
        this.insertMarkdownAtCursor = insertMarkdownAtCursor;
        this.session = new CompletionSession();
        this.handleKeydown = (event) => this.onKeydown(event);
        this.plugin = createInlineCompletionPlugin({
            onRequest: (view) => this.request(view),
            onAccept: (text, pos) => this.accept(text, pos),
            onCancel: () => this.cancel(),
        });
        this.editor.registerPlugin(this.plugin);
        this.editor.view?.dom?.addEventListener('keydown', this.handleKeydown, true);
    }

    onKeydown(event) {
        const value = inlineCompletionPluginKey.getState(this.editor.state);
        if (value?.text && event.key === 'Tab') {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation?.();
            this.accept(value.text, value.pos);
            return;
        }

        if ((value?.text || value?.loading || value?.error) && event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation?.();
            this.clear();
            this.cancel();
            return;
        }

        const isTrigger = event.key === 'Enter'
            && (event.metaKey || event.ctrlKey)
            && !event.altKey
            && !event.shiftKey;
        if (!isTrigger) return;

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        this.request(this.editor.view);
    }

    accept(text, pos) {
        const view = this.editor.view;
        if (!view || view.isDestroyed || !text) return;
        const insertPos = Math.min(pos ?? view.state.selection.from, view.state.doc.content.size);
        view.dispatch(view.state.tr
            .setSelection(TextSelection.create(view.state.doc, insertPos))
            .setMeta(inlineCompletionPluginKey, { type: 'clear' }));
        if (typeof this.insertMarkdownAtCursor === 'function') {
            this.insertMarkdownAtCursor(text);
        } else {
            const tr = view.state.tr.insertText(text, insertPos);
            tr.setSelection(TextSelection.create(tr.doc, insertPos + text.length));
            view.dispatch(tr);
        }
        logger.debug('accept', { length: text.length });
    }

    showSuggestion(text, pos = null) {
        const view = this.editor.view;
        if (!view || view.isDestroyed || !text) return;
        const insertPos = Math.min(pos ?? view.state.selection.from, view.state.doc.content.size);
        const tr = view.state.tr
            .setSelection(TextSelection.create(view.state.doc, insertPos))
            .setMeta(inlineCompletionPluginKey, {
                type: 'suggest',
                pos: insertPos,
                text,
            });
        view.dispatch(tr);
        view.focus();
    }

    clear() {
        const view = this.editor.view;
        if (!view || view.isDestroyed) return;
        view.dispatch(view.state.tr.setMeta(inlineCompletionPluginKey, { type: 'clear' }));
    }

    cancel() {
        this.session.cancel();
    }

    async request(view) {
        if (!view || view.composing) return;
        const { state } = view;
        if (!state.selection.empty) return;

        const snapshot = this.session.begin(view);
        const pos = snapshot.from;
        view.focus();
        view.dispatch(state.tr
            .setSelection(TextSelection.create(state.doc, pos))
            .setMeta(inlineCompletionPluginKey, { type: 'loading', pos }));
        logger.debug('request:start', { pos });

        try {
            const context = buildInlineCompletionContext(
                state,
                this.getMarkdown?.() || '',
                this.markdownSerializer,
            );
            const completion = await requestInlineCompletion(context);
            if (!this.session.isCurrent(snapshot, view)) return;
            view.dispatch(view.state.tr
                .setSelection(TextSelection.create(view.state.doc, pos))
                .setMeta(inlineCompletionPluginKey, {
                    type: 'suggest',
                    pos,
                    text: completion,
                }));
            view.focus();
            logger.debug('request:success', { length: completion.length });
        } catch (error) {
            if (!this.session.isCurrent(snapshot, view)) return;
            console.warn('[InlineCompletion] request:failed', error);
            view.dispatch(view.state.tr.setMeta(inlineCompletionPluginKey, {
                type: 'error',
                pos,
                error: error?.message || 'AI completion failed',
            }));
            setTimeout(() => {
                if (!this.session.isCurrent(snapshot, view)) return;
                view.dispatch(view.state.tr.setMeta(inlineCompletionPluginKey, { type: 'clear' }));
            }, 1800);
        }
    }

    destroy() {
        this.cancel();
        this.editor.view?.dom?.removeEventListener('keydown', this.handleKeydown, true);
        try {
            this.editor.unregisterPlugin(inlineCompletionPluginKey);
        } catch (_) {}
    }
}
