/**
 * FileTree 的状态管理模块
 * 负责管理文件树的各种状态：根文件夹、展开状态、当前文件、打开文件等
 */
export class FileTreeState {
    constructor(fileTree, callbacks = {}) {
        this.fileTree = fileTree;

        // 回调函数
        this.onStateChange = callbacks.onStateChange;
        this.onOpenFilesChange = callbacks.onOpenFilesChange;

        // ========== 核心状态 ==========
        this.rootPaths = new Set();
        this.expandedFolders = new Set();
        this.currentFile = null;
        this.openFiles = [];

        // ========== 区域折叠状态 ==========
        this.sectionStates = {
            openFilesCollapsed: false,
            foldersCollapsed: false,
        };
    }

    // ========== Root Paths 管理 ==========

    /**
     * 添加根文件夹
     */
    addRootPath(path) {
        const normalizedPath = this.fileTree.normalizePath(path);
        if (!normalizedPath) return false;

        if (!this.rootPaths.has(normalizedPath)) {
            this.rootPaths.add(normalizedPath);
            return true; // 表示状态已变更
        }
        return false;
    }

    /**
     * 删除根文件夹
     */
    removeRootPath(path) {
        const normalizedPath = this.fileTree.normalizePath(path);
        if (!normalizedPath) return false;

        const deleted = this.rootPaths.delete(normalizedPath);
        if (deleted) {
            // 同时移除所有相关的展开状态
            const keysToRemove = [];
            this.expandedFolders.forEach((key) => {
                if (key.includes(normalizedPath)) {
                    keysToRemove.push(key);
                }
            });
            keysToRemove.forEach((key) => this.expandedFolders.delete(key));
        }
        return deleted;
    }

    /**
     * 检查是否为根文件夹
     */
    isRootPath(path) {
        const normalizedPath = this.fileTree.normalizePath(path);
        return this.rootPaths.has(normalizedPath);
    }

    /**
     * 获取所有根文件夹
     */
    getRootPaths() {
        return Array.from(this.rootPaths);
    }

    /**
     * 置顶根文件夹
     */
    pinRootPath(path) {
        const normalizedPath = this.fileTree.normalizePath(path);
        if (!normalizedPath || !this.rootPaths.has(normalizedPath)) {
            return false;
        }

        const ordered = Array.from(this.rootPaths);
        const index = ordered.indexOf(normalizedPath);
        if (index <= 0) {
            return false; // 已经在最前面
        }

        ordered.splice(index, 1);
        ordered.unshift(normalizedPath);
        this.rootPaths = new Set(ordered);
        return true; // 表示顺序已变更
    }

    // ========== Expanded Folders 管理 ==========

    /**
     * 添加展开的文件夹
     */
    addExpandedFolder(folderKey) {
        if (!this.expandedFolders.has(folderKey)) {
            this.expandedFolders.add(folderKey);
            return true;
        }
        return false;
    }

    /**
     * 删除展开的文件夹
     */
    removeExpandedFolder(folderKey) {
        return this.expandedFolders.delete(folderKey);
    }

    /**
     * 检查文件夹是否已展开
     */
    isExpanded(folderKey) {
        return this.expandedFolders.has(folderKey);
    }

    /**
     * 切换文件夹展开状态
     */
    toggleExpanded(folderKey) {
        if (this.expandedFolders.has(folderKey)) {
            this.expandedFolders.delete(folderKey);
            return false; // 已收起
        } else {
            this.expandedFolders.add(folderKey);
            return true; // 已展开
        }
    }

    /**
     * 获取所有展开的文件夹
     */
    getExpandedFolders() {
        return Array.from(this.expandedFolders);
    }

    // ========== Current File 管理 ==========

    /**
     * 设置当前选中的文件
     */
    setCurrentFile(path) {
        const normalizedPath = this.fileTree.normalizePath(path);
        this.currentFile = normalizedPath;
    }

    /**
     * 清除当前选中的文件
     */
    clearCurrentFile() {
        this.currentFile = null;
    }

    /**
     * 获取当前选中的文件
     */
    getCurrentFile() {
        return this.currentFile;
    }

    /**
     * 检查指定文件是否为当前文件
     */
    isCurrentFile(path) {
        const normalizedPath = this.fileTree.normalizePath(path);
        const normalizedCurrent = this.fileTree.normalizePath(this.currentFile);
        return normalizedCurrent === normalizedPath;
    }

    // ========== Open Files 管理 ==========

    /**
     * 添加文件到打开列表
     */
    addOpenFile(path) {
        const normalizedPath = this.fileTree.normalizePath(path);
        if (!normalizedPath) return false;

        if (this.isInOpenList(normalizedPath)) {
            return false; // 已存在
        }

        this.openFiles.push(normalizedPath);
        this.emitOpenFilesChange();
        return true;
    }

    /**
     * 从打开列表中移除文件
     */
    removeOpenFile(path) {
        const normalizedPath = this.fileTree.normalizePath(path);
        const index = this.openFiles.findIndex(item => item === normalizedPath);

        if (index > -1) {
            this.openFiles.splice(index, 1);
            this.emitOpenFilesChange();
            return true;
        }
        return false;
    }

    /**
     * 替换打开文件列表中的路径（用于重命名）
     */
    replaceOpenFilePath(oldPath, newPath) {
        const normalizedOld = this.fileTree.normalizePath(oldPath);
        const normalizedNew = this.fileTree.normalizePath(newPath);

        if (!normalizedOld || !normalizedNew) {
            return false;
        }
        if (normalizedOld === normalizedNew) {
            return false;
        }

        const index = this.openFiles.findIndex(item => item === normalizedOld);
        if (index === -1) {
            // 如果不在打开列表中，但是当前文件，也需要更新
            if (this.fileTree.normalizePath(this.currentFile) === normalizedOld) {
                this.currentFile = normalizedNew;
                return true;
            }
            return false;
        }

        // 移除旧路径，在同位置插入新路径，避免重复
        const filtered = this.openFiles.filter(
            (path, idx) => path !== normalizedOld && (path !== normalizedNew || idx === index)
        );
        const insertPosition = Math.min(index, filtered.length);
        filtered.splice(insertPosition, 0, normalizedNew);
        this.openFiles = filtered;

        // 更新当前文件
        if (this.fileTree.normalizePath(this.currentFile) === normalizedOld) {
            this.currentFile = normalizedNew;
        }

        this.emitOpenFilesChange();
        return true;
    }

    /**
     * 检查文件是否在打开列表中
     */
    isInOpenList(path) {
        const normalizedPath = this.fileTree.normalizePath(path);
        return this.openFiles.some(item => item === normalizedPath);
    }

    /**
     * 检查文件是否已打开（在打开列表或为当前文件）
     */
    isFileOpen(path) {
        const normalizedPath = this.fileTree.normalizePath(path);
        const normalizedCurrent = this.fileTree.normalizePath(this.currentFile);
        const isInOpenList = this.isInOpenList(path);
        const isCurrent = normalizedCurrent === normalizedPath;
        return isInOpenList || isCurrent;
    }

    /**
     * 获取所有打开的文件
     */
    getOpenFiles() {
        return [...this.openFiles];
    }

    /**
     * 获取关闭文件后的候选文件
     */
    getFallbackFileAfterClose(path) {
        const normalizedPath = this.fileTree.normalizePath(path);
        const index = this.openFiles.findIndex(item => item === normalizedPath);

        if (index === -1) {
            return null;
        }

        // 移除当前文件后，选择相邻的文件
        const fallbackIndex = Math.min(index, this.openFiles.length - 2);
        return fallbackIndex >= 0 ? this.openFiles[fallbackIndex] : null;
    }

    // ========== Section States 管理 ==========

    /**
     * 切换区域折叠状态
     */
    toggleSectionState(contentId) {
        const willExpand = this.getSectionCollapsed(contentId);
        this.setSectionCollapsed(contentId, !willExpand);
        this.emitStateChange();
        return !willExpand; // 返回新的状态
    }

    /**
     * 设置区域折叠状态
     */
    setSectionCollapsed(contentId, collapsed) {
        if (contentId === 'openFilesContent') {
            this.sectionStates.openFilesCollapsed = collapsed;
        } else if (contentId === 'foldersContent') {
            this.sectionStates.foldersCollapsed = collapsed;
        }
    }

    /**
     * 获取区域折叠状态
     */
    getSectionCollapsed(contentId) {
        if (contentId === 'openFilesContent') {
            return this.sectionStates.openFilesCollapsed;
        } else if (contentId === 'foldersContent') {
            return this.sectionStates.foldersCollapsed;
        }
        return false;
    }

    /**
     * 获取所有区域状态
     */
    getSectionStates() {
        return { ...this.sectionStates };
    }

    // ========== 状态持久化 ==========

    /**
     * 获取需要持久化的状态
     */
    getPersistedState() {
        return {
            rootPaths: Array.from(this.rootPaths),
            expandedFolders: Array.from(this.expandedFolders),
            sectionStates: { ...this.sectionStates },
        };
    }

    /**
     * 从持久化状态中恢复
     */
    restoreState(state) {
        if (!state) return;

        if (Array.isArray(state.rootPaths)) {
            this.rootPaths = new Set(state.rootPaths);
        }

        if (Array.isArray(state.expandedFolders)) {
            this.expandedFolders = new Set(state.expandedFolders);
        }

        if (state.sectionStates) {
            this.sectionStates = { ...this.sectionStates, ...state.sectionStates };
        }
    }

    // ========== 事件触发 ==========

    /**
     * 触发状态变更事件
     */
    emitStateChange() {
        if (typeof this.onStateChange === 'function') {
            this.onStateChange(this.getPersistedState());
        }
    }

    /**
     * 触发打开文件列表变更事件
     */
    emitOpenFilesChange() {
        if (typeof this.onOpenFilesChange === 'function') {
            this.onOpenFilesChange([...this.openFiles]);
        }
    }

    // ========== 重置 ==========

    /**
     * 重置所有状态
     */
    reset() {
        this.rootPaths.clear();
        this.expandedFolders.clear();
        this.currentFile = null;
        this.openFiles = [];
        this.sectionStates = {
            openFilesCollapsed: false,
            foldersCollapsed: false,
        };
    }
}
