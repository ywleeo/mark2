/**
 * Markdown 图片的显示事务协议。
 * 只授权保留原图片路径的显示地址更新，不通过通用 metadata 放行任意文档修改。
 */
const displayTransactions = new WeakMap();

/**
 * 为已有图片创建显示事务；不改变 Markdown 路径、其他属性或撤销历史。
 * @param {import('@tiptap/pm/state').EditorState} state - 当前编辑器状态。
 * @param {number} position - 已有图片节点的位置。
 * @param {string|null} objectUrl - 本地图片的 blob 地址；外链图片传 null。
 * @returns {import('@tiptap/pm/state').Transaction} 图片显示事务。
 */
export function createImageDisplayTransaction(state, position, objectUrl = null) {
    const image = state.doc.nodeAt(position);
    if (image?.type.name !== 'image') {
        throw new TypeError('图片显示事务只能更新已有图片');
    }
    if (objectUrl !== null && (typeof objectUrl !== 'string' || !objectUrl.startsWith('blob:'))) {
        throw new TypeError('本地图片的显示地址必须为 blob URL');
    }

    const transaction = state.tr.setNodeMarkup(position, null, {
        ...image.attrs,
        src: objectUrl ?? image.attrs.src,
        dataOriginalSrc: image.attrs.dataOriginalSrc || image.attrs.src,
    }).setMeta('addToHistory', false);

    // 记录不可变文档与步骤快照，调用方追加文字编辑或源码步骤后即失去显示事务资格。
    displayTransactions.set(transaction, { doc: transaction.doc, steps: [...transaction.steps] });
    return transaction;
}

/**
 * 只接受本模块创建且没有被追加修改的事务，供只读门禁识别图片显示更新。
 * @param {import('@tiptap/pm/state').Transaction} transaction - 待检查事务。
 * @returns {boolean} 是否为完整保留的图片显示事务。
 */
export function isImageDisplayTransaction(transaction) {
    const snapshot = displayTransactions.get(transaction);
    return Boolean(snapshot
        && snapshot.doc === transaction.doc
        && snapshot.steps.length === transaction.steps.length
        && snapshot.steps.every((step, index) => step === transaction.steps[index]));
}
