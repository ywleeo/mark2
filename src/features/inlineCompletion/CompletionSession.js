/**
 * 管理一次内联续写请求的编辑器快照，阻止旧结果回填到已变化的文档。
 */
export class CompletionSession {
    constructor() {
        this.sequence = 0;
    }

    /**
     * 开始新请求并记录文档、选区快照。
     * @param {import('@tiptap/pm/view').EditorView} view - ProseMirror view
     * @returns {{id:number,doc:object,from:number,to:number}} 请求快照
     */
    begin(view) {
        const { state } = view;
        return {
            id: ++this.sequence,
            doc: state.doc,
            from: state.selection.from,
            to: state.selection.to,
        };
    }

    /** 让当前请求失效。 */
    cancel() {
        this.sequence += 1;
    }

    /**
     * 判断请求返回时编辑器是否仍停留在原始内容和光标位置。
     * @param {object} snapshot - begin 返回的快照
     * @param {import('@tiptap/pm/view').EditorView} view - 当前 view
     * @returns {boolean} 是否仍可展示结果
     */
    isCurrent(snapshot, view) {
        if (!snapshot || !view || view.isDestroyed || snapshot.id !== this.sequence) return false;
        const { state } = view;
        return state.doc.eq(snapshot.doc)
            && state.selection.from === snapshot.from
            && state.selection.to === snapshot.to;
    }
}
