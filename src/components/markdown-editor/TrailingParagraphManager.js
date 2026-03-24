import { TRAILING_PARAGRAPH_NODE_TYPES } from './constants.js';

/**
 * 确保编辑器文档末尾始终有一个空段落节点。
 * 这解决了代码块/表格等块级节点作为文档最后一个节点时，
 * 用户无法在其后继续输入的问题。
 */
export class TrailingParagraphManager {
    constructor({ getEditor, isUpdateSuppressed, setUpdateSuppressed }) {
        this.getEditor = getEditor;
        this.isUpdateSuppressed = isUpdateSuppressed;
        this.setUpdateSuppressed = setUpdateSuppressed;
        this._frame = null;
    }

    /** 延迟调度（合并连续的多次调用为一次） */
    schedule() {
        if (this._frame !== null) return;
        this._frame = requestAnimationFrame(() => {
            this._frame = null;
            this.ensure();
        });
    }

    /** 立即执行，确保文档末尾有段落节点 */
    ensure(options = {}) {
        const editor = this.getEditor();
        if (!editor?.state?.doc) return false;

        const { preserveSelection = true } = options;
        const doc = editor.state.doc;
        const wasDocEmpty = doc.childCount === 0;
        const lastTypeName = doc.lastChild?.type?.name ?? null;

        if (lastTypeName === 'paragraph') return false;

        const shouldForce = !doc.lastChild || (lastTypeName && TRAILING_PARAGRAPH_NODE_TYPES.has(lastTypeName));
        if (!shouldForce) return false;

        const paragraphType = editor.state.schema.nodes.paragraph;
        if (!paragraphType) return false;

        const previousSelection = preserveSelection ? editor.state.selection : null;
        const previousSuppress = this.isUpdateSuppressed();
        this.setUpdateSuppressed(true);
        try {
            const tr = editor.state.tr.insert(doc.content.size, paragraphType.create());
            tr.setMeta('addToHistory', false);
            editor.view.dispatch(tr);
            if (!editor.state?.doc) return true;

            if (wasDocEmpty) {
                editor.commands.setTextSelection({ from: 1, to: 1 });
            } else if (previousSelection) {
                const docSize = editor.state.doc.content.size;
                const clamp = (v) => Math.max(0, Math.min(v, docSize));
                editor.commands.setTextSelection({
                    from: clamp(previousSelection.from),
                    to: clamp(previousSelection.to),
                });
            }
        } catch (error) {
            console.warn('[TrailingParagraphManager] 追加结尾段落失败', error);
        } finally {
            this.setUpdateSuppressed(previousSuppress);
        }
        return true;
    }

    destroy() {
        if (this._frame !== null) {
            cancelAnimationFrame(this._frame);
            this._frame = null;
        }
    }
}
