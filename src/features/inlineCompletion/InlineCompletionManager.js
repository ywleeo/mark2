import { TextSelection } from '@tiptap/pm/state';
import { buildInlineCompletionContext, requestInlineCompletion } from './InlineCompletionProvider.js';
import { createInlineCompletionPlugin, inlineCompletionPluginKey } from './InlineCompletionPlugin.js';

/**
 * Markdown 编辑器内联续写控制器。
 */
export class InlineCompletionManager {
    constructor({ editor, getMarkdown }) {
        this.editor = editor;
        this.getMarkdown = getMarkdown;
        this.requestSeq = 0;
        this.handleKeydown = (event) => this.onKeydown(event);
        this.plugin = createInlineCompletionPlugin({
            onRequest: (view) => this.request(view),
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
        const tr = view.state.tr.insertText(text, insertPos);
        tr.setSelection(TextSelection.create(tr.doc, insertPos + text.length));
        tr.setMeta(inlineCompletionPluginKey, { type: 'clear' });
        view.dispatch(tr);
        console.debug('[InlineCompletion] accept', { length: text.length });
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
        this.requestSeq += 1;
    }

    async request(view) {
        if (!view || view.composing) return;
        const { state } = view;
        if (!state.selection.empty) return;

        const requestId = ++this.requestSeq;
        const pos = state.selection.from;
        view.focus();
        view.dispatch(state.tr
            .setSelection(TextSelection.create(state.doc, pos))
            .setMeta(inlineCompletionPluginKey, { type: 'loading', pos }));
        console.debug('[InlineCompletion] request:start', { pos });

        try {
            const context = buildInlineCompletionContext(state, this.getMarkdown?.() || '');
            const completion = await requestInlineCompletion(context);
            if (requestId !== this.requestSeq || view.isDestroyed) return;
            view.dispatch(view.state.tr
                .setSelection(TextSelection.create(view.state.doc, pos))
                .setMeta(inlineCompletionPluginKey, {
                    type: 'suggest',
                    pos,
                    text: completion,
                }));
            view.focus();
            console.debug('[InlineCompletion] request:success', { length: completion.length });
        } catch (error) {
            if (requestId !== this.requestSeq || view.isDestroyed) return;
            console.warn('[InlineCompletion] request:failed', error);
            view.dispatch(view.state.tr.setMeta(inlineCompletionPluginKey, {
                type: 'error',
                pos,
                error: error?.message || 'AI completion failed',
            }));
            setTimeout(() => {
                if (requestId !== this.requestSeq || view.isDestroyed) return;
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
