import { addClickHandler } from '../../utils/PointerHelper.js';
import { t } from '../../i18n/index.js';

export class EditorContextMenu {
    constructor({ onGenerateCard }) {
        this.onGenerateCard = onGenerateCard;
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
                if (e.target?.closest('[data-action="generate-card"]')) this._handleAction();
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
        const left = e.clientX + 200 > vw ? vw - 210 : e.clientX;
        const top = e.clientY + 60 > vh ? vh - 70 : e.clientY;
        this.element.style.left = `${left}px`;
        this.element.style.top = `${top}px`;
        this.element.classList.remove('hidden');
    }

    _hide() {
        this.element?.classList.add('hidden');
    }

    _handleAction() {
        this._hide();
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed) return;
        const text = sel.toString().trim();
        if (!text) return;
        const div = document.createElement('div');
        div.appendChild(sel.getRangeAt(0).cloneContents());
        this.onGenerateCard({ text, html: div.innerHTML });
    }

    destroy() {
        this._cleanups.forEach(fn => fn?.());
        this.element?.remove();
        this.element = null;
    }
}
