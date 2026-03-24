import { basename } from '../../utils/pathUtils.js';
import { rememberSecurityScopes } from '../../services/securityScopeService.js';

export class FolderLoader {
    constructor(options = {}) {
        const {
            container,
            normalizePath,
            getFileService,
            state,
            renderer,
            buildFolderKey,
            watchFolder,
            emitStateChange,
            shouldDefer,
            onRefreshDeferred,
            onBeforeRefresh,
        } = options;

        this.container = container;
        this.normalizePath = normalizePath;
        this.getFileService = getFileService;
        this.state = state;
        this.renderer = renderer;
        this.buildFolderKey = buildFolderKey;
        this.watchFolder = watchFolder;
        this.emitStateChange = emitStateChange;
        this.shouldDefer = shouldDefer;
        this.onRefreshDeferred = onRefreshDeferred;
        this.onBeforeRefresh = onBeforeRefresh;
    }

    _captureScrollPositions() {
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

    _restoreScrollPositions(snapshot = []) {
        if (!Array.isArray(snapshot) || snapshot.length === 0) return;
        window.requestAnimationFrame(() => {
            snapshot.forEach(({ element, top, left }) => {
                if (!element) return;
                element.scrollTop = top;
                element.scrollLeft = left;
            });
        });
    }

    shouldIgnoreFile(name) {
        const ignoredFiles = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini', '.localized']);
        return ignoredFiles.has(name);
    }

    async readDirectory(path) {
        const fileService = this.getFileService();
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

    findRootFolderElement(path) {
        const contentDiv = this.container?.querySelector('#foldersContent');
        if (!contentDiv) return null;

        const targetPath = this.normalizePath(path);
        if (!targetPath) return null;

        const folders = contentDiv.querySelectorAll('.tree-folder');
        for (const folder of folders) {
            if (folder?.dataset?.isRoot !== 'true') continue;
            const folderPath = folder?.dataset?.path;
            if (!folderPath) continue;
            if (this.normalizePath(folderPath) === targetPath) return folder;
        }
        return null;
    }

    async requestOpenFolder() {
        try {
            const fileService = this.getFileService();
            const selections = await fileService.pick({
                directory: true,
                multiple: true,
                allowFiles: false,
            });
            const entries = Array.isArray(selections) ? selections.filter(Boolean) : [];
            if (entries.length === 0) return;
            try {
                await rememberSecurityScopes(entries);
            } catch (error) {
                console.warn('[fileTree] 记录文件夹权限失败', error);
            }
            for (const entry of entries) {
                if (entry?.path) {
                    await this.loadFolder(entry.path);
                }
            }
        } catch (error) {
            console.error('打开文件夹失败:', error);
        }
    }

    async loadFolder(folderPath) {
        const normalizedPath = this.normalizePath(folderPath);
        if (!normalizedPath) return;

        const existingRootPath = this.state.findRootPathEntry(normalizedPath);
        const rootPath = existingRootPath || normalizedPath;
        const isNewRoot = !existingRootPath;
        let stateChanged = false;
        if (isNewRoot) {
            this.state.addRootPath(rootPath, { toTop: true });
            stateChanged = true;
        }

        const scrollSnapshot = this._captureScrollPositions();

        try {
            const entries = await this.readDirectory(rootPath);
            const folderName = basename(rootPath) || rootPath;

            const contentDiv = this.container.querySelector('#foldersContent');
            if (!contentDiv) return;

            let rootItem = this.findRootFolderElement(rootPath);
            const folderKey = this.buildFolderKey(rootPath, null, true);

            if (!rootItem) {
                rootItem = this.renderer.createFolderItem(folderName, rootPath, entries, true, null);
                contentDiv.prepend(rootItem);
            } else {
                const nameSpan = rootItem.querySelector('.tree-item-name');
                if (nameSpan) nameSpan.textContent = folderName;
            }
            rootItem.dataset.parentPath = '';
            rootItem.dataset.nodeKey = folderKey;
            rootItem.dataset.isRoot = 'true';

            const header = rootItem.querySelector('.tree-folder-header');
            const children = rootItem.querySelector('.tree-folder-children');
            if (!children) return;

            const expandedFolders = this.state.expandedFolders;
            const shouldExpand = isNewRoot || expandedFolders.has(folderKey);

            if (shouldExpand) {
                if (!expandedFolders.has(folderKey)) {
                    expandedFolders.add(folderKey);
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

            await this.loadFolderChildren(rootPath, children, entries);
            await this.watchFolder(rootPath);
        } catch (error) {
            console.error('读取文件夹失败:', error);
        } finally {
            this._restoreScrollPositions(scrollSnapshot);
            this.renderer.reapplyCurrentFileSelection();
            if (stateChanged) this.emitStateChange();
        }
    }

    async loadFolderChildren(path, childrenContainer, prefetchedEntries = null) {
        const entries = Array.isArray(prefetchedEntries)
            ? prefetchedEntries
            : await this.readDirectory(path);

        const fragment = document.createDocumentFragment();
        const expandedFolders = this.state.expandedFolders;

        for (const entry of entries) {
            const name = basename(entry.path);

            if (entry.isDir) {
                const folderItem = this.renderer.createFolderItem(name, entry.path, [], false, path);
                fragment.appendChild(folderItem);

                const childKey = folderItem.dataset.nodeKey;
                if (childKey && expandedFolders.has(childKey)) {
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
                const fileItem = this.renderer.createFileItem(name, entry.path);
                fragment.appendChild(fileItem);
            }
        }

        childrenContainer.replaceChildren(fragment);
    }

    async toggleFolder(path, folderElement = null) {
        const folderItem = folderElement ?? this.container.querySelector(`[data-path="${path}"]`);
        if (!folderItem) return;

        const header = folderItem.querySelector('.tree-folder-header');
        const children = folderItem.querySelector('.tree-folder-children');
        const parentPath = folderItem.dataset.parentPath || null;
        const isRoot = folderItem.dataset.isRoot === 'true';
        const folderKey = folderItem.dataset.nodeKey || this.buildFolderKey(path, parentPath, isRoot);
        const expandedFolders = this.state.expandedFolders;

        if (expandedFolders.has(folderKey)) {
            expandedFolders.delete(folderKey);
            children.classList.remove('expanded');
            header.classList.remove('expanded');
            children.style.display = 'none';
        } else {
            expandedFolders.add(folderKey);
            children.classList.add('expanded');
            header.classList.add('expanded');
            children.style.display = 'block';
            if (children.children.length === 0) {
                await this.loadFolderChildren(path, children);
            }
        }

        this.emitStateChange();
    }

    async refreshCurrentFolder(targetPath = null) {
        if (targetPath) {
            await this.refreshFolder(targetPath);
            return;
        }
        const rootPaths = Array.from(this.state.rootPaths);
        await Promise.allSettled(rootPaths.map((p) => this.refreshFolder(p)));
    }

    async refreshFolder(path) {
        const normalizedPath = this.normalizePath(path);
        if (!normalizedPath) return;

        this.onBeforeRefresh?.();
        if (this.shouldDefer?.(normalizedPath)) {
            this.onRefreshDeferred?.(normalizedPath);
            return;
        }

        if (this.state.isRootPath(normalizedPath)) {
            await this.loadFolder(normalizedPath);
            return;
        }

        const folderElement = this.container.querySelector(`.tree-folder[data-path="${normalizedPath}"]`);
        if (!folderElement) return;
        const children = folderElement.querySelector('.tree-folder-children');
        if (!children) return;

        try {
            const entries = await this.readDirectory(normalizedPath);
            await this.loadFolderChildren(normalizedPath, children, entries);
        } catch (error) {
            console.error('刷新文件夹失败:', { path: normalizedPath, error });
        } finally {
            this.renderer.reapplyCurrentFileSelection();
        }
    }
}
