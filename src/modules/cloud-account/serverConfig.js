/**
 * mark2 cloud server baseURL 配置。
 *
 * 默认指向生产环境 https://mark2app.com；开发期间可通过 localStorage 切到本地：
 *   localStorage.setItem('cloudServerBaseUrl', 'http://localhost:8787')
 *
 * 取消覆盖：localStorage.removeItem('cloudServerBaseUrl')
 */

const DEFAULT_BASE_URL = 'https://mark2app.com';
const STORAGE_KEY = 'cloudServerBaseUrl';

export function getServerBaseUrl() {
    try {
        const override = localStorage.getItem(STORAGE_KEY);
        if (override) return override.replace(/\/+$/, '');
    } catch (_) {
        // localStorage 不可用时降级到默认
    }
    return DEFAULT_BASE_URL;
}

export function setServerBaseUrl(url) {
    if (!url) {
        localStorage.removeItem(STORAGE_KEY);
        return;
    }
    localStorage.setItem(STORAGE_KEY, url.replace(/\/+$/, ''));
}
