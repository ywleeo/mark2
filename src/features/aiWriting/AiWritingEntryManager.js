import { t } from '../../i18n/index.js';
import { addClickHandler } from '../../utils/PointerHelper.js';
import { buildWritingIdeaContext, requestIdeaExpansion, requestWritingIdeas } from './AiWritingService.js';

/**
 * AI 写作入口管理器。
 * 负责光标行内提示、灵感面板，以及工具栏入口的上下文分流。
 */
export class AiWritingEntryManager {
    constructor({
        editor,
        getMarkdown,
        getSelectedMarkdown,
        inlineCompletionManager,
        insertTextAtCursor,
    }) {
        this.editor = editor;
        this.getMarkdown = getMarkdown;
        this.getSelectedMarkdown = getSelectedMarkdown;
        this.inlineCompletionManager = inlineCompletionManager;
        this.insertTextAtCursor = insertTextAtCursor;
        this.hintEl = null;
        this.panelEl = null;
        this.hintCleanups = [];
        this.panelCleanups = [];
        this.hintTimer = null;
        this.requestSeq = 0;
        this.expandedHintOpenedAt = 0;
        this.suppressedUntilSelectionChange = false;
        this.lastSelectionKey = '';
        this.selectionUpdateHandler = () => this.handleEditorActivity();
        this.transactionHandler = ({ transaction }) => this.handleTransaction(transaction);
        this.keydownHandler = () => this.handleTyping();
        this.documentPointerHandler = (event) => {
            if (this.panelEl && !this.panelEl.contains(event.target) && !this.hintEl?.contains(event.target)) {
                this.hidePanel();
            }
            if (this.hintEl?.classList.contains('ai-writing-cursor-hint--expanded')
                && !this.hintEl.contains(event.target)) {
                if (Date.now() - this.expandedHintOpenedAt < 180) return;
                this.hideHint();
            }
        };
    }

    setup() {
        this.editor?.on?.('selectionUpdate', this.selectionUpdateHandler);
        this.editor?.on?.('transaction', this.transactionHandler);
        this.editor?.view?.dom?.addEventListener('keydown', this.keydownHandler, true);
        document.addEventListener('mousedown', this.documentPointerHandler, true);
    }

    destroy() {
        this.requestSeq += 1;
        this.clearHintTimer();
        this.editor?.off?.('selectionUpdate', this.selectionUpdateHandler);
        this.editor?.off?.('transaction', this.transactionHandler);
        this.editor?.view?.dom?.removeEventListener('keydown', this.keydownHandler, true);
        document.removeEventListener('mousedown', this.documentPointerHandler, true);
        this.hideHint({ immediate: true });
        this.hidePanel();
    }

    handleEditorActivity() {
        const key = this.getSelectionKey();
        if (key !== this.lastSelectionKey) {
            this.lastSelectionKey = key;
            this.suppressedUntilSelectionChange = false;
        }
        this.hideHintForEditorActivity();
        this.scheduleCursorHint();
    }

    handleTransaction(transaction) {
        if (transaction?.docChanged) {
            this.hideHintForEditorActivity();
            this.hidePanel();
            this.suppressedUntilSelectionChange = false;
        }
        this.scheduleCursorHint();
    }

    handleTyping() {
        this.hideHintForEditorActivity();
        this.scheduleCursorHint();
    }

    getSelectionKey() {
        const selection = this.editor?.state?.selection;
        if (!selection) return '';
        return `${selection.from}:${selection.to}`;
    }

    clearHintTimer() {
        if (this.hintTimer) {
            clearTimeout(this.hintTimer);
            this.hintTimer = null;
        }
    }

    scheduleCursorHint() {
        this.clearHintTimer();
        const view = this.editor?.view;
        const selection = this.editor?.state?.selection;
        if (!view || view.isDestroyed || !view.hasFocus?.() || !selection?.empty || this.suppressedUntilSelectionChange) {
            return;
        }
        this.hintTimer = setTimeout(() => {
            this.hintTimer = null;
            this.showHintIfUseful();
        }, 0);
    }

    showHintIfUseful() {
        const view = this.editor?.view;
        const selection = this.editor?.state?.selection;
        if (!view || view.isDestroyed || !view.hasFocus?.() || !selection?.empty || this.panelEl) return;
        this.showHint();
    }

    showHint() {
        if (this.hintEl) {
            this.positionHintElement(this.hintEl);
            return;
        }

        const hint = document.createElement('div');
        hint.className = 'ai-writing-cursor-hint ai-writing-cursor-hint--compact';
        this.bindHintPointerGuards(hint);

        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'ai-writing-cursor-hint__trigger';
        trigger.textContent = 'AI';
        trigger.setAttribute('aria-label', t('toolbar.aiWriting'));
        this.hintCleanups.push(addClickHandler(trigger, () => {
            this.showActionHint();
        }, { preventDefault: true }));

        hint.append(trigger);
        document.body.appendChild(hint);
        this.hintEl = hint;
        this.positionHintElement(hint);
    }

    showActionHint() {
        this.hideHint({ immediate: true });

        const hint = document.createElement('div');
        hint.className = 'ai-writing-cursor-hint ai-writing-cursor-hint--expanded';
        this.expandedHintOpenedAt = Date.now();
        this.bindHintPointerGuards(hint);

        const title = document.createElement('span');
        title.className = 'ai-writing-menu__title ai-writing-cursor-hint__title';
        title.textContent = t('aiWriting.title');

        const continueBtn = document.createElement('button');
        continueBtn.type = 'button';
        continueBtn.textContent = t('aiWriting.continue');
        this.hintCleanups.push(addClickHandler(continueBtn, () => {
            this.suppressedUntilSelectionChange = true;
            this.hideHint();
            this.inlineCompletionManager?.request(this.editor.view);
        }, { preventDefault: true }));

        const inspirationBtn = document.createElement('button');
        inspirationBtn.type = 'button';
        inspirationBtn.textContent = t('aiWriting.inspiration');
        this.hintCleanups.push(addClickHandler(inspirationBtn, () => {
            this.hideHint();
            this.openInspiration();
        }, { preventDefault: true }));

        hint.append(title, continueBtn, inspirationBtn);
        document.body.appendChild(hint);
        this.hintEl = hint;
        this.positionHintElement(hint);
    }

    hideHint({ immediate = false } = {}) {
        const hint = this.hintEl;
        const shouldAnimate = !immediate && hint?.classList.contains('ai-writing-cursor-hint--compact');
        this.hintCleanups.forEach(cleanup => cleanup?.());
        this.hintCleanups = [];
        this.hintEl = null;

        if (!hint) return;
        if (shouldAnimate) {
            hint.classList.add('is-leaving');
            setTimeout(() => hint.remove(), 180);
            return;
        }
        hint.remove();
    }

    hideHintForEditorActivity() {
        if (this.hintEl?.classList.contains('ai-writing-cursor-hint--expanded')
            && Date.now() - this.expandedHintOpenedAt < 180) {
            return;
        }
        this.hideHint();
    }

    bindHintPointerGuards(hint) {
        const guard = event => {
            event.stopPropagation();
        };
        hint.addEventListener('mousedown', guard);
        hint.addEventListener('pointerdown', guard);
        hint.addEventListener('click', guard);
        this.hintCleanups.push(() => {
            hint.removeEventListener('mousedown', guard);
            hint.removeEventListener('pointerdown', guard);
            hint.removeEventListener('click', guard);
        });
    }

    positionElementAtCursor(element, { offsetY = 0 } = {}) {
        if (!element || !this.editor?.view) return;
        try {
            const pos = this.editor.state.selection.from;
            const coords = this.editor.view.coordsAtPos(pos, 1);
            const rect = element.getBoundingClientRect();
            const left = Math.max(10, Math.min(coords.left, window.innerWidth - rect.width - 10));
            const top = Math.max(10, Math.min(coords.bottom + offsetY, window.innerHeight - rect.height - 10));
            element.style.left = `${left}px`;
            element.style.top = `${top}px`;
        } catch {
            this.hideHint();
        }
    }

    positionHintElement(element) {
        if (!element) return;
        if (element.classList.contains('ai-writing-cursor-hint--compact')) {
            this.positionElementAtLineGutter(element);
            return;
        }
        this.positionElementAtLineGutter(element, { alignMenu: true });
    }

    positionElementAtLineGutter(element, { alignMenu = false } = {}) {
        if (!element || !this.editor?.view) return;
        try {
            const pos = this.editor.state.selection.from;
            const anchor = this.getLineGutterAnchor(pos);
            const rect = element.getBoundingClientRect();
            const left = alignMenu
                ? Math.max(10, Math.min(anchor.left + 24, window.innerWidth - rect.width - 10))
                : Math.max(10, Math.min(anchor.left, window.innerWidth - rect.width - 10));
            const lineMiddle = (anchor.top + anchor.bottom) / 2;
            const rawTop = alignMenu ? anchor.bottom + 6 : lineMiddle - rect.height / 2;
            const top = Math.max(10, Math.min(rawTop, window.innerHeight - rect.height - 10));
            element.style.left = `${left}px`;
            element.style.top = `${top}px`;
        } catch {
            this.hideHint();
        }
    }

    getLineGutterAnchor(pos) {
        const view = this.editor.view;
        const lineCoords = this.getCaretLineCoords(pos);
        return {
            left: 261,
            top: lineCoords.top,
            bottom: lineCoords.bottom,
        };
    }

    getCaretLineCoords(pos) {
        const view = this.editor.view;
        const coords = view.coordsAtPos(pos, 1);
        const nextRect = this.getCharacterRect(pos);
        if (!nextRect) return coords;

        const nextIsVisualLineStart = nextRect.top > coords.top + 2
            && nextRect.left < coords.left - 8;
        if (!nextIsVisualLineStart) return coords;

        return {
            top: nextRect.top,
            bottom: nextRect.bottom,
            left: nextRect.left,
            right: nextRect.right,
        };
    }

    getCharacterRect(pos) {
        const view = this.editor?.view;
        if (!view) return null;
        let domPos;
        try {
            domPos = view.domAtPos(pos);
        } catch {
            return null;
        }
        const target = this.findNextTextPosition(domPos.node, domPos.offset);
        if (!target) return null;

        const range = document.createRange();
        range.setStart(target.node, target.offset);
        range.setEnd(target.node, target.offset + 1);
        const rect = Array.from(range.getClientRects()).find(item => item.width > 0 && item.height > 0);
        range.detach?.();
        return rect || null;
    }

    findNextTextPosition(node, offset) {
        if (!node) return null;
        if (node.nodeType === Node.TEXT_NODE && offset < node.nodeValue.length) {
            return { node, offset };
        }

        const root = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
        if (!root) return null;
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let textNode = null;
        while ((textNode = walker.nextNode())) {
            if (textNode.nodeValue) return { node: textNode, offset: 0 };
        }
        return null;
    }

    openForCurrentContext() {
        const selection = this.editor?.state?.selection;
        if (!selection) return;
        if (selection.empty) {
            this.showHint();
        } else {
            this.openInspiration();
        }
    }

    async openInspiration() {
        const state = this.editor?.state;
        if (!state) return;
        const requestId = ++this.requestSeq;
        this.hideHint();
        this.showPanel({ loading: true });

        const selected = state.selection.empty ? '' : this.getSelectedMarkdown?.();
        const context = buildWritingIdeaContext(state, selected || '', this.getMarkdown?.() || '');
        try {
            const ideas = await requestWritingIdeas(context);
            if (requestId !== this.requestSeq) return;
            this.showPanel({ ideas, context });
        } catch (error) {
            if (requestId !== this.requestSeq) return;
            console.warn('[AiWriting] ideas failed', error);
            this.showPanel({ error: error?.message || t('aiWriting.error') });
        }
    }

    showPanel({ loading = false, ideas = [], context = null, error = '' } = {}) {
        this.hidePanel(false);

        const panel = document.createElement('div');
        panel.className = 'ai-writing-inspiration-panel';
        panel.addEventListener('mousedown', event => {
            event.stopPropagation();
        });

        const header = document.createElement('div');
        header.className = 'ai-writing-inspiration-panel__header';

        const title = document.createElement('span');
        title.className = 'ai-writing-menu__title ai-writing-inspiration-panel__ai-label';
        title.textContent = t('aiWriting.title');

        const label = document.createElement('span');
        label.textContent = t('aiWriting.inspirationTitle');

        header.append(title, label);
        panel.appendChild(header);

        if (loading) {
            const loadingEl = document.createElement('div');
            loadingEl.className = 'ai-writing-inspiration-panel__status';
            loadingEl.textContent = t('aiWriting.thinking');
            panel.appendChild(loadingEl);
        } else if (error) {
            const errorEl = document.createElement('div');
            errorEl.className = 'ai-writing-inspiration-panel__status ai-writing-inspiration-panel__status--error';
            errorEl.textContent = error;
            panel.appendChild(errorEl);
        } else {
            ideas.forEach(idea => panel.appendChild(this.createIdeaItem(idea, context)));
        }

        document.body.appendChild(panel);
        this.panelEl = panel;
        this.positionElementAtCursor(panel, { offsetY: 10 });
    }

    createIdeaItem(idea, context) {
        const item = document.createElement('div');
        item.className = 'ai-writing-idea';

        const type = document.createElement('div');
        type.className = 'ai-writing-idea__type';
        type.textContent = idea.typeLabel || idea.type;

        const text = document.createElement('div');
        text.className = 'ai-writing-idea__text';
        text.textContent = idea.text;

        const actions = document.createElement('div');
        actions.className = 'ai-writing-idea__actions';

        const expand = document.createElement('button');
        expand.type = 'button';
        expand.textContent = t('aiWriting.expandIdea');
        this.panelCleanups.push(addClickHandler(expand, () => this.expandIdea(idea, context), { preventDefault: true }));

        const insert = document.createElement('button');
        insert.type = 'button';
        insert.textContent = t('aiWriting.insertIdea');
        this.panelCleanups.push(addClickHandler(insert, () => this.insertIdea(idea), { preventDefault: true }));

        actions.append(expand, insert);
        item.append(type, text, actions);
        return item;
    }

    hidePanel(cancelRequest = true) {
        if (cancelRequest) this.requestSeq += 1;
        this.panelCleanups.forEach(cleanup => cleanup?.());
        this.panelCleanups = [];
        this.panelEl?.remove();
        this.panelEl = null;
    }

    async expandIdea(idea, context) {
        const requestId = ++this.requestSeq;
        this.showPanel({ loading: true });
        try {
            const text = await requestIdeaExpansion(idea.text, context);
            if (requestId !== this.requestSeq) return;
            this.inlineCompletionManager?.showSuggestion(text, this.editor?.state?.selection?.from);
            this.hidePanel(false);
        } catch (error) {
            if (requestId !== this.requestSeq) return;
            console.warn('[AiWriting] expand idea failed', error);
            this.showPanel({ error: error?.message || t('aiWriting.error') });
        }
    }

    insertIdea(idea) {
        this.insertTextAtCursor?.(`\n\n> ${t('aiWriting.ideaPrefix')}${idea.text}\n\n`);
        this.hidePanel();
    }
}
