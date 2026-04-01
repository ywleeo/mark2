/**
 * 文档真源管理器。
 * 当前阶段只收敛最关键的文档身份与 dirty 状态，保留旧模块作为兼容层。
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
    } = options;

    const documents = new Map();
    let activeDocumentPath = null;
    let lastActiveSnapshot = null;

    /**
     * 将活动文档状态同步到 AppState 兼容层。
     */
    function syncActiveDocumentToAppState() {
        if (!appState) {
            return;
        }
        const activeDocument = activeDocumentPath ? documents.get(activeDocumentPath) || null : null;
        appState.setCurrentFile(activeDocument?.path || null);
        appState.setHasUnsavedChanges(Boolean(activeDocument?.dirty));
        const nextSnapshot = {
            activePath: activeDocument?.path || null,
            dirty: Boolean(activeDocument?.dirty),
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
        const nextDocument = {
            id: normalizedPath,
            path: normalizedPath,
            tabId: patch.tabId ?? existing?.tabId ?? normalizedPath,
            kind: patch.kind ?? existing?.kind ?? 'file',
            viewMode: patch.viewMode ?? existing?.viewMode ?? null,
            dirty: patch.dirty ?? existing?.dirty ?? false,
            active: patch.active ?? existing?.active ?? false,
            sessionId: patch.sessionId ?? existing?.sessionId ?? null,
        };
        documents.set(normalizedPath, nextDocument);
        return nextDocument;
    }

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
            if (options.activate !== false) {
                if (activeDocumentPath && activeDocumentPath !== normalizedPath) {
                    const previous = documents.get(activeDocumentPath);
                    if (previous) {
                        previous.active = false;
                    }
                }
                activeDocumentPath = normalizedPath;
                nextDocument.active = true;
                syncActiveDocumentToAppState();
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

            if (activeDocumentPath && activeDocumentPath !== normalizedPath) {
                const previous = documents.get(activeDocumentPath);
                if (previous) {
                    previous.active = false;
                }
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
            if (!normalizedOld || !normalizedNew) {
                return null;
            }
            const existing = documents.get(normalizedOld);
            const nextDocument = {
                ...(existing || {}),
                ...patch,
                id: normalizedNew,
                path: normalizedNew,
                tabId: patch.tabId ?? existing?.tabId ?? normalizedNew,
            };

            documents.delete(normalizedOld);
            documents.set(normalizedNew, nextDocument);

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
            return nextDocument;
        },

        /**
         * 标记文档 dirty 状态。
         * @param {string} path - 文档路径
         * @param {boolean} dirty - dirty 状态
         */
        markDirty(path, dirty) {
            const normalizedPath = normalizeDocumentPath(normalizePath, path);
            if (!normalizedPath) {
                return;
            }
            const document = ensureDocument(normalizedPath);
            const nextDirty = Boolean(dirty);
            if (document.dirty === nextDirty) {
                return;
            }
            document.dirty = nextDirty;
            if (activeDocumentPath === normalizedPath) {
                syncActiveDocumentToAppState();
            }
            logger?.info?.('markDirty', {
                path: normalizedPath,
                dirty: nextDirty,
                active: activeDocumentPath === normalizedPath,
            });
            traceRecorder?.record?.('documents', 'dirty', {
                path: normalizedPath,
                dirty: nextDirty,
            });
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
            documents.delete(normalizedPath);
            if (wasActive) {
                activeDocumentPath = null;
                syncActiveDocumentToAppState();
            }
            logger?.info?.('closeDocument', {
                path: normalizedPath,
                wasActive,
            });
            traceRecorder?.record?.('documents', 'close', { path: normalizedPath });
        },

        /**
         * 清空当前激活文档。
         */
        clearActiveDocument() {
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
    };
}
