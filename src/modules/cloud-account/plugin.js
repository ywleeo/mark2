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
import { AccountSettingsRow } from './AccountSettingsRow.js';

if (features.cloudAccount) {
    registerCloudProvider({
        id: 'mark2cloud',
        preset: {
            id: 'mark2cloud',
            name: 'mark2 Cloud',
            baseUrl: '',
            models: ['fast', 'think'],
            isCloud: true,
        },
        isAvailable() {
            return getCloudCredentials().loggedIn;
        },
        getCredentials() {
            const c = getCloudCredentials();
            const profileModels = (c.profiles && c.profiles.length > 0)
                ? c.profiles.map((p) => p.id)
                : null;
            return {
                baseUrl: c.baseUrl,
                apiKey: c.loggedIn ? c.apiKey : '',
                models: profileModels,
            };
        },
        subscribe,
        mountSettingsSlot(container) {
            const row = new AccountSettingsRow();
            row.mount(container);
            return () => row.destroy();
        },
        bootstrap() {
            return bootstrapSession();
        },
    });
}
