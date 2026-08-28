import { TextSelection } from '@tiptap/pm/state';
import { buildInlineCompletionContext, requestInlineCompletion } from './InlineCompletionProvider.js';
import { createInlineCompletionPlugin, inlineCompletionPluginKey } from './InlineCompletionPlugin.js';
import { CompletionSession } from './CompletionSession.js';
import { createLogger } from '../../core/diagnostics/Logger.js';
import { acceptCompletion } from './CompletionAcceptance.js';

const logger = createLogger('inline-completion');

/**
 * Markdown 编辑器内联续写控制器。
 */
export class InlineCompletionManager {
    constructor({ editor, getMarkdown, markdownSerializer, insertInlineAtCursor, insertMarkdownAtCursor }) {
        this.editor = editor;
        this.getMarkdown = getMarkdown;
        this.markdownSerializer = markdownSerializer;
        this.insertInlineAtCursor = insertInlineAtCursor;
        this.insertMarkdownAtCursor = insertMarkdownAtCursor;
        this.session = new CompletionSession();
        this.handleKeydown = (event) => this.onKeydown(event);
        this.plugin = createInlineCompletionPlugin({
            onRequest: (view) => this.request(view),
            onAccept: (text, pos, insertionMode) => this.accept(text, pos, insertionMode),
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
            this.accept(value.text, value.pos, value.insertionMode);
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

    /**
     * 接受续写建议，并按生成时的上下文选择行内或块级插入。
     * @param {string} text - 待插入续写
     * @param {number|null} pos - 生成建议时的光标位置
     * @param {'inline'|'block'} insertionMode - 当前 Markdown 结构要求
     * @returns {void}
     */
    accept(text, pos, insertionMode = 'inline') {
        const view = this.editor.view;
        const accepted = acceptCompletion({
            view,
            text,
            pos,
            insertionMode,
            insertInlineAtCursor: this.insertInlineAtCursor,
            insertMarkdownAtCursor: this.insertMarkdownAtCursor,
            clearMetaKey: inlineCompletionPluginKey,
        });
        if (!accepted) return;
        logger.debug('accept', { length: text.length, insertionMode });
    }

    /**
     * 在指定位置展示续写建议，并保留其结构化插入模式。
     * @param {string} text - 建议文本
     * @param {number|null} pos - 展示位置
     * @param {'inline'|'block'} insertionMode - 接受建议时使用的插入模式
     * @returns {void}
     */
    showSuggestion(text, pos = null, insertionMode = 'inline') {
        const view = this.editor.view;
        if (!view || view.isDestroyed || !text) return;
        const insertPos = Math.min(pos ?? view.state.selection.from, view.state.doc.content.size);
        const tr = view.state.tr
            .setSelection(TextSelection.create(view.state.doc, insertPos))
            .setMeta(inlineCompletionPluginKey, {
                type: 'suggest',
                pos: insertPos,
                text,
                insertionMode,
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
                    insertionMode: context.currentFormat?.insertionMode || 'inline',
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
