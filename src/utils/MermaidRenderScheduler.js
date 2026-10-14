/** Mermaid 的串行渲染调度与有界主题缓存，不占用应用全局状态。 */

/** 让浏览器处理绘制和输入；隐藏窗口也能继续完成图表，不依赖 requestAnimationFrame。 */
function yieldToBrowser() {
    return new Promise(resolve => setTimeout(resolve, 0));
}

/** 同一图块的重复请求合并，旧请求取消写回，当前视口内的工作优先。 */
export class MermaidRenderScheduler {
    /** 注入时钟和让步函数，确保竞态、缓存和调度行为可独立验证。 */
    constructor({ yieldControl = yieldToBrowser, now = () => performance.now(),
        budgetMs = 8, maxEntries = 100, maxBytes = 8 * 1024 * 1024 } = {}) {
        this.yieldControl = yieldControl;
        this.now = now;
        this.budgetMs = budgetMs;
        this.maxEntries = maxEntries;
        this.maxBytes = maxBytes;
        this.cache = new Map();
        this.cacheBytes = 0;
        this.jobs = new WeakMap();
        this.queue = [];
        this.running = false;
    }

    /** 读取时提升 LRU 优先级，明暗来回切换无需重新布局。 */
    getCached(key) {
        const entry = this.cache.get(key);
        if (!entry) return null;
        this.cache.delete(key);
        this.cache.set(key, entry);
        return entry.value;
    }

    /** 同时限制图表数量与 SVG 字符串内存；超大单图不进入长期缓存。 */
    setCached(key, value) {
        const bytes = (key.length + value.svg.length) * 2;
        const previous = this.cache.get(key);
        if (previous) { this.cacheBytes -= previous.bytes; this.cache.delete(key); }
        if (bytes > this.maxBytes) return;
        this.cache.set(key, { value, bytes });
        this.cacheBytes += bytes;
        while (this.cache.size > this.maxEntries || this.cacheBytes > this.maxBytes) {
            const oldest = this.cache.keys().next().value;
            this.cacheBytes -= this.cache.get(oldest).bytes;
            this.cache.delete(oldest);
        }
    }

    /** 仅手动清缓存或销毁时使用，主题切换保留各主题的 SVG。 */
    clearCache() { this.cache.clear(); this.cacheBytes = 0; }

    /** 将一个图块加入队列；同源同主题合并，换源码或主题后旧结果失效。 */
    enqueue({ element, key, isCurrent, priority = () => 0, run }) {
        const existing = this.jobs.get(element);
        if (existing?.key === key && existing.isCurrent()) return existing.promise;
        const job = { element, key, isCurrent, priority, run };
        job.promise = new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject; });
        this.jobs.set(element, job);
        this.queue.push(job);
        // 在微任务内启动，让同批请求先完成登记，避免同时初始化 Mermaid 的全局配置。
        if (!this.running) { this.running = true; queueMicrotask(() => { void this.drain(); }); }
        return job.promise;
    }

    /** 每次完成绘制后重新读取优先级，滚动到后面的图也能插队。 */
    nextJob() {
        let best = 0;
        let priority = Infinity;
        for (let index = 0; index < this.queue.length; index += 1) {
            const job = this.queue[index];
            if (this.jobs.get(job.element) !== job || !job.isCurrent()) return this.queue.splice(index, 1)[0];
            const value = job.priority();
            if (value < priority) { priority = value; best = index; }
            if (priority === 0) break;
        }
        return this.queue.splice(best, 1)[0];
    }

    /** 全局只有一个实际绘制任务；超过时间预算即让出线程，逐图隔离错误。 */
    async drain() {
        let sliceStart = this.now();
        try {
            while (this.queue.length) {
                const job = this.nextJob();
                /** 异步绘制返回后也必须复查，避免覆盖已经切换的主题或文档。 */
                const shouldCommit = () => this.jobs.get(job.element) === job && job.isCurrent();
                try {
                    job.resolve(shouldCommit() ? await job.run(shouldCommit) : undefined);
                } catch (error) {
                    job.reject(error);
                } finally {
                    if (this.jobs.get(job.element) === job) this.jobs.delete(job.element);
                }
                if (this.queue.length && this.now() - sliceStart >= this.budgetMs) {
                    await this.yieldControl();
                    sliceStart = this.now();
                }
            }
        } finally { this.running = false; }
    }
}

/** 离屏图表接近视口时再交给渲染队列，移走的文档不保留观察任务。 */
export class MermaidViewportObserver {
    /** 观察器按需创建，注入接口让滚动和节点移除行为可独立测试。 */
    constructor({ onVisible, createObserver = callback => new IntersectionObserver(callback,
        { rootMargin: '600px 0px' }) }) {
        this.onVisible = onVisible;
        this.createObserver = createObserver;
        this.observer = null;
        this.elements = new Set();
    }

    /** 同一个图块只观察一次；主题变化时回调重新读取当前主题。 */
    defer(element) {
        if (this.elements.has(element)) return;
        if (!this.observer) {
            this.observer = this.createObserver(entries => {
                for (const entry of entries) {
                    if (!this.elements.has(entry.target)) continue;
                    if (!entry.target.isConnected || entry.isIntersecting) {
                        this.forget(entry.target);
                        if (entry.target.isConnected) this.onVisible(entry.target);
                    }
                }
            });
        }
        this.elements.add(element);
        this.observer.observe(element);
    }

    /** 已渲染或已移除的图块解除观察，最后一个任务结束时释放原生观察器。 */
    forget(element) {
        if (!this.elements.delete(element)) return;
        this.observer?.unobserve(element);
        if (!this.elements.size) { this.observer?.disconnect(); this.observer = null; }
    }

    /** 切换文件时及时释放上一篇文档的节点引用。 */
    pruneDisconnected() {
        for (const element of this.elements) if (!element.isConnected) this.forget(element);
    }
}
