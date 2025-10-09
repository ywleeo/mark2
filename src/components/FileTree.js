export class FileTree {
    constructor(containerElement, onFileSelect) {
        this.container = containerElement;
        this.onFileSelect = onFileSelect;
        this.rootPath = null;
        this.expandedFolders = new Set();
        this.currentFile = null;
        this.openFiles = []; // 跟踪打开的文件
        this.init();
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
                <div class="section-content" id="openFilesContent">
                    <div class="section-empty">未打开文件</div>
                </div>
            </div>

            <!-- 文件夹区域 -->
            <div class="sidebar-section folders-section">
                <div class="section-header" id="foldersHeader">
                    <svg class="section-arrow" width="8" height="8" viewBox="0 0 8 8">
                        <path d="M1 2 L4 5 L7 2" stroke="currentColor" stroke-width="1.5" fill="none"/>
                    </svg>
                    <span class="section-title">文件夹</span>
                </div>
                <div class="section-content" id="foldersContent">
                    <div class="section-empty">
                        <button class="open-folder-button">打开文件夹</button>
                    </div>
                </div>
            </div>
        `;

        this.setupEventListeners();
    }

    setupEventListeners() {
        // 打开文件夹按钮
        this.container.querySelector('.open-folder-button')?.addEventListener('click', () => {
            this.requestOpenFolder();
        });

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
                multiple: false,
            });

            if (selected) {
                await this.loadFolder(selected);
            }
        } catch (error) {
            console.error('打开文件夹失败:', error);
        }
    }

    async loadFolder(folderPath) {
        this.rootPath = folderPath;

        try {
            const entries = await this.readDirectory(folderPath);
            const folderName = folderPath.split('/').pop() || folderPath;

            const contentDiv = this.container.querySelector('#foldersContent');
            contentDiv.innerHTML = '';

            // 渲染根文件夹
            const rootItem = this.createFolderItem(folderName, folderPath, entries, true);
            contentDiv.appendChild(rootItem);

            // 默认展开根文件夹
            if (!this.expandedFolders.has(folderPath)) {
                await this.toggleFolder(folderPath);
            }
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

    async loadFolderChildren(path, childrenContainer) {
        const entries = await this.readDirectory(path);

        for (const entry of entries) {
            const name = entry.path.split('/').pop();

            if (entry.isDir) {
                const folderItem = this.createFolderItem(name, entry.path, []);
                childrenContainer.appendChild(folderItem);
            } else {
                const fileItem = this.createFileItem(name, entry.path);
                childrenContainer.appendChild(fileItem);
            }
        }
    }

    selectFile(path) {
        // 添加到打开文件列表
        this.addToOpenFiles(path);

        // 移除之前的选中状态
        this.container.querySelectorAll('.tree-file.selected, .open-file-item.selected').forEach(el => {
            el.classList.remove('selected');
        });

        // 添加选中状态到文件树
        const fileItem = this.container.querySelector(`.tree-file[data-path="${path}"]`);
        if (fileItem) {
            fileItem.classList.add('selected');
        }

        // 添加选中状态到打开文件列表
        const openFileItem = this.container.querySelector(`.open-file-item[data-path="${path}"]`);
        if (openFileItem) {
            openFileItem.classList.add('selected');
        }

        this.currentFile = path;

        // 回调
        if (this.onFileSelect) {
            this.onFileSelect(path);
        }
    }

    addToOpenFiles(path) {
        if (this.openFiles.includes(path)) return;

        this.openFiles.push(path);
        this.renderOpenFiles();
    }

    renderOpenFiles() {
        const contentDiv = this.container.querySelector('#openFilesContent');

        if (this.openFiles.length === 0) {
            contentDiv.innerHTML = '<div class="section-empty">未打开文件</div>';
            return;
        }

        contentDiv.innerHTML = '';

        this.openFiles.forEach(path => {
            const fileName = path.split('/').pop();
            const item = document.createElement('div');
            item.className = 'open-file-item';
            item.dataset.path = path;

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
        const index = this.openFiles.indexOf(path);
        if (index > -1) {
            this.openFiles.splice(index, 1);
            this.renderOpenFiles();
        }
    }
}
