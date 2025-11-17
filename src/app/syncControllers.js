export function createWorkspaceSyncController(options = {}) {
    const getWorkspaceContext = () => options.getWorkspaceContext?.() ?? null;
    const scheduleFn = (cb, delay) => {
        if (typeof window === 'undefined' || typeof window.setTimeout !== 'function') {
            return -1;
        }
        return window.setTimeout(cb, delay);
    };
    const clearFn = (timer) => {
        if (typeof window !== 'undefined' && typeof window.clearTimeout === 'function') {
            window.clearTimeout(timer);
        }
    };

    let workspaceSyncTimer = null;

    async function syncWorkspaceContext() {
        const context = getWorkspaceContext();
        if (!context || typeof options.invoke !== 'function') {
            return;
        }
        try {
            await options.invoke('update_workspace_context', {
                context: {
                    currentFile: context.currentFile || null,
                    currentDirectory: context.currentDirectory || null,
                    workspaceRoots: context.workspaceRoots || [],
                },
            });
        } catch (error) {
            console.warn('[WorkspaceSync] 更新失败', error);
        }
    }

    function scheduleWorkspaceContextSync() {
        if (workspaceSyncTimer) {
            clearFn(workspaceSyncTimer);
        }
        workspaceSyncTimer = scheduleFn(() => {
            workspaceSyncTimer = null;
            void syncWorkspaceContext();
        }, 200);
    }

    return {
        scheduleWorkspaceContextSync,
        syncWorkspaceContext,
    };
}

export function createDocumentSnapshotSyncController(options = {}) {
    const readSnapshot = () => options.readDocumentSnapshot?.() ?? null;
    const scheduleFn = (cb, delay) => {
        if (typeof window === 'undefined' || typeof window.setTimeout !== 'function') {
            return -1;
        }
        return window.setTimeout(cb, delay);
    };
    const clearFn = (timer) => {
        if (typeof window !== 'undefined' && typeof window.clearTimeout === 'function') {
            window.clearTimeout(timer);
        }
    };

    let documentSyncTimer = null;

    async function syncDocumentSnapshot() {
        let snapshot;
        try {
            snapshot = readSnapshot();
        } catch (_error) {
            // 没有打开文档时忽略
            return;
        }
        if (!snapshot || typeof options.invoke !== 'function') {
            return;
        }
        try {
            await options.invoke('update_document_snapshot', {
                snapshot: {
                    filePath: snapshot.filePath || null,
                    content: snapshot.content || '',
                    totalLines: snapshot.totalLines || 0,
                    updatedAt: Date.now(),
                },
            });
        } catch (error) {
            console.warn('[DocumentSync] 更新失败', error);
        }
    }

    function scheduleDocumentSnapshotSync() {
        if (documentSyncTimer) {
            clearFn(documentSyncTimer);
        }
        documentSyncTimer = scheduleFn(() => {
            documentSyncTimer = null;
            void syncDocumentSnapshot();
        }, 250);
    }

    return {
        scheduleDocumentSnapshotSync,
        syncDocumentSnapshot,
    };
}
