/**
 * 管理编辑器的焦点行为：
 * - 强制失焦
 * - 异步聚焦（RAF，支持指定位置/选区）
 * - 点击空白区域时自动聚焦
 */
export class FocusManager {
    constructor({ getEditor, getViewElement, getCurrentFile, onEmptyAreaClick }) {
        this.getEditor = getEditor;
        this.getViewElement = getViewElement;
        this.getCurrentFile = getCurrentFile;
        // 回调：用户点击空白区域时触发，参数 isEmpty: boolean
        this.onEmptyAreaClick = onEmptyAreaClick;
        this._mouseDownHandler = null;
        this._focusTarget = null;
    }

    /** 强制编辑器 DOM 失焦，同时清除浏览器选区 */
    forceBlur() {
        const dom = this.getEditor()?.view?.dom;
        if (dom && typeof dom.blur === 'function') dom.blur();
        window.getSelection?.()?.removeAllRanges?.();
    }

    /** 使用 RAF 异步聚焦，支持指定 position 或 selection */
    scheduleEditorFocus(options = {}) {
        const { position = null, selection = null } = options ?? {};
        const apply = () => {
            const editor = this.getEditor();
            if (!editor?.commands?.focus) return;
            position ? editor.commands.focus(position) : editor.commands.focus();
            if (selection && typeof editor.commands.setTextSelection === 'function') {
                editor.commands.setTextSelection(selection);
            }
            editor.view?.dom?.focus?.({ preventScroll: true });
        };
        typeof requestAnimationFrame === 'function' ? requestAnimationFrame(apply) : apply();
    }

    /** 检查编辑器内容是否为空 */
    isContentEmpty() {
        const editor = this.getEditor();
        if (!editor) return true;
        if (typeof editor.isEmpty === 'function') {
            try { return editor.isEmpty(); } catch (_) { /* fallthrough */ }
        }
        const doc = editor.state?.doc;
        if (!doc || doc.childCount === 0) return true;
        if (doc.childCount === 1) {
            const first = doc.child(0);
            if (first?.type?.name === 'paragraph' && first.content.size === 0) return true;
        }
        return (doc.textContent || '').trim().length === 0;
    }

    /** 监听 .markdown-content 上的 mousedown，点击空白区域时聚焦编辑器 */
    setup() {
        const viewElement = this.getViewElement();
        const markdownContent = viewElement?.querySelector('.markdown-content');
        if (!markdownContent) return;

        this._mouseDownHandler = (event) => {
            const editor = this.getEditor();
            if (!editor?.isEditable || !this.getCurrentFile()) return;
            if (!markdownContent.contains(event.target)) return;

            // 落在 .markdown-content 左右 padding（编辑器宿主之外）的点击不处理，
            // 否则会触发 focus('start') 把光标拉到文首、滚动条跳回顶部。
            const host = markdownContent.querySelector('[data-markdown-editor-host]');
            if (host) {
                const rect = host.getBoundingClientRect();
                if (event.clientX < rect.left || event.clientX > rect.right) return;
            }

            const isInsideEditor = event.target.closest('[data-markdown-editor-host]') !== null;
            const isEmpty = this.isContentEmpty();
            if (!isInsideEditor || (isInsideEditor && isEmpty)) {
                event.preventDefault();
                this.onEmptyAreaClick?.(isEmpty);
            }
        };

        this._focusTarget = markdownContent;
        markdownContent.addEventListener('mousedown', this._mouseDownHandler);
    }

    destroy() {
        if (this._focusTarget && this._mouseDownHandler) {
            this._focusTarget.removeEventListener('mousedown', this._mouseDownHandler);
            this._mouseDownHandler = null;
            this._focusTarget = null;
        }
    }
}
