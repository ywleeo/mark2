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
        this.builtinPluginDirectory = path.join(__dirname); // 内置插件目录
        this.userPluginDirectory = null; // 用户插件目录，在init时设置
        this.initialized = false;
    }

    /**
     * 获取用户插件目录
     */
    getUserPluginDirectory() {
        if (this.userPluginDirectory) {
            return this.userPluginDirectory;
        }

        try {
            // 尝试从主进程获取用户数据目录
            let userDataPath;
            
            if (process.type === 'browser') {
                // 主进程
                const { app } = require('electron');
                userDataPath = app.getPath('userData');
            } else {
                // 渲染进程，通过IPC获取
                const { ipcRenderer } = require('electron');
                const os = require('os');
                // 使用同步方式获取，如果失败则使用默认路径
                try {
                    userDataPath = ipcRenderer.sendSync('get-user-data-path');
                } catch (error) {
                    // 回退到默认路径
                    userDataPath = path.join(os.homedir(), '.mark2');
                }
            }
            
            this.userPluginDirectory = path.join(userDataPath, 'plugins');
        } catch (error) {
            console.warn('[插件管理器] 无法获取用户数据目录:', error);
            // 使用当前目录作为回退
            this.userPluginDirectory = path.join(process.cwd(), 'user-plugins');
        }
        
        return this.userPluginDirectory;
    }

    /**
     * 初始化插件管理器
     */
    async init() {
        if (this.initialized) return;

        // console.log('[插件管理器] 正在初始化...');
        
        // 加载所有插件
        await this.loadAllPlugins();
        
        // 注册所有插件的快捷键
        this.registerPluginShortcuts();
        
        this.initialized = true;
        // console.log('[插件管理器] 初始化完成');
        
        // 触发插件管理器初始化事件
        this.emit('pluginManager:initialized');
    }

    /**
     * 确保用户插件目录存在
     */
    ensureUserPluginDirectory() {
        try {
            // 确保已初始化用户插件目录路径
            const userDir = this.getUserPluginDirectory();
            
            if (!fs.existsSync(userDir)) {
                fs.mkdirSync(userDir, { recursive: true });
                // console.log(`[插件管理器] 创建用户插件目录: ${userDir}`);
            }
        } catch (error) {
            console.warn('[插件管理器] 创建用户插件目录失败:', error);
        }
    }

    /**
     * 加载所有插件
     */
    async loadAllPlugins() {
        // 确保用户插件目录存在
        this.ensureUserPluginDirectory();
        
        // 加载内置插件
        await this.loadPluginsFromDirectory(this.builtinPluginDirectory, 'builtin');
        
        // 加载用户插件
        await this.loadPluginsFromDirectory(this.userPluginDirectory, 'user');
    }

    /**
     * 从指定目录加载插件
     */
    async loadPluginsFromDirectory(directory, source = 'unknown') {
        try {
            if (!fs.existsSync(directory)) {
                return;
            }

            const items = fs.readdirSync(directory, { withFileTypes: true });
            
            for (const item of items) {
                if (item.isDirectory() && !item.name.startsWith('.')) {
                    await this.loadPlugin(item.name, directory, source);
                }
            }
        } catch (error) {
            console.warn(`[插件管理器] 从目录 ${directory} 加载插件失败:`, error);
        }
    }

    /**
     * 加载单个插件
     * @param {string} pluginName - 插件名称（目录名）
     * @param {string} pluginDirectory - 插件所在目录
     * @param {string} source - 插件来源（builtin/user）
     */
    async loadPlugin(pluginName, pluginDirectory = this.builtinPluginDirectory, source = 'builtin') {
        try {
            const pluginPath = path.join(pluginDirectory, pluginName);
            
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
                source: source,
                pluginPath: pluginPath,
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
            
            // console.log(`[插件管理器] 插件 ${pluginInstance.name} 加载成功`);
            
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
            
            // console.log(`[插件管理器] 插件 ${plugin.name} 卸载成功`);
            
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
     * 获取插件目录信息
     */
    getPluginDirectories() {
        return {
            builtin: this.builtinPluginDirectory,
            user: this.userPluginDirectory
        };
    }

    /**
     * 刷新插件列表（重新扫描并加载插件）
     */
    async refreshPlugins() {
        // console.log('[插件管理器] 刷新插件列表...');
        
        // 保存当前插件状态
        const pluginStates = new Map();
        for (const [pluginId, plugin] of this.plugins) {
            pluginStates.set(pluginId, plugin.enabled);
        }
        
        // 清理现有插件
        for (const [pluginId, plugin] of this.plugins) {
            try {
                await plugin.destroy();
            } catch (error) {
                console.warn(`[插件管理器] 销毁插件 ${pluginId} 失败:`, error);
            }
        }
        this.plugins.clear();
        
        // 重新加载所有插件
        await this.loadAllPlugins();
        
        // 恢复插件状态
        for (const [pluginId, enabled] of pluginStates) {
            const plugin = this.plugins.get(pluginId);
            if (plugin) {
                if (enabled) {
                    plugin.enable();
                } else {
                    plugin.disable();
                }
            }
        }
        
        // console.log('[插件管理器] 插件列表刷新完成');
    }

    /**
     * 注册所有插件的快捷键
     */
    registerPluginShortcuts() {
        // console.log('[插件管理器] 注册插件快捷键...');
        
        // 监听全局键盘事件
        document.addEventListener('keydown', (event) => {
            this.handleShortcutEvent(event);
        });
        
        // console.log('[插件管理器] 快捷键注册完成');
    }

    /**
     * 处理快捷键事件
     */
    handleShortcutEvent(event) {
        // 遍历所有插件，检查快捷键匹配
        for (const [pluginId, plugin] of this.plugins) {
            if (!plugin.isActive()) continue;
            
            const shortcuts = plugin.shortcuts || [];
            for (const shortcut of shortcuts) {
                if (this.matchShortcut(event, shortcut.accelerator)) {
                    event.preventDefault();
                    // console.log(`[插件管理器] 触发插件 ${pluginId} 的快捷键: ${shortcut.accelerator}`);
                    
                    // 调用插件的对应方法
                    const actionMethod = shortcut.action || 'executeShortcut';
                    if (typeof plugin[actionMethod] === 'function') {
                        plugin[actionMethod](shortcut);
                    } else {
                        console.warn(`[插件管理器] 插件 ${pluginId} 没有方法 ${actionMethod}`);
                    }
                    return; // 只处理第一个匹配的快捷键
                }
            }
        }
    }

    /**
     * 检查快捷键是否匹配
     */
    matchShortcut(event, accelerator) {
        // 解析加速器字符串 (如 "CmdOrCtrl+Shift+C")
        const parts = accelerator.split('+');
        let expectedCtrl = false;
        let expectedMeta = false;
        let expectedShift = false;
        let expectedAlt = false;
        let expectedKey = '';

        for (const part of parts) {
            switch (part.toLowerCase()) {
                case 'cmdorctrl':
                    if (process.platform === 'darwin') {
                        expectedMeta = true;
                    } else {
                        expectedCtrl = true;
                    }
                    break;
                case 'cmd':
                case 'meta':
                    expectedMeta = true;
                    break;
                case 'ctrl':
                    expectedCtrl = true;
                    break;
                case 'shift':
                    expectedShift = true;
                    break;
                case 'alt':
                    expectedAlt = true;
                    break;
                default:
                    expectedKey = part.toLowerCase();
                    break;
            }
        }

        // 检查修饰键
        if (event.ctrlKey !== expectedCtrl) return false;
        if (event.metaKey !== expectedMeta) return false;
        if (event.shiftKey !== expectedShift) return false;
        if (event.altKey !== expectedAlt) return false;

        // 检查主键
        return event.key.toLowerCase() === expectedKey;
    }

    /**
     * 销毁插件管理器
     */
    async destroy() {
        if (!this.initialized) return;

        // console.log('[插件管理器] 正在销毁...');
        
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
        
        // console.log('[插件管理器] 销毁完成');
    }
}

module.exports = PluginManager;