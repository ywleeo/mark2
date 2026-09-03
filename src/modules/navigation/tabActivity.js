import { getPathIdentityKey, normalizeFsPath } from '../../utils/pathUtils.js';

/**
 * 判断一个标签是否仍承载当前内容视图。
 * 标签栏 ID 优先用于覆盖“文件已删除、路径状态先被清空”的过渡状态，路径集合用于兼容正常文档切换。
 * @param {Object} options - 活动状态快照。
 * @param {Object|null} options.tab - 待判断的标签。
 * @param {string|null} options.activeTabId - 标签栏当前活动 ID。
 * @param {Array<string|null|undefined>} options.activePaths - 文档、应用和侧边栏记录的活动路径。
 * @param {(value:string|null|undefined)=>string|null|undefined} [options.normalizePath] - 路径归一化函数。
 * @returns {boolean} 标签是否承载当前内容。
 */
export function isActiveContentTab({
    tab,
    activeTabId = null,
    activePaths = [],
    normalizePath = normalizeFsPath,
} = {}) {
    if (!tab) {
        return false;
    }
    if (tab.id && activeTabId === tab.id) {
        return true;
    }

    const targetPath = normalizePath(tab.path || null);
    const targetIdentity = getPathIdentityKey(targetPath);
    if (!targetIdentity) {
        return false;
    }

    return activePaths.some((path) => {
        const normalizedPath = normalizePath(path || null);
        return getPathIdentityKey(normalizedPath) === targetIdentity;
    });
}
