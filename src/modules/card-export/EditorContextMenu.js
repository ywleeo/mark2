import { addClickHandler } from '../../utils/PointerHelper.js';
import { t } from '../../i18n/index.js';
import { SELECTION_REWRITE_ACTIONS } from '../../features/aiWriting/SelectionRewriteManager.js';

export class EditorContextMenu {
    constructor({ onBeautifyMarkdown, onAiSelectionAction, getEditor }) {
        this.onBeautifyMarkdown = onBeautifyMarkdown ?? null;
        this.onAiSelectionAction = onAiSelectionAction ?? null;
        this.getEditor = getEditor ?? null;
        this.element = null;
        this.selectionRange = null;
        this._cleanups = [];
        this._init();
    }

    _init() {
        const el = document.createElement('div');
        el.className = 'editor-context-menu editor-context-menu--ai hidden';
        el.innerHTML = `
            ${this.renderAiGroup()}
            <button type="button" class="ai-writing-menu__button" data-action="beautify-markdown">
                ${t('contextMenu.beautifyMarkdown')}
            </button>
        `;
        this.element = el;
        document.body.appendChild(el);

        const onContextMenu = (e) => this._handleContextMenu(e);
        const onClose = (e) => { if (!(e.target instanceof Node) || !el.contains(e.target)) this._hide(); };
        const onKeydown = (e) => { if (e.key === 'Escape') this._hide(); };

        document.addEventListener('contextmenu', onContextMenu);
        window.addEventListener('click', onClose, true);
        window.addEventListener('blur', onClose);
        window.addEventListener('keydown', onKeydown, true);

        this._cleanups.push(
            addClickHandler(el, (e) => {
                const item = e.target?.closest('[data-action]');
                const action = item?.dataset?.action;
                if (!action) return;
                if (action === 'beautify-markdown') this._handleBeautifyMarkdown();
                if (action.startsWith('ai-selection:')) {
                    this._handleAiSelectionAction(action.replace('ai-selection:', ''));
                }
            }, { shouldHandle: (e) => Boolean(e.target?.closest('[data-action]')), preventDefault: true }),
            () => document.removeEventListener('contextmenu', onContextMenu),
            () => window.removeEventListener('click', onClose, true),
            () => window.removeEventListener('blur', onClose),
            () => window.removeEventListener('keydown', onKeydown, true),
        );
    }

    renderAiGroup() {
        if (!this.onAiSelectionAction) return '';
        const actions = SELECTION_REWRITE_ACTIONS.map(action => `
            <button type="button" class="ai-writing-menu__button" data-action="ai-selection:${action.mode}">
                ${t(action.labelKey)}
            </button>
        `).join('');
        return `
            <span class="ai-writing-badge ai-writing-menu__title">${t('aiWriting.title')}</span>
            ${actions}
        `;
    }

    _handleContextMenu(e) {
        if (!e.target?.closest('[data-markdown-editor-host]')) return;
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || !sel.toString().trim()) return;
        this.selectionRange = this.getSelectionRange();
        e.preventDefault();
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        this.element.style.left = '0px';
        this.element.style.top = '0px';
        this.element.classList.remove('hidden');
        const rect = this.element.getBoundingClientRect();
        const left = e.clientX + rect.width > vw ? vw - rect.width - 8 : e.clientX;
        const top = e.clientY + rect.height > vh ? vh - rect.height - 8 : e.clientY;
        this.element.style.left = `${left}px`;
        this.element.style.top = `${top}px`;
    }

    _hide() {
        this.element?.classList.add('hidden');
    }

    getSelectionRange() {
        const editor = typeof this.getEditor === 'function' ? this.getEditor() : null;
        const selection = editor?.state?.selection;
        if (!selection || selection.empty) return null;
        return { from: selection.from, to: selection.to };
    }

    _handleBeautifyMarkdown() {
        this._hide();
        if (!this.onBeautifyMarkdown) return;

        const editor = typeof this.getEditor === 'function' ? this.getEditor() : null;
        if (!editor) return;

        const { from, to } = editor.state.selection;
        if (from === to) return;

        // 取选区纯文本作为 AI 输入（跨块用换行分隔）
        const text = editor.state.doc.textBetween(from, to, '\n').trim();
        if (!text) return;

        this.onBeautifyMarkdown({ text, from, to });
    }

    _handleAiSelectionAction(mode) {
        const range = this.selectionRange;
        this._hide();
        this.onAiSelectionAction?.(mode, range);
    }

    destroy() {
        this._cleanups.forEach(fn => fn?.());
        this.element?.remove();
        this.element = null;
    }
}
