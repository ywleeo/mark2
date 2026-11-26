/** 文档工作区的打开策略：Editorial 使用可替换预览，Classic 保留固定标签。 */
import { getPathIdentityKey } from '../../utils/pathUtils.js';

/** 从当前工作区配置读取文档导航模式；不依赖模块加载时的 DOM 快照。 */
export function isDocumentWorkspace(root = globalThis.document?.documentElement) {
    return root?.dataset?.workspaceProfile === 'writing';
}

/** 打开磁盘文档时，文档模式不加入固定 tab；既有文档与临时草稿仍由管理器保留。 */
export function prepareDocumentOpen(fileTree, path, writing = isDocumentWorkspace()) {
    if (!writing && !path.startsWith('untitled://')) fileTree?.addToOpenFiles?.(path);
}

/** 连续跟随链接时保留原文稿，直接回到原文稿时结束预览。 */
export function resolveLinkPreviewReturnPath(currentPath, currentDocument, targetPath) {
    const origin = currentDocument?.previewReturnPath ?? currentPath;
    return getPathIdentityKey(origin) === getPathIdentityKey(targetPath) ? null : origin;
}

/** 关闭列表条目时使用真实 tab 类型，预览文档不能误走固定 tab 的清理分支。 */
export function getDocumentCloseTarget(path, document, previewId = 'shared-preview') {
    const preview = document?.pinned === false;
    return { path, id: preview ? previewId : path, type: preview ? 'shared' : 'file' };
}
