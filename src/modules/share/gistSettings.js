/**
 * Gist 分享设置存储。
 * 分享凭据使用独立命名空间，避免与编辑器、AI 或已剥离的 Cloud 模块耦合。
 */

import { createStore } from '../../services/storage.js';

const store = createStore('gist-share');

// 兼容可能由早期版本写入的裸 key；迁移完成后旧 key 会被删除。
store.migrateFrom('gistApiKey', 'apiKey', { parse: 'raw' });
store.migrateFrom('githubGistApiKey', 'apiKey', { parse: 'raw' });

/**
 * 读取 Gist 分享配置。
 * @returns {{apiKey: string}}
 */
export function loadGistShareSettings() {
    const apiKey = store.get('apiKey', '');
    return {
        apiKey: typeof apiKey === 'string' ? apiKey.trim() : '',
    };
}

/**
 * 保存 Gist API Key；空值表示清除配置。
 * @param {string} apiKey - GitHub Personal Access Token。
 */
export function saveGistApiKey(apiKey) {
    const normalized = typeof apiKey === 'string' ? apiKey.trim() : '';
    if (!normalized) {
        store.remove('apiKey');
        return;
    }
    store.set('apiKey', normalized);
}
