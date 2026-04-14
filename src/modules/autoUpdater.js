/**
 * 自动更新模块。
 * 启动时检查更新，静默下载并提示用户重启。
 */
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

const CHECK_DELAY_MS = 5000; // 启动后延迟 5 秒检查

export function setupAutoUpdater() {
    setTimeout(() => {
        checkAndInstallUpdate().catch(err => {
            console.warn('[AutoUpdater] 检查更新失败:', err);
        });
    }, CHECK_DELAY_MS);
}

async function checkAndInstallUpdate() {
    const update = await check();
    if (!update) {
        console.log('[AutoUpdater] 当前已是最新版本');
        return;
    }

    console.log(`[AutoUpdater] 发现新版本: ${update.version}`);

    await update.downloadAndInstall((progress) => {
        if (progress.event === 'Started') {
            console.log(`[AutoUpdater] 开始下载，总大小: ${progress.data.contentLength} bytes`);
        } else if (progress.event === 'Progress') {
            console.log(`[AutoUpdater] 下载中: ${progress.data.chunkLength} bytes`);
        } else if (progress.event === 'Finished') {
            console.log('[AutoUpdater] 下载完成');
        }
    });

    console.log('[AutoUpdater] 安装完成，准备重启...');
    await relaunch();
}
