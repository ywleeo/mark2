/** 标签菜单装配与命令贡献，业务逻辑保持在标签功能模块内。 */
import { COMMAND_IDS } from '../../core/commands/commandIds.js';
import { TabContextMenu } from './TabContextMenu.js';
import { createTabCloseAction } from './tabContextActions.js';

/** 接入现有关闭事务和文件/分栏命令，文档变化时撤销过期菜单。 */
export function createTabContextController({ tabManager, documentManager, commandManager, hasUnsavedChanges, onError }) {
    const unregister = commandManager.registerCommand({
        id: COMMAND_IDS.DOCUMENT_CLOSE_TABS,
        title: '关闭标签页',
        handler: createTabCloseAction({
            getTabs: () => tabManager.getAllTabs(),
            getActiveTabId: () => tabManager.activeTabId,
            closeTab: id => tabManager.handleTabClose(id),
            hasUnsavedChanges,
        }),
    });
    const menu = new TabContextMenu({ tabManager, onError,
        executeCommand: (id, payload, context) => commandManager.executeCommand(id, payload, context) });
    const unsubscribe = documentManager.subscribe(() => menu.hideMenu());
    return {
        /** 释放菜单 DOM、全局监听、文档订阅与功能命令。 */
        dispose() {
            unsubscribe();
            unregister();
            menu.dispose();
        },
    };
}
