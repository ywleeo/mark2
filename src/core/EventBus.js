/**
 * 全局事件总线 - 插件间通信的核心
 */
export class EventBus {
    constructor() {
        this.listeners = new Map();
    }

    /**
     * 订阅事件
     * @param {string} event - 事件名
     * @param {Function} handler - 处理函数
     * @returns {Function} 取消订阅函数
     */
    on(event, handler) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event).add(handler);

        // 返回取消订阅函数
        return () => {
            const handlers = this.listeners.get(event);
            if (handlers) {
                handlers.delete(handler);
                if (handlers.size === 0) {
                    this.listeners.delete(event);
                }
            }
        };
    }

    /**
     * 订阅一次性事件
     */
    once(event, handler) {
        const wrapper = (...args) => {
            handler(...args);
            unsubscribe();
        };
        const unsubscribe = this.on(event, wrapper);
        return unsubscribe;
    }

    /**
     * 发布事件
     */
    emit(event, ...args) {
        const handlers = this.listeners.get(event);
        if (!handlers) return;

        handlers.forEach(handler => {
            try {
                handler(...args);
            } catch (error) {
                console.error(`[EventBus] Error in handler for "${event}":`, error);
            }
        });
    }

    /**
     * 异步发布事件（等待所有处理器完成）
     */
    async emitAsync(event, ...args) {
        const handlers = this.listeners.get(event);
        if (!handlers) return;

        await Promise.all(
            Array.from(handlers).map(async handler => {
                try {
                    await handler(...args);
                } catch (error) {
                    console.error(`[EventBus] Error in async handler for "${event}":`, error);
                }
            })
        );
    }

    /**
     * 清空所有监听器
     */
    clear() {
        this.listeners.clear();
    }

    /**
     * 获取事件监听器数量
     */
    listenerCount(event) {
        return this.listeners.get(event)?.size ?? 0;
    }
}

// 单例导出
export const eventBus = new EventBus();
