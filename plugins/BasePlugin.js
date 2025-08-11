/**
 * 插件基类
 * 所有插件都继承此类，提供统一的生命周期管理和平台API访问
 */

class BasePlugin {
    constructor(pluginConfig = {}) {
        this.id = pluginConfig.id || 'unknown';
        this.name = pluginConfig.name || 'Unknown Plugin';
        this.version = pluginConfig.version || '1.0.0';
        this.enabled = pluginConfig.enabled !== false; // 默认启用
        this.config = pluginConfig.config || {};
        this.initialized = false;
        
        // 提供平台 API 访问
        this.api = null; // 在初始化时赋值
    }

    /**
     * 初始化插件
     * 子类可以重写此方法进行初始化操作
     */
    async init() {
        if (this.initialized) return;
        
        console.log(`[插件] ${this.name} 正在初始化...`);
        this.initialized = true;
        
        // 触发初始化事件
        this.emit('plugin:initialized', { plugin: this });
    }

    /**
     * 销毁插件
     * 子类应该重写此方法进行清理操作
     */
    async destroy() {
        if (!this.initialized) return;
        
        console.log(`[插件] ${this.name} 正在销毁...`);
        this.initialized = false;
        
        // 触发销毁事件
        this.emit('plugin:destroyed', { plugin: this });
    }

    /**
     * 处理 Markdown 渲染
     * 插件可以重写此方法来处理 HTML 内容
     * @param {string} html - 输入的 HTML 内容
     * @returns {string} - 处理后的 HTML 内容
     */
    processMarkdown(html) {
        return html; // 默认不处理，直接返回原始内容
    }

    /**
     * 处理编辑器内容
     * 插件可以重写此方法来处理编辑器交互
     * @param {object} editor - CodeMirror 编辑器实例
     */
    processEditor(editor) {
        // 默认不处理
    }

    /**
     * 触发事件
     * @param {string} eventName - 事件名称
     * @param {object} data - 事件数据
     */
    emit(eventName, data) {
        if (window.pluginManager) {
            window.pluginManager.emit(eventName, data);
        }
    }

    /**
     * 监听事件
     * @param {string} eventName - 事件名称
     * @param {function} handler - 事件处理函数
     */
    on(eventName, handler) {
        if (window.pluginManager) {
            window.pluginManager.on(eventName, handler);
        }
    }

    /**
     * 启用插件
     */
    enable() {
        this.enabled = true;
        this.emit('plugin:enabled', { plugin: this });
    }

    /**
     * 禁用插件
     */
    disable() {
        this.enabled = false;
        this.emit('plugin:disabled', { plugin: this });
    }

    /**
     * 检查插件是否启用且已初始化
     */
    isActive() {
        return this.enabled && this.initialized;
    }

    /**
     * 获取插件配置
     */
    getConfig(key) {
        if (key) {
            return this.config[key];
        }
        return this.config;
    }

    /**
     * 更新插件配置
     */
    updateConfig(config) {
        this.config = { ...this.config, ...config };
        this.emit('plugin:config-updated', { plugin: this, config: this.config });
    }
}

module.exports = BasePlugin;