import { addClickHandler } from '../../utils/PointerHelper.js';

/**
 * FileTree 的 DOM 渲染模块
 * 负责创建文件树节点、渲染UI等
 */
export class FileTreeRenderer {
    constructor(fileTree) {
        this.fileTree = fileTree;
    }

    /**
     * 创建文件夹节点
     */
    createFolderItem(name, path, entries, isRoot = false, parentPath = null) {
        const item = document.createElement('div');
        item.className = 'tree-folder';
        item.dataset.path = path;
        item.dataset.parentPath = parentPath ?? '';
        item.dataset.nodeKey = this.fileTree.buildFolderKey(path, parentPath, isRoot);
        item.dataset.isRoot = isRoot ? 'true' : 'false';

        const header = document.createElement('div');
        header.className = `tree-folder-header ${isRoot ? 'root' : ''}`;

        const folderIconClosed = `
            <svg class="tree-folder-icon tree-folder-icon-closed" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
        `;

        const folderIconOpen = `
            <svg class="tree-folder-icon tree-folder-icon-open" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2"/>
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
            ${folderIconClosed}
            ${folderIconOpen}
            <span class="tree-item-name">${name}</span>
            ${rootActions}
        `;

        // Drag & Drop support
        item.addEventListener('dragenter', (e) => this.fileTree.mover?.handleDragEnter(e, header));
        item.addEventListener('dragover', (e) => this.fileTree.mover?.handleDragOver(e, header));
        item.addEventListener('dragleave', (e) => this.fileTree.mover?.handleDragLeave(e, header));
        item.addEventListener('drop', (e) => this.fileTree.mover?.handleDrop(e, path, header));

        // 文件夹拖拽
        header.draggable = true;
        const onFolderNativeDragStart = (event) => {
            if (this.fileTree.mover?.shouldBlockInteraction?.()) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            if (event.target.closest('.root-folder-actions')) return;
            if (event.target.closest('.tree-expand-icon')) return;
            this.fileTree.mover?.interceptNativeDragStart(event, path, { isDirectory: true });
        };
        const onFolderNativeDragEnd = () => this.fileTree.mover?.cancelNativeDragState?.();
        header.addEventListener('dragstart', onFolderNativeDragStart);
        header.addEventListener('dragend', onFolderNativeDragEnd);
        this.fileTree.cleanupFunctions.push(() => {
            header.removeEventListener('dragstart', onFolderNativeDragStart);
            header.removeEventListener('dragend', onFolderNativeDragEnd);
        });

        // 点击处理
        const cleanup1 = addClickHandler(header, (event) => {
            if (event.target.closest('.close-folder-btn') || event.target.closest('.pin-folder-btn')) {
                return;
            }
            this.fileTree.toggleFolder(path, item);
        }, { shouldHandle: () => !this.fileTree.mover?.shouldBlockInteraction?.() });
        this.fileTree.cleanupFunctions.push(cleanup1);

        if (isRoot) {
            const closeButton = header.querySelector('.close-folder-btn');
            if (closeButton) {
                const cleanup2 = addClickHandler(closeButton, (event) => {
                    event.stopPropagation();
                    this.fileTree.closeFolder(path);
                });
                this.fileTree.cleanupFunctions.push(cleanup2);
            }

            const pinButton = header.querySelector('.pin-folder-btn');
            if (pinButton) {
                const cleanup3 = addClickHandler(pinButton, (event) => {
                    event.stopPropagation();
                    this.fileTree.pinRootFolder(path);
                });
                this.fileTree.cleanupFunctions.push(cleanup3);
            }
        }

        const children = document.createElement('div');
        children.className = 'tree-folder-children';
        children.style.display = 'none';

        item.appendChild(header);
        item.appendChild(children);

        return item;
    }

    /**
     * 创建文件节点
     */
    createFileItem(name, path) {
        const item = document.createElement('div');
        item.className = 'tree-file';
        item.dataset.path = path;
        item.tabIndex = '0';

        // 启用原生 dragstart
        item.draggable = true;
        const onNativeDragStart = (e) => this.fileTree.mover?.interceptNativeDragStart(e, path);
        const onNativeDragEnd = () => this.fileTree.mover?.cancelNativeDragState?.();
        item.addEventListener('dragstart', onNativeDragStart);
        item.addEventListener('dragend', onNativeDragEnd);
        this.fileTree.cleanupFunctions.push(() => {
            item.removeEventListener('dragstart', onNativeDragStart);
            item.removeEventListener('dragend', onNativeDragEnd);
        });

        // SVG 文件图标
        let iconSvg = `
            <svg class="tree-file-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M13 2H6a2 2 0 0 0-2 2v16c0 1.1.9 2 2 2h12a2 2 0 0 0 2-2V9l-7-7z"/>
                <path d="M13 3v6h6"/>
            </svg>
        `;

        if (name.endsWith('.md') || name.endsWith('.markdown')) {
            iconSvg = `
                <svg class="tree-file-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16c0 1.1.9 2 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/>
                    <path d="M14 3v5h5M16 13H8M16 17H8M10 9H8"/>
                </svg>
            `;
        }

        item.innerHTML = `
            ${iconSvg}
            <span class="tree-item-name">${name}</span>
        `;

        // 键盘：回车触发重命名
        const onKeyDown = (e) => {
            if (this.fileTree.isRenaming()) return;
            if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                this.fileTree.startRenaming(path);
            }
        };
        item.addEventListener('keydown', onKeyDown);
        this.fileTree.cleanupFunctions.push(() => item.removeEventListener('keydown', onKeyDown));

        // 点击处理
        let clickCount = 0;
        let clickTimer = null;

        const cleanup = addClickHandler(item, (event) => {
            clickCount++;

            if (clickCount === 1) {
                // 第一次点击：立即打开文件（不自动聚焦编辑器）
                this.fileTree.selectFile(path, { autoFocus: false });

                // 启动定时器，等待可能的第二次点击
                clickTimer = setTimeout(() => {
                    clickCount = 0;
                }, 300);
            } else if (clickCount === 2) {
                // 第二次点击（双击）：添加到打开的文件
                clearTimeout(clickTimer);
                this.fileTree.addToOpenFiles(path);
                clickCount = 0;
            }
        }, {
            preventDefault: true,
            shouldHandle: (event) => {
                if (this.fileTree.mover?.shouldBlockInteraction?.()) {
                    return false;
                }
                if (event.target.closest('.tree-file-rename-input')) {
                    return false;
                }
                return true;
            },
        });
        this.fileTree.cleanupFunctions.push(cleanup);

        return item;
    }

    /**
     * 初始化容器 HTML
     */
    initContainer() {
        this.fileTree.container.innerHTML = `
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
    }

    /**
     * 重新应用当前文件的选中状态
     */
    reapplyCurrentFileSelection() {
        if (!this.fileTree.currentFile) return;
        const normalized = this.fileTree.normalizePath(this.fileTree.currentFile);
        if (!normalized) return;

        const fileItem = this.fileTree.container.querySelector(`.tree-file[data-path="${normalized}"]`);
        if (fileItem && !fileItem.classList.contains('selected')) {
            fileItem.classList.add('selected');
        }
    }
}
