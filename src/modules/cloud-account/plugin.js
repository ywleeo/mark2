/**
 * mark2 Cloud → cloudProviderRegistry 的 adapter。
 *
 * 把 cloud-account 模块的所有对外接口（getCloudCredentials / subscribe / bootstrap /
 * AccountSettingsRow）适配到通用 cloud provider plugin 接口，并在 import 时副作用注册。
 *
 * 应用启动只需一行 `import './modules/cloud-account/plugin.js'`，本插件即可生效。
 * 删除 `src/modules/cloud-account/` 整个目录 + 那一行 import，应用回退到 BYOK 模式。
 *
 * 也可以通过 `src/config/features.js` 的 `cloudAccount` flag 在不删代码的情况下关闭。
 */
import { features } from '../../config/features.js';
import { registerCloudProvider } from '../ai-assistant/cloudProviderRegistry.js';
import {
    bootstrapSession,
    getCloudCredentials,
    subscribe,
} from './index.js';

// 注:账户 UI 不再挂进 Settings,而是 titlebar 的浮动账户面板。
// 见 appBootstrap.js 里调 setupAccountTitlebarIcon()。

if (features.cloudAccount) {
    registerCloudProvider({
        id: 'mark2cloud',
        preset: {
            id: 'mark2cloud',
            name: 'mark2 Cloud',
            baseUrl: '',
            // 默认 fallback 列表，登录后会被 /api/v1/models 实拉的列表覆盖
            models: ['gpt-4o-mini'],
            isCloud: true,
        },
        isAvailable() {
            return getCloudCredentials().loggedIn;
        },
        getCredentials() {
            const c = getCloudCredentials();
            const modelIds = (c.models && c.models.length > 0)
                ? c.models.map((m) => m.id)
                : null;
            return {
                baseUrl: c.baseUrl,
                apiKey: c.loggedIn ? c.apiKey : '',
                models: modelIds,
            };
        },
        subscribe,
        bootstrap() {
            return bootstrapSession();
        },
    });
}
