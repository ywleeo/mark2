/**
 * 对比已写入磁盘的快照与编辑器当前内容。
 * 保存期间继续发生的编辑必须保持 dirty，不能被旧写入结果清除。
 * @param {string} savedContent - 本次实际写入磁盘的内容
 * @param {string} currentContent - 写盘完成时编辑器中的最新内容
 * @returns {{savedContent:string,currentContent:string,pendingChanges:boolean}}
 */
export function reconcileSavedSnapshot(savedContent, currentContent) {
    const saved = typeof savedContent === 'string' ? savedContent : '';
    const current = typeof currentContent === 'string' ? currentContent : '';
    return {
        savedContent: saved,
        currentContent: current,
        pendingChanges: current !== saved,
    };
}
