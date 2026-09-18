/**
 * TipTap 写作模式控制器。
 * 专注模式标记当前顶层内容块；打字机模式把光标所在行维持在视口中部。
 */

import { subscribeWritingModeState } from './writingModeState.js';
import {
    createMarkdownFocusModePlugin,
    markdownFocusModePluginKey,
} from './MarkdownFocusModePlugin.js';

/** 管理单个 TipTap 编辑器实例的专注与打字机交互。 */
export class MarkdownWritingModeController {
    /**
     * 创建控制器并订阅共享模式状态。
     * @param {{getEditor:Function,getViewElement:Function,getScrollContainer:Function}} options - 编辑器访问器。
     */
    constructor(options = {}) {
        this.getEditor = options.getEditor;
        this.getViewElement = options.getViewElement;
        this.getScrollContainer = options.getScrollContainer;
        this.state = { focusMode: false, typewriterMode: false };
        this.pendingFrame = null;
        this.resizeObserver = null;
        this.observedScrollContainer = null;

        this.getEditor?.()?.registerPlugin?.(createMarkdownFocusModePlugin());
        this.handleEditorActivity = () => this.refresh();
        this.unsubscribe = subscribeWritingModeState(state => this.applyState(state));
        this.bindEditorEvents();
    }

    /** 绑定 TipTap 选择和文档事务事件。 */
    bindEditorEvents() {
        const editor = this.getEditor?.();
        editor?.on?.('selectionUpdate', this.handleEditorActivity);
        editor?.on?.('transaction', this.handleEditorActivity);
        editor?.on?.('focus', this.handleEditorActivity);
    }

    /** 应用共享状态并刷新当前块与光标位置。 */
    applyState(state) {
        this.state = state;
        const viewElement = this.getViewElement?.();
        viewElement?.classList.toggle('writing-focus-mode', state.focusMode);
        viewElement?.classList.toggle('writing-typewriter-mode', state.typewriterMode);
        viewElement?.classList.toggle('has-writing-focus-block', state.focusMode);
        this.setFocusModeEnabled(state.focusMode);

        if (state.typewriterMode) {
            this.observeViewport();
        } else {
            this.stopObservingViewport();
        }
        this.refresh();
    }

    /** 将专注模式开关写入 ProseMirror 插件状态。 */
    setFocusModeEnabled(enabled) {
        const editor = this.getEditor?.();
        if (!editor?.view || markdownFocusModePluginKey.getState(editor.state) === enabled) return;
        editor.view.dispatch(editor.state.tr.setMeta(markdownFocusModePluginKey, { enabled }));
    }

    /** 根据当前选区按需居中光标。 */
    refresh() {
        if (this.state.typewriterMode) this.scheduleCursorCentering();
    }

    /** 监听视口尺寸变化，重新计算当前光标的居中位置。 */
    observeViewport() {
        const scrollContainer = this.getScrollContainer?.();
        if (!scrollContainer) return;
        if (this.observedScrollContainer === scrollContainer) return;
        this.stopObservingViewport();
        if (typeof ResizeObserver === 'undefined') return;
        this.resizeObserver = new ResizeObserver(() => {
            this.scheduleCursorCentering();
        });
        this.resizeObserver.observe(scrollContainer);
        this.observedScrollContainer = scrollContainer;
    }

    /** 停止视口监听。 */
    stopObservingViewport() {
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
        this.observedScrollContainer = null;
    }

    /** 合并高频选区事件，在下一帧只执行一次光标居中。 */
    scheduleCursorCentering() {
        if (this.pendingFrame !== null) return;
        const schedule = typeof requestAnimationFrame === 'function'
            ? requestAnimationFrame
            : callback => setTimeout(callback, 0);
        this.pendingFrame = schedule(() => {
            this.pendingFrame = null;
            this.centerCursor();
        });
    }

    /** 计算光标相对滚动容器的位置，并把它平移到视口中线。 */
    centerCursor() {
        const editor = this.getEditor?.();
        const scrollContainer = this.getScrollContainer?.();
        if (!this.state.typewriterMode || !editor?.view || !scrollContainer) return;

        try {
            const cursor = editor.view.coordsAtPos(editor.state.selection.head);
            const viewport = scrollContainer.getBoundingClientRect();
            const cursorCenter = (cursor.top + cursor.bottom) / 2;
            const viewportCenter = viewport.top + scrollContainer.clientHeight / 2;
            scrollContainer.scrollTop += cursorCenter - viewportCenter;
        } catch (error) {
            console.warn('[MarkdownWritingMode] 光标居中失败', error);
        }
    }

    /** 解除事件、订阅和临时样式。 */
    destroy() {
        const editor = this.getEditor?.();
        editor?.off?.('selectionUpdate', this.handleEditorActivity);
        editor?.off?.('transaction', this.handleEditorActivity);
        editor?.off?.('focus', this.handleEditorActivity);
        this.unsubscribe?.();
        this.stopObservingViewport();
        editor?.unregisterPlugin?.(markdownFocusModePluginKey);
        const viewElement = this.getViewElement?.();
        viewElement?.classList.remove(
            'writing-focus-mode',
            'writing-typewriter-mode',
            'has-writing-focus-block',
        );
        if (this.pendingFrame !== null && typeof cancelAnimationFrame === 'function') {
            cancelAnimationFrame(this.pendingFrame);
        }
        this.pendingFrame = null;
    }
}
