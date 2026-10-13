/** 已使用文档的持久化索引；只有新增或内容保存成功才调整顺序，不复制正文或管理文件夹。 */
import { createStore } from '../../services/storage.js';
import { normalizeFsPath, getPathIdentityKey } from '../../utils/pathUtils.js';

/** 返回可进入长期文档历史的磁盘路径，临时文档由当前工作区管理。 */
function savedPath(path) {
    if (typeof path !== 'string' || !path.trim() || path.startsWith('untitled://')) return null;
    return normalizeFsPath(path.trim());
}

/** 清理索引中的无效字段，并按照跨平台路径身份去重。 */
function normalizeRecords(records) {
    const unique = new Map();
    for (const record of Array.isArray(records) ? records : []) {
        const path = savedPath(record?.path);
        if (!path || !Number.isFinite(record.lastUsedAt)) continue;
        const key = getPathIdentityKey(path);
        if (!unique.has(key) || unique.get(key).lastUsedAt < record.lastUsedAt) {
            unique.set(key, { path, lastUsedAt: record.lastUsedAt,
                lastSavedAt: Number.isFinite(record.lastSavedAt) ? record.lastSavedAt : 0,
                title: String(record.title || '').slice(0, 160) });
        }
    }
    return [...unique.values()];
}

/** 文档历史与打开的 tab 分离，关闭 tab 不会移除文档入口。 */
export class DocumentHistory {
    /** @param {{store?:object,now?:Function}} options - 存储与时钟依赖，便于测试恢复和排序。 */
    constructor({ store = createStore('document-library', { version: 1 }), now = Date.now } = {}) {
        this.store = store;
        this.now = now;
        const saved = store.get('catalog', {});
        this.records = normalizeRecords(saved?.records);
        this.migrated = saved?.migrated === true;
        this.listeners = new Set();
    }

    /** 返回隔离引用的完整列表，不沿用 Open Recent 的 50 条上限。 */
    list() { return this.records.map(record => ({ ...record })); }

    /** 持久化元数据并通知订阅方；容量不足时保留内存内容并报告失败。 */
    persist() {
        this.records = normalizeRecords(this.records);
        const ok = this.store.set('catalog', { records: this.records, migrated: this.migrated });
        for (const listener of this.listeners) listener({ persisted: ok !== false });
        return ok !== false;
    }

    /** 首次使用时迁入已知最近文件，文件夹和临时路径不进入文档历史。 */
    migrateRecent(items = []) {
        if (this.migrated) return;
        this.records = normalizeRecords([
            ...this.records,
            ...items.filter(item => item.type === 'file').sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
                .map(item => ({ path: item.path, lastUsedAt: item.lastOpenedAt })),
        ]);
        this.migrated = true;
        this.persist();
    }

    /** 记录使用时间但保持原位置，新文档加入列表顶部；点击和未保存的编辑不重排。 */
    touch(path, { preserveExisting = false } = {}) {
        const normalized = savedPath(path);
        if (!normalized) return false;
        const key = getPathIdentityKey(normalized);
        const existing = this.records.find(record => getPathIdentityKey(record.path) === key);
        if (existing && preserveExisting) return true;
        if (existing) existing.lastUsedAt = this.now();
        else this.records.unshift({ path: normalized, lastUsedAt: this.now(), title: '' });
        return this.persist();
    }

    /** 只有成功写入有变化的内容才置顶；忽略失败、重载和无修改的重复保存。 */
    recordSave(path, event) {
        if (event?.type !== 'saved' || event.contentChanged !== true) return false;
        const normalized = savedPath(path);
        if (!normalized) return false;
        const key = getPathIdentityKey(normalized);
        const existing = this.records.find(record => getPathIdentityKey(record.path) === key);
        const savedAt = this.now();
        const record = { ...(existing || { path: normalized, title: '' }), lastUsedAt: savedAt, lastSavedAt: savedAt };
        this.records = [record, ...this.records.filter(item => getPathIdentityKey(item.path) !== key)];
        return this.persist();
    }

    /** 更新正文标题缓存，不改变位置或使用时间。 */
    setTitle(path, title) {
        const record = this.records.find(item => getPathIdentityKey(item.path) === getPathIdentityKey(path));
        const value = String(title || '').slice(0, 160);
        if (!record || record.title === value) return;
        record.title = value;
        this.persist();
    }

    /** 只移除索引记录；不关闭 tab，也不调用磁盘删除接口。 */
    remove(path) {
        const key = getPathIdentityKey(path);
        this.records = this.records.filter(record => getPathIdentityKey(record.path) !== key);
        return this.persist();
    }

    /** 将重命名或移动同步到历史路径，合并已经存在的目标记录。 */
    rename(oldPath, newPath) {
        const oldKey = getPathIdentityKey(oldPath);
        const target = savedPath(newPath);
        if (!target) return;
        let changed = false;
        this.records = this.records.map(record => {
            if (getPathIdentityKey(record.path) !== oldKey) return record;
            changed = true;
            return { ...record, path: target };
        });
        if (changed) this.persist();
    }

    /** 订阅元数据变化；调用返回函数解除绑定。 */
    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
}
