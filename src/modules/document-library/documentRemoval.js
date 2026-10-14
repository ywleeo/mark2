/** 文档列表的移除事务：保存/关闭成功后移除索引，再按列表位置选择邻居。 */
import { getPathIdentityKey } from '../../utils/pathUtils.js';

/** 串行执行列表操作，避免连续点击减号时关闭和打开相互覆盖。 */
export function createDocumentRemovalAction({ getEntries, getCurrentPath, isOpen, close, select, removeRecord }) {
    let pending = Promise.resolve();
    /** 操作开始时读取真实顺序；保存期间的置顶不会改变用户点击时的邻居。 */
    const remove = async path => {
        const key = getPathIdentityKey(path);
        const entries = getEntries();
        const index = entries.findIndex(entry => getPathIdentityKey(entry.path) === key);
        if (index < 0) return false;
        const wasActive = getPathIdentityKey(getCurrentPath()) === key;
        const candidates = [...entries.slice(index + 1), ...entries.slice(0, index).reverse()];
        if (isOpen(path)) {
            await close(path, { suppressFallback: wasActive });
            // 原有关闭流程在取消确认或保存失败时保留文档；不能先删掉它的入口。
            if (isOpen(path)) return false;
        }
        removeRecord(path);
        // 关闭期间若用户已经切换到另一篇文档，不再覆盖其选择。
        if (wasActive && !getCurrentPath()) {
            for (const candidate of candidates) {
                if (!getEntries().some(entry => getPathIdentityKey(entry.path) === getPathIdentityKey(candidate.path))) continue;
                if (await select(candidate.path)) break;
            }
        }
        return true;
    };
    /** 一次操作失败不会阻塞后续移除；错误仍交给当前动作的界面反馈。 */
    return path => {
        const operation = pending.then(() => remove(path));
        pending = operation.catch(() => {});
        return operation;
    };
}
