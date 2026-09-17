import * as recoveryApi from '../api/recovery.js';

const DEFAULT_SNAPSHOT_DELAY = 1200;

/**
 * 创建文档恢复服务。
 * 服务只订阅 DocumentRegistry，不持有编辑器实例，主栏与副栏共享同一套恢复机制。
 * @param {Object} options - 服务依赖。
 * @returns {Object} 恢复服务协议。
 */
export function createRecoveryService({
    documentRegistry,
    isUntitledPath,
    api = recoveryApi,
    delay = DEFAULT_SNAPSHOT_DELAY,
    logger = console,
}) {
    if (!documentRegistry?.subscribe) {
        throw new Error('recoveryService 需要 documentRegistry');
    }

    const timers = new Map();
    const operationQueues = new Map();
    const historyBaselines = new Set();
    let disposed = false;

    /** 判断路径是否进入磁盘文档恢复链路。 */
    function supportsPath(path) {
        return typeof path === 'string'
            && path.length > 0
            && !isUntitledPath?.(path);
    }

    /** 为同一文档串行执行后端操作，防止 pending/history 乱序覆盖。 */
    function enqueue(path, operation) {
        const previous = operationQueues.get(path) || Promise.resolve();
        const current = previous
            .catch(() => {})
            .then(operation)
            .catch((error) => {
                logger?.warn?.('[Recovery] 恢复点写入失败', { path, error });
            });
        operationQueues.set(path, current);
        current.finally(() => {
            if (operationQueues.get(path) === current) {
                operationQueues.delete(path);
            }
        });
        return current;
    }

    /** 生成后端所需的恢复快照载荷。 */
    function createSnapshot(document, kind, { clearPending = false } = {}) {
        return {
            filePath: document.uri,
            viewMode: document.viewMode,
            content: kind === 'history'
                ? document.getOriginalContent()
                : document.getContent(),
            revision: kind === 'history'
                ? document.getPersistedRevision()
                : document.getRevision(),
            diskModifiedTime: document.getModifiedTime() || null,
            kind,
            clearPending,
        };
    }

    /** 立即写入某个 dirty 文档的最新恢复点。 */
    function capturePending(path, document = documentRegistry.getDocument?.(path)) {
        if (!supportsPath(path) || !document?.dirty) return Promise.resolve();
        const snapshot = createSnapshot(document, 'pending');
        return enqueue(path, () => api.upsertRecoverySnapshot(snapshot));
    }

    /** 防抖安排一次恢复点写入。 */
    function schedulePending(path, document) {
        if (!supportsPath(path) || disposed) return;
        const existing = timers.get(path);
        if (existing) clearTimeout(existing);
        timers.set(path, setTimeout(() => {
            timers.delete(path);
            void capturePending(path, document);
        }, delay));
    }

    /** 取消等待中的恢复点写入。 */
    function cancelPending(path) {
        const timer = timers.get(path);
        if (timer) clearTimeout(timer);
        timers.delete(path);
    }

    /** 清除已经不再 dirty 的恢复点。 */
    function clearPending(path) {
        if (!supportsPath(path)) return Promise.resolve();
        cancelPending(path);
        return enqueue(path, () => api.clearPendingRecovery(path));
    }

    /** 保存成功后记录可回退历史，并由后端原子清除 pending。 */
    function captureHistory(path, document) {
        if (!supportsPath(path) || !document) return Promise.resolve();
        cancelPending(path);
        historyBaselines.add(path);
        const snapshot = createSnapshot(document, 'history', { clearPending: true });
        return enqueue(path, () => api.upsertRecoverySnapshot(snapshot));
    }

    /** 首次修改前保存磁盘基线，使第一次保存也能够回退到编辑前版本。 */
    function ensureHistoryBaseline(path, document) {
        if (!supportsPath(path) || !document || historyBaselines.has(path)) {
            return Promise.resolve();
        }
        historyBaselines.add(path);
        const snapshot = createSnapshot(document, 'history');
        return enqueue(path, async () => {
            try {
                await api.upsertRecoverySnapshot(snapshot);
            } catch (error) {
                historyBaselines.delete(path);
                throw error;
            }
        });
    }

    /** 将 DocumentModel 事件投影到恢复仓库。 */
    function handleDocumentEvent({ path, event, document }) {
        if (!supportsPath(path) || !event || !document) return;
        if (event.type === 'rename') {
            const oldPath = event.oldUri || path;
            const newPath = event.newUri || document.uri;
            cancelPending(oldPath);
            if (historyBaselines.delete(oldPath)) historyBaselines.add(newPath);
            const renameOperation = enqueue(oldPath, () => api.renameRecoveryDocument(
                oldPath,
                newPath,
            ));
            // 新路径上的后续写入必须等待旧路径身份迁移完成，避免跨队列竞态。
            operationQueues.set(newPath, renameOperation);
            void renameOperation.finally(() => {
                if (operationQueues.get(newPath) === renameOperation) {
                    operationQueues.delete(newPath);
                }
            });
            return;
        }
        if (event.type === 'save-state' && event.state === 'saving') {
            void ensureHistoryBaseline(path, document);
            return;
        }
        if (event.type === 'saved') {
            void captureHistory(path, document);
            if (event.pendingChanges) schedulePending(path, document);
            return;
        }
        if (event.type === 'content' || event.type === 'dirty') {
            if (document.dirty) {
                void ensureHistoryBaseline(path, document);
                schedulePending(path, document);
            } else {
                void clearPending(path);
            }
            return;
        }
        if (event.type === 'reload') {
            historyBaselines.delete(path);
            void clearPending(path);
        }
    }

    const unsubscribe = documentRegistry.subscribe(handleDocumentEvent);

    /** 在窗口真正销毁前刷新所有防抖中的 dirty 文档。 */
    async function flushAll() {
        const scheduledPaths = Array.from(timers.keys());
        for (const path of scheduledPaths) {
            cancelPending(path);
            await capturePending(path);
        }
        await Promise.allSettled(Array.from(operationQueues.values()));
    }

    /** 返回带正文的 pending 恢复点。 */
    async function loadPendingRecoveries() {
        const entries = await api.listRecoverySnapshots({ kind: 'pending' });
        return await loadSnapshotContents(entries);
    }

    /** 返回指定文档带正文的历史版本。 */
    async function loadHistory(filePath) {
        if (!supportsPath(filePath)) return [];
        const entries = await api.listRecoverySnapshots({ filePath, kind: 'history' });
        return await loadSnapshotContents(entries);
    }

    /** 容忍单个损坏恢复点，避免一条坏记录阻断其余可用版本。 */
    async function loadSnapshotContents(entries) {
        const results = await Promise.allSettled(
            entries.map(entry => api.readRecoverySnapshot(entry.id)),
        );
        return results.flatMap((result, index) => {
            if (result.status === 'fulfilled' && result.value) return [result.value];
            logger?.warn?.('[Recovery] 跳过无法读取的恢复点', {
                id: entries[index]?.id,
                error: result.reason,
            });
            return [];
        });
    }

    /** 删除一份恢复点。 */
    async function deleteSnapshot(id) {
        if (!id) return;
        await api.deleteRecoverySnapshot(id);
    }

    /** 释放订阅和定时器；窗口关闭前应先调用 flushAll。 */
    function dispose() {
        disposed = true;
        unsubscribe?.();
        for (const timer of timers.values()) clearTimeout(timer);
        timers.clear();
        historyBaselines.clear();
    }

    return {
        capturePending,
        clearPending,
        flushAll,
        loadPendingRecoveries,
        loadHistory,
        deleteSnapshot,
        dispose,
    };
}
