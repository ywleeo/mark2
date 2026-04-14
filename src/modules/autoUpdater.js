/**
 * 自动更新模块。
 * 启动时静默检查更新；支持菜单手动触发检查。
 */
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

const CHECK_DELAY_MS = 5000;

export function setupAutoUpdater() {
    setTimeout(() => {
        checkAndInstallUpdate(false).catch(err => {
            console.warn('[AutoUpdater] 检查更新失败:', err);
        });
    }, CHECK_DELAY_MS);
}

/**
 * 手动检查更新（菜单触发），会弹窗提示结果。
 */
export async function manualCheckUpdate() {
    try {
        await checkAndInstallUpdate(true);
    } catch (err) {
        alert(`检查更新失败: ${err.message || err}`);
    }
}

async function checkAndInstallUpdate(manual = false) {
    const update = await check();
    if (!update) {
        console.log('[AutoUpdater] 当前已是最新版本');
        if (manual) {
            alert('当前已是最新版本');
        }
        return;
    }

    console.log(`[AutoUpdater] 发现新版本: ${update.version}`);

    if (manual) {
        const confirmed = confirm(`发现新版本 ${update.version}，是否立即更新？`);
        if (!confirmed) return;
    }

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
