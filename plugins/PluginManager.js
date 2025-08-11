/**
 * 插件管理器
 * 负责加载、管理和协调所有插件
 */

const BasePlugin = require('./BasePlugin');
const path = require('path');
const fs = require('fs');

class PluginManager {
    constructor() {
        this.plugins = new Map(); // 存储已加载的插件
        this.eventListeners = new Map(); // 存储事件监听器
        this.pluginDirectory = path.join(__dirname); // 插件目录
        this.initialized = false;
    }

    /**
     * 初始化插件管理器
     */
    async init() {
        if (this.initialized) return;

        console.log('[插件管理器] 正在初始化...');
        
        // 加载所有插件
        await this.loadAllPlugins();
        
        this.initialized = true;
        console.log('[插件管理器] 初始化完成');
        
        // 触发插件管理器初始化事件
        this.emit('pluginManager:initialized');
    }

    /**
     * 加载所有插件
     */
    async loadAllPlugins() {
        try {
            // 读取插件目录
            const items = fs.readdirSync(this.pluginDirectory, { withFileTypes: true });
            
            for (const item of items) {
                if (item.isDirectory() && !item.name.startsWith('.')) {
                    await this.loadPlugin(item.name);
                }
            }
        } catch (error) {
            console.warn('[插件管理器] 加载插件失败:', error);
        }
    }

    /**
     * 加载单个插件
     * @param {string} pluginName - 插件名称（目录名）
     */
    async loadPlugin(pluginName) {
        try {
            const pluginPath = path.join(this.pluginDirectory, pluginName);
            
            // 检查插件目录是否存在
            if (!fs.existsSync(pluginPath)) {
                console.warn(`[插件管理器] 插件目录不存在: ${pluginPath}`);
                return;
            }

            // 读取插件配置
            const configPath = path.join(pluginPath, 'config.json');
            let pluginConfig = {};
            
            if (fs.existsSync(configPath)) {
                const configContent = fs.readFileSync(configPath, 'utf-8');
                pluginConfig = JSON.parse(configContent);
            }

            // 读取插件主文件
            const indexPath = path.join(pluginPath, 'index.js');
            if (!fs.existsSync(indexPath)) {
                console.warn(`[插件管理器] 插件主文件不存在: ${indexPath}`);
                return;
            }

            // 动态加载插件类
            delete require.cache[require.resolve(indexPath)]; // 清除缓存以支持热重载
            const PluginClass = require(indexPath);
            
            // 创建插件实例
            const pluginInstance = new PluginClass({
                id: pluginName,
                ...pluginConfig
            });

            // 验证插件是否继承自 BasePlugin
            if (!(pluginInstance instanceof BasePlugin)) {
                console.warn(`[插件管理器] 插件 ${pluginName} 必须继承自 BasePlugin`);
                return;
            }

            // 注入平台 API
            pluginInstance.api = window.platformAPI;
            
            // 初始化插件
            await pluginInstance.init();
            
            // 存储插件
            this.plugins.set(pluginName, pluginInstance);
            
            console.log(`[插件管理器] 插件 ${pluginInstance.name} 加载成功`);
            
            // 触发插件加载事件
            this.emit('plugin:loaded', { plugin: pluginInstance });
            
        } catch (error) {
            console.error(`[插件管理器] 加载插件 ${pluginName} 失败:`, error);
        }
    }

    /**
     * 卸载插件
     * @param {string} pluginName - 插件名称
     */
    async unloadPlugin(pluginName) {
        const plugin = this.plugins.get(pluginName);
        if (!plugin) return;

        try {
            // 销毁插件
            await plugin.destroy();
            
            // 从插件列表中移除
            this.plugins.delete(pluginName);
            
            console.log(`[插件管理器] 插件 ${plugin.name} 卸载成功`);
            
            // 触发插件卸载事件
            this.emit('plugin:unloaded', { plugin });
            
        } catch (error) {
            console.error(`[插件管理器] 卸载插件 ${pluginName} 失败:`, error);
        }
    }

    /**
     * 重新加载插件
     * @param {string} pluginName - 插件名称
     */
    async reloadPlugin(pluginName) {
        await this.unloadPlugin(pluginName);
        await this.loadPlugin(pluginName);
    }

    /**
     * 获取插件实例
     * @param {string} pluginName - 插件名称
     */
    getPlugin(pluginName) {
        return this.plugins.get(pluginName);
    }

    /**
     * 获取所有插件
     */
    getAllPlugins() {
        return Array.from(this.plugins.values());
    }

    /**
     * 获取启用的插件
     */
    getEnabledPlugins() {
        return this.getAllPlugins().filter(plugin => plugin.isActive());
    }

    /**
     * 处理 Markdown 渲染
     * 按顺序调用所有启用插件的 processMarkdown 方法
     * @param {string} html - 输入的 HTML 内容
     * @returns {string} - 处理后的 HTML 内容
     */
    processMarkdown(html) {
        let result = html;
        
        const enabledPlugins = this.getEnabledPlugins();
        
        for (const plugin of enabledPlugins) {
            try {
                result = plugin.processMarkdown(result);
            } catch (error) {
                console.warn(`[插件管理器] 插件 ${plugin.name} 处理 Markdown 失败:`, error);
            }
        }
        
        return result;
    }

    /**
     * 处理编辑器内容
     * 调用所有启用插件的 processEditor 方法
     * @param {object} editor - CodeMirror 编辑器实例
     */
    processEditor(editor) {
        const enabledPlugins = this.getEnabledPlugins();
        
        for (const plugin of enabledPlugins) {
            try {
                plugin.processEditor(editor);
            } catch (error) {
                console.warn(`[插件管理器] 插件 ${plugin.name} 处理编辑器失败:`, error);
            }
        }
    }

    /**
     * 触发事件
     * @param {string} eventName - 事件名称
     * @param {object} data - 事件数据
     */
    emit(eventName, data) {
        const listeners = this.eventListeners.get(eventName);
        if (listeners) {
            listeners.forEach(listener => {
                try {
                    listener(data);
                } catch (error) {
                    console.warn(`[插件管理器] 事件 ${eventName} 处理失败:`, error);
                }
            });
        }
    }

    /**
     * 监听事件
     * @param {string} eventName - 事件名称
     * @param {function} handler - 事件处理函数
     */
    on(eventName, handler) {
        if (!this.eventListeners.has(eventName)) {
            this.eventListeners.set(eventName, []);
        }
        this.eventListeners.get(eventName).push(handler);
    }

    /**
     * 移除事件监听器
     * @param {string} eventName - 事件名称
     * @param {function} handler - 事件处理函数
     */
    off(eventName, handler) {
        const listeners = this.eventListeners.get(eventName);
        if (listeners) {
            const index = listeners.indexOf(handler);
            if (index > -1) {
                listeners.splice(index, 1);
            }
        }
    }

    /**
     * 销毁插件管理器
     */
    async destroy() {
        if (!this.initialized) return;

        console.log('[插件管理器] 正在销毁...');
        
        // 销毁所有插件
        for (const [pluginName, plugin] of this.plugins) {
            try {
                await plugin.destroy();
            } catch (error) {
                console.warn(`[插件管理器] 销毁插件 ${pluginName} 失败:`, error);
            }
        }
        
        // 清除所有数据
        this.plugins.clear();
        this.eventListeners.clear();
        this.initialized = false;
        
        console.log('[插件管理器] 销毁完成');
    }
}

module.exports = PluginManager;