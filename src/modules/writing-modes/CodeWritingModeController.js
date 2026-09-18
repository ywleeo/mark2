/**
 * CodeMirror 写作模式控制器。
 * 复用 CodeMirror 的活动行标记实现源码专注模式，并维持光标垂直居中。
 */

import { subscribeWritingModeState } from './writingModeState.js';

/** 管理单个 CodeMirror 编辑器实例的专注与打字机交互。 */
export class CodeWritingModeController {
    /**
     * 创建控制器并订阅共享模式状态。
     * @param {{container:HTMLElement,getEditorView:Function,isApplicable?:Function}} options - CodeMirror 访问器。
     */
    constructor(options = {}) {
        this.container = options.container;
        this.getEditorView = options.getEditorView;
        this.isApplicable = options.isApplicable;
        this.state = { focusMode: false, typewriterMode: false };
        this.pendingFrame = null;
        this.resizeObserver = null;
        this.unsubscribe = subscribeWritingModeState(state => this.applyState(state));
    }

    /** 应用模式样式并刷新打字机视口。 */
    applyState(state) {
        this.state = state;
        const applicable = this.isApplicable?.() !== false;
        const focusMode = applicable && state.focusMode;
        const typewriterMode = applicable && state.typewriterMode;
        this.container?.classList.toggle('writing-focus-mode', focusMode);
        this.container?.classList.toggle('writing-typewriter-mode', typewriterMode);
        if (typewriterMode) {
            this.observeViewport();
            this.scheduleCursorCentering();
        } else {
            this.stopObservingViewport();
        }
    }

    /** 接收 CodeMirror 更新，只在选区或文档变化时重新居中。 */
    handleViewUpdate(update) {
        if (!this.state.typewriterMode || this.isApplicable?.() === false) return;
        if (update?.selectionSet || update?.docChanged || update?.geometryChanged) {
            this.scheduleCursorCentering();
        }
    }

    /** 编辑器实例创建或重建后重新挂接尺寸逻辑。 */
    refreshEditorView() {
        this.applyState(this.state);
    }

    /** 监听 CodeMirror 滚动视口尺寸。 */
    observeViewport() {
        if (this.resizeObserver || typeof ResizeObserver === 'undefined') return;
        const scroller = this.getEditorView?.()?.scrollDOM;
        if (!scroller) return;
        this.resizeObserver = new ResizeObserver(() => {
            this.scheduleCursorCentering();
        });
        this.resizeObserver.observe(scroller);
    }

    /** 停止视口尺寸监听。 */
    stopObservingViewport() {
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
    }

    /** 合并高频更新，在下一帧执行一次居中。 */
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

    /** 将 CodeMirror 主选区光标平移到滚动视口中线。 */
    centerCursor() {
        const view = this.getEditorView?.();
        const scroller = view?.scrollDOM;
        if (!this.state.typewriterMode || this.isApplicable?.() === false || !view || !scroller) return;
        const cursor = view.coordsAtPos(view.state.selection.main.head);
        if (!cursor) return;
        const viewport = scroller.getBoundingClientRect();
        const cursorCenter = (cursor.top + cursor.bottom) / 2;
        const viewportCenter = viewport.top + scroller.clientHeight / 2;
        scroller.scrollTop += cursorCenter - viewportCenter;
    }

    /** 解除订阅、观察器与临时样式。 */
    destroy() {
        this.unsubscribe?.();
        this.stopObservingViewport();
        this.container?.classList.remove('writing-focus-mode', 'writing-typewriter-mode');
        if (this.pendingFrame !== null && typeof cancelAnimationFrame === 'function') {
            cancelAnimationFrame(this.pendingFrame);
        }
        this.pendingFrame = null;
    }
}
