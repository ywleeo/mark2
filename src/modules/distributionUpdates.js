/** 按编译渠道加载更新实现；MAS 的打包结果不包含站外更新模块。 */
import { SUPPORTS_DESKTOP_UPDATER } from '../config/distribution.js';

/** 启动 GitHub 版更新服务；动态导入保留 MAS 的静态裁剪边界。 */
export async function setupDistributionUpdates() {
    if (!SUPPORTS_DESKTOP_UPDATER) return;
    const { setupAutoUpdater } = await import('./autoUpdater.js');
    setupAutoUpdater();
}

/** 命令层共用的手动入口；MAS 即使收到旧菜单事件也不会启用站外更新。 */
export async function checkDistributionUpdate() {
    if (!SUPPORTS_DESKTOP_UPDATER) return;
    const { manualCheckUpdate } = await import('./autoUpdater.js');
    return manualCheckUpdate();
}
