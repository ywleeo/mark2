import { addClickHandler } from '../../utils/PointerHelper.js';
import { createCompactFileNameElement } from '../../utils/fileNameDisplay.js';
import { getFileIconSvg } from '../../utils/fileIcons.js';

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
                    <button class="root-folder-action-btn move-up-btn" type="button" data-path="${path}" title="上移">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="18 15 12 9 6 15"/>
                        </svg>
                    </button>
                    <button class="root-folder-action-btn move-down-btn" type="button" data-path="${path}" title="下移">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="6 9 12 15 18 9"/>
                        </svg>
                    </button>
                    <button class="root-folder-action-btn close-folder-btn" type="button" data-path="${path}" title="移除文件夹">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                            <line x1="18" y1="6" x2="6" y2="18"/>
                            <line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                    </button>
                </div>
            `
            : '';

        header.innerHTML = `
            ${expandIcon}
            ${folderIconClosed}
            ${folderIconOpen}
            ${rootActions}
        `;
        const rootActionsElement = header.querySelector('.root-folder-actions');
        header.insertBefore(createCompactFileNameElement('tree-item-name', name), rootActionsElement);

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
            if (event.target.closest('.close-folder-btn') ||
                event.target.closest('.move-up-btn') ||
                event.target.closest('.move-down-btn')) {
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

            const moveUpButton = header.querySelector('.move-up-btn');
            if (moveUpButton) {
                const cleanup3 = addClickHandler(moveUpButton, (event) => {
                    event.stopPropagation();
                    this.fileTree.moveRootFolderUp(path);
                });
                this.fileTree.cleanupFunctions.push(cleanup3);
            }

            const moveDownButton = header.querySelector('.move-down-btn');
            if (moveDownButton) {
                const cleanup4 = addClickHandler(moveDownButton, (event) => {
                    event.stopPropagation();
                    this.fileTree.moveRootFolderDown(path);
                });
                this.fileTree.cleanupFunctions.push(cleanup4);
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
        item.title = name;

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

        item.innerHTML = getFileIconSvg(path, { className: 'tree-file-icon', size: 16 });
        item.appendChild(createCompactFileNameElement('tree-item-name', name));

        // 键盘：回车和 F2 触发重命名
        const onKeyDown = (e) => {
            if (this.fileTree.isRenaming()) return;
            if (e.key === 'Enter' || e.key === 'F2') {
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
                    <span class="section-title">OPEN FILES</span>
                    <div class="section-header-actions">
                        <span class="section-collapse-indicator" aria-hidden="true">
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M2.5 4.5 6 8l3.5-3.5"/>
                            </svg>
                        </span>
                        <button
                            class="section-action-btn"
                            id="openFilesAction"
                            type="button"
                            title="打开文件"
                            aria-label="打开文件"
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                                <path d="M14 2v6h6"/>
                            </svg>
                        </button>
                    </div>
                </div>
                <div class="section-content" id="openFilesContent"></div>
            </div>

            <!-- 文件夹区域 -->
            <div class="sidebar-section folders-section">
                <div class="section-header" id="foldersHeader">
                    <span class="section-title">FOLDERS</span>
                    <div class="section-header-actions">
                        <span class="section-collapse-indicator" aria-hidden="true">
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M2.5 4.5 6 8l3.5-3.5"/>
                            </svg>
                        </span>
                        <button
                            class="section-action-btn"
                            id="foldersAction"
                            type="button"
                            title="打开文件夹"
                            aria-label="打开文件夹"
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                <path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H3z"/>
                                <path d="M3 9h18l-1.4 9.1A2 2 0 0 1 17.62 20H6.38a2 2 0 0 1-1.98-1.9z"/>
                            </svg>
                        </button>
                    </div>
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
