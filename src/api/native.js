import { invoke } from '@tauri-apps/api/core';

function ensureString(value, name) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`[native] ${name} 需要合法的字符串`);
    }
}

export async function setExportMenuEnabled(enabled) {
    return await invoke('set_export_menu_enabled', { enabled: Boolean(enabled) });
}

export async function captureScreenshot(destination, imageData) {
    ensureString(destination, 'captureScreenshot.destination');
    ensureString(imageData, 'captureScreenshot.imageData');
    return await invoke('capture_screenshot', { destination, imageData });
}

export async function exportToPdf({ destination, htmlContent, cssContent, pageWidth } = {}) {
    ensureString(destination, 'exportToPdf.destination');
    ensureString(htmlContent, 'exportToPdf.htmlContent');
    ensureString(cssContent, 'exportToPdf.cssContent');
    return await invoke('export_to_pdf', {
        destination,
        htmlContent,
        cssContent,
        pageWidth,
    });
}

export async function listPlugins() {
    return await invoke('list_plugins');
}
