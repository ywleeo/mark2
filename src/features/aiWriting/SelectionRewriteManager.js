import { t } from '../../i18n/index.js';
import { buildSelectionRewriteContext, requestSelectionRewrite } from './AiWritingService.js';

export const SELECTION_REWRITE_ACTIONS = [
    { mode: 'polish', labelKey: 'aiWriting.polish' },
    { mode: 'expand', labelKey: 'aiWriting.expand' },
    { mode: 'shorten', labelKey: 'aiWriting.shorten' },
    { mode: 'inspiration', labelKey: 'aiWriting.inspiration' },
];

/**
 * 选区 AI 改写执行器。
 * UI 入口由编辑器右键菜单统一承载，这里只负责捕获选区并执行 AI 改写。
 */
export class SelectionRewriteManager {
    constructor({ editor, viewElement, getMarkdown, getSelectedMarkdown, replaceRangeWithMarkdown, onInspiration }) {
        this.editor = editor;
        this.viewElement = viewElement;
        this.getMarkdown = getMarkdown;
        this.getSelectedMarkdown = getSelectedMarkdown;
        this.replaceRangeWithMarkdown = replaceRangeWithMarkdown;
        this.onInspiration = onInspiration;
        this.selectionRange = null;
        this.requestSeq = 0;
    }

    setup() {
        // 右键菜单统一承载选区入口，保留 setup 以兼容 MarkdownEditor 的生命周期调用。
    }

    destroy() {
        this.requestSeq += 1;
        this.selectionRange = null;
    }

    getCurrentSelectionRange() {
        const state = this.editor?.state;
        const view = this.editor?.view;
        const selection = state?.selection;
        if (!state || !view || view.isDestroyed || !selection || selection.empty) return null;
        const selectedText = state.doc.textBetween(selection.from, selection.to, '\n', '\n').trim();
        if (!selectedText) return null;
        return { from: selection.from, to: selection.to };
    }

    executeForCurrentSelection(mode) {
        const range = this.getCurrentSelectionRange();
        return this.executeForSelectionRange(mode, range);
    }

    executeForSelectionRange(mode, range) {
        if (!range) return false;
        const state = this.editor?.state;
        const view = this.editor?.view;
        if (!state || !view || view.isDestroyed) return false;
        const selectedText = state.doc.textBetween(range.from, range.to, '\n', '\n').trim();
        if (!selectedText) return false;
        this.selectionRange = range;
        this.execute(mode);
        return true;
    }

    async execute(mode) {
        if (!this.selectionRange || !this.editor?.state) return;
        if (mode === 'inspiration') {
            this.onInspiration?.();
            this.selectionRange = null;
            return;
        }
        const requestId = ++this.requestSeq;
        const { from, to } = this.selectionRange;
        const currentSelection = this.editor.state.selection;
        const isCurrentSelection = currentSelection?.from === from && currentSelection?.to === to;
        const selectedMarkdown = (isCurrentSelection ? this.getSelectedMarkdown?.() : '')
            || this.editor.state.doc.textBetween(from, to, '\n', '\n');
        const context = buildSelectionRewriteContext(this.editor.state, selectedMarkdown, this.getMarkdown?.() || '');

        try {
            const result = await requestSelectionRewrite(mode, context);
            if (requestId !== this.requestSeq) return;
            this.replaceRangeWithMarkdown?.(from, to, result);
            this.selectionRange = null;
        } catch (error) {
            if (requestId !== this.requestSeq) return;
            console.warn('[SelectionRewrite] request failed', error);
            alert(error?.message || t('aiWriting.error'));
        } finally {
            if (requestId === this.requestSeq) this.selectionRange = null;
        }
    }
}
