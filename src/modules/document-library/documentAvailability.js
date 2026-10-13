/** 文档索引的磁盘有效性校验；只清理明确缺失的路径，不触及正文和编辑器会话。 */
import { getPathIdentityKey } from '../../utils/pathUtils.js';

/** 兼容文件服务的结构化错误与 Rust 在各平台返回的文件系统错误文本。 */
export function isMissingDocumentError(error) {
    const description = typeof error === 'string' ? error
        : [error?.code, error?.kind, error?.message].filter(Boolean).join(' ');
    return /\b(?:ENOENT|ENOTDIR|NotFound)\b|no such file|not a directory|does not exist|cannot find the (?:file|path)|os error (?:2|3|20)\b|找不到指定的(?:文件|路径)|系统找不到指定的(?:文件|路径)/i.test(description);
}

/** 限制元数据读取并发；权限错误、未保存内容及校验期间刚保存的记录不会被清理。 */
export async function pruneMissingDocuments({ history, readMetadata, shouldKeep = () => false, isCurrent = () => true }) {
    const records = history.list();
    const missing = [];
    let next = 0;
    /** 每个工作任务串行校验路径，卸载后停止派发和写回。 */
    const worker = async () => {
        while (isCurrent() && next < records.length) {
            const record = records[next++];
            if (shouldKeep(record.path)) continue;
            try {
                await readMetadata(record.path);
            } catch (error) {
                if (!isCurrent() || !isMissingDocumentError(error) || shouldKeep(record.path)) continue;
                missing.push(record);
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(3, records.length) }, worker));
    if (!isCurrent()) return;
    const current = new Map(history.list().map(record => [getPathIdentityKey(record.path), record]));
    // 批量提交前再次检查：旧磁盘结果不能移除校验期间已保存或重新打开的记录。
    const paths = missing.filter(record => !shouldKeep(record.path)
        && current.get(getPathIdentityKey(record.path))?.lastUsedAt === record.lastUsedAt)
        .map(record => record.path);
    if (paths.length) history.removeMany(paths);
}
