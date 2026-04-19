import { COMMAND_IDS } from '../core/commands/commandIds.js';
import { listen } from '@tauri-apps/api/event';

/**
 * 将原生菜单事件映射到统一命令层。
 * 菜单模块本身只做适配，不直接感知业务处理器。
 * @param {{executeCommand: Function}} handlers - 命令执行入口
 * @returns {Promise<Function>}
 */
export async function registerMenuListeners(handlers) {
    const disposers = [];
    const executeCommand = handlers?.executeCommand;

    if (typeof executeCommand !== 'function') {
        throw new Error('registerMenuListeners 需要 executeCommand');
    }

    const register = async (eventName, commandId, payloadFactory = null) => {
        const unlisten = await listen(eventName, () => {
            const payload = typeof payloadFactory === 'function' ? payloadFactory() : {};
            void executeCommand(commandId, payload, {
                source: 'menu',
                eventName,
            });
        });
        disposers.push(unlisten);
    };

    await register('menu-about', COMMAND_IDS.APP_ABOUT);
    await register('menu-app-quit', COMMAND_IDS.APP_QUIT);
    await register('menu-undo', COMMAND_IDS.EDITOR_UNDO);
    await register('menu-redo', COMMAND_IDS.EDITOR_REDO);
    await register('menu-open', COMMAND_IDS.APP_OPEN);
    await register('menu-open-file', COMMAND_IDS.APP_OPEN_FILE);
    await register('menu-open-folder', COMMAND_IDS.APP_OPEN_FOLDER);
    await register('menu-settings', COMMAND_IDS.APP_SETTINGS);
    await register('menu-vault-open', COMMAND_IDS.FEATURE_VAULT_TOGGLE);
    await register('menu-export-image', COMMAND_IDS.EXPORT_IMAGE);
    await register('menu-export-pdf', COMMAND_IDS.EXPORT_PDF);
    await register('menu-toggle-sidebar', COMMAND_IDS.VIEW_TOGGLE_SIDEBAR);
    await register('menu-toggle-status-bar', COMMAND_IDS.VIEW_TOGGLE_STATUS_BAR);
    await register('menu-toggle-markdown-code-view', COMMAND_IDS.VIEW_TOGGLE_SOURCE_MODE);
    await register('menu-toggle-markdown-toolbar', COMMAND_IDS.TOOLBAR_TOGGLE_MARKDOWN);
    await register('menu-toggle-theme', COMMAND_IDS.THEME_TOGGLE);
    await register('menu-toggle-terminal', COMMAND_IDS.FEATURE_TERMINAL_TOGGLE);
    await register('menu-toggle-ai-sidebar', COMMAND_IDS.FEATURE_AI_TOGGLE);
    await register('menu-file-new', COMMAND_IDS.DOCUMENT_NEW_FILE);
    await register('menu-file-delete', COMMAND_IDS.DOCUMENT_DELETE);
    await register('menu-file-move', COMMAND_IDS.DOCUMENT_MOVE);
    await register('menu-file-rename', COMMAND_IDS.DOCUMENT_RENAME);
    await register('menu-clear-recent', COMMAND_IDS.RECENT_CLEAR);
    await register('menu-check-update', COMMAND_IDS.APP_CHECK_UPDATE);

    // 注册最近文件菜单项点击事件（recent-0 到 recent-9）
    for (let i = 0; i < 10; i++) {
        const eventName = `menu-recent-${i}`;
        const unlisten = await listen(eventName, () => {
            void executeCommand(COMMAND_IDS.RECENT_OPEN_ENTRY, { index: i }, {
                source: 'menu',
                eventName,
            });
        });
        disposers.push(unlisten);
    }

    return () => {
        while (disposers.length > 0) {
            const unlisten = disposers.pop();
            try {
                unlisten();
            } catch (error) {
                console.warn('移除菜单监听失败', error);
            }
        }
    };
}
