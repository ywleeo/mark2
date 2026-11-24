import { invoke } from '@tauri-apps/api/core';
import { withFileAccess } from '../services/securityScopeService.js';

function ensureString(value, name) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`[native] ${name} 需要合法的字符串`);
    }
}

export async function setExportMenuEnabled(enabled) {
    return await invoke('set_export_menu_enabled', { enabled: Boolean(enabled) });
}


/** 向用户选择的目标导出图片，必要时提示重新授权。 */
export async function captureScreenshot(destination, imageData) {
    ensureString(destination, 'captureScreenshot.destination');
    ensureString(imageData, 'captureScreenshot.imageData');
    return withFileAccess([{ path: destination }], () => invoke('capture_screenshot', { destination, imageData }));
}

