import { addClickHandler } from '../utils/PointerHelper.js';
import { isEditableFilePath, getViewModeForPath } from '../utils/fileTypeUtils.js';
import { getAppServices } from '../services/appServices.js';

const WATCHER_VERIFICATION_COOLDOWN_MS = 5000;
const WATCHER_STALE_THRESHOLD_MS = 300000;

export class FileTree {
    constructor(containerElement, onFileSelect, callbacks = {}) {
        this.container = containerElement;
        this.onFileSelect = onFileSelect;
        this.services = null;
        this.fileService = null;
        this.rootPaths = new Set();
        this.expandedFolders = new Set();
        this.currentFile = null;
        this.openFiles = []; // 跟踪打开的文件
        this.folderWatchers = new Map();
        this.fileWatchers = new Map();
this.onFolderChange = callbacks.onFolderChange;
        this.onFileChange = callbacks.onFileChange;
        this.onOpenFilesChange = callbacks.onOpenFilesChange;
        this.onStateChange = callbacks.onStateChange;
        this.onCloseFileRequest = callbacks.onCloseFileRequest;
        this.onPathRenamed = callbacks.onPathRenamed;
        this.renamingPath = null;
        this._renameCleanup = null;
        this.sectionStates = {
            openFilesCollapsed: false,
            foldersCollapsed: false,
        };
        this.cleanupFunctions = []; // 存储清理函数
        this.init();
        this.ensureFileService();
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
        this._onTreeDragOver = (e) => this.handleTreeDragOver(e);
        this._onTreeDragLeave = (e) => this.handleTreeDragLeave(e);
        this._onTreeDrop = (e) => this.handleTreeDrop(e);
        this.container.addEventListener('dragover', this._onTreeDragOver);
        this.container.addEventListener('dragleave', this._onTreeDragLeave);
        this.container.addEventListener('drop', this._onTreeDrop);

        console.log('[FileTree] container DnD listeners attached');

        // 部分环境下 dragover 可能被系统级拦截，这里用 mousemove 兜底
        this._onMouseMoveDuringDrag = (e) => {
            if (!window.__IS_INTERNAL_DRAG__) return;
            // 构造一个伪事件对象传给 handleTreeDragOver（只用到 clientX/clientY）
            // console.log('[mousemove during drag]', e.clientX, e.clientY);
            this.handleTreeDragOver({ clientX: e.clientX, clientY: e.clientY, dataTransfer: null, preventDefault() {}, stopPropagation() {} });
        };
        window.addEventListener('mousemove', this._onMouseMoveDuringDrag);
        console.log('[FileTree] window mousemove fallback attached');
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
        item.addEventListener('dragenter', (e) => this.handleDragEnter(e, header));
        item.addEventListener('dragover', (e) => this.handleDragOver(e, header));
        item.addEventListener('dragleave', (e) => this.handleDragLeave(e, header));
        item.addEventListener('drop', (e) => this.handleDrop(e, path, header));

        // 使用统一的点击处理函数
        const cleanup1 = addClickHandler(header, (event) => {
            if (event.target.closest('.close-folder-btn') || event.target.closest('.pin-folder-btn')) {
                return;
            }
            this.toggleFolder(path, item);
        });
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
        // 这样可以兼容 macOS 触控板三指拖动（可能不会触发 mousedown）
        item.draggable = true;
        const onMouseDown = (e) => this.beginInternalDrag(e, path);
        const onNativeDragStart = (e) => this.interceptNativeDragStart(e, path);
        const onNativeDragEnd = () => this.cancelNativeDragState?.();
        item.addEventListener('mousedown', onMouseDown);
        item.addEventListener('dragstart', onNativeDragStart);
        item.addEventListener('dragend', onNativeDragEnd);
        // 记录清理函数
        this.cleanupFunctions.push(() => {
            item.removeEventListener('mousedown', onMouseDown);
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
            if (this.renamingPath) return;
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

        const cleanup = addClickHandler(item, () => {
            clickCount++;

            if (clickCount === 1) {
                // 第一次点击：立即打开文件（不自动聚焦编辑器）
                this.selectFile(path, { autoFocus: false });
                // 保持焦点在当前文件项，便于直接按 Enter 触发重命名
                try { item.focus(); } catch {}

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
        }, { preventDefault: true });
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
        const { autoFocus = true } = options;
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
        const contentDiv = this.container.querySelector('#openFilesContent');

        if (this.openFiles.length === 0) {
            contentDiv.innerHTML = '';
            return;
        }

        contentDiv.innerHTML = '';

        this.openFiles.forEach(path => {
            if (!skipWatch) {
                this.watchFile(path).catch(error => {
                    console.error('监听文件失败:', error);
                });
            }

            const fileName = path.split('/').pop();
            const item = document.createElement('div');
            item.className = 'open-file-item';
            item.dataset.path = path;

            if (this.normalizePath(this.currentFile) === path) {
                item.classList.add('selected');
            }

            // 允许键盘聚焦
            item.tabIndex = '0';

            const iconSvg = `
                <svg class="open-file-icon" width="14" height="14" viewBox="0 0 16 16">
                    <path d="M2 1.5v13c0 .28.22.5.5.5h11c.28 0 .5-.22.5-.5V4.5L10.5 1H2.5c-.28 0-.5.22-.5.5z"
                          fill="none" stroke="currentColor" stroke-width="1"/>
                    <path d="M10.5 1v3.5H14" fill="none" stroke="currentColor" stroke-width="1"/>
                </svg>
            `;

            item.innerHTML = `
                ${iconSvg}
                <span class="open-file-name">${fileName}</span>
                <button class="close-file-btn" data-path="${path}">×</button>
            `;

            // 使用统一的点击处理函数
            const cleanup1 = addClickHandler(item, (event) => {
                if (event.target.closest('.close-file-btn')) {
                    return;
                }
                this.selectFile(path);
            });
            this.cleanupFunctions.push(cleanup1);

            const closeButton = item.querySelector('.close-file-btn');
            const cleanup2 = addClickHandler(closeButton, (event) => {
                event.stopPropagation();
                if (typeof this.onCloseFileRequest === 'function') {
                    const maybePromise = this.onCloseFileRequest(path);
                    if (maybePromise && typeof maybePromise.then === 'function') {
                        maybePromise.catch(error => {
                            console.error('关闭文件请求失败:', error);
                        });
                    }
                    return;
                }
                this.closeFile(path);
            });
            this.cleanupFunctions.push(cleanup2);

            const onKeyDown = (e) => {
                if (this.renamingPath) return;
                if (e.key === 'Enter') {
                    e.preventDefault();
                    e.stopPropagation();
                    this.startRenaming(path);
                }
            };
            item.addEventListener('keydown', onKeyDown);
            this.cleanupFunctions.push(() => item.removeEventListener('keydown', onKeyDown));

            contentDiv.appendChild(item);
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

    async watchFolder(path) {
        const normalizedPath = this.normalizePath(path);
        if (!normalizedPath || this.folderWatchers.has(normalizedPath)) {
            return;
        }

        try {
            const { watch } = await import('@tauri-apps/plugin-fs');
            const unwatch = await watch(normalizedPath, (event) => {
                this.onFolderChange?.(normalizedPath, event);
            }, { recursive: true, delayMs: 100 });
            this.folderWatchers.set(normalizedPath, unwatch);
        } catch (error) {
            console.error('目录监听失败:', error);
            this.folderWatchers.delete(normalizedPath);
        }
    }

    stopWatchingFolder(path = null) {
        if (path) {
            const normalizedPath = this.normalizePath(path);
            if (!normalizedPath) return;
            const unwatch = this.folderWatchers.get(normalizedPath);
            if (unwatch) {
                try {
                    unwatch();
                } catch (error) {
                    console.error('停止目录监听失败:', error);
                }
                this.folderWatchers.delete(normalizedPath);
            }
            return;
        }

        this.folderWatchers.forEach((unwatch, watchedPath) => {
            try {
                unwatch();
            } catch (error) {
                console.error('停止目录监听失败:', { watchedPath, error });
            }
        });
        this.folderWatchers.clear();
    }

    async watchFile(path, options = {}) {
        const normalizedPath = this.normalizePath(path);
        if (!normalizedPath) return;

        // 如果已经在监听，直接更新校验时间
        const existingState = this.fileWatchers.get(normalizedPath);
        if (existingState) {
            existingState.lastVerificationTimestamp = Date.now();
            return;
        }

        try {
            const { watch } = await import('@tauri-apps/plugin-fs');
            const unwatch = await watch(
                normalizedPath,
                (event) => {
                    const state = this.fileWatchers.get(normalizedPath);
                    if (state) {
                        state.lastEventTimestamp = Date.now();
                        state.hasReceivedEvent = true;
                        state.externallyModified = true;
                    }

                    requestAnimationFrame(() => {
                        this.onFileChange?.(normalizedPath, event);
                    });
                },
                { recursive: false, delayMs: 50 }
            );

            const watcherState = {
                unwatch,
                hasReceivedEvent: false,
                lastEventTimestamp: null,
                lastVerificationTimestamp: Date.now(),
                lastRebuildTimestamp: Date.now(),
                pendingVerification: null,
                externallyModified: false,
            };

            this.fileWatchers.set(normalizedPath, watcherState);
        } catch (error) {
            console.error('文件监听失败:', { path: normalizedPath, options, error });
            throw error;
        }
    }

    stopWatchingFile(path) {
        const normalizedPath = this.normalizePath(path);
        if (!normalizedPath) return;

        const watcherState = this.fileWatchers.get(normalizedPath);
        if (!watcherState) {
            return;
        }

        const { unwatch } = watcherState;
        if (typeof unwatch === 'function') {
            try {
                unwatch();
            } catch (error) {
                console.error('停止文件监听失败:', { path: normalizedPath, error });
            }
        }

        this.fileWatchers.delete(normalizedPath);
    }

    async ensureFileWatcherHealth(path, options = {}) {
        const normalizedPath = this.normalizePath(path);
        if (!normalizedPath) return;

        const state = this.fileWatchers.get(normalizedPath);
        if (!state) {
            await this.watchFile(normalizedPath, { reason: 'ensure-missing' });
            return;
        }

        const now = Date.now();
        if (!options.force) {
            const sinceLastVerify = now - (state.lastVerificationTimestamp ?? 0);
            if (sinceLastVerify < WATCHER_VERIFICATION_COOLDOWN_MS) {
                return;
            }
        }

        if (state.pendingVerification) {
            return;
        }

        const verificationPromise = (async () => {
            try {
                await this.ensureFileService().ipcHealthCheck?.();
                const verifiedAt = Date.now();
                state.lastVerificationTimestamp = verifiedAt;

                if (state.hasReceivedEvent) {
                    const lastEventAt = state.lastEventTimestamp ?? verifiedAt;
                    const timeSinceLastEvent = verifiedAt - lastEventAt;
                    if (timeSinceLastEvent > WATCHER_STALE_THRESHOLD_MS) {
                        await this.restartFileWatcher(normalizedPath, { reason: 'stale-event' });
                    }
                }
            } catch (error) {
                console.warn('IPC 健康检查失败，准备重建文件监听', { path: normalizedPath, error });
                await this.restartFileWatcher(normalizedPath, { reason: 'ipc-failed' });
            }
        })();

        state.pendingVerification = verificationPromise;

        try {
            await verificationPromise;
        } finally {
            const current = this.fileWatchers.get(normalizedPath);
            if (current) {
                current.pendingVerification = null;
            }
        }
    }

    async restartFileWatcher(path, options = {}) {
        const normalizedPath = this.normalizePath(path);
        if (!normalizedPath) return;

        const state = this.fileWatchers.get(normalizedPath);
        const now = Date.now();
        if (state && now - (state.lastRebuildTimestamp ?? 0) < WATCHER_VERIFICATION_COOLDOWN_MS) {
            return;
        }

        this.stopWatchingFile(normalizedPath);

        try {
            await this.watchFile(normalizedPath, { ...options, reason: options.reason ?? 'restart' });
        } catch (error) {
            console.error('重建文件监听失败:', { path: normalizedPath, error, options });
        }
    }

    consumeExternalModification(path) {
        const normalizedPath = this.normalizePath(path);
        if (!normalizedPath) return false;
        const state = this.fileWatchers.get(normalizedPath);
        if (!state) return false;
        const wasModified = Boolean(state.externallyModified);
        state.externallyModified = false;
        return wasModified;
    }

    clearExternalModification(path) {
        const normalizedPath = this.normalizePath(path);
        if (!normalizedPath) return;
        const state = this.fileWatchers.get(normalizedPath);
        if (state) {
            state.externallyModified = false;
        }
    }

    async refreshCurrentFolder(targetPath = null) {
        if (targetPath) {
            await this.refreshFolder(targetPath);
            return;
        }

        const tasks = Array.from(this.rootPaths).map((path) => this.refreshFolder(path));
        await Promise.all(tasks);
    }

    async refreshFolder(path) {
        const normalizedPath = this.normalizePath(path);
        if (!normalizedPath || !this.rootPaths.has(normalizedPath)) {
            return;
        }

        await this.loadFolder(normalizedPath);
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

    // 旧的原生 DnD 启动保留（不再使用）
    handleDragStart(event, path) {
        // 已弃用
    }

    handleDragEnd(event) {
        // 已弃用
    }

    // 拦截原生 dragstart（用于 macOS 三指拖动），转为自定义拖拽
    interceptNativeDragStart(event, sourcePath) {
        try {
            event.preventDefault();
            event.stopPropagation();
        } catch {}
        // 不要在这里设置内部拖拽标记与样式，等真正进入拖拽再设置
        const clientX = event.clientX ?? (event.touches && event.touches[0]?.clientX) ?? 0;
        const clientY = event.clientY ?? (event.touches && event.touches[0]?.clientY) ?? 0;
        const fakeMouseEvent = { button: 0, clientX, clientY, preventDefault(){} };
        this._nativeDragIntercepting = true;
        this.beginInternalDrag(fakeMouseEvent, sourcePath);
        // 同时创建一个取消原生拖拽的状态
        this.cancelNativeDragState = () => {
            this._nativeDragIntercepting = false;
        };
    }

    // ========== 自定义鼠标拖拽实现，绕过 HTML5 DnD ==========
    beginInternalDrag(event, sourcePath) {
        if (event.button !== 0) return; // 仅左键
        // 避免与点击选择冲突，先阻止文本选择
        event.preventDefault();
        this._dragState = {
            sourcePath,
            startX: event.clientX,
            startY: event.clientY,
            active: false,
            hoverHeader: null,
        };
        // 不在这里创建拖拽预览与内部拖拽标记，等阈值触发后再创建
        this._onInternalMouseMove = (e) => this.onInternalDragMove(e);
        this._onInternalMouseUp = (e) => this.endInternalDrag(e);
        window.addEventListener('mousemove', this._onInternalMouseMove, true);
        window.addEventListener('mouseup', this._onInternalMouseUp, true);
    }

    onInternalDragMove(event) {
        if (!this._dragState) return;
        const { startX, startY, active } = this._dragState;
        const dx = Math.abs(event.clientX - startX);
        const dy = Math.abs(event.clientY - startY);
        const threshold = 3;
        if (!active && (dx > threshold || dy > threshold)) {
            this._dragState.active = true;
            // 真正进入拖拽时再设置内部拖拽标记与样式
            document.body.classList.add('is-internal-drag');
            window.__IS_INTERNAL_DRAG__ = true;
            // 在此时创建拖拽预览，避免点击/双击瞬间闪烁
            const name = (this._dragState.sourcePath || '').split(/[\/\\]/).pop() || '';
            const sourceEl = this.container.querySelector(`.tree-file[data-path="${this._dragState.sourcePath}"]`);
            const rect = sourceEl ? sourceEl.getBoundingClientRect() : null;
            const nodeWidth = rect ? rect.width : null;
            this.createDragGhost(name, event.clientX, event.clientY, nodeWidth);
        }
        if (!this._dragState.active) return;

        // 更新拖拽预览位置
        this.updateDragGhost(event.clientX, event.clientY);

        // 命中检测
        const header = this.findHeaderAtPoint(event.clientX, event.clientY);
        if (header !== this._dragState.hoverHeader) {
            this.clearAllDragOverHighlights();
            if (header) header.classList.add('drag-over');
            this._dragState.hoverHeader = header;
        }
    }

    async endInternalDrag(event) {
        if (!this._dragState) return;
        window.removeEventListener('mousemove', this._onInternalMouseMove, true);
        window.removeEventListener('mouseup', this._onInternalMouseUp, true);

        const { sourcePath, active, hoverHeader } = this._dragState;
        this._dragState = null;
        const targetHeader = hoverHeader;

        // 清理 UI 状态
        this.clearAllDragOverHighlights();
        this.removeDragGhost();
        document.body.classList.remove('is-internal-drag');
        window.__IS_INTERNAL_DRAG__ = false;

        if (!active) return; // 只是点击，没有拖拽

        const targetFolderPath = targetHeader?.parentElement?.dataset?.path;
        if (!targetFolderPath || !sourcePath) return;
        await this.performMove(sourcePath, targetFolderPath);
    }

    clearAllDragOverHighlights() {
        this.container.querySelectorAll('.drag-over').forEach(el => {
            el.classList.remove('drag-over');
        });
    }

    findHeaderAtPoint(clientX, clientY) {
        const el = document.elementFromPoint(clientX, clientY);
        if (!el) return null;
        // 允许在整块文件夹区域内命中（包括 children 区域）
        const folder = el.closest?.('.tree-folder');
        if (!folder) return null;
        const header = folder.querySelector('.tree-folder-header');
        return header || null;
    }

    handleTreeDragOver(event) {
        // console.log('[handleTreeDragOver]', { clientX: event.clientX, clientY: event.clientY, types: event.dataTransfer.types });
        if (!window.__IS_INTERNAL_DRAG__) return;
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }

        const header = this.findHeaderAtPoint(event.clientX, event.clientY);
        // console.log('  -> found header:', header);
        if (!header) {
            this.clearAllDragOverHighlights();
            return;
        }

        if (!header.classList.contains('drag-over')) {
            console.log('[DnD] Adding drag-over to:', header.querySelector('.tree-item-name')?.textContent);
            this.clearAllDragOverHighlights();
            header.classList.add('drag-over');
        }
        if (event && event.dataTransfer) {
            event.dataTransfer.dropEffect = 'move';
        }
    }

    handleTreeDragLeave(event) {
        // console.log('[handleTreeDragLeave]');
        if (!window.__IS_INTERNAL_DRAG__) return;
        // 当鼠标离开容器或进入非文件夹区域时清理
        const related = event.relatedTarget;
        // console.log('  -> relatedTarget:', related, ' in container:', related && this.container.contains(related));
        if (!related || !this.container.contains(related)) {
            console.log('[DnD] Removing all highlights (left container)');
            this.clearAllDragOverHighlights();
        }
    }

    async handleTreeDrop(event) {
        console.log('[handleTreeDrop]', { clientX: event.clientX, clientY: event.clientY });
        if (!window.__IS_INTERNAL_DRAG__) return;
        event.preventDefault();
        event.stopPropagation();

        const header = this.findHeaderAtPoint(event.clientX, event.clientY);
        console.log('  -> drop on header:', header?.querySelector('.tree-item-name')?.textContent);
        this.clearAllDragOverHighlights();
        if (!header) {
            console.log('  -> No header found, abort drop');
            return;
        }

        const targetFolderPath = header?.parentElement?.dataset?.path;
        const sourcePath = event.dataTransfer.getData('application/x-mark2-file') ||
                           event.dataTransfer.getData('text/plain');
        console.log('  -> performing move', { sourcePath, targetFolderPath });

        if (!sourcePath || !targetFolderPath) {
            console.log('  -> Missing paths, abort');
            return;
        }
        await this.performMove(sourcePath, targetFolderPath);
        console.log('  -> move done');
    }

    handleDragEnter(event, element) {
        // console.log('Drag enter:', element.dataset);
        event.preventDefault();
        event.stopPropagation();

        const hasInternalType = event.dataTransfer.types.includes('application/x-mark2-file');
        const isInternal = hasInternalType || window.__IS_INTERNAL_DRAG__;

        if (!isInternal) {
            return;
        }
        
        // 移除所有其他高亮，确保只有当前目标高亮
        // 这一步非常关键，防止“拖影”现象
        this.container.querySelectorAll('.drag-over').forEach(el => {
            if (el !== element) {
                el.classList.remove('drag-over');
            }
        });
        
        element.classList.add('drag-over');
    }

    handleDragOver(event, element) {
        event.preventDefault();
        event.stopPropagation();
        
        const hasInternalType = event.dataTransfer.types.includes('application/x-mark2-file');
        const isInternal = hasInternalType || window.__IS_INTERNAL_DRAG__;

        if (!isInternal) {
            return;
        }

        // 再次确保高亮状态（防止 enter 没触发或被意外移除）
        if (!element.classList.contains('drag-over')) {
             this.container.querySelectorAll('.drag-over').forEach(el => {
                el.classList.remove('drag-over');
            });
            element.classList.add('drag-over');
        }
        
        event.dataTransfer.dropEffect = 'move';
    }

    handleDragLeave(event, element) {
        event.preventDefault();
        event.stopPropagation();
        
        // 只有当真正离开这个元素（进入了非子元素区域）时才移除样式
        // 由于我们现在监听的是 item，element 传进来的是 header，需要小心处理
        // 这里简化逻辑：不在 leave 时移除，而是在 enter 其他元素时互斥移除
        // 或者，只有当 relatedTarget 不在当前 header 内时才移除
        if (!element.contains(event.relatedTarget)) {
             element.classList.remove('drag-over');
        }
    }

    async handleDrop(event, targetFolderPath, element) {
        // 保持兼容，转调到 performMove
        event.preventDefault();
        event.stopPropagation();
        element.classList.remove('drag-over');

        const sourcePath = event.dataTransfer.getData('application/x-mark2-file') || 
                           event.dataTransfer.getData('text/plain');
        if (!sourcePath) return;
        await this.performMove(sourcePath, targetFolderPath);
    }

    // ===== 拖拽预览（ghost）辅助 =====
    createDragGhost(label, x, y, nodeWidth = null) {
        this.removeDragGhost();
        const ghost = document.createElement('div');
        ghost.className = 'drag-ghost';
        ghost.style.position = 'fixed';
        ghost.style.left = '0px';
        ghost.style.top = '0px';
        ghost.style.transform = 'translate(-9999px, -9999px)';
        ghost.style.zIndex = '99999';
        ghost.style.pointerEvents = 'none';
        ghost.style.whiteSpace = 'nowrap';
        ghost.style.textOverflow = 'ellipsis';
        ghost.style.overflow = 'hidden';
        ghost.style.boxSizing = 'border-box';
        
        // 宽度与原节点一致
        if (nodeWidth && Number.isFinite(nodeWidth)) {
            const w = Math.max(80, Math.round(nodeWidth));
            ghost.style.width = `${w}px`;
            ghost.style.maxWidth = `${w}px`;
        } else {
            ghost.style.maxWidth = '240px';
        }
        
        // 获取当前主题的选中文件样式变量
        const computedStyle = getComputedStyle(document.body);
        const selectedBg = computedStyle.getPropertyValue('--file-selected-bg').trim();
        const selectedBorder = computedStyle.getPropertyValue('--file-selected-border').trim();
        const textColor = computedStyle.getPropertyValue('--text-color').trim();
        const fileIconColor = computedStyle.getPropertyValue('--file-icon-color').trim();
        
        // 提升背景不透明度（如果 --file-selected-bg 为 rgba 且 alpha 偏低）
        let effectiveBg = selectedBg;
        const m = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([0-9.]+)\s*\)$/i.exec(selectedBg);
        if (m) {
            const alpha = parseFloat(m[4]);
            const targetAlpha = Math.max(alpha, 0.55); // 至少 0.85
            effectiveBg = `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${targetAlpha})`;
        }
        
        // 应用与选中文件相同的样式
        ghost.style.background = effectiveBg;
        ghost.style.fontSize = '12px';
        ghost.style.fontWeight = '500';
        ghost.style.color = textColor;
        ghost.style.padding = '2px 16px 2px 20px';
        ghost.style.borderRight = `2px solid ${selectedBorder}`;
        ghost.style.borderRadius = '0';
        ghost.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';
        ghost.style.opacity = '1';
        ghost.style.display = 'flex';
        ghost.style.alignItems = 'center';
        
        // 添加文件图标（与普通文件项保持一致）
        const icon = document.createElement('svg');
        icon.style.marginRight = '6px';
        icon.style.width = '14px';
        icon.style.height = '14px';
        icon.style.flexShrink = '0';
        icon.style.color = fileIconColor;
        icon.innerHTML = `
            <path d="M2 1.5v13c0 .28.22.5.5.5h11c.28 0 .5-.22.5-.5V4.5L10.5 1H2.5c-.28 0-.5.22-.5.5z" fill="none" stroke="currentColor" stroke-width="1"/>
            <path d="M10.5 1v3.5H14" fill="none" stroke="currentColor" stroke-width="1"/>
        `;
        
        const labelSpan = document.createElement('span');
        labelSpan.style.flex = '1';
        labelSpan.style.overflow = 'hidden';
        labelSpan.style.textOverflow = 'ellipsis';
        labelSpan.style.whiteSpace = 'nowrap';
        labelSpan.textContent = label || '';
        
        ghost.appendChild(icon);
        ghost.appendChild(labelSpan);
        
        document.body.appendChild(ghost);
        this._dragGhost = ghost;
        this.updateDragGhost(x, y);
    }

    updateDragGhost(x, y) {
        if (!this._dragGhost) return;
        const offsetX = 12; // 光标右下角偏移
        const offsetY = 16;
        this._dragGhost.style.transform = `translate(${Math.max(0, x + offsetX)}px, ${Math.max(0, y + offsetY)}px)`;
    }

    removeDragGhost() {
        if (this._dragGhost && this._dragGhost.parentElement) {
            this._dragGhost.parentElement.removeChild(this._dragGhost);
        }
        this._dragGhost = null;
    }

    // ===== 内联重命名 =====
    startRenaming(path) {
        const normalized = this.normalizePath(path);
        if (!normalized) return;
        if (this.renamingPath && this.renamingPath !== normalized) {
            this.cancelRenaming();
        }

        // 优先使用文件树节点，若未挂载则回退到「打开的文件」列表项
        const treeItem = this.container.querySelector(`.tree-file[data-path="${normalized}"]`);
        const openFileItem = this.container.querySelector(`.open-file-item[data-path="${normalized}"]`);
        const item = treeItem || openFileItem;
        if (!item) return;

        const nameSpan = treeItem
            ? item.querySelector('.tree-item-name')
            : item.querySelector('.open-file-name');
        if (!nameSpan) return;

        const fileName = nameSpan.textContent || normalized.split('/').pop();
        if (!treeItem && !item.hasAttribute('tabindex')) {
            item.tabIndex = -1;
        }

        // 构建输入框
        const input = document.createElement('input');
        input.type = 'text';
        input.className = treeItem
            ? 'tree-file-rename-input'
            : 'tree-file-rename-input open-file-rename-input';
        input.value = fileName;
        nameSpan.replaceWith(input);
        this.renamingPath = normalized;

        let submitting = false;
        const submit = async () => {
            if (submitting) return;
            submitting = true;
            const nextLabel = (input.value || '').trim();
            const ok = await this.submitRenaming(
                normalized,
                fileName,
                nextLabel,
                { input, item, nameClass: treeItem ? 'tree-item-name' : 'open-file-name' }
            );
            if (!ok) {
                submitting = false;
                input.focus();
                input.select();
            }
        };
        const cancel = () => this.cancelRenaming({
            input,
            item,
            originalName: fileName,
            nameClass: treeItem ? 'tree-item-name' : 'open-file-name',
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
            // 失焦即取消（与 Tab 行为保持一致）
            if (!submitting) {
                cancel();
            }
        };
        input.addEventListener('keydown', onKeyDown);
        input.addEventListener('blur', onBlur);
        this._renameCleanup = () => {
            input.removeEventListener('keydown', onKeyDown);
            input.removeEventListener('blur', onBlur);
            this._renameCleanup = null;
        };

        // 聚焦并只选中不含扩展名的主体
        setTimeout(() => {
            input.focus();
            const { start, end } = this._calcNameSelectionRange(fileName);
            try {
                input.setSelectionRange(start, end);
            } catch {}
        }, 0);
    }

    cancelRenaming(ctx = {}) {
        const {
            input,
            item,
            originalName,
            nameClass = 'tree-item-name',
        } = ctx;
        if (!this.renamingPath) return;
        if (this._renameCleanup) this._renameCleanup();
        if (input && item) {
            const span = document.createElement('span');
            span.className = nameClass;
            span.textContent = originalName || (this.renamingPath.split('/').pop());
            input.replaceWith(span);
            // 恢复焦点到文件树项，避免焦点跳入编辑器
            try { item.focus(); } catch {}
        }
        this.renamingPath = null;
    }

    async submitRenaming(oldPath, currentLabel, nextLabel, ctx = {}) {
        if (!nextLabel) {
            return false;
        }
        if (nextLabel === currentLabel) {
            // 无变化
            this.cancelRenaming(ctx);
            return true;
        }
        try {
            await this.performRename(oldPath, nextLabel);
            this.cancelRenaming(ctx);
            return true;
        } catch (error) {
            console.error('重命名失败:', error);
            try {
                const { message } = await import('@tauri-apps/plugin-dialog');
                await message(`重命名失败:\n${error.message || error}`, { title: '重命名失败', kind: 'error' });
            } catch {}
            return false;
        }
    }

    _calcNameSelectionRange(fileName) {
        // 默认选中文件名不包含扩展名
        // 规则：取最后一个 '.' 之前；但以 '.' 开头的隐藏文件只在存在第二个点时才视为有扩展名
        const len = (fileName || '').length;
        if (len === 0) return { start: 0, end: 0 };
        const firstDot = fileName.indexOf('.');
        const lastDot = fileName.lastIndexOf('.');
        let end = len;
        if (lastDot > 0) {
            // 有点且不在第 0 位
            end = lastDot;
        } else if (firstDot === 0 && lastDot > 0) {
            end = lastDot;
        }
        if (end < 0) end = len;
        return { start: 0, end };
    }

    async performRename(sourcePath, nextLabel) {
        const normalizedSource = this.normalizePath(sourcePath);
        if (!normalizedSource) return;
        const separator = '/';
        const parentDir = normalizedSource.substring(0, normalizedSource.lastIndexOf(separator));
        const destinationPath = parentDir ? `${parentDir}${separator}${nextLabel}` : nextLabel;
        if (destinationPath === normalizedSource) {
            return;
        }
        await this.fileService.move(normalizedSource, destinationPath);
        
        // 同步打开文件列表
        this.replaceOpenFilePath(normalizedSource, destinationPath);
        // 如果当前文件就是它，更新选中（不自动聚焦编辑器）
        const wasCurrent = this.normalizePath(this.currentFile) === normalizedSource;
        if (wasCurrent) {
            this.selectFile(destinationPath, { autoFocus: false });
        }
        // 通知外部做全局同步（Tab、状态栏、会话等），传递禁止自动聚焦标记
        try {
            this.onPathRenamed?.(normalizedSource, destinationPath, { suppressAutoFocus: true });
        } catch (e) {
            console.warn('onPathRenamed 回调失败:', e);
        }
        // 延迟刷新父目录，避免刷新触发文件重新加载
        if (parentDir) {
            setTimeout(() => {
                this.refreshFolder(parentDir);
            }, 300);
        }
        
        // 重命名成功后保持焦点在文件树项上
        setTimeout(() => {
            const renamedItem = this.container.querySelector(`.tree-file[data-path="${destinationPath}"]`);
            if (renamedItem) {
                try { renamedItem.focus(); } catch {}
            }
        }, 100);
    }

    async performMove(sourcePath, targetFolderPath) {
        const normalizedSource = this.normalizePath(sourcePath);
        const normalizedTarget = this.normalizePath(targetFolderPath);

        if (!normalizedSource || !normalizedTarget) {
            console.warn('Invalid paths:', { normalizedSource, normalizedTarget });
            return;
        }

        const fileName = normalizedSource.split(/[/\\]/).pop();
        const separator = '/'; // 在本项目内统一使用 POSIX 分隔符
        const cleanTarget = normalizedTarget.endsWith(separator)
            ? normalizedTarget.slice(0, -1)
            : normalizedTarget;
        const destinationPath = `${cleanTarget}${separator}${fileName}`;

        if (normalizedSource === destinationPath) {
            return;
        }

        try {
            await this.fileService.move(normalizedSource, destinationPath);
            const sourceParentPath = normalizedSource.substring(0, normalizedSource.lastIndexOf(separator));
            const tasks = [this.refreshFolder(cleanTarget)];
            if (sourceParentPath && sourceParentPath !== cleanTarget) {
                tasks.push(this.refreshFolder(sourceParentPath));
            }
            await Promise.all(tasks);
        } catch (error) {
            console.error('Move failed:', error);
            try {
                const { message } = await import('@tauri-apps/plugin-dialog');
                await message(`无法移动文件:\n${error.message || error}`, { title: '移动失败', kind: 'error' });
            } catch {}
        }
    }

    dispose() {
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
        if (this._onTreeDragLeave) this.container.removeEventListener('dragleave', this._onTreeDragLeave);
        if (this._onTreeDrop) this.container.removeEventListener('drop', this._onTreeDrop);
        if (this._onMouseMoveDuringDrag) window.removeEventListener('mousemove', this._onMouseMoveDuringDrag);

        this.stopWatchingFolder();
        Array.from(this.fileWatchers.keys()).forEach(path => {
            this.stopWatchingFile(path);
        });
        this.fileWatchers.clear();
        this.openFiles = [];
        this.expandedFolders.clear();
        this.rootPaths.clear();
    }
}
