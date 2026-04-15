/**
 * 最近打开文件和文件夹管理服务
 * 使用时间 + 打开次数的权重算法进行排序
 */

import { createStore } from './storage.js';

const store = createStore('recentFiles');
store.migrateFrom('mark2:recentFiles', 'items');

const MAX_RECENT_ITEMS = 50; // 最多存储 50 个，但只显示前 10 个

/**
 * 计算项目的权重分数
 * 算法：结合打开次数和时间新鲜度
 * score = openCount * 10 + timeScore
 * timeScore 随着时间衰减：最近 1 天内 = 20 分，7 天内 = 10 分，30 天内 = 5 分
 */
function calculateScore(item, now = Date.now()) {
    const daysSinceLastOpen = (now - item.lastOpenedAt) / (1000 * 60 * 60 * 24);

    let timeScore = 0;
    if (daysSinceLastOpen < 1) {
        timeScore = 20;
    } else if (daysSinceLastOpen < 7) {
        timeScore = 10;
    } else if (daysSinceLastOpen < 30) {
        timeScore = 5;
    }

    return item.openCount * 10 + timeScore;
}

/**
 * 标准化路径
 */
function normalizePath(path) {
    if (typeof path !== 'string' || path.trim().length === 0) {
        return null;
    }
    return path.replace(/\\/g, '/').trim();
}

/**
 * 从 localStorage 加载最近打开的文件列表
 */
function loadRecentItems() {
    const parsed = store.get('items', []);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(item =>
        item &&
        typeof item === 'object' &&
        normalizePath(item.path) &&
        typeof item.lastOpenedAt === 'number' &&
        typeof item.openCount === 'number' &&
        (item.type === 'file' || item.type === 'folder')
    );
}

/**
 * 保存最近打开的文件列表到 storage
 */
function saveRecentItems(items) {
    // 只保留前 MAX_RECENT_ITEMS 个
    store.set('items', items.slice(0, MAX_RECENT_ITEMS));
}

/**
 * 创建最近文件服务
 */
export function createRecentFilesService() {
    /**
     * 记录打开文件或文件夹
     */
    function recordOpen(path, type) {
        const normalizedPath = normalizePath(path);
        if (!normalizedPath) {
            return;
        }

        if (type !== 'file' && type !== 'folder') {
            console.warn('[recentFilesService] 无效的类型:', type);
            return;
        }

        const items = loadRecentItems();
        const now = Date.now();

        // 查找是否已存在
        const existingIndex = items.findIndex(item => item.path === normalizedPath);

        if (existingIndex >= 0) {
            // 更新现有项
            const existing = items[existingIndex];
            items.splice(existingIndex, 1);
            items.unshift({
                path: normalizedPath,
                type: existing.type, // 保持原来的类型
                lastOpenedAt: now,
                openCount: existing.openCount + 1,
            });
        } else {
            // 添加新项
            items.unshift({
                path: normalizedPath,
                type,
                lastOpenedAt: now,
                openCount: 1,
            });
        }

        // 按权重排序
        const sortedItems = items.sort((a, b) => {
            return calculateScore(b, now) - calculateScore(a, now);
        });

        saveRecentItems(sortedItems);
    }

    /**
     * 获取排序后的最近文件列表（最多 10 个）
     */
    function getRecentFiles(limit = 10) {
        const items = loadRecentItems();
        const now = Date.now();

        const files = items
            .filter(item => item.type === 'file')
            .sort((a, b) => calculateScore(b, now) - calculateScore(a, now))
            .slice(0, limit);

        return files;
    }

    /**
     * 获取排序后的最近文件夹列表（最多 10 个）
     */
    function getRecentFolders(limit = 10) {
        const items = loadRecentItems();
        const now = Date.now();

        const folders = items
            .filter(item => item.type === 'folder')
            .sort((a, b) => calculateScore(b, now) - calculateScore(a, now))
            .slice(0, limit);

        return folders;
    }

    /**
     * 获取混合的最近项列表（文件和文件夹一起），按权重排序
     */
    function getRecentItems(limit = 10) {
        const items = loadRecentItems();
        const now = Date.now();

        const sorted = items
            .sort((a, b) => calculateScore(b, now) - calculateScore(a, now))
            .slice(0, limit);

        return sorted;
    }

    /**
     * 清除所有最近项
     */
    function clearAll() {
        store.remove('items');
    }

    /**
     * 从列表中移除指定路径
     */
    function removeItem(path) {
        const normalizedPath = normalizePath(path);
        if (!normalizedPath) {
            return;
        }

        const items = loadRecentItems();
        const filtered = items.filter(item => item.path !== normalizedPath);
        saveRecentItems(filtered);
    }

    return {
        recordOpen,
        getRecentFiles,
        getRecentFolders,
        getRecentItems,
        clearAll,
        removeItem,
    };
}
