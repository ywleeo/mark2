/**
 * AppBridge - App 公共能力接口
 *
 * 为插件提供统一的 API，用于：
 * - UI 操作（侧边栏、对话框、通知）
 * - 编辑器能力（获取内容、插入文本、选区）
 * - 存储能力（localStorage、配置持久化）
 * - 事件系统（全局事件总线）
 */

export class AppBridge {
    constructor(options = {}) {
        this.eventBus = options.eventBus;
        this.appContext = options.appContext || {};
    }

    // ============ UI 能力 ============

    /**
     * 显示通知
     * @param {Object} options
     * @param {string} options.message - 消息内容
     * @param {'info'|'success'|'warning'|'error'} options.type - 消息类型
     * @param {number} options.duration - 显示时长（毫秒）
     */
    showNotification(options) {
        this.eventBus?.emit('app:notification', options);
    }

    /**
     * 显示确认对话框
     * @param {Object} options
     * @param {string} options.title - 标题
     * @param {string} options.message - 消息
     * @param {string} options.confirmText - 确认按钮文本
     * @param {string} options.cancelText - 取消按钮文本
     * @returns {Promise<boolean>}
     */
    async showConfirm(options) {
        return new Promise((resolve) => {
            // 简单实现：使用浏览器原生 confirm
            // 后续可以扩展为自定义对话框
            const result = window.confirm(`${options.title}\n\n${options.message}`);
            resolve(result);
        });
    }

    /**
     * 注册侧边栏容器
     * @param {Object} options
     * @param {string} options.id - 侧边栏 ID
     * @param {HTMLElement} options.element - 容器元素
     * @param {string} options.title - 标题
     */
    registerSidebar(options) {
        // 插件不需要注册侧边栏，因为容器已由 App 提供
        // 插件只需要获取容器并渲染内容
        console.warn('[AppBridge] registerSidebar 已废弃，请直接使用 document.getElementById 获取容器');
    }

    // ============ 编辑器能力 ============

    /**
     * 获取编辑器上下文
     * @param {Object} options
     * @param {boolean} options.includeSelection - 是否包含选中内容
     * @param {boolean} options.includeFullDocument - 是否包含完整文档
     * @returns {Promise<string>}
     */
    async getEditorContext(options = {}) {
        if (typeof this.appContext.getEditorContext === 'function') {
            return await this.appContext.getEditorContext(options);
        }
        return '';
    }

    /**
     * 获取当前文档内容
     * @returns {Promise<string>}
     */
    async getDocumentContent() {
        return await this.getEditorContext({ includeFullDocument: true });
    }

    /**
     * 获取选中文本
     * @returns {Promise<string>}
     */
    async getSelectedText() {
        return await this.getEditorContext({ includeSelection: true });
    }

    /**
     * 插入文本到编辑器
     * @param {string} text
     * @param {Object} options
     * @param {'cursor'|'end'|'replace'} options.position - 插入位置
     * @returns {Promise<void>}
     */
    async insertText(text, options = {}) {
        this.eventBus?.emit('app:editor:insert', {
            text,
            position: options.position || 'cursor',
        });
    }

    /**
     * 替换选中文本
     * @param {string} text
     * @returns {Promise<void>}
     */
    async replaceSelection(text) {
        return await this.insertText(text, { position: 'replace' });
    }

    // ============ 存储能力 ============

    /**
     * 获取配置
     * @param {string} key - 配置键
     * @param {*} defaultValue - 默认值
     * @returns {*}
     */
    getConfig(key, defaultValue = null) {
        const stored = localStorage.getItem(`app:config:${key}`);
        if (stored) {
            try {
                return JSON.parse(stored);
            } catch {
                return stored;
            }
        }
        return defaultValue;
    }

    /**
     * 保存配置
     * @param {string} key - 配置键
     * @param {*} value - 配置值
     */
    setConfig(key, value) {
        const serialized = typeof value === 'string' ? value : JSON.stringify(value);
        localStorage.setItem(`app:config:${key}`, serialized);
    }

    /**
     * 删除配置
     * @param {string} key - 配置键
     */
    removeConfig(key) {
        localStorage.removeItem(`app:config:${key}`);
    }

    // ============ 事件系统 ============

    /**
     * 订阅事件
     * @param {string} event - 事件名
     * @param {Function} handler - 处理函数
     * @returns {Function} 取消订阅函数
     */
    on(event, handler) {
        return this.eventBus?.on(event, handler);
    }

    /**
     * 取消订阅事件
     * @param {string} event - 事件名
     * @param {Function} handler - 处理函数
     */
    off(event, handler) {
        this.eventBus?.off(event, handler);
    }

    /**
     * 发送事件
     * @param {string} event - 事件名
     * @param {*} data - 事件数据
     */
    emit(event, data) {
        this.eventBus?.emit(event, data);
    }

    /**
     * 订阅一次性事件
     * @param {string} event - 事件名
     * @param {Function} handler - 处理函数
     */
    once(event, handler) {
        const wrappedHandler = (data) => {
            handler(data);
            this.off(event, wrappedHandler);
        };
        this.on(event, wrappedHandler);
    }

    // ============ 其他能力 ============

    /**
     * 获取当前视图模式
     * @returns {string} 'markdown' | 'code' | 'image' | 'unsupported'
     */
    getActiveViewMode() {
        return this.appContext.getActiveViewMode?.() || 'markdown';
    }

    /**
     * 获取 App 版本
     * @returns {string}
     */
    getAppVersion() {
        return this.appContext.version || '1.0.0';
    }
}
