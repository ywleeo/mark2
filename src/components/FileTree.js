import { addClickHandler } from '../utils/PointerHelper.js';
import { isEditableFilePath, getViewModeForPath } from '../utils/fileTypeUtils.js';
import { getAppServices } from '../services/appServices.js';
import { FileRenamer } from './FileRenamer.js';
import { FileMover } from './FileMover.js';
import { FileWatcher } from './FileWatcher.js';
import { OpenFilesView } from './OpenFilesView.js';
import { ExternalDropHandler } from './ExternalDropHandler.js';
import { FileTreeContextMenu } from './FileTreeContextMenu.js';

export class FileTree {
    constructor(containerElement, onFileSelect, callbacks = {}) {
        const {
            onFolderChange,
            onFileChange,
            onOpenFilesChange,
            onStateChange,
            onCloseFileRequest,
            onPathRenamed,
            documentSessions = null,
        } = callbacks;

        this.container = containerElement;
        this.onFileSelect = onFileSelect;
        this.services = null;
        this.fileService = null;
        this.rootPaths = new Set();
        this.expandedFolders = new Set();
        this.currentFile = null;
        this.openFiles = []; // 跟踪打开的文件
        this.onFolderChange = onFolderChange;
        this.onFileChange = onFileChange;
        this.onOpenFilesChange = onOpenFilesChange;
        this.onStateChange = onStateChange;
        this.onCloseFileRequest = onCloseFileRequest;
        this.onPathRenamed = onPathRenamed;
        this.sectionStates = {
            openFilesCollapsed: false,
            foldersCollapsed: false,
        };
        this.cleanupFunctions = []; // 存储清理函数
        this.documentSessions = documentSessions;

        // 文件夹重命名状态
        this.folderRenamingPath = null;
        this._folderRenameCleanup = null;

        this.init();
        this.ensureFileService();

        this.watcher = new FileWatcher({
            normalizePath: this.normalizePath.bind(this),
            getFileService: () => this.fileService,
            ensureFileService: () => this.ensureFileService(),
            onFolderChange: this.onFolderChange,
            onFileChange: this.onFileChange,
            getRootPaths: () => Array.from(this.rootPaths),
            isRootPath: (path) => this.rootPaths.has(path),
            loadFolder: (path) => this.loadFolder(path),
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
            getCurrentFile: () => this.currentFile,
            onPathRenamed: this.onPathRenamed,
            refreshFolder: (folderPath) => this.refreshFolder(folderPath),
            documentSessions: this.documentSessions,
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
            readDirectory: (path) => this.readDirectory(path),
            addRootFolder: (path, { entries } = {}) => this.addRootFolder(path, entries || null),
            refreshFolder: (path) => this.refreshFolder(path),
        });

        this.contextMenu = new FileTreeContextMenu({
            container: this.container,
            getTargetPath: (item) => this.normalizePath(item?.dataset?.path),
            onRename: (path, meta) => this.startRenaming(path, meta),
            onMove: (path, meta) => this.promptMoveTo(path, meta),
            onReveal: (path /*, meta */) => this.revealInFinder(path),
            onDelete: (path /*, meta */) => this.confirmAndDelete(path),
            onCreateFile: (path /*, meta */) => this.createFileInFolder(path),
            onCreateFolder: (path /*, meta */) => this.createFolderInFolder(path),
        });
    }

    normalizePath(path) {
        if (!path) return path;
        if (typeof path === 'string' && path.startsWith('file://')) {
            try {
                const url = new URL(path);
                return decodeURI(url.pathname);
            } catch (error) {
                console.warn('无法解析路径 URL:', path, error);
            }
        }
        return path;
    }

    markLocalWrite(path, options = {}) {
        if (!this.documentSessions || typeof this.documentSessions.markLocalWrite !== 'function') {
            return;
        }
        const normalizedPath = this.normalizePath(path);
        if (!normalizedPath) {
            return;
        }
        const suppressWatcherMs = Number.isFinite(options.durationMs)
            ? Math.max(0, options.durationMs)
            : 1200;
        this.documentSessions.markLocalWrite(normalizedPath, { suppressWatcherMs });
    }

    buildFolderKey(path, parentPath = null, isRoot = false) {
        if (isRoot) {
            return `root::${path}`;
        }
        const parentSegment = parentPath ?? '';
        return `${parentSegment}::${path}`;
    }

    isInOpenList(path) {
        const normalized = this.normalizePath(path);
        return this.openFiles.some(item => item === normalized);
    }

    isFileOpen(path) {
        const normalized = this.normalizePath(path);
        const normalizedCurrent = this.normalizePath(this.currentFile);
        const isInOpenList = this.isInOpenList(path);
        const isCurrent = normalizedCurrent === normalized;
        return isInOpenList || isCurrent;
    }

    init() {
        this.container.innerHTML = `
            <!-- 打开的文件区域 -->
            <div class="sidebar-section open-files-section">
                <div class="section-header" id="openFilesHeader">
                    <svg class="section-arrow" width="8" height="8" viewBox="0 0 8 8">
                        <path d="M1 2 L4 5 L7 2" stroke="currentColor" stroke-width="1.5" fill="none"/>
                    </svg>
                    <span class="section-title">打开的文件</span>
                </div>
                <div class="section-content" id="openFilesContent"></div>
            </div>

            <!-- 文件夹区域 -->
            <div class="sidebar-section folders-section">
                <div class="section-header" id="foldersHeader">
                    <svg class="section-arrow" width="8" height="8" viewBox="0 0 8 8">
                        <path d="M1 2 L4 5 L7 2" stroke="currentColor" stroke-width="1.5" fill="none"/>
                    </svg>
                    <span class="section-title">文件夹</span>
                </div>
                <div class="section-content" id="foldersContent"></div>
            </div>
        `;

        this.setupEventListeners();
        this.applySectionStates();
    }

    setupEventListeners() {
        // 区域折叠
        this.container.querySelector('#openFilesHeader')?.addEventListener('click', () => {
            this.toggleSection('openFilesContent');
        });

        this.container.querySelector('#foldersHeader')?.addEventListener('click', () => {
            this.toggleSection('foldersContent');
        });

        // 文件树容器级拖拽监听（更可靠的命中）
        this._onTreeDragOver = (e) => this.mover?.handleTreeDragOver(e);
        this._onTreeDragLeave = (e) => this.mover?.handleTreeDragLeave(e);
        this._onTreeDrop = (e) => {
            // 外部文件拖入
            if (!window.__IS_INTERNAL_DRAG__) {
                this.externalDropHandler?.handleDrop(e);
                return;
            }
            this.mover?.handleTreeDrop(e);
        };
        this._onTreeDragEnter = (e) => {
            if (!window.__IS_INTERNAL_DRAG__) {
                this.externalDropHandler?.handleDragOver(e);
                return;
            }
        };
        this.container.addEventListener('dragover', this._onTreeDragOver);
        this.container.addEventListener('dragenter', this._onTreeDragEnter);
        this.container.addEventListener('dragleave', this._onTreeDragLeave);
        this.container.addEventListener('drop', this._onTreeDrop);

        console.log('[FileTree] container DnD listeners attached');

        // 部分环境下 dragover 可能被系统级拦截，这里用 mousemove 兜底
        this._onMouseMoveDuringDrag = (e) => {
            if (!window.__IS_INTERNAL_DRAG__) return;
            // 构造一个伪事件对象传给 handleTreeDragOver（只用到 clientX/clientY）
            // console.log('[mousemove during drag]', e.clientX, e.clientY);
            this.mover?.handleTreeDragOver({ clientX: e.clientX, clientY: e.clientY, dataTransfer: null, preventDefault() {}, stopPropagation() {} });
        };
        window.addEventListener('mousemove', this._onMouseMoveDuringDrag);
        console.log('[FileTree] window mousemove fallback attached');
    }

    async promptMoveTo(sourcePath, meta = {}) {
        const normalizedSource = this.normalizePath(sourcePath);
        if (!normalizedSource) {
            return;
        }

        const isDirectory = meta?.isDirectory === true || meta?.targetType === 'folder';
        try {
            const [{ open }, pathModule] = await Promise.all([
                import('@tauri-apps/plugin-dialog'),
                import('@tauri-apps/api/path'),
            ]);

            const selection = await open({
                directory: true,
                multiple: false,
            });
            const targetDirectory = Array.isArray(selection) ? selection[0] : selection;
            const normalizedTargetDir = this.normalizePath(targetDirectory);
            if (!normalizedTargetDir) {
                return;
            }

            const fileName = await pathModule.basename(normalizedSource);
            const destinationPath = await pathModule.join(normalizedTargetDir, fileName);
            const normalizedDestination = this.normalizePath(destinationPath);
            if (normalizedDestination && normalizedDestination === normalizedSource) {
                return;
            }

            const fileService = this.ensureFileService();
            await fileService.move(normalizedSource, normalizedDestination);

            const sourceParent = await pathModule.dirname(normalizedSource);
            const destinationParent = await pathModule.dirname(normalizedDestination);
            const refreshTasks = [];
            if (sourceParent) {
                refreshTasks.push(this.refreshFolder(sourceParent));
            }
            if (destinationParent && destinationParent !== sourceParent) {
                refreshTasks.push(this.refreshFolder(destinationParent));
            }
            await Promise.all(refreshTasks);

            await this.handleMoveSuccess(normalizedSource, normalizedDestination, { isDirectory });
        } catch (error) {
            console.error('移动文件失败:', error);
            try {
                const { message } = await import('@tauri-apps/plugin-dialog');
                await message(`无法移动文件:\n${error.message || error}`, { title: '移动失败', kind: 'error' });
            } catch {}
        }
    }

    async revealInFinder(path) {
        const normalized = this.normalizePath(path);
        if (!normalized) return;
        try {
            const fileService = this.ensureFileService();
            await fileService.reveal(normalized);
        } catch (error) {
            console.error('打开 Finder 失败:', error);
            try {
                const { message } = await import('@tauri-apps/plugin-dialog');
                await message(`无法在 Finder 中打开:\n${error.message || error}`, { title: '操作失败', kind: 'error' });
            } catch {}
        }
    }

    async confirmAndDelete(path) {
        const normalized = this.normalizePath(path);
        if (!normalized) return;
        try {
            const [{ confirm, message }, pathModule] = await Promise.all([
                import('@tauri-apps/plugin-dialog'),
                import('@tauri-apps/api/path'),
            ]);
            const fileName = await pathModule.basename(normalized);
            const shouldDelete = await confirm(`确认删除文件 "${fileName}" 吗？`, {
                title: '删除文件',
                kind: 'warning',
                okLabel: '删除',
                cancelLabel: '取消',
            });
            if (!shouldDelete) {
                return;
            }

            const fileService = this.ensureFileService();
            await fileService.remove(normalized);

            this.stopWatchingFile(normalized);
            if (this.isInOpenList(normalized)) {
                this.closeFile(normalized, { suppressActivate: true });
            }
            if (this.normalizePath(this.currentFile) === normalized) {
                this.clearSelection();
                if (this.onFileSelect) {
                    this.onFileSelect(null);
                }
            }

            const parentDir = await pathModule.dirname(normalized);
            const normalizedParent = this.normalizePath(parentDir);
            if (normalizedParent) {
                await this.refreshFolder(normalizedParent);
            }
        } catch (error) {
            console.error('删除文件失败:', error);
            try {
                const { message } = await import('@tauri-apps/plugin-dialog');
                await message(`删除文件失败:\n${error.message || error}`, { title: '删除失败', kind: 'error' });
            } catch {}
        }
    }

    async createFileInFolder(folderPath) {
        const normalized = this.normalizePath(folderPath);
        if (!normalized) return;
        try {
            const pathModule = await import('@tauri-apps/api/path');
            const fileService = this.ensureFileService();

            // 为避免聚焦到已存在的同名文件，这里自动寻找可用的名称：
            // untitled.md, untitled-1.md, untitled-2.md, ...
            const baseName = 'untitled';
            const ext = '.md';
            let candidatePath = null;
            let attempts = 0;

            // 理论上不太可能无限循环，这里加一个安全上限
            while (attempts < 1000) {
                const suffix = attempts === 0 ? '' : `-${attempts}`;
                const fileName = `${baseName}${suffix}${ext}`;
                const joined = await pathModule.join(normalized, fileName);
                const normalizedCandidate = this.normalizePath(joined);
                if (!normalizedCandidate) {
                    attempts += 1;
                    continue;
                }

                const exists = await fileService.exists(normalizedCandidate);
                if (!exists) {
                    candidatePath = normalizedCandidate;
                    break;
                }
                attempts += 1;
            }

            if (!candidatePath) {
                throw new Error('无法找到可用的文件名');
            }

            this.markLocalWrite(candidatePath);
            this.markLocalWrite(normalized);
            await fileService.writeText(candidatePath, '');

            await this.refreshFolder(normalized);

            // 刷新后选中新文件并自动触发重命名
            setTimeout(() => {
                this.selectFile(candidatePath, { autoFocus: false });
                this.startRenaming(candidatePath);
            }, 100);
        } catch (error) {
            console.error('创建文件失败:', error);
            try {
                const { message } = await import('@tauri-apps/plugin-dialog');
                await message(`创建文件失败:\n${error.message || error}`, { title: '创建失败', kind: 'error' });
            } catch {}
        }
    }

    async createFolderInFolder(folderPath) {
        const normalized = this.normalizePath(folderPath);
        if (!normalized) return;
        try {
            const pathModule = await import('@tauri-apps/api/path');
            const fileService = this.ensureFileService();

            // 为避免聚焦到已存在的同名文件夹，这里自动寻找可用的名称：
            // newfolder, newfolder-1, newfolder-2, ...
            const baseName = 'newfolder';
            let candidatePath = null;
            let attempts = 0;

            while (attempts < 1000) {
                const suffix = attempts === 0 ? '' : `-${attempts}`;
                const folderName = `${baseName}${suffix}`;
                const joined = await pathModule.join(normalized, folderName);
                const normalizedCandidate = this.normalizePath(joined);
                if (!normalizedCandidate) {
                    attempts += 1;
                    continue;
                }

                const exists = await fileService.exists(normalizedCandidate);
                if (!exists) {
                    candidatePath = normalizedCandidate;
                    break;
                }
                attempts += 1;
            }

            if (!candidatePath) {
                throw new Error('无法找到可用的文件夹名称');
            }

            this.markLocalWrite(candidatePath);
            this.markLocalWrite(normalized);
            await fileService.createDirectory(candidatePath);

            await this.refreshFolder(normalized);

            // 刷新后自动触发重命名
            setTimeout(() => {
                this.startRenaming(candidatePath, { targetType: 'folder' });
            }, 100);
        } catch (error) {
            console.error('创建文件夹失败:', error);
            try {
                const { message } = await import('@tauri-apps/plugin-dialog');
                await message(`创建文件夹失败:\n${error.message || error}`, { title: '创建失败', kind: 'error' });
            } catch {}
        }
    }

    applySectionStates() {
        const openFilesContent = this.container.querySelector('#openFilesContent');
        const openFilesHeader = this.container.querySelector('#openFilesHeader');
        const foldersContent = this.container.querySelector('#foldersContent');
        const foldersHeader = this.container.querySelector('#foldersHeader');

        this.applySingleSectionState(openFilesContent, openFilesHeader, this.sectionStates.openFilesCollapsed);
        this.applySingleSectionState(foldersContent, foldersHeader, this.sectionStates.foldersCollapsed);
    }

    applySingleSectionState(content, header, collapsed) {
        if (!content || !header) return;

        if (collapsed) {
            content.classList.add('collapsed');
            header.classList.add('collapsed');
            content.style.display = 'none';
        } else {
            content.classList.remove('collapsed');
            header.classList.remove('collapsed');
            content.style.display = 'block';
        }
    }

    toggleSection(contentId) {
        const content = this.container.querySelector(`#${contentId}`);
        if (!content) return;
        const header = content.previousElementSibling;
        if (!header) return;

        const willExpand = content.classList.contains('collapsed');

        if (willExpand) {
            content.classList.remove('collapsed');
            header.classList.remove('collapsed');
            content.style.display = 'block';
            this.updateSectionCollapsedState(contentId, false);
        } else {
            content.classList.add('collapsed');
            header.classList.add('collapsed');
            content.style.display = 'none';
            this.updateSectionCollapsedState(contentId, true);
        }

        this.emitStateChange();
    }

    updateSectionCollapsedState(contentId, collapsed) {
        if (contentId === 'openFilesContent') {
            this.sectionStates.openFilesCollapsed = collapsed;
        } else if (contentId === 'foldersContent') {
            this.sectionStates.foldersCollapsed = collapsed;
        }
    }

    emitStateChange() {
        if (typeof this.onStateChange === 'function') {
            this.onStateChange(this.getPersistedState());
        }
    }

    getPersistedState() {
        return {
            rootPaths: Array.from(this.rootPaths),
            expandedFolders: Array.from(this.expandedFolders),
            sectionStates: { ...this.sectionStates },
        };
    }

    captureScrollPositions() {
        const elements = [
            this.container,
            this.container.querySelector('#foldersContent'),
            this.container.querySelector('#openFilesContent'),
        ].filter(Boolean);

        return elements.map((element) => ({
            element,
            top: element.scrollTop,
            left: element.scrollLeft,
        }));
    }

    restoreScrollPositions(snapshot = []) {
        if (!Array.isArray(snapshot) || snapshot.length === 0) {
            return;
        }
        window.requestAnimationFrame(() => {
            snapshot.forEach(({ element, top, left }) => {
                if (!element) {
                    return;
                }
                element.scrollTop = top;
                element.scrollLeft = left;
            });
        });
    }

    async requestOpenFolder() {
        const { open } = await import('@tauri-apps/plugin-dialog');
        try {
            const selected = await open({
                directory: true,
                multiple: true,
            });

            const selections = Array.isArray(selected)
                ? selected.filter(Boolean)
                : selected ? [selected] : [];

            for (const folderPath of selections) {
                await this.loadFolder(folderPath);
            }
        } catch (error) {
            console.error('打开文件夹失败:', error);
        }
    }

    async loadFolder(folderPath) {
        const normalizedPath = this.normalizePath(folderPath);
        if (!normalizedPath) return;

        const isNewRoot = !this.rootPaths.has(normalizedPath);
        let stateChanged = false;
        if (isNewRoot) {
            this.rootPaths.add(normalizedPath);
            stateChanged = true;
        }

        const scrollSnapshot = this.captureScrollPositions();

        try {
            const entries = await this.readDirectory(normalizedPath);
            const folderName = normalizedPath.split('/').pop() || normalizedPath;

            const contentDiv = this.container.querySelector('#foldersContent');
            if (!contentDiv) return;

            let rootItem = contentDiv.querySelector(`.tree-folder[data-path="${normalizedPath}"]`);
            const folderKey = this.buildFolderKey(normalizedPath, null, true);

            if (!rootItem) {
                rootItem = this.createFolderItem(folderName, normalizedPath, entries, true, null);
                contentDiv.appendChild(rootItem);
            } else {
                const nameSpan = rootItem.querySelector('.tree-item-name');
                if (nameSpan) {
                    nameSpan.textContent = folderName;
                }
            }
            rootItem.dataset.parentPath = '';
            rootItem.dataset.nodeKey = folderKey;
            rootItem.dataset.isRoot = 'true';

            const header = rootItem.querySelector('.tree-folder-header');
            const children = rootItem.querySelector('.tree-folder-children');

            if (!children) {
                return;
            }

            const shouldExpand = isNewRoot || this.expandedFolders.has(folderKey);

            if (shouldExpand) {
                if (!this.expandedFolders.has(folderKey)) {
                    this.expandedFolders.add(folderKey);
                    stateChanged = true;
                }
                header?.classList.add('expanded');
                children.classList.add('expanded');
                children.style.display = 'block';
            } else {
                header?.classList.remove('expanded');
                children.classList.remove('expanded');
                children.style.display = 'none';
            }

            await this.loadFolderChildren(normalizedPath, children, entries);

            await this.watchFolder(normalizedPath);
        } catch (error) {
            console.error('读取文件夹失败:', error);
        } finally {
            this.restoreScrollPositions(scrollSnapshot);
            // 刷新后重新应用当前文件的选中状态
            this.reapplyCurrentFileSelection();
            if (stateChanged) {
                this.emitStateChange();
            }
        }
    }

    reapplyCurrentFileSelection() {
        if (!this.currentFile) return;
        const normalized = this.normalizePath(this.currentFile);
        if (!normalized) return;

        const fileItem = this.container.querySelector(`.tree-file[data-path="${normalized}"]`);
        if (fileItem && !fileItem.classList.contains('selected')) {
            fileItem.classList.add('selected');
        }
    }

    shouldIgnoreFile(name) {
        // 只忽略特定的系统文件
        const ignoredFiles = new Set([
            '.DS_Store',
            'Thumbs.db',
            'desktop.ini',
            '.localized'
        ]);

        return ignoredFiles.has(name);
    }

    async readDirectory(path) {
        const fileService = this.ensureFileService();
        const { directories = [], files = [] } = await fileService.list(path);

        const folders = directories
            .filter(entry => !this.shouldIgnoreFile(entry.name))
            .map(entry => ({ path: entry.path, isDir: true }));
        const regularFiles = files
            .filter(entry => !this.shouldIgnoreFile(entry.name))
            .map(entry => ({ path: entry.path, isDir: false }));

        folders.sort((a, b) => a.path.localeCompare(b.path));
        regularFiles.sort((a, b) => a.path.localeCompare(b.path));

        return [...folders, ...regularFiles];
    }

    createFolderItem(name, path, entries, isRoot = false, parentPath = null) {
        const item = document.createElement('div');
        item.className = 'tree-folder';
        item.dataset.path = path;
        item.dataset.parentPath = parentPath ?? '';
        item.dataset.nodeKey = this.buildFolderKey(path, parentPath, isRoot);
        item.dataset.isRoot = isRoot ? 'true' : 'false';

        const header = document.createElement('div');
        header.className = `tree-folder-header ${isRoot ? 'root' : ''}`;

        const folderIcon = `
            <svg class="tree-folder-icon" width="16" height="16" viewBox="0 0 16 16">
                <path d="M1 2.5v10c0 .28.22.5.5.5h13c.28 0 .5-.22.5-.5V5c0-.28-.22-.5-.5-.5H7L5.5 3H1.5c-.28 0-.5.22-.5.5z"
                      fill="currentColor" opacity="0.8"/>
            </svg>
        `;

        const expandIcon = `
            <svg class="tree-expand-icon" width="10" height="10" viewBox="0 0 10 10">
                <path d="M2 3 L5 6 L8 3" stroke="currentColor" stroke-width="1.5" fill="none"/>
            </svg>
        `;

        const rootActions = isRoot
            ? `
                <div class="root-folder-actions">
                    <button class="root-folder-action-btn pin-folder-btn" type="button" data-path="${path}" title="置顶文件夹">
                        ↑
                    </button>
                    <button class="root-folder-action-btn close-folder-btn" type="button" data-path="${path}" title="移除文件夹">
                        ×
                    </button>
                </div>
            `
            : '';

        header.innerHTML = `
            ${expandIcon}
            ${folderIcon}
            <span class="tree-item-name">${name}</span>
            ${rootActions}
        `;

        // Drag & Drop support（保留用于外部文件拖入）；内部拖拽已切换为自定义鼠标拖拽
        item.addEventListener('dragenter', (e) => this.mover?.handleDragEnter(e, header));
        item.addEventListener('dragover', (e) => this.mover?.handleDragOver(e, header));
        item.addEventListener('dragleave', (e) => this.mover?.handleDragLeave(e, header));
        item.addEventListener('drop', (e) => this.mover?.handleDrop(e, path, header));

        // 文件夹拖拽（自定义拖拽，支持文件夹移动）。触发使用原生 dragstart（由 macOS 判定按下并移动/三指拖动）。
        header.draggable = true;
        const onFolderNativeDragStart = (event) => {
            if (this.mover?.shouldBlockInteraction?.()) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            if (event.target.closest('.root-folder-actions')) return;
            if (event.target.closest('.tree-expand-icon')) return;
            this.mover?.interceptNativeDragStart(event, path, { isDirectory: true });
        };
        const onFolderNativeDragEnd = () => this.mover?.cancelNativeDragState?.();
        header.addEventListener('dragstart', onFolderNativeDragStart);
        header.addEventListener('dragend', onFolderNativeDragEnd);
        this.cleanupFunctions.push(() => {
            header.removeEventListener('dragstart', onFolderNativeDragStart);
            header.removeEventListener('dragend', onFolderNativeDragEnd);
        });

        // 使用统一的点击处理函数
        const cleanup1 = addClickHandler(header, (event) => {
            if (event.target.closest('.close-folder-btn') || event.target.closest('.pin-folder-btn')) {
                return;
            }
            this.toggleFolder(path, item);
        }, { shouldHandle: () => !this.mover?.shouldBlockInteraction?.() });
        this.cleanupFunctions.push(cleanup1);

        if (isRoot) {
            const closeButton = header.querySelector('.close-folder-btn');
            if (closeButton) {
                const cleanup2 = addClickHandler(closeButton, (event) => {
                    event.stopPropagation();
                    this.closeFolder(path);
                });
                this.cleanupFunctions.push(cleanup2);
            }

            const pinButton = header.querySelector('.pin-folder-btn');
            if (pinButton) {
                const cleanup3 = addClickHandler(pinButton, (event) => {
                    event.stopPropagation();
                    this.pinRootFolder(path);
                });
                this.cleanupFunctions.push(cleanup3);
            }
        }

        const children = document.createElement('div');
        children.className = 'tree-folder-children';
        children.style.display = 'none';

        item.appendChild(header);
        item.appendChild(children);

        return item;
    }

    createFileItem(name, path) {
        const item = document.createElement('div');
        item.className = 'tree-file';
        item.dataset.path = path;
        item.tabIndex = '0'; // 使文件项可以聚焦

        // 启用原生 dragstart 仅用于“触发”事件，然后立刻拦截并切换到自定义拖拽
        // 这样可以兼容 macOS 触控板三指拖动 & 触控板按下不抬起并移动
        item.draggable = true;
        const onNativeDragStart = (e) => this.mover?.interceptNativeDragStart(e, path);
        const onNativeDragEnd = () => this.mover?.cancelNativeDragState?.();
        item.addEventListener('dragstart', onNativeDragStart);
        item.addEventListener('dragend', onNativeDragEnd);
        // 记录清理函数
        this.cleanupFunctions.push(() => {
            item.removeEventListener('dragstart', onNativeDragStart);
            item.removeEventListener('dragend', onNativeDragEnd);
        });

        // SVG 文件图标
        let iconSvg = `
            <svg class="tree-file-icon" width="16" height="16" viewBox="0 0 16 16">
                <path d="M2 1.5v13c0 .28.22.5.5.5h11c.28 0 .5-.22.5-.5V4.5L10.5 1H2.5c-.28 0-.5.22-.5.5z"
                      fill="none" stroke="currentColor" stroke-width="1"/>
                <path d="M10.5 1v3.5H14" fill="none" stroke="currentColor" stroke-width="1"/>
            </svg>
        `;

        if (name.endsWith('.md') || name.endsWith('.markdown')) {
            iconSvg = `
                <svg class="tree-file-icon" width="16" height="16" viewBox="0 0 16 16">
                    <path d="M2 1.5v13c0 .28.22.5.5.5h11c.28 0 .5-.22.5-.5V4.5L10.5 1H2.5c-.28 0-.5.22-.5.5z"
                          fill="none" stroke="currentColor" stroke-width="1"/>
                    <path d="M10.5 1v3.5H14" fill="none" stroke="currentColor" stroke-width="1"/>
                    <text x="4" y="12" font-size="6" fill="currentColor">M</text>
                </svg>
            `;
        }

        item.innerHTML = `
            ${iconSvg}
            <span class="tree-item-name">${name}</span>
        `;

        // 键盘：回车触发重命名
        const onKeyDown = (e) => {
            if (this.isRenaming()) return;
            if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                this.startRenaming(path);
            }
        };
        item.addEventListener('keydown', onKeyDown);
        this.cleanupFunctions.push(() => item.removeEventListener('keydown', onKeyDown));

        // 使用统一的点击处理函数
        let clickCount = 0;
        let clickTimer = null;

        const cleanup = addClickHandler(item, (event) => {
            clickCount++;

            if (clickCount === 1) {
                // 第一次点击：立即打开文件（不自动聚焦编辑器）
                this.selectFile(path, { autoFocus: false });

                // 启动定时器，等待可能的第二次点击
                clickTimer = setTimeout(() => {
                    clickCount = 0;
                }, 300);
            } else if (clickCount === 2) {
                // 第二次点击（双击）：添加到打开的文件
                clearTimeout(clickTimer);
                this.addToOpenFiles(path);
                clickCount = 0;
            }
        }, {
            preventDefault: true,
            shouldHandle: (event) => {
                if (this.mover?.shouldBlockInteraction?.()) {
                    return false;
                }
                if (event.target.closest('.tree-file-rename-input')) {
                    return false;
                }
                return true;
            },
        });
        this.cleanupFunctions.push(cleanup);

        return item;
    }

    async toggleFolder(path, folderElement = null) {
        const folderItem = folderElement ?? this.container.querySelector(`[data-path="${path}"]`);
        if (!folderItem) return;

        const header = folderItem.querySelector('.tree-folder-header');
        const children = folderItem.querySelector('.tree-folder-children');
        const parentPath = folderItem.dataset.parentPath || null;
        const isRoot = folderItem.dataset.isRoot === 'true';
        const folderKey = folderItem.dataset.nodeKey || this.buildFolderKey(path, parentPath, isRoot);

        if (this.expandedFolders.has(folderKey)) {
            // 收起
            this.expandedFolders.delete(folderKey);
            children.classList.remove('expanded');
            header.classList.remove('expanded');
            children.style.display = 'none';
        } else {
            // 展开
            this.expandedFolders.add(folderKey);
            children.classList.add('expanded');
            header.classList.add('expanded');
            children.style.display = 'block';

            // 如果还没加载子项，加载它们
            if (children.children.length === 0) {
                await this.loadFolderChildren(path, children);
            }
        }

        this.emitStateChange();
    }

    async loadFolderChildren(path, childrenContainer, prefetchedEntries = null) {
        const entries = Array.isArray(prefetchedEntries)
            ? prefetchedEntries
            : await this.readDirectory(path);

        const fragment = document.createDocumentFragment();

        for (const entry of entries) {
            const name = entry.path.split('/').pop();

            if (entry.isDir) {
                const folderItem = this.createFolderItem(name, entry.path, [], false, path);
                fragment.appendChild(folderItem);

                const childKey = folderItem.dataset.nodeKey;

                if (childKey && this.expandedFolders.has(childKey)) {
                    const header = folderItem.querySelector('.tree-folder-header');
                    const children = folderItem.querySelector('.tree-folder-children');
                    header?.classList.add('expanded');
                    if (children) {
                        children.classList.add('expanded');
                        children.style.display = 'block';
                        await this.loadFolderChildren(entry.path, children);
                    }
                }
            } else {
                const fileItem = this.createFileItem(name, entry.path);
                fragment.appendChild(fileItem);
            }
        }

        childrenContainer.replaceChildren(fragment);
    }

    selectFile(path, options = {}) {
        const {
            autoFocus = true,
            preserveFocus = false,
        } = options;
        const normalized = this.normalizePath(path);
        if (!normalized) {
            this.clearSelection();
            this.currentFile = null;
            if (this.onFileSelect) {
                this.onFileSelect(null, { autoFocus });
            }
            return;
        }

        // 移除之前的选中状态
        this.container.querySelectorAll('.tree-file.selected, .open-file-item.selected').forEach(el => {
            el.classList.remove('selected');
        });

        const shouldManageFocus = !autoFocus && !preserveFocus;

        // 添加选中状态到文件树
        const fileItem = this.container.querySelector(`.tree-file[data-path="${normalized}"]`)
            || this.container.querySelector(`.tree-file[data-path="${path}"]`);
        if (fileItem) {
            fileItem.classList.add('selected');
        }

        // 添加选中状态到打开文件列表
        const openFileItem = this.container.querySelector(`.open-file-item[data-path="${normalized}"]`)
            || this.container.querySelector(`.open-file-item[data-path="${path}"]`);
        if (openFileItem) {
            openFileItem.classList.add('selected');
        }

        this.currentFile = normalized;

        if (shouldManageFocus) {
            const activeElement = typeof document !== 'undefined' ? document.activeElement : null;
            const focusCandidates = [fileItem, openFileItem].filter(Boolean);
            const focusTarget = focusCandidates.find((element) => {
                if (!element) return false;
                if (element.contains(activeElement)) {
                    return false;
                }
                if (element.querySelector('.tree-file-rename-input')) {
                    return false;
                }
                return true;
            });
            if (focusTarget) {
                try {
                    focusTarget.focus({ preventScroll: true });
                } catch {}
            }
        }

        // 回调
        if (this.onFileSelect) {
            this.onFileSelect(normalized, { autoFocus });
        }

        this.ensureFileWatcherHealth(normalized).catch(error => {
            console.warn('文件监听健康检查失败:', { path: normalized, error });
        });
    }

    addToOpenFiles(path) {
        const normalized = this.normalizePath(path);
        if (!normalized) return;

        if (this.isInOpenList(normalized)) return;

        this.openFiles.push(normalized);
        this.renderOpenFiles();
        const viewMode = getViewModeForPath(normalized);
        const shouldWatch = viewMode === 'markdown' || viewMode === 'code';
        if (shouldWatch) {
            this.watchFile(normalized).catch(error => {
                console.error('监听文件失败:', error);
            });
        }
        this.onOpenFilesChange?.([...this.openFiles]);
    }

    replaceOpenFilePath(oldPath, newPath) {
        const normalizedOld = this.normalizePath(oldPath);
        const normalizedNew = this.normalizePath(newPath);

        if (!normalizedOld || !normalizedNew) {
            return;
        }
        if (normalizedOld === normalizedNew) {
            return;
        }

        const index = this.openFiles.findIndex(item => item === normalizedOld);
        this.stopWatchingFile(normalizedOld);

        if (index === -1) {
            if (this.normalizePath(this.currentFile) === normalizedOld) {
                this.currentFile = normalizedNew;
            }
            this.watchFile(normalizedNew).catch(error => {
                console.error('监听文件失败:', error);
            });
            return;
        }

        const filtered = this.openFiles.filter(
            (path, idx) => path !== normalizedOld && (path !== normalizedNew || idx === index)
        );
        const insertPosition = Math.min(index, filtered.length);
        filtered.splice(insertPosition, 0, normalizedNew);
        this.openFiles = filtered;

        if (this.normalizePath(this.currentFile) === normalizedOld) {
            this.currentFile = normalizedNew;
        }

        this.renderOpenFiles();
        this.watchFile(normalizedNew).catch(error => {
            console.error('监听文件失败:', error);
        });
        this.onOpenFilesChange?.([...this.openFiles]);
    }

    renderOpenFiles(options = {}) {
        const { skipWatch = false } = options;
        this.openFilesView?.render(this.openFiles, {
            currentFile: this.currentFile,
            skipWatch,
        });
    }

    closeFile(path, options = {}) {
        const normalizedTarget = this.normalizePath(path);
        const index = this.openFiles.findIndex(item => item === normalizedTarget);
        if (index > -1) {
            const wasActive = this.normalizePath(this.currentFile) === normalizedTarget;
            this.openFiles.splice(index, 1);
            this.renderOpenFiles();
            this.stopWatchingFile(normalizedTarget);
            this.onOpenFilesChange?.([...this.openFiles]);

            if (wasActive) {
                const fallbackIndex = Math.min(index, this.openFiles.length - 1);
                const fallback = fallbackIndex >= 0 ? this.openFiles[fallbackIndex] : null;
                if (fallback && !options.suppressActivate) {
                    this.selectFile(fallback);
                } else if (!fallback) {
                    this.clearSelection();
                    if (this.onFileSelect) {
                        this.onFileSelect(null);
                    }
                }
            }
        }
    }

    closeFolder(path) {
        const normalizedPath = this.normalizePath(path);
        if (!normalizedPath || !this.rootPaths.has(normalizedPath)) {
            return;
        }

        this.rootPaths.delete(normalizedPath);

        const keysToRemove = [];
        this.expandedFolders.forEach((key) => {
            if (key.includes(normalizedPath)) {
                keysToRemove.push(key);
            }
        });
        keysToRemove.forEach((key) => this.expandedFolders.delete(key));

        this.stopWatchingFolder(normalizedPath);

        const folderElement = this.container.querySelector(`.tree-folder[data-path="${normalizedPath}"]`);
        if (folderElement?.parentElement) {
            folderElement.parentElement.removeChild(folderElement);
        }

        const currentNormalized = this.normalizePath(this.currentFile);
        const isUnderFolder = currentNormalized
            ? currentNormalized === normalizedPath
                || currentNormalized.startsWith(`${normalizedPath}/`)
                || currentNormalized.startsWith(`${normalizedPath}\\`)
            : false;

        if (isUnderFolder && !this.isInOpenList(currentNormalized)) {
            this.clearSelection();
            if (this.onFileSelect) {
                this.onFileSelect(null);
            }
        }

        this.emitStateChange();
    }

    pinRootFolder(path) {
        const normalizedPath = this.normalizePath(path);
        if (!normalizedPath || !this.rootPaths.has(normalizedPath)) {
            return;
        }

        const ordered = Array.from(this.rootPaths);
        const index = ordered.indexOf(normalizedPath);
        if (index <= 0) {
            return;
        }

        ordered.splice(index, 1);
        ordered.unshift(normalizedPath);
        this.rootPaths = new Set(ordered);

        const contentDiv = this.container.querySelector('#foldersContent');
        const folderElement = contentDiv?.querySelector(`.tree-folder[data-path="${normalizedPath}"]`);
        if (contentDiv && folderElement) {
            contentDiv.removeChild(folderElement);
            contentDiv.insertBefore(folderElement, contentDiv.firstChild);
        }

        this.emitStateChange();
    }

    clearSelection() {
        this.container.querySelectorAll('.tree-file.selected, .open-file-item.selected').forEach(el => {
            el.classList.remove('selected');
        });
        this.currentFile = null;
    }

    async handleMoveSuccess(sourcePath, destinationPath, meta = {}) {
        const normalizedSource = this.normalizePath(sourcePath);
        const normalizedDestination = this.normalizePath(destinationPath);
        if (!normalizedSource || !normalizedDestination) {
            return;
        }

        const isDirectory = meta?.isDirectory === true;
        if (!isDirectory) {
            try {
                this.replaceOpenFilePath(normalizedSource, normalizedDestination);
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

        const affectedPaths = new Set(this.openFiles || []);
        if (this.currentFile) {
            affectedPaths.add(this.currentFile);
        }

        affectedPaths.forEach((path) => {
            if (!path) return;
            const normalized = this.normalizePath(path);
            if (!normalized || !normalized.startsWith(sourcePrefix)) {
                return;
            }
            const relative = normalized.slice(sourcePrefix.length);
            const nextPath = `${destinationPrefix}${relative}`;
            try {
                this.replaceOpenFilePath(normalized, nextPath);
                this.onPathRenamed?.(normalized, nextPath, { suppressAutoFocus: true });
            } catch (error) {
                console.warn('处理文件夹移动回调失败:', error);
            }
        });
    }

    async watchFolder(path) {
        return this.watcher?.watchFolder(path);
    }

    stopWatchingFolder(path = null) {
        this.watcher?.stopWatchingFolder(path);
    }

    async watchFile(path, options = {}) {
        return this.watcher?.watchFile(path, options);
    }

    stopWatchingFile(path) {
        this.watcher?.stopWatchingFile(path);
    }

    async ensureFileWatcherHealth(path, options = {}) {
        return this.watcher?.ensureFileWatcherHealth(path, options);
    }

    async restartFileWatcher(path, options = {}) {
        return this.watcher?.restartFileWatcher(path, options);
    }

    consumeExternalModification(path) {
        return this.watcher?.consumeExternalModification(path);
    }

    clearExternalModification(path) {
        this.watcher?.clearExternalModification(path);
    }

    async refreshCurrentFolder(targetPath = null) {
        if (targetPath) {
            await this.refreshFolder(targetPath);
            return;
        }

        const rootPaths = Array.from(this.rootPaths);
        const tasks = rootPaths.map((rootPath) => this.refreshFolder(rootPath));
        await Promise.allSettled(tasks);
    }

    async refreshFolder(path) {
        const normalizedPath = this.normalizePath(path);
        if (!normalizedPath) {
            return;
        }

        if (this.rootPaths.has(normalizedPath)) {
            await this.loadFolder(normalizedPath);
            return;
        }

        const folderElement = this.container.querySelector(`.tree-folder[data-path="${normalizedPath}"]`);
        if (!folderElement) {
            return;
        }
        const children = folderElement.querySelector('.tree-folder-children');
        if (!children) {
            return;
        }

        try {
            const entries = await this.readDirectory(normalizedPath);
            await this.loadFolderChildren(normalizedPath, children, entries);
        } catch (error) {
            console.error('刷新文件夹失败:', { path: normalizedPath, error });
        }
    }

    getRootPaths() {
        return Array.from(this.rootPaths);
    }

    hasRoot(path) {
        const normalizedPath = this.normalizePath(path);
        return normalizedPath ? this.rootPaths.has(normalizedPath) : false;
    }

    getOpenFilePaths() {
        return [...this.openFiles];
    }

    restoreOpenFiles(paths = []) {
        const normalized = [];
        const seen = new Set();

        paths.forEach((path) => {
            const normalizedPath = this.normalizePath(path);
            if (!normalizedPath || seen.has(normalizedPath)) {
                return;
            }
            seen.add(normalizedPath);
            normalized.push(normalizedPath);
        });

        // 停止监听不再存在的文件
        this.openFiles.forEach((path) => {
            if (!seen.has(path)) {
                this.stopWatchingFile(path);
            }
        });

        this.openFiles = normalized;
        this.renderOpenFiles();
        this.onOpenFilesChange?.([...this.openFiles]);
    }

    reorderOpenFiles(paths = []) {
        if (!Array.isArray(paths) || paths.length === 0) {
            return;
        }

        const seen = new Set();
        const existing = new Set(this.openFiles);
        const normalized = [];

        paths.forEach((path) => {
            const normalizedPath = this.normalizePath(path);
            if (!normalizedPath || seen.has(normalizedPath) || !existing.has(normalizedPath)) {
                return;
            }
            seen.add(normalizedPath);
            normalized.push(normalizedPath);
            existing.delete(normalizedPath);
        });

        if (normalized.length === 0) {
            return;
        }

        if (existing.size > 0) {
            this.openFiles.forEach((path) => {
                if (!seen.has(path)) {
                    normalized.push(path);
                }
            });
        }

        const isSameOrder = normalized.length === this.openFiles.length
            && normalized.every((path, index) => this.openFiles[index] === path);
        if (isSameOrder) {
            return;
        }

        this.openFiles = normalized;
        this.renderOpenFiles({ skipWatch: true });
        this.onOpenFilesChange?.([...this.openFiles]);
    }

    async restoreState(state = {}) {
        const rootPaths = Array.isArray(state.rootPaths)
            ? state.rootPaths
                .map(path => this.normalizePath(path))
                .filter(path => typeof path === 'string' && path.length > 0)
            : [];

        const expandedFolders = Array.isArray(state.expandedFolders)
            ? state.expandedFolders
                .filter(key => typeof key === 'string' && key.length > 0)
            : [];

        if (state.sectionStates && typeof state.sectionStates === 'object') {
            if (typeof state.sectionStates.openFilesCollapsed === 'boolean') {
                this.sectionStates.openFilesCollapsed = state.sectionStates.openFilesCollapsed;
            }
            if (typeof state.sectionStates.foldersCollapsed === 'boolean') {
                this.sectionStates.foldersCollapsed = state.sectionStates.foldersCollapsed;
            }
        }

        this.rootPaths = new Set(rootPaths);
        this.expandedFolders = new Set(expandedFolders);
        this.applySectionStates();

        const contentDiv = this.container.querySelector('#foldersContent');
        if (contentDiv) {
            contentDiv.innerHTML = '';
        }

        for (const path of rootPaths) {
            try {
                await this.loadFolder(path);
            } catch (error) {
                console.warn('恢复文件夹失败:', path, error);
            }
        }
    }

    ensureFileService() {
        if (this.fileService) {
            return this.fileService;
        }
        try {
            this.services = getAppServices();
        } catch (error) {
            const fallback = typeof window !== 'undefined' ? window.__MARK2_SERVICES__ : null;
            if (fallback) {
                this.services = fallback;
            } else {
                throw error;
            }
        }
        if (!this.services?.file) {
            throw new Error('文件服务未初始化');
        }
        this.fileService = this.services.file;
        return this.fileService;
    }

    // ===== 内联重命名 =====
    startRenaming(path, meta = {}) {
        if (this.mover?.shouldBlockInteraction?.()) {
            return;
        }

        const targetType = meta?.targetType || 'file';
        if (targetType === 'folder') {
            this.startFolderRenaming(path);
        } else {
            this.renamer?.start(path);
        }
    }

    // 文件夹重命名（在文件树节点上 inline 编辑）
    startFolderRenaming(path) {
        const normalized = this.normalizePath(path);
        if (!normalized) return;

        if (this.folderRenamingPath && this.folderRenamingPath !== normalized) {
            this.cancelFolderRenaming();
        }

        const folderItem = this.container?.querySelector(`.tree-folder[data-path="${normalized}"]`);
        if (!folderItem) return;
        const header = folderItem.querySelector('.tree-folder-header');
        if (!header) return;
        const nameSpan = header.querySelector('.tree-item-name');
        if (!nameSpan) return;

        const folderName = nameSpan.textContent || normalized.split('/').pop();
        const input = document.createElement('input');
        input.type = 'text';
        // 复用文件重命名输入框样式，保持一致
        input.className = 'tree-file-rename-input';
        input.value = folderName;
        nameSpan.replaceWith(input);
        this.folderRenamingPath = normalized;

        let submitting = false;
        const submit = async () => {
            if (submitting) return;
            submitting = true;
            const nextLabel = (input.value || '').trim();
            const ok = await this._submitFolderRenaming(
                normalized,
                folderName,
                nextLabel,
                { input, header, nameClass: 'tree-item-name' },
            );
            if (!ok) {
                submitting = false;
                try {
                    input.focus();
                    input.select();
                } catch {}
            }
        };
        const cancel = () => this.cancelFolderRenaming({
            input,
            header,
            originalName: folderName,
            nameClass: 'tree-item-name',
        });

        const onKeyDown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                void submit();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                cancel();
            }
        };
        const onBlur = () => {
            if (!submitting) {
                cancel();
            }
        };
        input.addEventListener('keydown', onKeyDown);
        input.addEventListener('blur', onBlur);
        this._folderRenameCleanup = () => {
            input.removeEventListener('keydown', onKeyDown);
            input.removeEventListener('blur', onBlur);
            this._folderRenameCleanup = null;
        };

        setTimeout(() => {
            try {
                input.focus();
                // 文件夹名整体选中
                input.setSelectionRange(0, folderName.length);
            } catch {}
        }, 0);
    }

    cancelFolderRenaming(ctx = {}) {
        const {
            input,
            header,
            originalName,
            nameClass = 'tree-item-name',
        } = ctx;
        if (!this.folderRenamingPath) return;

        if (this._folderRenameCleanup) {
            this._folderRenameCleanup();
        }

        if (input && header) {
            const span = document.createElement('span');
            span.className = nameClass;
            const fallbackName = originalName || (this.folderRenamingPath.split('/').pop());
            span.textContent = fallbackName;
            input.replaceWith(span);
            try {
                header.focus();
            } catch {}
        }

        this.folderRenamingPath = null;
    }

    async _submitFolderRenaming(oldPath, currentLabel, nextLabel, ctx = {}) {
        if (!nextLabel) {
            // 名称为空时保持编辑态
            return false;
        }
        if (nextLabel === currentLabel) {
            this.cancelFolderRenaming(ctx);
            return true;
        }
        try {
            await this._performFolderRename(oldPath, nextLabel);
            this.cancelFolderRenaming({
                ...ctx,
                originalName: nextLabel,
            });
            return true;
        } catch (error) {
            console.error('重命名文件夹失败:', error);
            try {
                const { message } = await import('@tauri-apps/plugin-dialog');
                await message(`重命名失败:\n${error.message || error}`, { title: '重命名失败', kind: 'error' });
            } catch {}
            return false;
        }
    }

    async _performFolderRename(sourcePath, nextLabel) {
        const normalizedSource = this.normalizePath(sourcePath);
        if (!normalizedSource) return;

        const fileService = this.ensureFileService();
        const separator = '/';
        const lastSlashIndex = normalizedSource.lastIndexOf(separator);
        const parentDir = lastSlashIndex >= 0 ? normalizedSource.substring(0, lastSlashIndex) : '';
        const destinationPath = parentDir
            ? `${parentDir}${separator}${nextLabel}`
            : nextLabel;
        const normalizedDestination = this.normalizePath(destinationPath);
        if (!normalizedDestination || normalizedDestination === normalizedSource) {
            return;
        }

        await fileService.move(normalizedSource, normalizedDestination);

        // 如果是根目录，更新 rootPaths 并重建目录监听
        if (this.rootPaths.has(normalizedSource)) {
            this.rootPaths.delete(normalizedSource);
            this.rootPaths.add(normalizedDestination);
            try {
                this.stopWatchingFolder(normalizedSource);
            } catch {}
            try {
                await this.watchFolder(normalizedDestination);
            } catch {}
        }

        // 刷新父目录视图（仅当父目录是根路径时生效，由 FileWatcher 控制）
        if (parentDir) {
            setTimeout(() => {
                this.refreshFolder(parentDir);
            }, 300);
        }

        // 同步 openFiles / TabManager 等（目录移动逻辑与 FileMover 保持一致）
        await this.handleMoveSuccess(normalizedSource, normalizedDestination, { isDirectory: true });

        // 重命名成功后尝试聚焦新的文件夹节点
        setTimeout(() => {
            const folderHeader = this.container?.querySelector(`.tree-folder[data-path="${normalizedDestination}"] .tree-folder-header`);
            if (folderHeader) {
                try {
                    folderHeader.focus();
                } catch {}
            }
        }, 100);
    }

    cancelRenaming(ctx = {}) {
        this.renamer?.cancel(ctx);
        this.cancelFolderRenaming();
    }

    isRenaming() {
        return (this.renamer?.isRenaming() ?? false) || Boolean(this.folderRenamingPath);
    }

    dispose() {
        this.mover?.dispose();
        this.watcher?.dispose();
        this.openFilesView?.dispose();
        this.contextMenu?.dispose();
        // 取消可能正在重命名的状态
        this.cancelRenaming();
        // 清理所有事件监听器
        this.cleanupFunctions.forEach(cleanup => {
            if (typeof cleanup === 'function') {
                cleanup();
            }
        });
        this.cleanupFunctions = [];

        // 解绑容器级 DnD 事件
        if (this._onTreeDragOver) this.container.removeEventListener('dragover', this._onTreeDragOver);
        if (this._onTreeDragEnter) this.container.removeEventListener('dragenter', this._onTreeDragEnter);
        if (this._onTreeDragLeave) this.container.removeEventListener('dragleave', this._onTreeDragLeave);
        if (this._onTreeDrop) this.container.removeEventListener('drop', this._onTreeDrop);
        if (this._onMouseMoveDuringDrag) window.removeEventListener('mousemove', this._onMouseMoveDuringDrag);

        this.stopWatchingFolder();
        this.openFiles = [];
        this.expandedFolders.clear();
        this.rootPaths.clear();
    }
}
