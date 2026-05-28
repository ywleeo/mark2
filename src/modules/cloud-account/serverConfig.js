/**
 * mark2 cloud server baseURL 配置。
 *
 * 默认指向生产 https://mark2.altron.cc。
 * 开发期需要切到本地后端时,在 devtools console 里手动设:
 *   localStorage.setItem('cloudServerBaseUrl', 'http://localhost:8787')
 * 取消覆盖:
 *   localStorage.removeItem('cloudServerBaseUrl')
 */

const DEFAULT_BASE_URL = 'https://mark2.altron.cc';
const STORAGE_KEY = 'cloudServerBaseUrl';

/**
 * 服务端登录页（web，不在 API baseURL 之下）。
 * - `from=app` 标记来自桌面客户端
 * - `cb=mark2://auth` 登录完成后浏览器 302 回这个 deep link，附带 token / code
 *
 * 注意：登录页域名是 mark2app.com，与 API baseURL（mark2.altron.cc）不同。
 */
export const LOGIN_URL = 'https://mark2app.com/login?from=app&cb=mark2://auth';

// deep link 回调 scheme，main.rs 注册的 mark2://...
export const DEEP_LINK_SCHEME = 'mark2:';

export function getServerBaseUrl() {
    try {
        const override = localStorage.getItem(STORAGE_KEY);
        if (override) return override.replace(/\/+$/, '');
    } catch (_) {
        // localStorage 不可用时降级到默认
    }
    return DEFAULT_BASE_URL;
}
