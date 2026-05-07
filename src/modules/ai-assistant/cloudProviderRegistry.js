/**
 * Cloud Provider Plugin Registry
 *
 * 让 ai-assistant 与具体的 cloud account 实现（如 mark2 cloud、未来其它云）解耦。
 * Plugin 通过 import 副作用自注册到这里，aiService / AiSidebar / SettingsDialog 都
 * 仅依赖本 registry 暴露的接口，不再 import 任何 cloud-account 模块。
 *
 * Plugin 接口：
 * {
 *   id: string,                                           // 唯一 id（同时作为 provider preset id）
 *   preset: { id, name, baseUrl, models, isCloud: true }, // 静态 preset 定义（model 可被运行时覆盖）
 *   isAvailable(): boolean,                               // 是否可用（一般 = 已登录）
 *   getCredentials(): { baseUrl, apiKey, models? },       // 运行时凭据；models 不返回时用 preset.models
 *   subscribe(cb): () => void,                            // 状态变化时通知（登录态/profiles 等）
 *   mountSettingsSlot(container): () => void,             // Settings 卡片入口；返回 destroy
 *   bootstrap(): Promise<void>,                           // 应用启动时调（非阻塞）
 * }
 */

const plugins = new Map();
const listeners = new Set();

function emit() {
    listeners.forEach((fn) => {
        try { fn(); } catch (e) { console.error('[cloudRegistry] listener error:', e); }
    });
}

export function registerCloudProvider(plugin) {
    if (!plugin || !plugin.id || !plugin.preset) {
        throw new Error('[cloudRegistry] plugin must have id and preset');
    }
    plugins.set(plugin.id, plugin);
    if (typeof plugin.subscribe === 'function') {
        plugin.subscribe(emit);
    }
    emit();
}

export function unregisterCloudProvider(id) {
    plugins.delete(id);
    emit();
}

export function listCloudProviders() {
    return Array.from(plugins.values());
}

export function getCloudProvider(id) {
    return plugins.get(id) || null;
}

/**
 * 订阅注册表本身的变化（plugin 增减 + 各 plugin 自身状态变化）。
 * @returns {Function} unsubscribe
 */
export function subscribeRegistry(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

/** 启动期统一调一次每个 plugin 的 bootstrap，互不阻塞。 */
export function bootstrapCloudPlugins() {
    for (const p of plugins.values()) {
        if (typeof p.bootstrap === 'function') {
            try { void p.bootstrap(); } catch (e) {
                console.warn(`[cloudRegistry] ${p.id} bootstrap failed:`, e);
            }
        }
    }
}
