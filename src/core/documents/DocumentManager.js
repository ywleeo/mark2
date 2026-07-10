/**
 * 文档生命周期管理器。
 * 只管理 tab、激活状态和文档身份；dirty 与保存状态由 DocumentModel 投影。
 */

/**
 * 规范化文档路径。
 * @param {Function} normalizePath - 路径规范化函数
 * @param {string|null} value - 原始路径
 * @returns {string|null}
 */
function normalizeDocumentPath(normalizePath, value) {
    if (!value || typeof value !== 'string') {
        return null;
    }
    const normalized = normalizePath?.(value);
    return normalized || value;
}

/**
 * 判断两个轻量对象是否字段一致。
 * @param {Object|null} left - 左值
 * @param {Object|null} right - 右值
 * @returns {boolean}
 */
function isShallowEqual(left, right) {
    if (left === right) {
        return true;
    }
    if (!left || !right) {
        return false;
    }
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) {
        return false;
    }
    return leftKeys.every(key => left[key] === right[key]);
}

/**
 * 创建文档管理器。
 * @param {Object} options - 初始化参数
 * @returns {Object} 文档管理器实例
 */
export function createDocumentManager(options = {}) {
    const {
        appState,
        normalizePath,
        logger,
        traceRecorder,
        documentRegistry,
    } = options;

    const documents = new Map();
    const openOrder = [];
    const listeners = new Set();
    let activeDocumentPath = null;
    let lastActiveSnapshot = null;

    /** 从 DocumentModel 读取派生 dirty，DocumentManager 不再保存副本。 */
    function resolveDirty(path) {
        return Boolean(path && documentRegistry?.isDirty?.(path));
    }

    /** 给内部 tab 文档暴露只读 dirty 属性。 */
    function attachDirtyProjection(doc) {
        Object.defineProperty(doc, 'dirty', {
            configurable: true,
            enumerable: true,
            get: () => resolveDirty(doc.path),
        });
        return doc;
    }

    /**
     * 发送事件给所有订阅者。
     * 订阅方回调中抛出的异常会被捕获并降级为日志。
     */
    function emit(event) {
        if (!event || !event.type) return;
        for (const listener of Array.from(listeners)) {
            try {
                listener(event);
            } catch (error) {
                logger?.warn?.('documentManager listener error', error);
            }
        }
    }

    function ensureOrderEntry(path, atStart = false) {
        if (!openOrder.includes(path)) {
            if (atStart) {
                openOrder.unshift(path);
            } else {
                openOrder.push(path);
            }
            return true;
        }
        return false;
    }

    function removeOrderEntry(path) {
        const idx = openOrder.indexOf(path);
        if (idx !== -1) {
            openOrder.splice(idx, 1);
            return true;
        }
        return false;
    }

    function toPublicDocument(doc) {
        if (!doc) return null;
        return {
            path: doc.path,
            tabId: doc.tabId,
            kind: doc.kind,
            viewMode: doc.viewMode,
            dirty: resolveDirty(doc.path),
            syncing: Boolean(doc.syncing),
            active: Boolean(doc.active),
            sessionId: doc.sessionId,
            label: doc.label || null,
            pinned: doc.pinned !== false,
        };
    }

    /** 将活动文档身份同步到 AppState；dirty 由 provider 实时读取。 */
    function syncActiveDocumentToAppState() {
        if (!appState) {
            return;
        }
        const activeDocument = activeDocumentPath ? documents.get(activeDocumentPath) || null : null;
        appState.setCurrentFile(activeDocument?.path || null);
        const nextSnapshot = {
            activePath: activeDocument?.path || null,
            dirty: resolveDirty(activeDocument?.path),
            tabId: activeDocument?.tabId || null,
        };
        if (!isShallowEqual(lastActiveSnapshot, nextSnapshot)) {
            logger?.info?.('syncActiveDocument', nextSnapshot);
            lastActiveSnapshot = nextSnapshot;
        }
    }

    /**
     * 确保指定路径对应的文档实体存在。
     * @param {string} path - 文档路径
     * @param {Object} patch - 文档补丁
     * @returns {Object} 文档实体
     */
    function ensureDocument(path, patch = {}) {
        const normalizedPath = normalizeDocumentPath(normalizePath, path);
        if (!normalizedPath) {
            throw new Error('DocumentManager 需要有效路径');
        }

        const existing = documents.get(normalizedPath);
        const nextDocument = attachDirtyProjection({
            id: normalizedPath,
            path: normalizedPath,
            tabId: patch.tabId ?? existing?.tabId ?? normalizedPath,
            kind: patch.kind ?? existing?.kind ?? 'file',
            viewMode: patch.viewMode ?? existing?.viewMode ?? null,
            active: patch.active ?? existing?.active ?? false,
            sessionId: patch.sessionId ?? existing?.sessionId ?? null,
            label: patch.label ?? existing?.label ?? null,
            // pinned=true 代表"固定打开"（file tab 或 untitled）；
            // pinned=false 代表"临时预览"（shared tab），不会进入 openOrder
            pinned: patch.pinned ?? existing?.pinned ?? true,
        });
        documents.set(normalizedPath, nextDocument);
        return nextDocument;
    }

    /**
     * 将 DocumentModel 的派生状态投影到 tab 生命周期层。
     * DocumentManager 只转发事件，不保存 dirty 副本。
     */
    documentRegistry?.subscribe?.(({ path, event, document: model }) => {
        const managedDocument = documents.get(path);
        if (!managedDocument || !event) return;

        if (event.type === 'save-state') {
            managedDocument.syncing = event.state === 'saving';
        }
        if (activeDocumentPath === path) {
            syncActiveDocumentToAppState();
        }

        if (event.type === 'dirty') {
            logger?.info?.('documentDirtyChanged', {
                path,
                dirty: model.dirty,
                revision: model.getRevision?.(),
            });
            traceRecorder?.record?.('documents', 'dirty', { path, dirty: model.dirty });
            emit({
                type: 'dirty',
                path,
                dirty: model.dirty,
                document: toPublicDocument(managedDocument),
            });
        } else if (event.type === 'save-state') {
            emit({ type: 'update', path, document: toPublicDocument(managedDocument) });
        }
    });

    return {
        /**
         * 打开或更新一个文档实体，并可选择激活它。
         * @param {string} path - 文档路径
         * @param {Object} options - 文档元信息
         * @returns {Object|null}
         */
        openDocument(path, options = {}) {
            const normalizedPath = normalizeDocumentPath(normalizePath, path);
            if (!normalizedPath) {
                return null;
            }

            const previousDocument = documents.get(normalizedPath);
            const nextDocument = ensureDocument(normalizedPath, options);
            if (options.dirty !== undefined) {
                let model = documentRegistry?.getDocument?.(normalizedPath);
                if (!model && (options.kind === 'untitled' || options.kind === 'import')) {
                    model = documentRegistry?.registerInMemoryDocument?.(normalizedPath, {
                        viewMode: options.viewMode || 'markdown',
                        content: '',
                    });
                }
                if (options.dirty) model?.markUnpersisted?.();
            }
            // 仅 pinned 文档进入 openOrder（file tab 列表）。
            // unpinned → 只在 documents 中存在（供内容管理），不会作为 file tab 渲染。
            // 如果之前是 unpinned 现在变 pinned，也要补进 openOrder
            const previouslyPinned = previousDocument ? previousDocument.pinned !== false : false;
            const isNowPinned = nextDocument.pinned !== false;
            let isNewOpen = false;
            if (isNowPinned) {
                isNewOpen = ensureOrderEntry(normalizedPath, options.atStart === true);
                if (!previouslyPinned && previousDocument) {
                    isNewOpen = true;
                }
            } else {
                removeOrderEntry(normalizedPath);
            }
            // 对于 unpinned 文档（shared tab 预览）：同一时间只保留一个
            if (!isNowPinned) {
                for (const [otherPath, otherDoc] of documents) {
                    if (otherPath === normalizedPath) continue;
                    if (otherDoc.pinned === false) {
                        documents.delete(otherPath);
                    }
                }
            }
            let previousActivePath = null;
            if (options.activate !== false) {
                if (activeDocumentPath && activeDocumentPath !== normalizedPath) {
                    const previous = documents.get(activeDocumentPath);
                    if (previous) {
                        previous.active = false;
                    }
                    previousActivePath = activeDocumentPath;
                }
                activeDocumentPath = normalizedPath;
                nextDocument.active = true;
                syncActiveDocumentToAppState();
            }

            if (isNewOpen || !previousDocument) {
                emit({ type: 'open', path: normalizedPath, document: toPublicDocument(nextDocument) });
            } else {
                emit({ type: 'update', path: normalizedPath, document: toPublicDocument(nextDocument) });
            }
            if (options.activate !== false) {
                emit({
                    type: 'activate',
                    path: normalizedPath,
                    previousPath: previousActivePath,
                    document: toPublicDocument(nextDocument),
                });
            }

            const logPayload = {
                path: normalizedPath,
                tabId: nextDocument.tabId,
                kind: nextDocument.kind,
                viewMode: nextDocument.viewMode,
                dirty: nextDocument.dirty,
                activate: options.activate !== false,
            };
            const previousLogPayload = previousDocument
                ? {
                    path: previousDocument.path,
                    tabId: previousDocument.tabId,
                    kind: previousDocument.kind,
                    viewMode: previousDocument.viewMode,
                    dirty: previousDocument.dirty,
                    activate: options.activate !== false,
                }
                : null;
            if (!isShallowEqual(previousLogPayload, logPayload)) {
                logger?.info?.('openDocument', logPayload);
            }
            traceRecorder?.record?.('documents', 'open', {
                path: normalizedPath,
                kind: nextDocument.kind,
                viewMode: nextDocument.viewMode,
            });
            return nextDocument;
        },

        /**
         * 激活指定文档；如允许，也可在不存在时隐式创建。
         * @param {string} path - 文档路径
         * @param {Object} options - 激活选项
         * @returns {Object|null}
         */
        activateDocument(path, options = {}) {
            const normalizedPath = normalizeDocumentPath(normalizePath, path);
            if (!normalizedPath) {
                return null;
            }

            const existing = documents.get(normalizedPath);
            if (!existing && options.allowCreate) {
                return this.openDocument(normalizedPath, options);
            }
            if (!existing) {
                return null;
            }

            let previousActivePath = null;
            if (activeDocumentPath && activeDocumentPath !== normalizedPath) {
                const previous = documents.get(activeDocumentPath);
                if (previous) {
                    previous.active = false;
                }
                previousActivePath = activeDocumentPath;
            }

            activeDocumentPath = normalizedPath;
            existing.active = true;
            if (options.viewMode) {
                existing.viewMode = options.viewMode;
            }
            if (options.sessionId !== undefined) {
                existing.sessionId = options.sessionId;
            }
            syncActiveDocumentToAppState();

            logger?.info?.('activateDocument', {
                path: normalizedPath,
                tabId: existing.tabId,
                viewMode: existing.viewMode,
                sessionId: existing.sessionId,
            });
            traceRecorder?.record?.('documents', 'activate', { path: normalizedPath });
            emit({
                type: 'activate',
                path: normalizedPath,
                previousPath: previousActivePath,
                document: toPublicDocument(existing),
            });
            return existing;
        },

        /**
         * 重命名文档实体，并迁移 active 状态。
         * @param {string} oldPath - 旧路径
         * @param {string} newPath - 新路径
         * @param {Object} patch - 迁移时的补丁字段
         * @returns {Object|null}
         */
        renameDocument(oldPath, newPath, patch = {}) {
            const normalizedOld = normalizeDocumentPath(normalizePath, oldPath);
            const normalizedNew = normalizeDocumentPath(normalizePath, newPath);
            if (!normalizedOld || !normalizedNew || normalizedOld === normalizedNew) {
                return documents.get(normalizedNew) || null;
            }

            const existing = documents.get(normalizedOld);
            if (!existing) {
                // 已重命名过：幂等短路。若带 patch 则合并到 newPath 并 emit update。
                // active 由 activate/close 等流程维护，不接受来自 patch 的覆盖。
                const already = documents.get(normalizedNew);
                if (already && patch) {
                    const { active: _active, dirty: requestedDirty, ...safePatch } = patch;
                    if (requestedDirty) {
                        documentRegistry?.getDocument?.(normalizedNew)?.markUnpersisted?.();
                    }
                    if (Object.keys(safePatch).length > 0) {
                        Object.assign(already, safePatch, {
                            id: normalizedNew,
                            path: normalizedNew,
                            tabId: safePatch.tabId ?? already.tabId ?? normalizedNew,
                        });
                        emit({ type: 'update', path: normalizedNew, document: toPublicDocument(already) });
                    }
                }
                return already || null;
            }

            const { dirty: requestedDirty, ...safePatch } = patch;
            const nextDocument = attachDirtyProjection({
                ...existing,
                ...safePatch,
                id: normalizedNew,
                path: normalizedNew,
                tabId: safePatch.tabId ?? existing.tabId ?? normalizedNew,
            });
            if (requestedDirty) {
                documentRegistry?.getDocument?.(normalizedNew)?.markUnpersisted?.();
            }

            documents.delete(normalizedOld);
            documents.set(normalizedNew, nextDocument);

            // 仅当旧路径在 openOrder（pinned）时迁移位置，unpinned 文档不进 openOrder
            const orderIdx = openOrder.indexOf(normalizedOld);
            if (orderIdx !== -1) {
                openOrder[orderIdx] = normalizedNew;
            }

            if (activeDocumentPath === normalizedOld) {
                activeDocumentPath = normalizedNew;
                nextDocument.active = true;
                syncActiveDocumentToAppState();
            }

            logger?.info?.('renameDocument', { oldPath: normalizedOld, newPath: normalizedNew });
            traceRecorder?.record?.('documents', 'rename', {
                oldPath: normalizedOld,
                newPath: normalizedNew,
            });
            emit({
                type: 'rename',
                oldPath: normalizedOld,
                newPath: normalizedNew,
                document: toPublicDocument(nextDocument),
            });
            return nextDocument;
        },

        /**
         * 更新文档元信息。
         * @param {string} path - 文档路径
         * @param {Object} patch - 文档补丁
         * @returns {Object|null}
         */
        updateDocument(path, patch = {}) {
            const normalizedPath = normalizeDocumentPath(normalizePath, path);
            if (!normalizedPath) {
                return null;
            }
            const document = ensureDocument(normalizedPath, patch);
            if (activeDocumentPath === normalizedPath) {
                syncActiveDocumentToAppState();
            }
            logger?.info?.('updateDocument', {
                path: normalizedPath,
                patch,
            });
            emit({
                type: 'update',
                path: normalizedPath,
                document: toPublicDocument(document),
            });
            return document;
        },

        /**
         * 关闭指定文档。
         * @param {string} path - 文档路径
         */
        closeDocument(path) {
            const normalizedPath = normalizeDocumentPath(normalizePath, path);
            if (!normalizedPath) {
                return;
            }
            const wasActive = activeDocumentPath === normalizedPath;
            const existing = documents.get(normalizedPath);
            documents.delete(normalizedPath);
            const removedFromOrder = removeOrderEntry(normalizedPath);
            if (wasActive) {
                activeDocumentPath = null;
                syncActiveDocumentToAppState();
            }
            logger?.info?.('closeDocument', {
                path: normalizedPath,
                wasActive,
            });
            traceRecorder?.record?.('documents', 'close', { path: normalizedPath });
            if (existing || removedFromOrder) {
                emit({
                    type: 'close',
                    path: normalizedPath,
                    wasActive,
                    document: toPublicDocument(existing),
                });
            }
            if (wasActive) {
                emit({ type: 'activate', path: null, previousPath: normalizedPath, document: null });
            }
        },

        /**
         * 清空当前激活文档。
         */
        clearActiveDocument() {
            const previousActivePath = activeDocumentPath;
            if (activeDocumentPath) {
                const activeDocument = documents.get(activeDocumentPath);
                if (activeDocument) {
                    activeDocument.active = false;
                }
            }
            activeDocumentPath = null;
            syncActiveDocumentToAppState();
            logger?.info?.('clearActiveDocument', {});
            traceRecorder?.record?.('documents', 'clear-active', {});
            if (previousActivePath) {
                emit({ type: 'activate', path: null, previousPath: previousActivePath, document: null });
            }
        },

        /**
         * 获取当前激活文档。
         * @returns {Object|null}
         */
        getActiveDocument() {
            return activeDocumentPath ? documents.get(activeDocumentPath) || null : null;
        },

        /**
         * 获取当前激活文档路径。
         * @returns {string|null}
         */
        getActivePath() {
            return this.getActiveDocument()?.path || null;
        },

        /**
         * 根据路径获取文档实体。
         * @param {string} path - 文档路径
         * @returns {Object|null}
         */
        getDocumentByPath(path) {
            const normalizedPath = normalizeDocumentPath(normalizePath, path);
            return normalizedPath ? documents.get(normalizedPath) || null : null;
        },

        /**
         * 订阅 DocumentManager 事件。
         * 事件类型：open / close / activate / rename / dirty / update / reorder
         * @param {Function} listener
         * @returns {Function} 取消订阅函数
         */
        subscribe(listener) {
            if (typeof listener !== 'function') {
                return () => {};
            }
            listeners.add(listener);
            return () => listeners.delete(listener);
        },

        /**
         * 获取当前所有打开文档路径（按打开顺序）。
         * @returns {string[]}
         */
        getOpenPaths() {
            return openOrder.slice();
        },

        /**
         * 获取所有打开文档的快照（按打开顺序）。
         * @returns {Array<Object>}
         */
        getOpenDocuments() {
            return openOrder
                .map(path => documents.get(path))
                .filter(Boolean)
                .map(toPublicDocument);
        },

        /**
         * 重新排序打开的文档（用于 tab 拖拽）。
         * @param {string[]} nextOrder - 新顺序
         */
        reorderDocuments(nextOrder) {
            if (!Array.isArray(nextOrder)) {
                return;
            }
            const normalized = nextOrder
                .map(path => normalizeDocumentPath(normalizePath, path))
                .filter(Boolean)
                .filter(path => documents.has(path));
            const currentSet = new Set(openOrder);
            const nextSet = new Set(normalized);
            if (normalized.length !== openOrder.length
                || !openOrder.every(path => nextSet.has(path))
                || !normalized.every(path => currentSet.has(path))) {
                logger?.warn?.('reorderDocuments 顺序与已打开文档不匹配，已忽略');
                return;
            }
            const same = openOrder.every((path, idx) => path === normalized[idx]);
            if (same) return;
            openOrder.splice(0, openOrder.length, ...normalized);
            logger?.info?.('reorderDocuments', { order: normalized });
            emit({ type: 'reorder', order: normalized.slice() });
        },
    };
}
