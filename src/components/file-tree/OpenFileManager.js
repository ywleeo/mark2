import { getPathIdentityKey } from '../../utils/pathUtils.js';
import { getViewModeForPath } from '../../utils/fileTypeUtils.js';

const UNTITLED_PREFIX = 'untitled://';

function isUntitledPath(path) {
    return typeof path === 'string' && path.startsWith(UNTITLED_PREFIX);
}

/**
 * OpenFileManager
 * 文件树「已打开文件」区段的视图与交互层。
 *
 * 真源：DocumentManager。本类的所有 add/close/reorder/replacePath/restore
 * 都委托给 dm，不再直接维护 state.openFiles。dm 的 open/close/rename/reorder
 * 事件回流，驱动 state.openFiles + watch/unwatch + 渲染。
 */
export class OpenFileManager {
    constructor(options = {}) {
        const {
            normalizePath,
            state,
            getOpenFilesView,
            watchFile,
            stopWatchingFile,
            selectFile,
            clearSelection,
            onFileSelect,
            onOpenFilesChange,
            onPathRenamed,
        } = options;

        this.normalizePath = normalizePath;
        this.state = state;
        this.getOpenFilesView = getOpenFilesView;
        this.watchFile = watchFile;
        this.stopWatchingFile = stopWatchingFile;
        this.selectFile = selectFile;
        this.clearSelection = clearSelection;
        this.onFileSelect = onFileSelect;
        this.onOpenFilesChange = onOpenFilesChange;
        this.onPathRenamed = onPathRenamed;

        this.documentManager = null;
        this._dmUnsub = null;
        this._isRestoring = false;
    }

    /**
     * 绑定 DocumentManager。绑定后所有改动都走 dm，state.openFiles 由 dm 事件派生。
     * @param {Object} dm - DocumentManager 实例
     */
    bindDocumentManager(dm) {
        if (this._dmUnsub) {
            this._dmUnsub();
            this._dmUnsub = null;
        }
        this.documentManager = dm || null;
        if (!dm) return;
        this._dmUnsub = dm.subscribe?.((event) => this._onDocumentEvent(event)) || null;
        this._syncFromDocumentManager();
    }

    _requireDm() {
        if (!this.documentManager) {
            throw new Error('OpenFileManager 未绑定 DocumentManager');
        }
        return this.documentManager;
    }

    /**
     * 从 dm.openOrder 派生出 fileTree 视角的文件列表（剔除 untitled 与未 pinned 项）。
     */
    _filterOpenPathsFromDm() {
        const dm = this.documentManager;
        if (!dm) return [];
        const paths = dm.getOpenPaths();
        return paths.filter((p) => {
            if (isUntitledPath(p)) return false;
            const doc = dm.getDocumentByPath?.(p);
            // dm.openOrder 只包含 pinned，但保险起见再校验一次
            return !doc || doc.pinned !== false;
        });
    }

    _onDocumentEvent(event) {
        if (this._isRestoring) return;
        if (!event || !event.type) return;
        const relevant = ['open', 'close', 'rename', 'reorder'];
        if (!relevant.includes(event.type)) return;
        // 仅响应 pinned 文件相关事件
        if (event.type === 'open' && event.document?.pinned === false) return;
        if (event.path && isUntitledPath(event.path)) return;
        if (event.oldPath && isUntitledPath(event.oldPath)
            && event.newPath && isUntitledPath(event.newPath)) return;
        this._syncFromDocumentManager();
    }

    /**
     * 用 dm 当前快照重建 state.openFiles，并补/撤 watchFile。
     * @param {Object} [options]
     * @param {boolean} [options.skipWatch] 跳过 watchFile（restore 阶段用，避免启动时批量建立 watcher）
     */
    _syncFromDocumentManager(options = {}) {
        const { skipWatch = false } = options;
        const next = this._filterOpenPathsFromDm();
        const prev = this.state.openFiles.slice();
        const prevSet = new Set(prev.map((p) => getPathIdentityKey(p)).filter(Boolean));
        const nextSet = new Set(next.map((p) => getPathIdentityKey(p)).filter(Boolean));

        // 新增：开始监听
        if (!skipWatch) {
            next.forEach((p) => {
                const key = getPathIdentityKey(p);
                if (!key || prevSet.has(key)) return;
                const viewMode = getViewModeForPath(p);
                if (viewMode === 'markdown' || viewMode === 'code') {
                    this.watchFile(p).catch((err) => {
                        console.error('监听文件失败:', err);
                    });
                }
            });
        }

        // 移除：停止监听
        prev.forEach((p) => {
            const key = getPathIdentityKey(p);
            if (!key || nextSet.has(key)) return;
            this.stopWatchingFile(p);
        });

        const isSame = prev.length === next.length
            && prev.every((p, i) => p === next[i]);
        this.state.openFiles = next;
        this.render();
        if (!isSame) {
            this.onOpenFilesChange?.([...next]);
        }
    }

    getOpenFilePaths() {
        return [...this.state.openFiles];
    }

    add(path) {
        const dm = this._requireDm();
        const normalized = this.normalizePath(path);
        if (!normalized) return;
        if (this.state.isInOpenList(normalized)) return;
        dm.openDocument(normalized, {
            kind: 'file',
            tabId: normalized,
            pinned: true,
            activate: false,
            atStart: false,
        });
    }

    close(path, options = {}) {
        const dm = this._requireDm();
        const normalizedTarget = this.normalizePath(path);
        const targetIdentity = getPathIdentityKey(normalizedTarget);
        const index = this.state.findOpenFileIndex(normalizedTarget);
        if (index === -1) return;

        const wasActive = Boolean(targetIdentity) && this.state.isCurrentFile(normalizedTarget);

        // dm 事件会同步 state.openFiles 并停止 watch
        dm.closeDocument(normalizedTarget);

        if (wasActive) {
            const fallbackIndex = Math.min(index, this.state.openFiles.length - 1);
            const fallback = fallbackIndex >= 0 ? this.state.openFiles[fallbackIndex] : null;
            if (fallback && !options.suppressActivate) {
                this.selectFile(fallback);
            } else if (!fallback) {
                this.clearSelection();
                if (!options.suppressActivate) {
                    this.onFileSelect?.(null);
                }
            }
        }
    }

    replacePath(oldPath, newPath) {
        const dm = this._requireDm();
        const normalizedOld = this.normalizePath(oldPath);
        const normalizedNew = this.normalizePath(newPath);
        const oldIdentity = getPathIdentityKey(normalizedOld);
        const newIdentity = getPathIdentityKey(normalizedNew);

        if (!normalizedOld || !normalizedNew) return;
        if (!oldIdentity || !newIdentity || oldIdentity === newIdentity) return;

        const index = this.state.findOpenFileIndex(normalizedOld);

        if (index === -1) {
            // 不在 file tab 列表里：仅同步 currentFile + 重启 watch
            if (this.state.isCurrentFile(normalizedOld)) {
                this.state.currentFile = normalizedNew;
            }
            this.stopWatchingFile(normalizedOld);
            const viewMode = getViewModeForPath(normalizedNew);
            if (viewMode === 'markdown' || viewMode === 'code') {
                this.watchFile(normalizedNew).catch((err) => {
                    console.error('监听文件失败:', err);
                });
            }
            return;
        }

        // 在 file tab 列表里：dm 改名 → 事件回流同步
        this.stopWatchingFile(normalizedOld);
        dm.renameDocument(normalizedOld, normalizedNew);
        if (this.state.isCurrentFile(normalizedOld)) {
            this.state.currentFile = normalizedNew;
        }
    }

    render(options = {}) {
        const { skipWatch = false } = options;
        this.getOpenFilesView?.()?.render(this.state.openFiles, {
            currentFile: this.state.currentFile,
            skipWatch,
        });
    }

    restore(paths = []) {
        const dm = this._requireDm();
        const normalized = [];
        const seen = new Set();

        paths.forEach((path) => {
            const np = this.normalizePath(path);
            const key = getPathIdentityKey(np);
            if (!np || !key || seen.has(key)) return;
            seen.add(key);
            normalized.push(np);
        });

        // 批量 close/open 期间挂起事件回调，避免触发 N 次 _syncFromDocumentManager
        this._isRestoring = true;
        try {
            // 关闭 dm 中目前 fileTree 视角下、但不在 restore 列表里的文件文档
            const currentInDm = this._filterOpenPathsFromDm();
            currentInDm.forEach((p) => {
                const key = getPathIdentityKey(p);
                if (!key || !seen.has(key)) {
                    dm.closeDocument(p);
                }
            });

            // 批量 open（已存在则会被识别为 update，atStart=false 维持顺序）
            normalized.forEach((p) => {
                dm.openDocument(p, {
                    kind: 'file',
                    tabId: p,
                    pinned: true,
                    activate: false,
                    atStart: false,
                });
            });
        } finally {
            this._isRestoring = false;
        }

        // currentFile 校正
        const normalizedCurrent = this.normalizePath(this.state.currentFile);
        if (normalizedCurrent) {
            const currentIdentity = getPathIdentityKey(normalizedCurrent);
            const restoredCurrent = normalized.find(
                (p) => getPathIdentityKey(p) === currentIdentity,
            ) || null;
            this.state.currentFile = restoredCurrent || normalizedCurrent;
        }

        // 兜底：dm 已是最终状态，主动 sync 一次保证 render / emit 已同步。
        // 跳过 watchFile（与 v1.7.0 restore 行为一致），watcher 在文件首次加载时按需建立。
        this._syncFromDocumentManager({ skipWatch: true });
    }

    reorder(paths = []) {
        if (!Array.isArray(paths) || paths.length === 0) return;
        const dm = this._requireDm();

        const dmPaths = dm.getOpenPaths();
        const dmFilePaths = dmPaths.filter((p) => !isUntitledPath(p));
        const dmFileSet = new Set(dmFilePaths.map((p) => getPathIdentityKey(p)).filter(Boolean));

        const seen = new Set();
        const incoming = [];
        paths.forEach((p) => {
            const np = this.normalizePath(p);
            const key = getPathIdentityKey(np);
            if (!np || !key || seen.has(key) || !dmFileSet.has(key)) return;
            seen.add(key);
            incoming.push(np);
        });

        if (incoming.length === 0) return;

        // 未提及的现存文件按原顺序追加在末尾
        dmFilePaths.forEach((p) => {
            const key = getPathIdentityKey(p);
            if (key && !seen.has(key)) {
                incoming.push(p);
                seen.add(key);
            }
        });

        const isSame = incoming.length === dmFilePaths.length
            && incoming.every((p, i) => p === dmFilePaths[i]);
        if (isSame) return;

        // 合并 untitled 与文件：保持 untitled 在 dm.openOrder 的相对位置
        const merged = [];
        const fileIter = incoming[Symbol.iterator]();
        for (const p of dmPaths) {
            if (isUntitledPath(p)) {
                merged.push(p);
            } else {
                const next = fileIter.next();
                if (!next.done) merged.push(next.value);
            }
        }
        // 理论上 fileIter 已耗尽，保险起见追加剩余
        for (const next of fileIter) merged.push(next);

        dm.reorderDocuments(merged);
    }

    handleMoveSuccess(sourcePath, destinationPath, meta = {}) {
        const normalizedSource = this.normalizePath(sourcePath);
        const normalizedDestination = this.normalizePath(destinationPath);
        if (!normalizedSource || !normalizedDestination) return;

        const isDirectory = meta?.isDirectory === true;
        if (!isDirectory) {
            try {
                this.replacePath(normalizedSource, normalizedDestination);
                this.onPathRenamed?.(normalizedSource, normalizedDestination, { suppressAutoFocus: true });
            } catch (error) {
                console.warn('处理文件移动回调失败:', error);
            }
            return;
        }

        const sourcePrefix = normalizedSource.endsWith('/') ? normalizedSource : `${normalizedSource}/`;
        const destinationPrefix = normalizedDestination.endsWith('/')
            ? normalizedDestination
            : `${normalizedDestination}/`;

        const affectedPaths = new Set(this.state.openFiles || []);
        if (this.state.currentFile) affectedPaths.add(this.state.currentFile);

        affectedPaths.forEach((path) => {
            if (!path) return;
            const normalized = this.normalizePath(path);
            if (!normalized || !normalized.startsWith(sourcePrefix)) return;
            const relative = normalized.slice(sourcePrefix.length);
            const nextPath = `${destinationPrefix}${relative}`;
            try {
                this.replacePath(normalized, nextPath);
                this.onPathRenamed?.(normalized, nextPath, { suppressAutoFocus: true });
            } catch (error) {
                console.warn('处理文件夹移动回调失败:', error);
            }
        });
    }

    dispose() {
        if (this._dmUnsub) {
            this._dmUnsub();
            this._dmUnsub = null;
        }
        this.documentManager = null;
    }
}
