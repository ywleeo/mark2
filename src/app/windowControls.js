/**
 * 窗口控制相关功能
 */
import { getCurrentWindow } from '@tauri-apps/api/window';
import { addClickHandler } from '../utils/PointerHelper.js';
import { applyEditorSettings, saveEditorSettings } from '../utils/editorSettings.js';

/**
 * 设置自定义标题栏的窗口控制按钮
 */
export function setupTitlebarControls() {
    const closeBtn = document.getElementById('titlebar-close');
    const minimizeBtn = document.getElementById('titlebar-minimize');
    const maximizeBtn = document.getElementById('titlebar-maximize');
    const appWindow = getCurrentWindow();

    if (closeBtn) {
        closeBtn.addEventListener('click', () => appWindow.close());
    }
    if (minimizeBtn) {
        minimizeBtn.addEventListener('click', () => appWindow.minimize());
    }
    if (maximizeBtn) {
        maximizeBtn.addEventListener('click', async () => {
            const isMaximized = await appWindow.isMaximized();
            if (isMaximized) {
                await appWindow.unmaximize();
            } else {
                await appWindow.maximize();
            }
        });
    }
}

/**
 * 切换 dark/light 主题
 * @param {Object} appState - 应用状态对象
 */
export function toggleAppTheme(appState) {
    const root = document.documentElement;
    const currentAppearance = root.dataset.themeAppearance;
    const newAppearance = currentAppearance === 'dark' ? 'light' : 'dark';
    const currentSettings = appState.getEditorSettings();
    const updatedSettings = { ...currentSettings, appearance: newAppearance };
    appState.setEditorSettings(updatedSettings);
    applyEditorSettings(updatedSettings);
    saveEditorSettings(updatedSettings);
}

/**
 * 设置主题切换按钮
 * @param {Object} appState - 应用状态对象
 */
export function setupThemeToggle(appState) {
    const toggleBtn = document.getElementById('theme-toggle');
    if (!toggleBtn) return;

    addClickHandler(toggleBtn, () => {
        toggleAppTheme(appState);
    }, {
        preventDefault: true,
    });
}
