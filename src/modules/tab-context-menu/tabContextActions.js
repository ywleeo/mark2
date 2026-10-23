/** 标签菜单的目标选择与批量关闭事务，不持有文档或激活态副本。 */

/** 未命名文稿即使内容为空也不属于已保存文件。 */
export function isSavedTab(tab) {
    return Boolean(tab?.path && !tab.path.startsWith('untitled://') && !tab.dirty && !tab.syncing);
}

/** 同时校验 ID 和路径，避免 shared-preview 被复用后误关闭新文稿。 */
export function findMatchingTab(tabs, target) {
    return tabs.find(tab => tab.id === target?.id && tab.path === target?.path);
}

/** 选择点击时的标签快照；当前激活项最后关闭，避免逐个加载待关闭文稿。 */
export function getCloseTargets(tabs, target, scope, activeTabId) {
    if (!findMatchingTab(tabs, target)) return [];
    const candidates = tabs.filter(tab => {
        if (scope === 'current') return tab.id === target.id;
        if (scope === 'others') return tab.id !== target.id;
        if (scope === 'saved') return isSavedTab(tab);
        return scope === 'all';
    });
    return [...candidates.filter(tab => tab.id !== activeTabId),
        ...candidates.filter(tab => tab.id === activeTabId)].map(tab => ({ ...tab }));
}

/** 串行关闭并实时复核 dirty；取消、保存失败或异常都会阻止继续关闭。 */
export function createTabCloseAction({ getTabs, getActiveTabId, closeTab, hasUnsavedChanges }) {
    let closing = false;

    /** 并发菜单动作不排队，避免前次取消后又由旧请求继续关闭。 */
    return async function closeTabs({ target, scope }) {
        if (closing) return false;
        closing = true;
        try {
            const targets = getCloseTargets(getTabs(), target, scope, getActiveTabId());
            for (const snapshot of targets) {
                let current = findMatchingTab(getTabs(), snapshot);
                if (!current) continue;
                if (scope === 'saved') {
                    if (!isSavedTab(current) || await hasUnsavedChanges(current.path)) continue;
                    // 异步检查期间目标可能被复用或重新编辑，必须再次核对。
                    current = findMatchingTab(getTabs(), snapshot);
                    if (!isSavedTab(current)) continue;
                }
                await closeTab(current.id);
                if (findMatchingTab(getTabs(), snapshot)) return false;
            }
            return true;
        } finally {
            closing = false;
        }
    };
}
