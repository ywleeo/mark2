/** 文档右键动作策略与执行器，所有操作绑定目标路径，不依赖当前活动文档。 */
import { basename, dirname, normalizeFsPath } from '../../utils/pathUtils.js';
import { COMMAND_IDS } from '../../core/commands/commandIds.js';

/** 临时文档只提供保存和关闭；磁盘文件复用既有文件操作及确认流程。 */
export function getDocumentContextActions(path, isOpen) {
    if (path.startsWith('untitled://')) return ['save', 'close'];
    return ['open', 'open-secondary', 'rename', 'move', 'copy-path', 'reveal',
        ...(isOpen ? ['close'] : []), 'remove', 'delete'];
}

/** 校验单个文件名并构造同目录目标，避免重命名被解释成跨目录移动。 */
export function documentRenameDestination(path, name) {
    const trimmed = name.trim();
    if (!trimmed || trimmed === '.' || trimmed === '..' || /[/\\\x00-\x1f]/.test(trimmed)) return null;
    const separator = path.includes('\\') ? '\\' : '/';
    return normalizeFsPath(`${dirname(path)}${separator}${trimmed}`);
}

/** 注入现有文件服务和生命周期；历史删除与物理删除有明确的不同入口。 */
export function createDocumentContextActions({ select, close, remove, saveDocument, history, fileTree, fileService, executeCommand, requestName }) {
    return async (action, path) => {
        // 再次校验动作，防止菜单打开后路径变更或非法动作触发磁盘操作。
        if (!getDocumentContextActions(path, true).includes(action)) return;
        switch (action) {
            case 'open': return select(path);
            case 'save':
                // 保存主栏中刚激活的目标，不能落入仍持有焦点的副栏全局保存命令。
                if (await select(path)) return saveDocument(path);
                return;
            case 'close': return close(path);
            case 'remove': return remove ? remove(path) : history.remove(path);
            case 'rename': {
                const name = await requestName(basename(path));
                if (name === null) return;
                const destination = documentRenameDestination(path, name);
                if (!destination || destination === normalizeFsPath(path)) return;
                if (await fileService.exists(destination)) {
                    const error = new Error('A document with this name already exists.');
                    error.code = 'document-name-exists';
                    throw error;
                }
                await fileTree.renameFile(path, name.trim());
                history.rename(path, destination);
                return;
            }
            case 'move': {
                const destination = await fileTree.promptMoveTo(path, { targetType: 'file' });
                if (destination) history.rename(path, destination);
                return;
            }
            case 'delete':
                if (await fileTree.confirmAndDelete(path)) history.remove(path);
                return;
            default: {
                const commands = { 'open-secondary': COMMAND_IDS.VIEW_OPEN_IN_SECONDARY,
                    'copy-path': COMMAND_IDS.WORKSPACE_COPY_PATH, reveal: COMMAND_IDS.WORKSPACE_REVEAL_IN_FINDER };
                return executeCommand(commands[action], { path, targetType: 'file' });
            }
        }
    };
}
