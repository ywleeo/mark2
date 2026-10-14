/** AI 对话耗时：以单调时钟计算完整任务时间，与网络无响应计时互相独立。 */

/** 用固定宽度的时分秒显示耗时，小时只在需要时出现。 */
export function formatTaskDuration(durationMs) {
    const seconds = Math.floor(Math.max(0, Number.isFinite(durationMs) ? durationMs : 0) / 1000);
    const parts = [Math.floor(seconds / 60) % 60, seconds % 60];
    if (seconds >= 3600) parts.unshift(Math.floor(seconds / 3600));
    return parts.map(value => String(value).padStart(2, '0')).join(':');
}

/** 只在运行期间刷新文字；后台延迟不会造成计时漂移。 */
export class DocumentTaskTimer {
    /** 注入时钟便于验证取消和重试，刷新回调仅更新耗时文字。 */
    constructor({ now = () => performance.now(), onTick = () => {} } = {}) {
        this.now = now;
        this.onTick = onTick;
        this.startedAt = null;
        this.durationMs = 0;
        this.interval = null;
    }

    /** 每次发送重新计时，覆盖文件读取、工具调用及完整生成。 */
    start() {
        this.stop();
        this.startedAt = this.now();
        this.durationMs = 0;
        this.onTick(this.elapsed());
        this.interval = setInterval(() => this.onTick(this.elapsed()), 1000);
    }

    /** 读取真实耗时，不依赖定时器触发次数或本地时钟变更。 */
    elapsed() {
        return this.startedAt === null ? this.durationMs : Math.max(0, this.now() - this.startedAt);
    }

    /** 完成、取消、关闭或销毁时释放刷新器，并保留最终耗时。 */
    stop() {
        this.durationMs = this.elapsed();
        this.startedAt = null;
        clearInterval(this.interval);
        this.interval = null;
        return this.durationMs;
    }
}
