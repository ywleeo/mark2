import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { t } from '../../i18n/index.js';
import { aiService } from '../../modules/ai-assistant/aiService.js';
import { addClickHandler } from '../../utils/PointerHelper.js';

export const inlineCompletionPluginKey = new PluginKey('inlineCompletion');

let activeSettingsEl = null;

function saveInlineCompletionPreference(key, value) {
    const config = aiService.getConfig();
    aiService.saveConfig({
        ...config,
        preferences: {
            ...(config.preferences || {}),
            [key]: value,
        },
    });
}

function closeInlineCompletionSettings() {
    if (activeSettingsEl) {
        activeSettingsEl.remove();
        activeSettingsEl = null;
    }
    document.removeEventListener('mousedown', closeInlineCompletionSettingsOnOutside, true);
    document.removeEventListener('keydown', closeInlineCompletionSettingsOnEscape, true);
}

function closeInlineCompletionSettingsOnOutside(event) {
    if (activeSettingsEl && !activeSettingsEl.contains(event.target)) {
        closeInlineCompletionSettings();
    }
}

function closeInlineCompletionSettingsOnEscape(event) {
    if (event.key === 'Escape') closeInlineCompletionSettings();
}

function createPreferenceSelect(labelKey, value, options, onChange) {
    const label = document.createElement('label');
    label.className = 'inline-completion-settings__field';

    const text = document.createElement('span');
    text.textContent = t(labelKey);

    const select = document.createElement('select');
    options.forEach(option => {
        const item = document.createElement('option');
        item.value = option.value;
        item.textContent = t(option.labelKey);
        if (option.value === value) item.selected = true;
        select.appendChild(item);
    });
    select.addEventListener('change', () => onChange(select.value));

    label.append(text, select);
    return label;
}

function showInlineCompletionSettings(anchor) {
    closeInlineCompletionSettings();
    const config = aiService.getConfig();
    const prefs = config.preferences || {};

    const panel = document.createElement('div');
    panel.className = 'inline-completion-settings';
    panel.addEventListener('mousedown', (event) => {
        event.stopPropagation();
    });

    panel.append(
        createPreferenceSelect('settings.completionLength', prefs.completionLength || 'medium', [
            { value: 'short', labelKey: 'settings.completionLengthShort' },
            { value: 'medium', labelKey: 'settings.completionLengthMedium' },
            { value: 'long', labelKey: 'settings.completionLengthLong' },
        ], value => saveInlineCompletionPreference('completionLength', value)),
        createPreferenceSelect('settings.completionCreativity', prefs.creativity || 'medium', [
            { value: 'low', labelKey: 'settings.creativityLow' },
            { value: 'medium', labelKey: 'settings.creativityMedium' },
            { value: 'high', labelKey: 'settings.creativityHigh' },
        ], value => saveInlineCompletionPreference('creativity', value)),
    );

    document.body.appendChild(panel);
    activeSettingsEl = panel;

    const anchorRect = anchor.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const left = Math.max(10, Math.min(anchorRect.left, window.innerWidth - panelRect.width - 10));
    const top = Math.max(10, Math.min(anchorRect.bottom + 8, window.innerHeight - panelRect.height - 10));
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;

    setTimeout(() => {
        document.addEventListener('mousedown', closeInlineCompletionSettingsOnOutside, true);
        document.addEventListener('keydown', closeInlineCompletionSettingsOnEscape, true);
    }, 0);
}

function createSettingsButton() {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'inline-completion-settings-button';
    button.setAttribute('aria-label', t('inlineCompletion.settings'));
    button.setAttribute('contenteditable', 'false');
    button.tabIndex = -1;
    button.textContent = '⋯';
    addClickHandler(button, () => showInlineCompletionSettings(button), { preventDefault: true });
    return button;
}

function markInlineCompletionWidget(element) {
    element.setAttribute('contenteditable', 'false');
    element.setAttribute('data-inline-completion-widget', 'true');
    return element;
}

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

        status.append(label, dots, createSettingsButton());
        return markInlineCompletionWidget(status);
    }

    if (error) {
        const status = document.createElement('span');
        status.className = 'inline-completion-status inline-completion-status--error';
        status.textContent = error;
        return markInlineCompletionWidget(status);
    }

    const wrapper = document.createElement('span');
    wrapper.className = 'inline-completion-wrap';

    const ghost = document.createElement('span');
    ghost.className = 'inline-completion';
    ghost.textContent = text;

    const hint = document.createElement('span');
    hint.className = 'inline-completion-hint';
    hint.textContent = t('inlineCompletion.hint');

    wrapper.append(ghost, hint, createSettingsButton());
    return markInlineCompletionWidget(wrapper);
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
                    Decoration.widget(value.pos, () => createGhostWidget(value.text, value.loading, value.error), {
                        side: 1,
                        ignoreSelection: true,
                        stopEvent: event => Boolean(event.target?.closest?.('[data-inline-completion-widget]')),
                    }),
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
