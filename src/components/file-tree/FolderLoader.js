import { basename } from '../../utils/pathUtils.js';
import { rememberSecurityScopes } from '../../services/securityScopeService.js';
import { isUnsupportedFilePath } from '../../utils/fileTypeUtils.js';
import { createCompactFileNameElement, scheduleCompactFileNameRefresh } from '../../utils/fileNameDisplay.js';

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
            stopWatchingFolder,
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
        this.stopWatchingFolder = stopWatchingFolder;
        this.emitStateChange = emitStateChange;
        this.shouldDefer = shouldDefer;
        this.onRefreshDeferred = onRefreshDeferred;
        this.onBeforeRefresh = onBeforeRefresh;

        // 记录每个 children 容器上次填充的内容签名，签名未变就跳过 DOM 重建，
        // 避免窗口聚焦/watcher 等无差别 refresh 触发整棵树闪一下。
        this._childrenSignatures = new WeakMap();
    }

    _computeEntriesSignature(entries) {
        if (!Array.isArray(entries) || entries.length === 0) return '';
        return entries.map((e) => `${e.isDir ? 'd' : 'f'}:${e.path}`).join('\n');
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
            .filter(entry => !isUnsupportedFilePath(entry.path))
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
                if (nameSpan) {
                    nameSpan.replaceWith(createCompactFileNameElement('tree-item-name', folderName));
                }
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
            // root header 的名字 label 不在 children 容器内，需要单独触发一次刷新
            scheduleCompactFileNameRefresh(rootItem);
            // watcher 注册不阻塞首屏：超大目录（几十万 entry）下 FSEvents/notify
            // 启动可能慢，await 会让整个 loadFolder 卡住，UI 显示不出来。
            // 错误自己 log，外部 try/catch 不再 await 它。
            this.watchFolder(rootPath).catch((err) => console.error('watchFolder failed:', err));
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

        // ─── 快速路径：内容签名未变 + 容器已有内容 → 完全不动 DOM ───
        const newSignature = this._computeEntriesSignature(entries);
        const oldSignature = this._childrenSignatures.get(childrenContainer);
        const hasExistingChildren = childrenContainer.children.length > 0;
        if (hasExistingChildren && oldSignature === newSignature) {
            return;
        }

        // ─── 增量更新：复用旧节点（保留展开/选中/滚动状态），只新建/删除/重排必要的部分 ───
        const oldNodes = new Map();
        for (const child of Array.from(childrenContainer.children)) {
            const key = child.dataset?.path;
            if (key) oldNodes.set(key, child);
        }

        const expandedFolders = this.state.expandedFolders;
        const deferredLoads = [];
        const nextOrder = new Array(entries.length);
        const newlyCreated = [];

        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            const expectedClass = entry.isDir ? 'tree-folder' : 'tree-file';
            let node = oldNodes.get(entry.path);
            // 同 path 但类型变了（极少见但合法：rm file → mkdir 同名）也要重建
            if (node && !node.classList.contains(expectedClass)) {
                node = null;
            }

            if (node) {
                oldNodes.delete(entry.path); // 标记为已复用
            } else {
                const name = basename(entry.path);
                if (entry.isDir) {
                    node = this.renderer.createFolderItem(name, entry.path, [], false, path);
                    const childKey = node.dataset.nodeKey;
                    if (childKey && expandedFolders.has(childKey)) {
                        const header = node.querySelector('.tree-folder-header');
                        const children = node.querySelector('.tree-folder-children');
                        header?.classList.add('expanded');
                        if (children) {
                            children.classList.add('expanded');
                            children.style.display = 'block';
                            // 把递归加载延后到空闲帧，避免在首屏一次性下钻 N 层
                            deferredLoads.push({ path: entry.path, children, key: childKey });
                        }
                    }
                } else {
                    node = this.renderer.createFileItem(name, entry.path);
                }
                newlyCreated.push(node);
            }
            nextOrder[i] = node;
        }

        // 删除：oldNodes 里剩下的 = 新列表里没有的条目
        for (const removed of oldNodes.values()) {
            removed.remove();
        }

        // 快速路径：容器原本是空的（首次展开/初次加载），全部都是新建节点，
        // 用 DocumentFragment 一次 append 进去，避免逐个 insertBefore 触发 N 次 reflow
        // —— 这是大目录（几十/上百个子项）打开慢的关键瓶颈
        if (!hasExistingChildren && newlyCreated.length === nextOrder.length) {
            const fragment = document.createDocumentFragment();
            for (const node of nextOrder) fragment.appendChild(node);
            childrenContainer.appendChild(fragment);
        } else {
            // 增量重排：仅在顺序/数量与当前 DOM 不一致时调整。appendChild 对已存在节点是
            // "移动"操作，不会重建，也不破坏节点状态（hover/focus/expand 等）。
            const currentChildren = childrenContainer.children;
            let needsReorder = currentChildren.length !== nextOrder.length;
            if (!needsReorder) {
                for (let i = 0; i < nextOrder.length; i++) {
                    if (currentChildren[i] !== nextOrder[i]) { needsReorder = true; break; }
                }
            }
            if (needsReorder) {
                for (let i = 0; i < nextOrder.length; i++) {
                    const target = nextOrder[i];
                    const current = currentChildren[i];
                    if (current !== target) {
                        childrenContainer.insertBefore(target, current || null);
                    }
                }
            }
        }

        this._childrenSignatures.set(childrenContainer, newSignature);

        // 只对新建节点刷新名字截断（旧节点已计算过）
        if (newlyCreated.length > 0) {
            scheduleCompactFileNameRefresh(childrenContainer);
        }

        if (deferredLoads.length > 0) {
            this._scheduleDeferredChildren(deferredLoads);
        }
    }

    _scheduleDeferredChildren(jobs) {
        const idle = typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function'
            ? window.requestIdleCallback.bind(window)
            : (cb) => setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 0 }), 0);

        const runNext = () => {
            const job = jobs.shift();
            if (!job) return;
            idle(async () => {
                // 任何时候都可能：用户已经把这个父目录折叠掉、或刷新使容器脱离 DOM
                if (!this.state.expandedFolders.has(job.key) || !job.children.isConnected) {
                    runNext();
                    return;
                }
                try {
                    await this.loadFolderChildren(job.path, job.children);
                    // 恢复出来的已展开子目录也要单独挂 watcher（recursive: false）
                    this.watchFolder?.(job.path)?.catch?.(() => {});
                    // 子目录加载完才能确认对应文件是否在 DOM 里，重应用一次选中态
                    this.renderer?.reapplyCurrentFileSelection?.();
                } catch (error) {
                    console.error('惰性展开子目录失败:', { path: job.path, error });
                } finally {
                    runNext();
                }
            }, { timeout: 200 });
        };

        runNext();
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
            // 折叠时取消该子目录的 watch（root 永远 watch，由 closeFolder 管理）
            if (!isRoot) {
                this.stopWatchingFolder?.(path);
            }
        } else {
            expandedFolders.add(folderKey);
            children.classList.add('expanded');
            header.classList.add('expanded');
            children.style.display = 'block';
            if (children.children.length === 0) {
                await this.loadFolderChildren(path, children);
            }
            // 展开时挂载该子目录的 watch（recursive: false 在 FileWatcher 已配好）
            if (!isRoot) {
                this.watchFolder?.(path)?.catch?.(() => {});
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
