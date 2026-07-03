import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { t } from '../../i18n/index.js';

export const inlineCompletionPluginKey = new PluginKey('inlineCompletion');

function createGhostWidget(text, loading, error) {
    if (loading) {
        const status = document.createElement('span');
        status.className = 'inline-completion-writing';
        status.setAttribute('aria-label', t('inlineCompletion.writing'));

        const label = document.createElement('span');
        label.textContent = t('inlineCompletion.writing');

        const dots = document.createElement('span');
        dots.className = 'inline-completion-writing__dots';
        for (let i = 0; i < 3; i += 1) {
            const dot = document.createElement('span');
            dot.textContent = '.';
            dots.appendChild(dot);
        }

        status.append(label, dots);
        return status;
    }

    if (error) {
        const status = document.createElement('span');
        status.className = 'inline-completion-status inline-completion-status--error';
        status.textContent = error;
        return status;
    }

    const wrapper = document.createElement('span');
    wrapper.className = 'inline-completion-wrap';

    const ghost = document.createElement('span');
    ghost.className = 'inline-completion';
    ghost.textContent = text;

    const hint = document.createElement('span');
    hint.className = 'inline-completion-hint';
    hint.textContent = t('inlineCompletion.hint');

    wrapper.append(ghost, hint);
    return wrapper;
}

function isTriggerEvent(event) {
    return event.key === 'Enter'
        && (event.metaKey || event.ctrlKey)
        && !event.altKey
        && !event.shiftKey;
}

/**
 * 创建 inline completion ProseMirror 插件，负责 ghost text 和快捷键。
 * @param {{onRequest: Function, onAccept?: Function, onCancel?: Function}} handlers - 交互回调
 * @returns {Plugin} ProseMirror 插件
 */
export function createInlineCompletionPlugin(handlers) {
    return new Plugin({
        key: inlineCompletionPluginKey,
        state: {
            init: () => ({ text: '', pos: null, loading: false, error: '' }),
            apply(tr, value) {
                const meta = tr.getMeta(inlineCompletionPluginKey);
                if (meta?.type === 'loading') {
                    return { text: '', pos: meta.pos, loading: true, error: '' };
                }
                if (meta?.type === 'suggest') {
                    return { text: meta.text || '', pos: meta.pos, loading: false, error: '' };
                }
                if (meta?.type === 'error') {
                    return { text: '', pos: meta.pos, loading: false, error: meta.error || '' };
                }
                if (meta?.type === 'clear') {
                    return { text: '', pos: null, loading: false, error: '' };
                }
                if (tr.docChanged && (value.text || value.loading || value.error)) {
                    return { text: '', pos: null, loading: false, error: '' };
                }
                if (value.pos != null) {
                    const mapped = tr.mapping.map(value.pos);
                    return { ...value, pos: mapped };
                }
                return value;
            },
        },
        props: {
            decorations(state) {
                const value = inlineCompletionPluginKey.getState(state);
                if (!value || value.pos == null || (!value.text && !value.loading && !value.error)) {
                    return DecorationSet.empty;
                }
                return DecorationSet.create(state.doc, [
                    Decoration.widget(value.pos, () => createGhostWidget(value.text, value.loading, value.error), { side: 1 }),
                ]);
            },
            handleKeyDown(view, event) {
                const value = inlineCompletionPluginKey.getState(view.state);
                if (isTriggerEvent(event)) {
                    event.preventDefault();
                    handlers.onRequest?.(view);
                    return true;
                }
                if (value?.text && event.key === 'Tab') {
                    event.preventDefault();
                    const insertPos = Math.min(value.pos ?? view.state.selection.from, view.state.doc.content.size);
                    const tr = view.state.tr.insertText(value.text, insertPos);
                    tr.setSelection(TextSelection.create(tr.doc, insertPos + value.text.length));
                    tr.setMeta(inlineCompletionPluginKey, { type: 'clear' });
                    view.dispatch(tr);
                    handlers.onAccept?.(value.text);
                    return true;
                }
                if ((value?.text || value?.loading || value?.error) && event.key === 'Escape') {
                    event.preventDefault();
                    view.dispatch(view.state.tr.setMeta(inlineCompletionPluginKey, { type: 'clear' }));
                    handlers.onCancel?.();
                    return true;
                }
                return false;
            },
        },
    });
}
