import { normalizeFsPath, getPathIdentityKey } from '../../utils/pathUtils.js';
import { getExternalDropOpener } from '../../modules/fileOperations.js';
import { getAppServices } from '../../services/appServices.js';
import { FileRenamer } from '../FileRenamer.js';
import { FileMover } from '../FileMover.js';
import { FileWatcher } from '../FileWatcher.js';
import { OpenFilesView } from '../OpenFilesView.js';
import { ExternalDropHandler } from '../ExternalDropHandler.js';
import { FileTreeContextMenu } from '../FileTreeContextMenu.js';
import { FileTreeRenderer } from './FileTreeRenderer.js';
import { FileTreeState } from './FileTreeState.js';
import { FileTreeEvents } from './FileTreeEvents.js';
import { captureSecurityScopeForPath } from '../../services/securityScopeService.js';
import { FolderRenamer } from './FolderRenamer.js';
import { FileCreator } from './FileCreator.js';
import { FolderLoader } from './FolderLoader.js';
import { OpenFileManager } from './OpenFileManager.js';
import { FileActions } from './FileActions.js';
import { scheduleCompactFileNameRefresh } from '../../utils/fileNameDisplay.js';

function extractPathFromFolderKey(folderKey) {
    if (!folderKey) return '';
    const segments = String(folderKey).split('::');
    return segments[segments.length - 1] || '';
}

export class FileTree {
    constructor(containerElement, onFileSelect, callbacks = {}) {
        const {
            onFolderChange,
            onFileChange,
            onOpenFilesChange,
            onStateChange,
            beforeFileSelect,
            executeCommand,
            onCloseFileRequest,
            onPathRenamed,
            onRunFile,
            onOpenFileRequest,
            onOpenFolderRequest,
            documentSessions = null,
        } = callbacks;

        this.onRunFile = onRunFile;
        this.container = containerElement;
        this.onFileSelect = onFileSelect;
        this.services = null;
        this.fileService = null;
        this.onFolderChange = onFolderChange;
        this.onFileChange = onFileChange;
        this.onOpenFilesChange = onOpenFilesChange;
        this.beforeFileSelect = beforeFileSelect;
        this.executeCommand = executeCommand;
        this.onCloseFileRequest = onCloseFileRequest;
        this.onPathRenamed = onPathRenamed;
        this.onOpenFileRequest = onOpenFileRequest;
        this.onOpenFolderRequest = onOpenFolderRequest;
        this.cleanupFunctions = [];
        this.documentSessions = documentSessions;
        this.pendingRefreshPaths = new Set();
        this.labelResizeObserver = null;

        this.state = new FileTreeState(this, { onStateChange });
        this.renderer = new FileTreeRenderer(this);
        this.events = new FileTreeEvents(this);

        this.folderRenamer = new FolderRenamer({
            container: this.container,
            normalizePath: this.normalizePath.bind(this),
            getFileService: () => this.fileService,
            refreshFolder: (path) => this.refreshFolder(path),
            handleMoveSuccess: (src, dst, meta) => this.handleMoveSuccess(src, dst, meta),
            watchFolder: (path) => this.watchFolder(path),
            stopWatchingFolder: (path) => this.stopWatchingFolder(path),
            isRootPath: (path) => this.state.isRootPath(path),
            replaceRootPath: (oldPath, newPath) => {
                this.state.removeRootPath(oldPath);
                this.state.addRootPath(newPath);
            },
            onRenamingEnd: () => this.flushPendingRefresh(),
        });

        this.creator = new FileCreator({
            normalizePath: this.normalizePath.bind(this),
            getFileService: () => this.fileService,
            markLocalWrite: (path, opts) => this.markLocalWrite(path, opts),
            refreshFolder: (path) => this.refreshFolder(path),
            selectFile: (path, opts) => this.selectFile(path, opts),
            startRenaming: (path, meta) => this.startRenaming(path, meta),
        });

        this.init();
        this.ensureFileService();

        this.watcher = new FileWatcher({
            normalizePath: this.normalizePath.bind(this),
            getFileService: () => this.fileService,
            ensureFileService: () => this.ensureFileService(),
            onFolderChange: this.onFolderChange,
            onFileChange: this.onFileChange,
            getRootPaths: () => this.state.getRootPaths(),
            isRootPath: (path) => this.state.isRootPath(path),
            loadFolder: (path) => this.loadFolder(path),
            getExpandedFolderPaths: () => this.getExpandedFolderPaths(),
        });

        this.mover = new FileMover({
            container: this.container,
            normalizePath: this.normalizePath.bind(this),
            getFileService: () => this.fileService,
            refreshFolder: (folderPath) => this.refreshFolder(folderPath),
            onMove: (source, destination, meta = {}) => this.handleMoveSuccess(source, destination, meta),
        });

        this.renamer = new FileRenamer({
            container: this.container,
            normalizePath: this.normalizePath.bind(this),
            getFileService: () => this.fileService,
            replaceOpenFilePath: this.replaceOpenFilePath.bind(this),
            selectFile: this.selectFile.bind(this),
            getCurrentFile: () => this.state.getCurrentFile(),
            onPathRenamed: this.onPathRenamed,
            refreshFolder: (folderPath) => this.refreshFolder(folderPath),
            documentSessions: this.documentSessions,
            onRenamingEnd: () => this.flushPendingRefresh(),
        });

        this.openFilesView = new OpenFilesView({
            container: this.container.querySelector('#openFilesContent'),
            normalizePath: this.normalizePath.bind(this),
            watchFile: (path) => this.watchFile(path),
            shouldBlockInteraction: () => this.mover?.shouldBlockInteraction?.(),
            onSelect: (path) => this.selectFile(path),
            onClose: (path) => {
                if (typeof this.onCloseFileRequest === 'function') {
                    const maybePromise = this.onCloseFileRequest(path);
                    if (maybePromise && typeof maybePromise.then === 'function') {
                        maybePromise.catch(error => {
                            console.error('关闭文件请求失败:', error);
                        });
                        return;
                    }
                }
                this.closeFile(path);
            },
            onRenameRequest: (path) => this.startRenaming(path),
            isRenaming: () => this.isRenaming(),
        });

        this.externalDropHandler = new ExternalDropHandler({
            container: this.container,
            openPathsFromSelection: (paths, options = {}) => {
                const opener = getExternalDropOpener();
                if (!opener) {
                    console.warn('[FileTree] openPathsFromSelection 未注入，无法处理外部拖拽');
                    return;
                }
                return opener(paths, options);
            },
            ensureSecurityScope: (path) => this.ensureSecurityScope(path),
        });

        this.loader = new FolderLoader({
            container: this.container,
            normalizePath: this.normalizePath.bind(this),
            getFileService: () => this.ensureFileService(),
            state: this.state,
            renderer: this.renderer,
            buildFolderKey: this.buildFolderKey.bind(this),
            watchFolder: (path) => this.watchFolder(path),
            emitStateChange: () => this.emitStateChange(),
            shouldDefer: (path) => this.shouldDeferRefresh(path),
            onRefreshDeferred: (path) => this.pendingRefreshPaths.add(path),
            onBeforeRefresh: () => this.ensureRenamingState(),
        });

        this.openFileManager = new OpenFileManager({
            normalizePath: this.normalizePath.bind(this),
            state: this.state,
            getOpenFilesView: () => this.openFilesView,
            watchFile: (path, opts) => this.watchFile(path, opts),
            stopWatchingFile: (path) => this.stopWatchingFile(path),
            selectFile: (path, opts) => this.selectFile(path, opts),
            clearSelection: () => this.clearSelection(),
            onFileSelect: this.onFileSelect,
            onOpenFilesChange: this.onOpenFilesChange,
            onPathRenamed: this.onPathRenamed,
        });

        this.fileActions = new FileActions({
            normalizePath: this.normalizePath.bind(this),
            getFileService: () => this.ensureFileService(),
            refreshFolder: (path) => this.refreshFolder(path),
            handleMoveSuccess: (src, dst, meta) => this.handleMoveSuccess(src, dst, meta),
            stopWatchingFile: (path) => this.stopWatchingFile(path),
            closeFile: (path, opts) => this.closeFile(path, opts),
            clearSelection: () => this.clearSelection(),
            isInOpenList: (path) => this.isInOpenList(path),
            getCurrentFile: () => this.state.getCurrentFile(),
            onFileSelect: this.onFileSelect,
            onCloseFileRequest: this.onCloseFileRequest,
        });

        this.contextMenu = new FileTreeContextMenu({
            container: this.container,
            executeCommand: this.executeCommand,
            getTargetPath: (item) => this.normalizePath(item?.dataset?.path),
            onRename: (path, meta) => this.startRenaming(path, meta),
            onMove: (path, meta) => this.fileActions.promptMoveTo(path, meta),
            onReveal: (path) => this.fileActions.revealInFinder(path),
            onDelete: (path) => this.fileActions.confirmAndDelete(path),
            onCreateFile: (path) => this.creator.createFile(path),
            onCreateFolder: (path) => this.creator.createFolder(path),
            onRun: (path) => this.onRunFile?.(path),
        });
    }

    async ensureSecurityScope(path, options = {}) {
        const normalized = this.normalizePath(path);
        if (!normalized) return;
        try {
            await captureSecurityScopeForPath(normalized, options);
        } catch (error) {
            console.warn('[fileTree] 捕获安全权限失败', error);
        }
    }

    normalizePath(path) {
        return normalizeFsPath(path);
    }

    folderKeyBelongsToRoot(folderKey, rootPath) {
        const rootCanonical = this.normalizePath(rootPath);
        if (!rootCanonical) return false;

        const folderPath = extractPathFromFolderKey(folderKey);
        const folderCanonical = this.normalizePath(folderPath);
        if (!folderCanonical) return false;

        const rootIdentity = getPathIdentityKey(rootCanonical);
        const folderIdentity = getPathIdentityKey(folderCanonical);
        if (!rootIdentity || !folderIdentity) return false;
        if (rootIdentity === folderIdentity) return true;

        const ensureTrailingSeparator = (value) => {
            if (!value || value.endsWith('/') || value.endsWith('\\')) return value;
            const separator = value.includes('\\') ? '\\' : '/';
            return `${value}${separator}`;
        };

        const rootPrefix = ensureTrailingSeparator(rootIdentity);
        return rootPrefix && folderIdentity.startsWith(rootPrefix);
    }

    isPathWithinRoot(path, rootPath) {
        const normalizedPath = this.normalizePath(path);
        const normalizedRoot = this.normalizePath(rootPath);
        if (!normalizedPath || !normalizedRoot) return false;

        const pathIdentity = getPathIdentityKey(normalizedPath);
        const rootIdentity = getPathIdentityKey(normalizedRoot);
        if (!pathIdentity || !rootIdentity) return false;
        if (pathIdentity === rootIdentity) return true;

        const separator = normalizedRoot.includes('\\') ? '\\' : '/';
        const rootPrefix = normalizedRoot.endsWith(separator)
            ? rootIdentity
            : `${rootIdentity}${separator}`;
        return pathIdentity.startsWith(rootPrefix);
    }

    markLocalWrite(path, options = {}) {
        if (!this.documentSessions || typeof this.documentSessions.markLocalWrite !== 'function') return;
        const normalizedPath = this.normalizePath(path);
        if (!normalizedPath) return;
        const suppressWatcherMs = Number.isFinite(options.durationMs)
            ? Math.max(0, options.durationMs)
            : 1200;
        this.documentSessions.markLocalWrite(normalizedPath, { suppressWatcherMs });
    }

    buildFolderKey(path, parentPath = null, isRoot = false) {
        if (isRoot) return `root::${path}`;
        const parentSegment = parentPath ?? '';
        return `${parentSegment}::${path}`;
    }

    isInOpenList(path) { return this.state.isInOpenList(path); }
    isFileOpen(path) { return this.state.isFileOpen(path); }

    // ========== 状态访问器 ==========

    get rootPaths() { return this.state.rootPaths; }
    set rootPaths(value) { this.state.rootPaths = value; }

    get expandedFolders() { return this.state.expandedFolders; }
    set expandedFolders(value) { this.state.expandedFolders = value; }

    get currentFile() { return this.state.currentFile; }
    set currentFile(value) { this.state.currentFile = value; }

    get openFiles() { return this.state.openFiles; }
    set openFiles(value) { this.state.openFiles = value; }

    get sectionStates() { return this.state.sectionStates; }

    init() {
        this.renderer.initContainer();
        this.events.setupEventListeners();
        this.events.applySectionStates();
        this.setupCompactNameObserver();
    }

    setupCompactNameObserver() {
        if (typeof window === 'undefined' || typeof window.ResizeObserver !== 'function') {
            return;
        }

        this.labelResizeObserver?.disconnect?.();
        this.labelResizeObserver = new window.ResizeObserver(() => {
            scheduleCompactFileNameRefresh(this.container);
        });
        this.labelResizeObserver.observe(this.container);

        const sidebar = document.getElementById('sidebar');
        if (sidebar) {
            this.labelResizeObserver.observe(sidebar);
        }

        const resizer = document.getElementById('sidebarResizer');
        if (resizer) {
            this.labelResizeObserver.observe(resizer);
        }
    }

    toggleSection(contentId) { this.events.handleSectionToggle(contentId); }
    updateSectionCollapsedState(contentId, collapsed) { this.state.setSectionCollapsed(contentId, collapsed); }
    emitStateChange() { this.state.emitStateChange(); }
    getPersistedState() { return this.state.getPersistedState(); }

    // ========== 文件夹加载（委托 FolderLoader）==========

    async requestOpenFolder() { return this.loader.requestOpenFolder(); }
    async loadFolder(path) { return this.loader.loadFolder(path); }
    async toggleFolder(path, el) { return this.loader.toggleFolder(path, el); }
    async loadFolderChildren(path, container, prefetched) { return this.loader.loadFolderChildren(path, container, prefetched); }
    async refreshFolder(path) { return this.loader.refreshFolder(path); }
    async refreshCurrentFolder(targetPath) { return this.loader.refreshCurrentFolder(targetPath); }
    findRootFolderElementByPath(path) { return this.loader.findRootFolderElement(path); }

    // ========== 开放文件管理（委托 OpenFileManager）==========

    bindDocumentManager(dm) { return this.openFileManager.bindDocumentManager(dm); }
    addToOpenFiles(path) { return this.openFileManager.add(path); }
    replaceOpenFilePath(oldPath, newPath) { return this.openFileManager.replacePath(oldPath, newPath); }
    renderOpenFiles(options) { return this.openFileManager.render(options); }
    closeFile(path, options) { return this.openFileManager.close(path, options); }
    handleMoveSuccess(src, dst, meta) { return this.openFileManager.handleMoveSuccess(src, dst, meta); }
    restoreOpenFiles(paths) { return this.openFileManager.restore(paths); }
    reorderOpenFiles(paths) { return this.openFileManager.reorder(paths); }
    getOpenFilePaths() { return this.openFileManager.getOpenFilePaths(); }

    // ========== 文件操作（委托 FileActions）==========

    async promptMoveTo(path, meta) { return this.fileActions.promptMoveTo(path, meta); }
    async revealInFinder(path) { return this.fileActions.revealInFinder(path); }
    async confirmAndDelete(path) { return this.fileActions.confirmAndDelete(path); }

    // ========== 创建操作（向后兼容存根）==========

    async createFileInFolder(folderPath) { return this.creator.createFile(folderPath); }
    async createFolderInFolder(folderPath) { return this.creator.createFolder(folderPath); }
    async createWorkflowInFolder(folderPath) { return this.creator.createWorkflow(folderPath); }

    // ========== 文件选择 ==========

    async selectFile(path, options = {}) {
        const { autoFocus = true, preserveFocus = false, silent = false } = options;
        const normalized = this.normalizePath(path);
        if (!normalized) {
            this.clearSelection();
            this.currentFile = null;
            if (!silent && this.onFileSelect) this.onFileSelect(null, { autoFocus });
            return;
        }

        if (!silent && typeof this.beforeFileSelect === 'function') {
            const shouldContinue = await this.beforeFileSelect(normalized, {
                autoFocus,
                preserveFocus,
            });
            if (shouldContinue === false) {
                return;
            }
        }

        this.container.querySelectorAll('.tree-file.selected, .open-file-item.selected').forEach(el => {
            el.classList.remove('selected');
        });

        const shouldManageFocus = !autoFocus && !preserveFocus;

        // 用遍历 + 严格相等替代 CSS 属性选择器，避免中文路径的 Unicode 编码问题
        const fileItem = Array.from(this.container.querySelectorAll('.tree-file'))
            .find(el => el.dataset.path === normalized);
        if (fileItem) fileItem.classList.add('selected');

        const openFileItem = Array.from(this.container.querySelectorAll('.open-file-item'))
            .find(el => el.dataset.path === normalized);
        if (openFileItem) openFileItem.classList.add('selected');

        this.currentFile = normalized;

        if (shouldManageFocus) {
            const activeElement = typeof document !== 'undefined' ? document.activeElement : null;
            const focusTarget = [fileItem, openFileItem].filter(Boolean).find((element) => {
                if (!element) return false;
                if (element.contains(activeElement)) return false;
                if (element.querySelector('.tree-file-rename-input')) return false;
                return true;
            });
            if (focusTarget) {
                try { focusTarget.focus({ preventScroll: true }); } catch {}
            }
        }

        if (!silent && this.onFileSelect) this.onFileSelect(normalized, { autoFocus });

        if (!silent) {
            this.ensureFileWatcherHealth(normalized).catch(error => {
                console.warn('文件监听健康检查失败:', { path: normalized, error });
            });
        }
    }

    clearSelection() {
        this.container.querySelectorAll('.tree-file.selected, .open-file-item.selected').forEach(el => {
            el.classList.remove('selected');
        });
        this.currentFile = null;
    }

    // ========== 文件夹关闭/置顶 ==========

    closeFolder(path) {
        const normalizedPath = this.normalizePath(path);
        const existingRootPath = this.state.findRootPathEntry(normalizedPath);
        if (!normalizedPath || !existingRootPath) return;

        this.state.removeRootPath(existingRootPath);

        const keysToRemove = [];
        this.expandedFolders.forEach((key) => {
            if (this.folderKeyBelongsToRoot(key, existingRootPath)) keysToRemove.push(key);
        });
        keysToRemove.forEach((key) => this.expandedFolders.delete(key));

        this.stopWatchingFolder(existingRootPath);

        const folderElement = this.loader.findRootFolderElement(existingRootPath);
        if (folderElement?.parentElement) folderElement.parentElement.removeChild(folderElement);

        const currentNormalized = this.normalizePath(this.currentFile);
        if (this.isPathWithinRoot(currentNormalized, existingRootPath) && !this.isInOpenList(currentNormalized)) {
            this.clearSelection();
            if (this.onFileSelect) this.onFileSelect(null);
        }

        this.emitStateChange();
    }

    moveRootFolderUp(path) {
        const normalizedPath = this.normalizePath(path);
        const existingRootPath = this.state.findRootPathEntry(normalizedPath);
        if (!normalizedPath || !existingRootPath) return;

        const ordered = Array.from(this.rootPaths);
        const index = ordered.indexOf(existingRootPath);
        if (index <= 0) return;

        [ordered[index - 1], ordered[index]] = [ordered[index], ordered[index - 1]];
        this.rootPaths = new Set(ordered);

        this.reorderRootFolderElements();
        this.emitStateChange();
    }

    moveRootFolderDown(path) {
        const normalizedPath = this.normalizePath(path);
        const existingRootPath = this.state.findRootPathEntry(normalizedPath);
        if (!normalizedPath || !existingRootPath) return;

        const ordered = Array.from(this.rootPaths);
        const index = ordered.indexOf(existingRootPath);
        if (index < 0 || index >= ordered.length - 1) return;

        [ordered[index], ordered[index + 1]] = [ordered[index + 1], ordered[index]];
        this.rootPaths = new Set(ordered);

        this.reorderRootFolderElements();
        this.emitStateChange();
    }

    reorderRootFolderElements() {
        const contentDiv = this.container.querySelector('#foldersContent');
        if (!contentDiv) return;

        const ordered = Array.from(this.rootPaths);
        for (let i = ordered.length - 1; i >= 0; i--) {
            const folderElement = this.loader.findRootFolderElement(ordered[i]);
            if (folderElement && folderElement.parentElement === contentDiv) {
                contentDiv.removeChild(folderElement);
                contentDiv.insertBefore(folderElement, contentDiv.firstChild);
            }
        }
    }

    // ========== 文件监听（委托 FileWatcher）==========

    async watchFolder(path) { return this.watcher?.watchFolder(path); }
    stopWatchingFolder(path = null) { this.watcher?.stopWatchingFolder(path); }
    async watchFile(path, options = {}) { return this.watcher?.watchFile(path, options); }
    stopWatchingFile(path) { this.watcher?.stopWatchingFile(path); }
    async ensureFileWatcherHealth(path, options = {}) { return this.watcher?.ensureFileWatcherHealth(path, options); }
    async restartFileWatcher(path, options = {}) { return this.watcher?.restartFileWatcher(path, options); }
    consumeExternalModification(path) { return this.watcher?.consumeExternalModification(path); }
    clearExternalModification(path) { this.watcher?.clearExternalModification(path); }

    // ========== 状态查询 ==========

    getRootPaths() { return Array.from(this.rootPaths); }
    hasRoot(path) {
        const normalizedPath = this.normalizePath(path);
        return normalizedPath ? this.state.isRootPath(normalizedPath) : false;
    }

    getExpandedFolderPaths() {
        const paths = new Set();
        this.state.getExpandedFolders().forEach((key) => {
            if (!key) return;
            const normalized = this.normalizePath(extractPathFromFolderKey(key));
            if (normalized) paths.add(normalized);
        });
        return Array.from(paths);
    }

    async restoreState(state = {}) {
        const rootPaths = Array.isArray(state.rootPaths)
            ? state.rootPaths.map(path => this.normalizePath(path)).filter(Boolean)
            : [];
        const expandedFolders = Array.isArray(state.expandedFolders)
            ? state.expandedFolders.filter(key => typeof key === 'string' && key.length > 0)
            : [];

        this.state.restoreState({ rootPaths, expandedFolders, sectionStates: state.sectionStates });
        this.events.applySectionStates();

        const contentDiv = this.container.querySelector('#foldersContent');
        if (contentDiv) contentDiv.innerHTML = '';

        for (const path of [...rootPaths].reverse()) {
            try {
                await this.loadFolder(path);
            } catch (error) {
                console.warn('恢复文件夹失败:', path, error);
            }
        }
    }

    // ========== 文件服务 ==========

    ensureFileService() {
        if (this.fileService) return this.fileService;
        this.services = getAppServices();
        if (!this.services?.file) throw new Error('文件服务未初始化');
        this.fileService = this.services.file;
        return this.fileService;
    }

    // ========== 重命名 ==========

    startRenaming(path, meta = {}) {
        if (this.mover?.shouldBlockInteraction?.()) return;
        const targetType = meta?.targetType || 'file';
        if (targetType === 'folder') {
            this.folderRenamer.start(path);
        } else {
            this.renamer?.start(path);
        }
    }

    cancelRenaming(ctx = {}) {
        this.renamer?.cancel(ctx);
        this.folderRenamer.cancel();
    }

    isRenaming() {
        return (this.renamer?.isRenaming() ?? false) || this.folderRenamer.isRenaming();
    }

    ensureRenamingState() {
        if (!this.isRenaming()) return;
        const hasInput = Boolean(this.container?.querySelector('.tree-file-rename-input'));
        if (hasInput) return;
        this.renamer?.cancel();
        this.folderRenamer.cancel();
    }

    shouldDeferRefresh(folderPath) {
        const normalized = this.normalizePath(folderPath);
        if (!normalized) return false;
        const activePath = this.renamer?.getRenamingPath?.() || this.folderRenamer.getRenamingPath();
        if (!activePath) return false;
        const sep = normalized.includes('\\') ? '\\' : '/';
        return activePath === normalized || activePath.startsWith(`${normalized}${sep}`);
    }

    flushPendingRefresh() {
        if (this.pendingRefreshPaths.size === 0) return;
        const pending = Array.from(this.pendingRefreshPaths);
        this.pendingRefreshPaths.clear();
        setTimeout(() => {
            pending.forEach((path) => this.refreshFolder(path));
        }, 0);
    }

    // ========== 销毁 ==========

    dispose() {
        this.mover?.dispose();
        this.watcher?.dispose();
        this.openFilesView?.dispose();
        this.contextMenu?.dispose();
        this.openFileManager?.dispose();
        this.labelResizeObserver?.disconnect?.();
        this.labelResizeObserver = null;
        this.cancelRenaming();
        this.cleanupFunctions.forEach(cleanup => {
            if (typeof cleanup === 'function') cleanup();
        });
        this.cleanupFunctions = [];
        this.events.cleanup();
        this.stopWatchingFolder();
        this.openFiles = [];
        this.expandedFolders.clear();
        this.rootPaths.clear();
    }
}
