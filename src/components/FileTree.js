export class FileTree {
    constructor(containerElement, onFileSelect, callbacks = {}) {
        this.container = containerElement;
        this.onFileSelect = onFileSelect;
        this.rootPaths = new Set();
        this.expandedFolders = new Set();
        this.currentFile = null;
        this.openFiles = []; // 跟踪打开的文件
        this.folderWatchers = new Map();
        this.fileWatchers = new Map();
        this.onFolderChange = callbacks.onFolderChange;
        this.onFileChange = callbacks.onFileChange;
        this.onOpenFilesChange = callbacks.onOpenFilesChange;
        this.init();
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

    isInOpenList(path) {
        const normalized = this.normalizePath(path);
        const result = this.openFiles.some(item => item === normalized);
        console.debug('[FileTree] 检查打开列表', {
            path,
            normalized,
            openFiles: [...this.openFiles],
            result,
        });
        return result;
    }

    isFileOpen(path) {
        const normalized = this.normalizePath(path);
        const normalizedCurrent = this.normalizePath(this.currentFile);
        const isInOpenList = this.isInOpenList(path);
        const isCurrent = normalizedCurrent === normalized;
        const result = isInOpenList || isCurrent;
        console.debug('[FileTree] 检查文件是否已打开', {
            path,
            normalized,
            normalizedCurrent,
            openFiles: [...this.openFiles],
            result,
        });
        return result;
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
    }

    setupEventListeners() {
        // 区域折叠
        this.container.querySelector('#openFilesHeader')?.addEventListener('click', () => {
            this.toggleSection('openFilesContent');
        });

        this.container.querySelector('#foldersHeader')?.addEventListener('click', () => {
            this.toggleSection('foldersContent');
        });
    }

    toggleSection(contentId) {
        const content = this.container.querySelector(`#${contentId}`);
        const header = content.previousElementSibling;

        if (content.classList.contains('collapsed')) {
            content.classList.remove('collapsed');
            header.classList.remove('collapsed');
        } else {
            content.classList.add('collapsed');
            header.classList.add('collapsed');
        }
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
        if (isNewRoot) {
            this.rootPaths.add(normalizedPath);
        }

        try {
            const entries = await this.readDirectory(normalizedPath);
            const folderName = normalizedPath.split('/').pop() || normalizedPath;

            const contentDiv = this.container.querySelector('#foldersContent');
            if (!contentDiv) return;

            let rootItem = contentDiv.querySelector(`.tree-folder[data-path="${normalizedPath}"]`);
            if (!rootItem) {
                rootItem = this.createFolderItem(folderName, normalizedPath, entries, true);
                contentDiv.appendChild(rootItem);
            } else {
                const nameSpan = rootItem.querySelector('.tree-item-name');
                if (nameSpan) {
                    nameSpan.textContent = folderName;
                }
            }

            const header = rootItem.querySelector('.tree-folder-header');
            const children = rootItem.querySelector('.tree-folder-children');

            if (!children) {
                return;
            }

            children.innerHTML = '';
            const shouldExpand = isNewRoot || this.expandedFolders.has(normalizedPath);

            if (shouldExpand) {
                this.expandedFolders.add(normalizedPath);
                header?.classList.add('expanded');
                children.classList.add('expanded');
                children.style.display = 'block';
                await this.loadFolderChildren(normalizedPath, children, entries);
            } else {
                header?.classList.remove('expanded');
                children.classList.remove('expanded');
                children.style.display = 'none';
            }

            await this.watchFolder(normalizedPath);
        } catch (error) {
            console.error('读取文件夹失败:', error);
        }
    }

    async readDirectory(path) {
        const { invoke } = await import('@tauri-apps/api/core');
        const entries = await invoke('read_dir', { path });

        // 分类并排序：文件夹在前，文件在后
        const folders = [];
        const files = [];

        for (const entry of entries) {
            const isDir = await invoke('is_directory', { path: entry });
            if (isDir) {
                folders.push({ path: entry, isDir: true });
            } else {
                files.push({ path: entry, isDir: false });
            }
        }

        folders.sort((a, b) => a.path.localeCompare(b.path));
        files.sort((a, b) => a.path.localeCompare(b.path));

        return [...folders, ...files];
    }

    createFolderItem(name, path, entries, isRoot = false) {
        const item = document.createElement('div');
        item.className = 'tree-folder';
        item.dataset.path = path;

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

        header.innerHTML = `
            ${expandIcon}
            ${folderIcon}
            <span class="tree-item-name">${name}</span>
        `;

        header.addEventListener('click', () => {
            this.toggleFolder(path);
        });

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

        item.addEventListener('click', () => {
            this.selectFile(path);
        });

        item.addEventListener('dblclick', () => {
            this.addToOpenFiles(path);
            this.selectFile(path);
        });

        return item;
    }

    async toggleFolder(path) {
        const folderItem = this.container.querySelector(`[data-path="${path}"]`);
        if (!folderItem) return;

        const header = folderItem.querySelector('.tree-folder-header');
        const children = folderItem.querySelector('.tree-folder-children');

        if (this.expandedFolders.has(path)) {
            // 收起
            this.expandedFolders.delete(path);
            children.classList.remove('expanded');
            header.classList.remove('expanded');
            children.style.display = 'none';
        } else {
            // 展开
            this.expandedFolders.add(path);
            children.classList.add('expanded');
            header.classList.add('expanded');
            children.style.display = 'block';

            // 如果还没加载子项，加载它们
            if (children.children.length === 0) {
                await this.loadFolderChildren(path, children);
            }
        }
    }

    async loadFolderChildren(path, childrenContainer, prefetchedEntries = null) {
        const entries = Array.isArray(prefetchedEntries) ? prefetchedEntries : await this.readDirectory(path);

        for (const entry of entries) {
            const name = entry.path.split('/').pop();

            if (entry.isDir) {
                const folderItem = this.createFolderItem(name, entry.path, []);
                childrenContainer.appendChild(folderItem);

                if (this.expandedFolders.has(entry.path)) {
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
                childrenContainer.appendChild(fileItem);
            }
        }
    }

    selectFile(path) {
        const normalized = this.normalizePath(path);
        if (!normalized) {
            this.clearSelection();
            this.currentFile = null;
            if (this.onFileSelect) {
                this.onFileSelect(null);
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
            this.onFileSelect(normalized);
        }
    }

    addToOpenFiles(path) {
        const normalized = this.normalizePath(path);
        if (!normalized) return;

        if (this.isInOpenList(normalized)) return;

        this.openFiles.push(normalized);
        console.debug('[FileTree] 添加到打开文件列表', { path: normalized, openFiles: [...this.openFiles] });
        this.renderOpenFiles();
        this.watchFile(normalized).catch(error => {
            console.error('监听文件失败:', error);
        });
        this.onOpenFilesChange?.([...this.openFiles]);
    }

    renderOpenFiles() {
        const contentDiv = this.container.querySelector('#openFilesContent');

        if (this.openFiles.length === 0) {
            contentDiv.innerHTML = '';
            return;
        }

        contentDiv.innerHTML = '';

        this.openFiles.forEach(path => {
            this.watchFile(path).catch(error => {
                console.error('监听文件失败:', error);
            });

            const fileName = path.split('/').pop();
            const item = document.createElement('div');
            item.className = 'open-file-item';
            item.dataset.path = path;

            if (this.normalizePath(this.currentFile) === path) {
                item.classList.add('selected');
            }

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

            item.addEventListener('click', (e) => {
                if (!e.target.classList.contains('close-file-btn')) {
                    this.selectFile(path);
                }
            });

            item.querySelector('.close-file-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                this.closeFile(path);
            });

            contentDiv.appendChild(item);
        });
    }

    closeFile(path) {
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
                if (fallback) {
                    this.selectFile(fallback);
                } else {
                    this.clearSelection();
                    if (this.onFileSelect) {
                        this.onFileSelect(null);
                    }
                }
            }
        }
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
                console.debug('[FileTree] 目录变更事件', { path: normalizedPath, event });
                this.onFolderChange?.(normalizedPath, event);
            }, { recursive: true, delayMs: 200 });
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

    async watchFile(path) {
        const normalizedPath = this.normalizePath(path);
        if (!normalizedPath || this.fileWatchers.has(normalizedPath)) return;

        try {
            const { watch } = await import('@tauri-apps/plugin-fs');
            const unwatch = await watch(normalizedPath, (event) => {
                console.debug('[FileTree] 文件变更事件', { path: normalizedPath, event });
                this.onFileChange?.(normalizedPath, event);
            }, { recursive: false, delayMs: 150 });
            this.fileWatchers.set(normalizedPath, unwatch);
            console.debug('[FileTree] 已监听文件', normalizedPath);
        } catch (error) {
            console.error('文件监听失败:', error);
            throw error;
        }
    }

    stopWatchingFile(path) {
        const normalizedPath = this.normalizePath(path);
        const unwatch = this.fileWatchers.get(normalizedPath);
        if (unwatch) {
            try {
                unwatch();
            } catch (error) {
                console.error('停止文件监听失败:', error);
            }
            this.fileWatchers.delete(normalizedPath);
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

    dispose() {
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
