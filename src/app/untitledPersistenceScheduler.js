/**
 * 创建 untitled 工作区持久化调度器。
 * 仅临时文档发生编辑时防抖落快照，普通磁盘文件不进入此链路。
 * @param {Object} options - 调度器依赖
 * @param {()=>string|null} options.getCurrentFile - 获取当前文档路径
 * @param {(path:string)=>boolean} options.isUntitledPath - 判断临时文档路径
 * @param {()=>void} options.persistWorkspaceState - 持久化工作区快照
 * @param {number} [options.delay=200] - 防抖时间
 * @returns {{schedule:()=>void,cancel:()=>void}} 调度协议
 */
export function createUntitledPersistenceScheduler({
    getCurrentFile,
    isUntitledPath,
    persistWorkspaceState,
    delay = 200,
}) {
    let timer = null;

    /** 取消尚未执行的持久化任务。 */
    function cancel() {
        if (timer === null) return;
        clearTimeout(timer);
        timer = null;
    }

    /** 在当前文档为 untitled 时重新安排一次工作区持久化。 */
    function schedule() {
        const currentFile = getCurrentFile?.();
        if (!isUntitledPath?.(currentFile) || typeof persistWorkspaceState !== 'function') return;
        cancel();
        timer = setTimeout(() => {
            timer = null;
            persistWorkspaceState();
        }, delay);
    }

    return { schedule, cancel };
}
