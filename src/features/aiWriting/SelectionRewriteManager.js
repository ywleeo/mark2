import { t } from '../../i18n/index.js';
import { createLogger } from '../../core/diagnostics/Logger.js';
import { buildSelectionRewriteContext, requestSelectionRewrite } from './AiWritingService.js';
import { createSelectionRewritePlugin, selectionRewritePluginKey } from './SelectionRewritePlugin.js';

const logger = createLogger('selection-rewrite');
const RESULT_STATUS_DURATION_MS = 2200;

/**
 * 选区 AI 改写执行器。
 * UI 入口由 Markdown Toolbar 统一承载，这里只负责捕获选区并执行 AI 改写。
 */
export class SelectionRewriteManager {
    constructor({ editor, viewElement, getMarkdown, getSelectedMarkdown, getRangeMarkdown, replaceRangeWithMarkdown, onInspiration }) {
        this.editor = editor;
        this.viewElement = viewElement;
        this.getMarkdown = getMarkdown;
        this.getSelectedMarkdown = getSelectedMarkdown;
        this.getRangeMarkdown = getRangeMarkdown;
        this.replaceRangeWithMarkdown = replaceRangeWithMarkdown;
        this.onInspiration = onInspiration;
        this.selectionRange = null;
        this.requestSeq = 0;
        this.statusTimer = null;
        this.plugin = createSelectionRewritePlugin({ onCancel: () => this.cancel() });
    }

    setup() {
        this.editor?.registerPlugin?.(this.plugin);
    }

    destroy() {
        this.cancel();
        try {
            this.editor?.unregisterPlugin?.(selectionRewritePluginKey);
        } catch (_) {}
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
        void this.execute(mode);
        return true;
    }

    /**
     * 取消当前改写请求并清理编辑器内状态。
     * 后端请求可能仍会结束，但 requestSeq 会阻止旧结果写回文档。
     * @returns {void}
     */
    cancel() {
        this.requestSeq += 1;
        this.selectionRange = null;
        this.clearStatusTimer();
        this.dispatchStatus({ type: 'clear' });
    }

    async execute(mode) {
        if (!this.selectionRange || !this.editor?.state) return;
        if (mode === 'inspiration') {
            this.onInspiration?.({ ...this.selectionRange });
            this.selectionRange = null;
            return;
        }
        const requestId = ++this.requestSeq;
        const { from, to } = this.selectionRange;
        const sourceDoc = this.editor.state.doc;
        const sourceText = sourceDoc.textBetween(from, to, '\n', '\n');
        const selectedMarkdown = this.getRangeMarkdown?.(from, to)
            || this.getSelectedMarkdown?.()
            || this.editor.state.doc.textBetween(from, to, '\n', '\n');
        const context = buildSelectionRewriteContext(
            this.editor.state,
            selectedMarkdown,
            this.getMarkdown?.() || '',
            { from, to },
        );
        this.clearStatusTimer();
        this.dispatchStatus({
            type: 'loading',
            from,
            to,
            message: t('aiWriting.working'),
        });
        logger.info('request:start', { mode, selectionLength: sourceText.length });

        try {
            const result = await requestSelectionRewrite(mode, context);
            if (requestId !== this.requestSeq) return;
            const currentDoc = this.editor?.state?.doc;
            if (!currentDoc?.eq?.(sourceDoc)) {
                throw new Error(t('aiWriting.error.documentChanged'));
            }
            const insertedRange = this.replaceRangeWithMarkdown?.(from, to, result);
            const resultFrom = insertedRange?.from ?? from;
            const resultTo = insertedRange?.to ?? Math.min(from + result.length, this.editor.state.doc.content.size);
            this.dispatchStatus({
                type: 'success',
                from: resultFrom,
                to: resultTo,
                message: t('aiWriting.done'),
            });
            this.scheduleStatusClear(requestId);
            logger.info('request:success', { mode, outputLength: result.length });
            this.selectionRange = null;
        } catch (error) {
            if (requestId !== this.requestSeq) return;
            const pluginState = selectionRewritePluginKey.getState(this.editor?.state);
            this.dispatchStatus({
                type: 'error',
                from: pluginState?.from ?? from,
                to: pluginState?.to ?? to,
                message: error?.message || t('aiWriting.error'),
            });
            this.scheduleStatusClear(requestId);
            logger.warn('request:failed', { mode, error });
        } finally {
            if (requestId === this.requestSeq) this.selectionRange = null;
        }
    }

    /**
     * 向选区状态插件派发 UI 状态。
     * @param {object} meta - selectionRewritePluginKey transaction meta
     * @returns {void}
     */
    dispatchStatus(meta) {
        const view = this.editor?.view;
        if (!view || view.isDestroyed) return;
        view.dispatch(view.state.tr.setMeta(selectionRewritePluginKey, meta));
    }

    /** 清理延迟隐藏计时器。 */
    clearStatusTimer() {
        if (this.statusTimer !== null) {
            clearTimeout(this.statusTimer);
            this.statusTimer = null;
        }
    }

    /**
     * 成功或失败提示短暂停留后自动清理。
     * @param {number} requestId - 当前请求序号
     */
    scheduleStatusClear(requestId) {
        this.clearStatusTimer();
        this.statusTimer = setTimeout(() => {
            this.statusTimer = null;
            if (requestId === this.requestSeq) this.dispatchStatus({ type: 'clear' });
        }, RESULT_STATUS_DURATION_MS);
    }
}
