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
