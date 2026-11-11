/** 全局排除配置的唯一运行时真源：校验、持久化、变更订阅与查询版本控制。 */
import { createStore } from '../../services/storage.js';
import { createLogger } from '../../core/diagnostics/Logger.js';
import { validateFileExclusions, listWorkspaceDirectory } from '../../api/fileExclusions.js';
import { normalizeFileExclusionSettings } from './fileExclusionSettings.js';

/** 创建可注入 IO 的配置服务，供运行时与回归测试使用相同事务逻辑。 */
export function createFileExclusionService({
    store = createStore('file-exclusions', { version: 1 }),
    validate = validateFileExclusions,
    list = listWorkspaceDirectory,
    logger = createLogger('workspace'),
    eventTarget = typeof window === 'undefined' ? null : window,
} = {}) {
    let settings = normalizeFileExclusionSettings(store.get('settings', null));
    let revision = 0;
    const listeners = new Set();
    let synchronization = 0;

    /** 广播独立配置副本，某个消费者失败不会中断其他工作区刷新。 */
    function publish(next) {
        settings = next;
        revision += 1;
        logger.info('file-exclusions:changed', {
            revision, enabled: settings.enabled, applyToSearch: settings.applyToSearch,
            ruleCount: settings.rules.length,
        });
        for (const listener of listeners) {
            try { listener(service.getSettings(), revision); }
            catch (error) { logger.warn('file-exclusions:notify-failed', { error }); }
        }
    }

    const service = {
        /** 返回独立快照，调用方不能直接改写运行时配置。 */
        getSettings() { return normalizeFileExclusionSettings(settings); },
        /** 查询版本仅在有效配置确实变化时递增。 */
        getRevision() { return revision; },
        /** 注册变更通知，返回资源释放函数。 */
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        /** 整批校验成功且提交仍有效时才保存；取消或任一错误均保留旧配置。 */
        async save(candidate, isCurrent = () => true) {
            const next = normalizeFileExclusionSettings(candidate);
            const errors = await validate(next);
            if (!isCurrent()) return false;
            if (errors.length) {
                throw Object.assign(new Error('Invalid file exclusion rules'), { ruleErrors: errors });
            }
            if (JSON.stringify(settings) === JSON.stringify(next)) return true;
            if (!store.set('settings', next)) throw new Error('Unable to persist file exclusions');
            synchronization += 1;
            publish(next);
            return true;
        },
        /** 其他窗口提交后读取相同命名空间；错误配置和过期校验不进入运行时。 */
        async reload() {
            const current = ++synchronization;
            const next = normalizeFileExclusionSettings(store.get('settings', null));
            const errors = await validate(next);
            if (current !== synchronization || errors.length) return;
            if (JSON.stringify(settings) !== JSON.stringify(next)) publish(next);
        },
        /** 规则变更期间完成的查询会重新执行，避免迟到响应恢复已隐藏条目。 */
        async listDirectory(path, rootPath) {
            while (true) {
                const version = revision;
                const entries = await list(path, rootPath, service.getSettings());
                if (version === revision) return { entries, revision: version };
            }
        },
        /** 释放窗口级存储订阅；应用窗口关闭时浏览器也会自动回收。 */
        dispose() {
            synchronization += 1;
            eventTarget?.removeEventListener?.('storage', onStorage);
            listeners.clear();
        },
    };
    /** localStorage 的 storage 事件只发给其他窗口，不会重复本窗口的保存通知。 */
    const onStorage = event => {
        if (event.key === null || event.key === store.fullKey?.('settings')) {
            void service.reload().catch(error => logger.warn('file-exclusions:sync-failed', { error }));
        }
    };
    eventTarget?.addEventListener?.('storage', onStorage);
    return service;
}

/** 全应用共享配置，组件只订阅或持有草稿，不创建第二份生效状态。 */
export const fileExclusionService = createFileExclusionService();
