/**
 * 插件系统集成
 * 负责在渲染进程中初始化和集成插件系统
 */

class PluginIntegration {
    constructor() {
        this.pluginManager = null;
        this.initialized = false;
    }

    /**
     * 初始化插件系统
     */
    async init() {
        if (this.initialized) return;

        try {
            // 确保平台 API 已加载
            if (!window.platformAPI) {
                const PlatformAPI = require('./PlatformAPI');
                // PlatformAPI 在加载时会自动创建 window.platformAPI
            }
            
            // 动态加载插件管理器
            const PluginManager = require('../../plugins/PluginManager');
            
            // 创建插件管理器实例
            this.pluginManager = new PluginManager();
            
            // 将插件管理器暴露到全局，供其他组件使用
            window.pluginManager = this.pluginManager;
            
            // 初始化插件管理器
            await this.pluginManager.init();
            
            // 集成到现有系统中
            this.integrateWithExistingSystems();
            
            this.initialized = true;
            // console.log('[插件系统] 初始化完成');
            
        } catch (error) {
            console.error('[插件系统] 初始化失败:', error);
        }
    }

    /**
     * 集成到现有系统中
     */
    integrateWithExistingSystems() {
        // 集成到 MarkdownRenderer
        this.integrateWithMarkdownRenderer();
        
        // 集成到编辑器系统
        this.integrateWithEditor();
        
        // 添加菜单选项
        this.integrateWithMenu();
    }

    /**
     * 集成到 Markdown 渲染器
     */
    integrateWithMarkdownRenderer() {
        // 保存原始的关键词高亮方法
        if (window.MarkdownRenderer && window.MarkdownRenderer.prototype.applyKeywordHighlight) {
            const originalMethod = window.MarkdownRenderer.prototype.applyKeywordHighlight;
            
            // 重写方法，使用插件系统处理
            window.MarkdownRenderer.prototype.applyKeywordHighlight = function(html) {
                // 如果插件系统可用，使用插件处理
                if (window.pluginManager && window.pluginManager.initialized) {
                    return window.pluginManager.processMarkdown(html);
                }
                
                // 否则回退到原始方法
                return originalMethod.call(this, html);
            };
            
            console.log('[插件系统] 已集成到 MarkdownRenderer');
        }
    }

    /**
     * 集成到编辑器系统
     */
    integrateWithEditor() {
        // 监听编辑器初始化事件
        if (window.pluginManager) {
            window.pluginManager.on('editor:initialized', (data) => {
                if (data.editor && window.pluginManager) {
                    window.pluginManager.processEditor(data.editor);
                }
            });
        }
    }

    /**
     * 集成到菜单系统
     */
    integrateWithMenu() {
        // 这里可以添加插件相关的菜单选项
        // 由于菜单在主进程中，需要通过 IPC 通信
        if (window.pluginManager) {
            window.pluginManager.on('plugin:loaded', (data) => {
                console.log(`[插件系统] 插件 ${data.plugin.name} 已加载`);
            });
            
            window.pluginManager.on('plugin:unloaded', (data) => {
                console.log(`[插件系统] 插件 ${data.plugin.name} 已卸载`);
            });
        }
    }

    /**
     * 获取插件管理器
     */
    getPluginManager() {
        return this.pluginManager;
    }

    /**
     * 销毁插件系统
     */
    async destroy() {
        if (!this.initialized) return;

        if (this.pluginManager) {
            await this.pluginManager.destroy();
            this.pluginManager = null;
        }
        
        // 清理全局引用
        if (window.pluginManager) {
            delete window.pluginManager;
        }
        
        this.initialized = false;
        console.log('[插件系统] 已销毁');
    }

    /**
     * 重新加载插件系统
     */
    async reload() {
        await this.destroy();
        await this.init();
    }
}

// 创建全局实例
window.pluginIntegration = new PluginIntegration();

module.exports = PluginIntegration;