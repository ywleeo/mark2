import { listen } from '@tauri-apps/api/event';

export async function registerMenuListeners(handlers) {
    const disposers = [];

    const register = async (eventName, handler) => {
        if (!handler) {
            return;
        }
        const unlisten = await listen(eventName, () => {
            void handler();
        });
        disposers.push(unlisten);
    };

    await register('menu-open', handlers.onOpen);
    await register('menu-settings', handlers.onSettings);
    await register('menu-export-image', handlers.onExportImage);
    await register('menu-export-pdf', handlers.onExportPdf);
    await register('menu-toggle-sidebar', handlers.onToggleSidebar);
    await register('menu-toggle-status-bar', handlers.onToggleStatusBar);
    await register('menu-toggle-markdown-code-view', handlers.onToggleMarkdownCodeView);
    await register('menu-file-new', handlers.onNewFile);
    await register('menu-file-delete', handlers.onDeleteActiveFile);
    await register('menu-file-move', handlers.onMoveActiveFile);
    await register('menu-file-rename', handlers.onRenameActiveFile);
    await register('menu-clear-recent', handlers.onClearRecent);

    // 注册最近文件菜单项点击事件（recent-0 到 recent-9）
    for (let i = 0; i < 10; i++) {
        const eventName = `menu-recent-${i}`;
        if (handlers.onRecentItemClick) {
            const unlisten = await listen(eventName, () => {
                void handlers.onRecentItemClick(i);
            });
            disposers.push(unlisten);
        }
    }

    // 动态注册插件菜单事件 (plugin-{id}-toggle, plugin-{id}-settings)
    // 通过 EventBus 转发给插件系统
    const pluginEventUnlisten = await listen('menu-plugin-ai-assistant-toggle', () => {
        handlers.onToggleAiAssistant?.();
    });
    disposers.push(pluginEventUnlisten);

    const pluginSettingsUnlisten = await listen('menu-plugin-ai-assistant-settings', () => {
        handlers.onOpenAiSettings?.();
    });
    disposers.push(pluginSettingsUnlisten);

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
