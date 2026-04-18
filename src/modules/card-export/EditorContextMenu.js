import { addClickHandler } from '../../utils/PointerHelper.js';
import { t } from '../../i18n/index.js';

export class EditorContextMenu {
    constructor({ onGenerateCard, onBeautifyMarkdown, getEditor }) {
        this.onGenerateCard = onGenerateCard;
        this.onBeautifyMarkdown = onBeautifyMarkdown ?? null;
        this.getEditor = getEditor ?? null;
        this.element = null;
        this._cleanups = [];
        this._init();
    }

    _init() {
        const el = document.createElement('div');
        el.className = 'editor-context-menu hidden';
        el.innerHTML = `
            <button type="button" class="editor-context-menu__item" data-action="generate-card">
                <span class="editor-context-menu__item-icon" aria-hidden="true">
                    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="2" y="2" width="12" height="12" rx="1.5"/>
                        <path d="M5 6h6M5 9h4"/>
                    </svg>
                </span>
                <span class="editor-context-menu__item-label">${t('contextMenu.generateCard')}</span>
            </button>
            <button type="button" class="editor-context-menu__item" data-action="beautify-markdown">
                <span class="editor-context-menu__item-icon" aria-hidden="true">
                    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M8 2l1.2 3.5L13 7l-3.8 1.5L8 12l-1.2-3.5L3 7l3.8-1.5Z"/>
                        <path d="M13 11l.6 1.4 1.4.6-1.4.6L13 15l-.6-1.4-1.4-.6 1.4-.6Z" stroke-width="1.2"/>
                    </svg>
                </span>
                <span class="editor-context-menu__item-label">${t('contextMenu.beautifyMarkdown')}</span>
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
                if (e.target?.closest('[data-action="generate-card"]')) this._handleGenerateCard();
                if (e.target?.closest('[data-action="beautify-markdown"]')) this._handleBeautifyMarkdown();
            }, { shouldHandle: (e) => Boolean(e.target?.closest('[data-action]')), preventDefault: true }),
            () => document.removeEventListener('contextmenu', onContextMenu),
            () => window.removeEventListener('click', onClose, true),
            () => window.removeEventListener('blur', onClose),
            () => window.removeEventListener('keydown', onKeydown, true),
        );
    }

    _handleContextMenu(e) {
        if (!e.target?.closest('[data-markdown-editor-host]')) return;
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || !sel.toString().trim()) return;
        e.preventDefault();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const menuHeight = this.onBeautifyMarkdown ? 80 : 44;
        const left = e.clientX + 200 > vw ? vw - 210 : e.clientX;
        const top = e.clientY + menuHeight > vh ? vh - menuHeight - 8 : e.clientY;
        this.element.style.left = `${left}px`;
        this.element.style.top = `${top}px`;
        this.element.classList.remove('hidden');
    }

    _hide() {
        this.element?.classList.add('hidden');
    }

    _handleGenerateCard() {
        this._hide();
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed) return;
        const text = sel.toString().trim();
        if (!text) return;
        const div = document.createElement('div');
        div.appendChild(sel.getRangeAt(0).cloneContents());
        this.onGenerateCard({ text, html: div.innerHTML });
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

    destroy() {
        this._cleanups.forEach(fn => fn?.());
        this.element?.remove();
        this.element = null;
    }
}
