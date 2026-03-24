import { addClickHandler } from '../../utils/PointerHelper.js';

/**
 * FileTree 的事件处理模块
 * 负责处理文件树的各种用户交互事件
 */
export class FileTreeEvents {
    constructor(fileTree) {
        this.fileTree = fileTree;

        // 事件处理函数引用（用于清理）
        this._onTreeDragOver = null;
        this._onTreeDragLeave = null;
        this._onTreeDrop = null;
        this._onTreeDragEnter = null;
        this._onMouseMoveDuringDrag = null;
        this._sectionCleanupFunctions = [];
    }

    /**
     * 设置所有事件监听器
     */
    setupEventListeners() {
        this.setupSectionToggles();
        this.setupDragAndDrop();
    }

    /**
     * 设置区域折叠/展开事件
     */
    setupSectionToggles() {
        const openFilesHeader = this.fileTree.container.querySelector('#openFilesHeader');
        const foldersHeader = this.fileTree.container.querySelector('#foldersHeader');
        const openFilesAction = this.fileTree.container.querySelector('#openFilesAction');
        const foldersAction = this.fileTree.container.querySelector('#foldersAction');

        if (openFilesHeader) {
            const cleanup = addClickHandler(openFilesHeader, (event) => {
                if (event.target.closest('.section-action-btn')) return;
                this.handleSectionToggle('openFilesContent');
            });
            this._sectionCleanupFunctions.push(cleanup);
        }

        if (foldersHeader) {
            const cleanup = addClickHandler(foldersHeader, (event) => {
                if (event.target.closest('.section-action-btn')) return;
                this.handleSectionToggle('foldersContent');
            });
            this._sectionCleanupFunctions.push(cleanup);
        }

        if (openFilesAction) {
            const cleanup = addClickHandler(openFilesAction, async (event) => {
                event.stopPropagation();
                await this.fileTree.onOpenFileRequest?.();
            });
            this._sectionCleanupFunctions.push(cleanup);
        }

        if (foldersAction) {
            const cleanup = addClickHandler(foldersAction, async (event) => {
                event.stopPropagation();
                await this.fileTree.onOpenFolderRequest?.();
            });
            this._sectionCleanupFunctions.push(cleanup);
        }
    }

    /**
     * 处理区域折叠/展开
     */
    handleSectionToggle(contentId) {
        const content = this.fileTree.container.querySelector(`#${contentId}`);
        if (!content) return;

        const header = content.previousElementSibling;
        if (!header) return;

        const willExpand = content.classList.contains('collapsed');

        if (willExpand) {
            content.classList.remove('collapsed');
            header.classList.remove('collapsed');
            content.style.display = 'block';
            this.fileTree.state.setSectionCollapsed(contentId, false);
        } else {
            content.classList.add('collapsed');
            header.classList.add('collapsed');
            content.style.display = 'none';
            this.fileTree.state.setSectionCollapsed(contentId, true);
        }

        this.fileTree.state.emitStateChange();
    }

    /**
     * 应用区域折叠状态（从状态恢复UI）
     */
    applySectionStates() {
        const openFilesContent = this.fileTree.container.querySelector('#openFilesContent');
        const openFilesHeader = this.fileTree.container.querySelector('#openFilesHeader');
        const foldersContent = this.fileTree.container.querySelector('#foldersContent');
        const foldersHeader = this.fileTree.container.querySelector('#foldersHeader');

        const openFilesCollapsed = this.fileTree.state.getSectionCollapsed('openFilesContent');
        const foldersCollapsed = this.fileTree.state.getSectionCollapsed('foldersContent');

        this.applySingleSectionState(openFilesContent, openFilesHeader, openFilesCollapsed);
        this.applySingleSectionState(foldersContent, foldersHeader, foldersCollapsed);
    }

    /**
     * 应用单个区域的折叠状态
     */
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

    /**
     * 设置拖放事件监听器
     */
    setupDragAndDrop() {
        // 文件树容器级拖拽监听（更可靠的命中）
        this._onTreeDragOver = (e) => this.fileTree.mover?.handleTreeDragOver(e);
        this._onTreeDragLeave = (e) => this.fileTree.mover?.handleTreeDragLeave(e);
        this._onTreeDrop = (e) => {
            // 外部文件拖入
            if (!window.__IS_INTERNAL_DRAG__) {
                this.fileTree.externalDropHandler?.handleDrop(e);
                return;
            }
            this.fileTree.mover?.handleTreeDrop(e);
        };
        this._onTreeDragEnter = (e) => {
            if (!window.__IS_INTERNAL_DRAG__) {
                this.fileTree.externalDropHandler?.handleDragOver(e);
                return;
            }
        };

        this.fileTree.container.addEventListener('dragover', this._onTreeDragOver);
        this.fileTree.container.addEventListener('dragenter', this._onTreeDragEnter);
        this.fileTree.container.addEventListener('dragleave', this._onTreeDragLeave);
        this.fileTree.container.addEventListener('drop', this._onTreeDrop);

        // console.log('[FileTree] container DnD listeners attached');

        // 部分环境下 dragover 可能被系统级拦截，这里用 mousemove 兜底
        this._onMouseMoveDuringDrag = (e) => {
            if (!window.__IS_INTERNAL_DRAG__) return;
            // 构造一个伪事件对象传给 handleTreeDragOver（只用到 clientX/clientY）
            this.fileTree.mover?.handleTreeDragOver({
                clientX: e.clientX,
                clientY: e.clientY,
                dataTransfer: null,
                preventDefault() {},
                stopPropagation() {}
            });
        };
        window.addEventListener('mousemove', this._onMouseMoveDuringDrag);
        // console.log('[FileTree] window mousemove fallback attached');
    }

    /**
     * 清理所有事件监听器
     */
    cleanup() {
        this._sectionCleanupFunctions.forEach((cleanup) => {
            try {
                cleanup?.();
            } catch (error) {
                console.warn('[FileTree] 清理 section 点击事件失败', error);
            }
        });
        this._sectionCleanupFunctions = [];

        // 清理拖放事件
        if (this._onTreeDragOver) {
            this.fileTree.container.removeEventListener('dragover', this._onTreeDragOver);
        }
        if (this._onTreeDragEnter) {
            this.fileTree.container.removeEventListener('dragenter', this._onTreeDragEnter);
        }
        if (this._onTreeDragLeave) {
            this.fileTree.container.removeEventListener('dragleave', this._onTreeDragLeave);
        }
        if (this._onTreeDrop) {
            this.fileTree.container.removeEventListener('drop', this._onTreeDrop);
        }
        if (this._onMouseMoveDuringDrag) {
            window.removeEventListener('mousemove', this._onMouseMoveDuringDrag);
        }

        // 清空引用
        this._onTreeDragOver = null;
        this._onTreeDragLeave = null;
        this._onTreeDrop = null;
        this._onTreeDragEnter = null;
        this._onMouseMoveDuringDrag = null;

        console.log('[FileTree] event listeners cleaned up');
    }
}
