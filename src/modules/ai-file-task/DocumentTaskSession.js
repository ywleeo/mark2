/**
 * 管理浮动面板中的单次文档任务，防止关闭、重开或切换来源后旧请求回写 UI。
 */
export class DocumentTaskSession {
    constructor() {
        this.sequence = 0;
    }

    /**
     * 创建绑定源文件的请求快照。
     * @param {string} sourcePath - 请求开始时的源文件
     * @returns {{id:number,sourcePath:string}}
     */
    begin(sourcePath) {
        this.sequence += 1;
        return { id: this.sequence, sourcePath };
    }

    /**
     * 使当前请求立即失效。
     */
    cancel() {
        this.sequence += 1;
    }

    /**
     * 判断结果是否仍属于当前面板会话。
     * @param {{id:number}|null} snapshot - 请求快照
     * @returns {boolean}
     */
    isCurrent(snapshot) {
        return Boolean(snapshot && snapshot.id === this.sequence);
    }
}
