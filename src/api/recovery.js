import { invoke } from '@tauri-apps/api/core';

/** 写入一份未保存恢复点或已保存历史版本。 */
export async function upsertRecoverySnapshot(snapshot) {
    return await invoke('upsert_recovery_snapshot', { snapshot });
}

/** 按路径和类型读取恢复点元数据。 */
export async function listRecoverySnapshots({ filePath = null, kind = null } = {}) {
    return await invoke('list_recovery_snapshots', { filePath, kind });
}

/** 读取恢复点正文。 */
export async function readRecoverySnapshot(id) {
    return await invoke('read_recovery_snapshot', { id });
}

/** 删除指定恢复点。 */
export async function deleteRecoverySnapshot(id) {
    await invoke('delete_recovery_snapshot', { id });
}

/** 清除某个文档的未保存恢复点。 */
export async function clearPendingRecovery(filePath) {
    await invoke('clear_pending_recovery', { filePath });
}

/** 文件重命名后同步迁移恢复记录。 */
export async function renameRecoveryDocument(oldPath, newPath) {
    await invoke('rename_recovery_document', { oldPath, newPath });
}
