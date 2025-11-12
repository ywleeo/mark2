import { eventBus } from './EventBus.js';
import { AppBridge } from './AppBridge.js';
import { builtinPlugins } from '../config/builtin-plugins.js';
import { listPlugins } from '../api/native.js';

/**
 * 插件管理器 - 负责插件的自动扫描、加载、激活、卸载
 */
export class PluginManager {
    constructor(options = {}) {
        this.eventBus = options.eventBus || eventBus;
        this.plugins = new Map();
        this.pluginContexts = new Map();
        this.services = options.services || null;

        // 创建 AppBridge 实例
        this.appBridge = new AppBridge({
            eventBus: this.eventBus,
            appContext: options.appContext || {},
        });
    }

    /**
     * 自动扫描并加载所有插件
     */
    async scanAndLoadPlugins() {
        const preloadedModules = import.meta.glob('/plugins/*/frontend/index.js');
        const loadedPluginIds = new Set();

        // 1. 先加载内置插件
        for (const builtin of builtinPlugins) {
            const { manifest, module } = builtin;
            if (!manifest?.id || !module) {
                console.warn('[PluginManager] 内置插件定义缺少 manifest 或 module，跳过');
                continue;
            }
            try {
                console.log(`[PluginManager] 加载内置插件: ${manifest.id}`);
                await this.register(manifest.id, module, manifest);
                await this.activate(manifest.id);
                loadedPluginIds.add(manifest.id);
            } catch (error) {
                console.error(`[PluginManager] 加载内置插件 "${manifest.id}" 失败:`, error);
            }
        }

        // 2. 尝试从后端读取可扩展插件列表（目录扫描）
        let manifests = [];
        try {
            manifests = await listPlugins();
            console.log(`[PluginManager] 目录中发现 ${manifests.length} 个插件`);
        } catch (error) {
            console.error('[PluginManager] 扫描插件目录失败:', error);
        }

        // 3. 动态加载目录插件（跳过已加载的内置插件）
        for (const manifest of manifests) {
            if (!manifest?.id) {
                continue;
            }

            if (loadedPluginIds.has(manifest.id)) {
                console.log(`[PluginManager] 插件 ${manifest.id} 已作为内置插件加载，跳过目录版本`);
                continue;
            }

            if (!manifest.frontend?.enabled) {
                console.log(`[PluginManager] 跳过禁用的插件: ${manifest.id}`);
                continue;
            }

            try {
                const modulePath = `/plugins/${manifest.id}/frontend/index.js`;
                console.log(`[PluginManager] 加载插件: ${manifest.id} (${modulePath})`);

                if (preloadedModules[modulePath]) {
                    const pluginModule = await preloadedModules[modulePath]();
                    await this.register(manifest.id, pluginModule, manifest);
                    await this.activate(manifest.id);
                } else {
                    console.warn(`[PluginManager] 插件 "${manifest.id}" 的前端入口文件不存在: ${modulePath}`);
                }
            } catch (error) {
                console.error(`[PluginManager] 加载插件 "${manifest.id}" 失败:`, error);
            }
        }
    }

    /**
     * 注册插件（手动注册方式）
     * @param {string} id - 插件唯一 ID
     * @param {Object} plugin - 插件模块
     */
    async register(id, plugin, manifest) {
        if (this.plugins.has(id)) {
            console.warn(`[PluginManager] 插件 "${id}" 已存在，跳过注册`);
            return;
        }

        // 验证插件接口
        if (typeof plugin.activate !== 'function') {
            throw new Error(`插件 "${id}" 缺少 activate 方法`);
        }

        this.plugins.set(id, {
            id,
            module: plugin,
            active: false,
            metadata: manifest || plugin.metadata || {},
        });

        console.log(`[PluginManager] 已注册插件: ${id}`);
    }

    /**
     * 激活插件
     */
    async activate(id) {
        const plugin = this.plugins.get(id);
        if (!plugin) {
            throw new Error(`插件 "${id}" 未注册`);
        }

        if (plugin.active) {
            console.warn(`[PluginManager] 插件 "${id}" 已激活`);
            return;
        }

        try {
            // 创建插件上下文
            const context = this.createPluginContext(id);

            // 调用插件的 activate 方法
            const api = await plugin.module.activate(context);

            // 保存插件上下文和导出的 API
            this.pluginContexts.set(id, {
                ...context,
                api: api || {},
            });

            plugin.active = true;
            this.eventBus.emit('plugin:activated', { id, api });

            console.log(`[PluginManager] 已激活插件: ${id}`);
        } catch (error) {
            console.error(`[PluginManager] 激活插件 "${id}" 失败:`, error);
            throw error;
        }
    }

    /**
     * 停用插件
     */
    async deactivate(id) {
        const plugin = this.plugins.get(id);
        if (!plugin || !plugin.active) {
            return;
        }

        try {
            // 调用插件的 deactivate 方法
            if (typeof plugin.module.deactivate === 'function') {
                await plugin.module.deactivate();
            }

            // 清理上下文
            const context = this.pluginContexts.get(id);
            if (context?.cleanup) {
                context.cleanup();
            }
            this.pluginContexts.delete(id);

            plugin.active = false;
            this.eventBus.emit('plugin:deactivated', { id });

            console.log(`[PluginManager] 已停用插件: ${id}`);
        } catch (error) {
            console.error(`[PluginManager] 停用插件 "${id}" 失败:`, error);
            throw error;
        }
    }

    /**
     * 创建插件上下文（插件沙箱）
     */
    createPluginContext(pluginId) {
        const subscriptions = [];
        const cleanups = [];

        const context = {
            // 插件基本信息
            pluginId,

            // 事件系统
            eventBus: {
                on: (event, handler) => {
                    const unsubscribe = this.eventBus.on(event, handler);
                    subscriptions.push(unsubscribe);
                    return unsubscribe;
                },
                once: (event, handler) => {
                    const unsubscribe = this.eventBus.once(event, handler);
                    subscriptions.push(unsubscribe);
                    return unsubscribe;
                },
                emit: (...args) => this.eventBus.emit(...args),
                emitAsync: (...args) => this.eventBus.emitAsync(...args),
            },

            // 应用能力接口（通过 AppBridge 提供）
            app: this.appBridge,

            // 统一服务集合（文件、文档、原生命令等）
            services: this.services,

            // 获取其他插件的 API
            getPluginApi: (id) => {
                const pluginContext = this.pluginContexts.get(id);
                return pluginContext?.api || null;
            },

            // 注册清理函数
            onCleanup: (fn) => {
                cleanups.push(fn);
            },

            // 清理上下文
            cleanup: () => {
                // 取消所有事件订阅
                subscriptions.forEach(unsubscribe => unsubscribe());
                subscriptions.length = 0;

                // 执行所有清理函数
                cleanups.forEach(fn => {
                    try {
                        fn();
                    } catch (error) {
                        console.error(`[PluginManager] 清理函数执行失败:`, error);
                    }
                });
                cleanups.length = 0;
            },
        };

        return context;
    }

    /**
     * 批量激活插件
     */
    async activateAll() {
        const activations = [];
        for (const [id, plugin] of this.plugins) {
            if (!plugin.active) {
                activations.push(this.activate(id));
            }
        }
        await Promise.all(activations);
    }

    /**
     * 批量停用所有插件
     */
    async deactivateAll() {
        const deactivations = [];
        for (const [id, plugin] of this.plugins) {
            if (plugin.active) {
                deactivations.push(this.deactivate(id));
            }
        }
        await Promise.all(deactivations);
    }

    /**
     * 获取插件 API
     */
    getPluginApi(id) {
        const context = this.pluginContexts.get(id);
        return context?.api || null;
    }

    /**
     * 获取所有已激活插件
     */
    getActivePlugins() {
        return Array.from(this.plugins.values())
            .filter(p => p.active)
            .map(p => ({
                id: p.id,
                metadata: p.metadata,
            }));
    }
}
