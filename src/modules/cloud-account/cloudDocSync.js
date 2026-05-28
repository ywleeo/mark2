/**
 * 云文档回写:把"云文件夹打开的 untitled 文档"的编辑内容写回云端原文件。
 *
 * 只负责网络写(PUT /storage/files/{id}),确认 UI / 取内容 / 标干净由调用方处理
 * (关闭流程在 navigationController、⌘S 在 fileOperations,它们各自有 editor / 对话框)。
 */

import { getState } from './accountState.js';
import { api, ServerError } from './serverApi.js';
import { untitledFileManager } from '../untitledFileManager.js';
import { eventBus } from '../../core/EventBus.js';

/**
 * 把内容覆盖写回云端对应的 storage 文件。
 * 上传期间通过 eventBus 广播 cloud:doc-sync-start/end(带 fileId),
 * 云文件夹据此在对应行显示「上传中」状态,与本模块解耦。
 * @param {{ path:string, content:string, filename:string }} args
 * @returns {Promise<boolean>} 是否成功
 */
export async function pushCloudDocument({ path, content, filename }) {
    const fileId = untitledFileManager.getCloudFileId?.(path);
    if (!fileId) return false;
    const { token } = getState();
    if (!token) return false;
    eventBus.emit('cloud:doc-sync-start', { fileId });
    let ok = false;
    try {
        const blob = new Blob([content], { type: 'text/markdown' });
        await api.updateFile({ file_id: fileId, blob, filename, token });
        ok = true;
    } catch (e) {
        const detail = (e instanceof ServerError && (e.body?.detail || e.message)) || e?.message || '';
        console.error('[cloud] 更新云文件失败:', detail);
    } finally {
        eventBus.emit('cloud:doc-sync-end', { fileId, ok });
    }
    return ok;
}
