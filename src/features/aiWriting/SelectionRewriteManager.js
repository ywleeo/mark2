import { t } from '../../i18n/index.js';
import { addClickHandler } from '../../utils/PointerHelper.js';
import { buildSelectionRewriteContext, requestSelectionRewrite } from './AiWritingService.js';

const ACTIONS = [
    { mode: 'polish', labelKey: 'aiWriting.polish' },
    { mode: 'expand', labelKey: 'aiWriting.expand' },
    { mode: 'shorten', labelKey: 'aiWriting.shorten' },
    { mode: 'inspiration', labelKey: 'aiWriting.inspiration' },
];

const SHOW_DELAY_MS = 1000;

/**
 * 选区 AI 改写浮层。
 * 选区稳定后显示轻量菜单，执行后用 AI 输出直接替换当前选区。
 */
export class SelectionRewriteManager {
    constructor({ editor, viewElement, getMarkdown, getSelectedMarkdown, replaceRangeWithMarkdown, onInspiration }) {
        this.editor = editor;
        this.viewElement = viewElement;
        this.getMarkdown = getMarkdown;
        this.getSelectedMarkdown = getSelectedMarkdown;
        this.replaceRangeWithMarkdown = replaceRangeWithMarkdown;
        this.onInspiration = onInspiration;
        this.menuEl = null;
        this.selectionRange = null;
        this.pendingSelectionRange = null;
        this.cleanupHandlers = [];
        this.requestSeq = 0;
        this.updateHandler = () => this.scheduleUpdate();
        this.keyHandler = (event) => {
            if (event.key === 'Escape') this.hide(true);
        };
        this.pointerDownHandler = (event) => {
            if (this.menuEl && !this.menuEl.contains(event.target)) this.hide(true);
        };
        this.updateFrame = null;
        this.showTimer = null;
    }

    setup() {
        this.editor?.on?.('selectionUpdate', this.updateHandler);
        this.editor?.on?.('transaction', this.updateHandler);
        document.addEventListener('keydown', this.keyHandler, true);
        document.addEventListener('mousedown', this.pointerDownHandler, true);
    }

    destroy() {
        this.requestSeq += 1;
        if (this.updateFrame != null) cancelAnimationFrame(this.updateFrame);
        this.updateFrame = null;
        this.clearShowTimer();
        this.editor?.off?.('selectionUpdate', this.updateHandler);
        this.editor?.off?.('transaction', this.updateHandler);
        document.removeEventListener('keydown', this.keyHandler, true);
        document.removeEventListener('mousedown', this.pointerDownHandler, true);
        this.hide();
    }

    scheduleUpdate() {
        if (this.updateFrame != null) return;
        this.updateFrame = requestAnimationFrame(() => {
            this.updateFrame = null;
            this.update();
        });
    }

    clearShowTimer() {
        if (this.showTimer != null) clearTimeout(this.showTimer);
        this.showTimer = null;
        this.pendingSelectionRange = null;
    }

    update() {
        const state = this.editor?.state;
        const view = this.editor?.view;
        const selection = state?.selection;
        if (!state || !view || view.isDestroyed || !selection || selection.empty) {
            this.hide(true);
            return;
        }

        const selectedText = state.doc.textBetween(selection.from, selection.to, '\n', '\n').trim();
        if (!selectedText) {
            this.hide(true);
            return;
        }

        const nextRange = { from: selection.from, to: selection.to };
        if (this.menuEl && this.isSameRange(this.selectionRange, nextRange)) {
            this.position();
            return;
        }

        if (this.menuEl) this.hide(true);
        this.scheduleDelayedShow(nextRange);
    }

    isSameRange(left, right) {
        return Boolean(left && right && left.from === right.from && left.to === right.to);
    }

    scheduleDelayedShow(range) {
        if (this.isSameRange(this.pendingSelectionRange, range) && this.showTimer != null) return;
        this.clearShowTimer();
        this.pendingSelectionRange = range;
        this.showTimer = setTimeout(() => {
            this.showTimer = null;
            const state = this.editor?.state;
            const view = this.editor?.view;
            const selection = state?.selection;
            if (!state || !view || view.isDestroyed || !selection || selection.empty) {
                this.pendingSelectionRange = null;
                return;
            }
            const currentRange = { from: selection.from, to: selection.to };
            if (!this.isSameRange(this.pendingSelectionRange, currentRange)) {
                this.pendingSelectionRange = null;
                return;
            }
            const selectedText = state.doc.textBetween(selection.from, selection.to, '\n', '\n').trim();
            if (!selectedText) {
                this.pendingSelectionRange = null;
                return;
            }
            this.selectionRange = currentRange;
            this.pendingSelectionRange = null;
            this.show();
            this.position();
        }, SHOW_DELAY_MS);
    }

    show() {
        if (this.menuEl) return;

        const menu = document.createElement('div');
        menu.className = 'ai-writing-menu';
        menu.addEventListener('mousedown', (event) => {
            event.preventDefault();
            event.stopPropagation();
        });

        const title = document.createElement('span');
        title.className = 'ai-writing-menu__title';
        title.textContent = t('aiWriting.title');
        menu.appendChild(title);

        ACTIONS.forEach(action => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'ai-writing-menu__button';
            button.textContent = t(action.labelKey);
            this.cleanupHandlers.push(addClickHandler(button, () => this.execute(action.mode), { preventDefault: true }));
            menu.appendChild(button);
        });

        document.body.appendChild(menu);
        this.menuEl = menu;
    }

    hide(cancelRequest = false) {
        if (cancelRequest) this.requestSeq += 1;
        this.clearShowTimer();
        this.cleanupHandlers.forEach(cleanup => cleanup?.());
        this.cleanupHandlers = [];
        this.selectionRange = null;
        if (this.menuEl) {
            this.menuEl.remove();
            this.menuEl = null;
        }
    }

    position() {
        if (!this.menuEl || !this.selectionRange || !this.editor?.view) return;
        try {
            const { from, to } = this.selectionRange;
            const start = this.editor.view.coordsAtPos(from);
            const end = this.editor.view.coordsAtPos(to);
            const anchorX = (start.left + end.right) / 2;
            const anchorY = Math.min(start.top, end.top);
            const rect = this.menuEl.getBoundingClientRect();
            const x = Math.max(10, Math.min(anchorX - rect.width / 2, window.innerWidth - rect.width - 10));
            const y = Math.max(10, anchorY - rect.height - 10);
            this.menuEl.style.left = `${x}px`;
            this.menuEl.style.top = `${y}px`;
        } catch {
            this.hide();
        }
    }

    setBusy(isBusy) {
        if (!this.menuEl) return;
        this.menuEl.classList.toggle('is-busy', isBusy);
        const buttons = this.menuEl.querySelectorAll('button');
        buttons.forEach(button => { button.disabled = isBusy; });
        const title = this.menuEl.querySelector('.ai-writing-menu__title');
        if (title) title.textContent = isBusy ? t('aiWriting.working') : t('aiWriting.title');
    }

    async execute(mode) {
        if (!this.selectionRange || !this.editor?.state) return;
        if (mode === 'inspiration') {
            this.onInspiration?.();
            this.hide(false);
            return;
        }
        const requestId = ++this.requestSeq;
        const { from, to } = this.selectionRange;
        const selectedMarkdown = this.getSelectedMarkdown?.() || this.editor.state.doc.textBetween(from, to, '\n', '\n');
        const context = buildSelectionRewriteContext(this.editor.state, selectedMarkdown, this.getMarkdown?.() || '');
        this.setBusy(true);

        try {
            const result = await requestSelectionRewrite(mode, context);
            if (requestId !== this.requestSeq) return;
            this.replaceRangeWithMarkdown?.(from, to, result);
            this.hide();
        } catch (error) {
            if (requestId !== this.requestSeq) return;
            console.warn('[SelectionRewrite] request failed', error);
            this.showError(error?.message || t('aiWriting.error'));
        } finally {
            if (requestId === this.requestSeq) this.setBusy(false);
        }
    }

    showError(message) {
        if (!this.menuEl) return;
        const title = this.menuEl.querySelector('.ai-writing-menu__title');
        if (title) title.textContent = message || t('aiWriting.error');
        this.menuEl.classList.add('is-error');
        setTimeout(() => {
            if (!this.menuEl) return;
            this.menuEl.classList.remove('is-error');
            const nextTitle = this.menuEl.querySelector('.ai-writing-menu__title');
            if (nextTitle) nextTitle.textContent = t('aiWriting.title');
        }, 2200);
    }
}
