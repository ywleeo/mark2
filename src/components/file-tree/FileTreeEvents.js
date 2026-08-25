import { addClickHandler } from '../../utils/PointerHelper.js';
import { isInternalDrag } from '../../utils/dragState.js';
import { readClipboardFilePaths } from '../../api/clipboard.js';
import { t } from '../../i18n/index.js';

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
        this._onTreeKeyDown = null;
        this._onTreePaste = null;
        this._onTreeBlur = null;
        this._onDocumentPointerDown = null;
        this._blankAreaClickCleanup = null;
        this._blankAreaPasteArmed = false;
        this._clipboardPastePending = false;
        this._sectionCleanupFunctions = [];
    }

    /**
     * 设置所有事件监听器
     */
    setupEventListeners() {
        this.setupSectionToggles();
        this.setupDragAndDrop();
        this.setupBlankAreaPaste();
    }

    /**
     * 判断点击目标是否属于文件树的非交互空白区域。
     * @param {EventTarget|null} target - 原始点击目标。
     * @returns {boolean} 是否允许把后续粘贴解释为打开路径。
     */
    isBlankTreeArea(target) {
        if (!(target instanceof Element) || !this.fileTree.container.contains(target)) {
            return false;
        }
        return !target.closest([
            '.tree-file',
            '.tree-folder-header',
            '.open-file-item',
            '.section-header',
            'button',
            'input',
            'textarea',
            '[contenteditable="true"]',
        ].join(','));
    }

    /**
     * 让文件树空白处成为显式粘贴目标，避免抢占编辑器和重命名输入框的 Cmd/Ctrl+V。
     */
    setupBlankAreaPaste() {
        const container = this.fileTree.container;
        container.tabIndex = -1;
        this._blankAreaClickCleanup = addClickHandler(container, (event) => {
            const isBlankArea = this.isBlankTreeArea(event.target);
            this._blankAreaPasteArmed = isBlankArea;
            if (isBlankArea) {
                container.focus({ preventScroll: true });
            }
        }, { preventDefault: false });

        this._onTreeKeyDown = (event) => {
            const isPasteShortcut = (event.metaKey || event.ctrlKey)
                && !event.altKey
                && event.key?.toLowerCase() === 'v';
            if (!isPasteShortcut || !this._blankAreaPasteArmed) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            if (this._clipboardPastePending) return;
            void this.handleBlankAreaPaste();
        };
        // macOS 原生 Paste 菜单可能直接派发 paste 而不经过 DOM keydown，需保留同一入口。
        this._onTreePaste = (event) => {
            if (!this._blankAreaPasteArmed) return;
            event.preventDefault();
            event.stopPropagation();
            if (this._clipboardPastePending) return;
            void this.handleBlankAreaPaste();
        };
        this._onTreeBlur = () => {
            this._blankAreaPasteArmed = false;
        };
        // 子节点的 addClickHandler 可能阻止冒泡且保留容器焦点，捕获阶段负责可靠解除粘贴目标。
        this._onDocumentPointerDown = (event) => {
            if (!this.isBlankTreeArea(event.target)) {
                this._blankAreaPasteArmed = false;
            }
        };
        container.addEventListener('keydown', this._onTreeKeyDown);
        container.addEventListener('paste', this._onTreePaste);
        container.addEventListener('blur', this._onTreeBlur);
        document.addEventListener('pointerdown', this._onDocumentPointerDown, true);
    }

    /**
     * 读取剪贴板中的文件夹，确认后通过现有工作区入口打开。
     * 文件路径会被忽略，本交互仅承担“复制文件夹后打开路径”的职责。
     * @returns {Promise<boolean>} 是否确认并发起了打开操作。
     */
    async handleBlankAreaPaste() {
        this._clipboardPastePending = true;
        try {
            const clipboardPaths = await readClipboardFilePaths();
            const uniquePaths = Array.from(new Set(
                clipboardPaths
                    .map(path => this.fileTree.normalizePath(path))
                    .filter(Boolean),
            ));
            if (uniquePaths.length === 0) return false;

            const fileService = this.fileTree.ensureFileService();
            const folderPaths = [];
            for (const path of uniquePaths) {
                try {
                    if (await fileService.isDirectory(path)) {
                        folderPaths.push(path);
                    }
                } catch (error) {
                    console.warn('[FileTree] 跳过无法访问的剪贴板路径', { path, error });
                }
            }
            if (folderPaths.length === 0) return false;

            const { confirm } = await import('@tauri-apps/plugin-dialog');
            const pathSummary = folderPaths.length === 1
                ? folderPaths[0]
                : folderPaths.map(path => `• ${path}`).join('\n');
            const shouldOpen = await confirm(
                t('sidebar.openClipboardFolderConfirm', { path: pathSummary }),
                {
                    title: t('sidebar.openClipboardFolderTitle'),
                    kind: 'info',
                    okLabel: t('sidebar.openClipboardFolderOk'),
                    cancelLabel: t('common.cancel'),
                },
            );
            if (!shouldOpen) return false;

            for (const path of folderPaths) {
                await this.fileTree.ensureSecurityScope(path);
            }
            await this.fileTree.openPathsFromSelection(folderPaths, { source: 'clipboard' });
            return true;
        } catch (error) {
            console.warn('[FileTree] 从剪贴板打开文件夹失败', error);
            return false;
        } finally {
            this._clipboardPastePending = false;
        }
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
            if (!isInternalDrag()) {
                this.fileTree.externalDropHandler?.handleDrop(e);
                return;
            }
            this.fileTree.mover?.handleTreeDrop(e);
        };
        this._onTreeDragEnter = (e) => {
            if (!isInternalDrag()) {
                this.fileTree.externalDropHandler?.handleDragOver(e);
                return;
            }
        };

        this.fileTree.container.addEventListener('dragover', this._onTreeDragOver);
        this.fileTree.container.addEventListener('dragenter', this._onTreeDragEnter);
        this.fileTree.container.addEventListener('dragleave', this._onTreeDragLeave);
        this.fileTree.container.addEventListener('drop', this._onTreeDrop);

        // 部分环境下 dragover 可能被系统级拦截，这里用 mousemove 兜底
        this._onMouseMoveDuringDrag = (e) => {
            if (!isInternalDrag()) return;
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
        if (this._onTreeKeyDown) {
            this.fileTree.container.removeEventListener('keydown', this._onTreeKeyDown);
        }
        if (this._onTreePaste) {
            this.fileTree.container.removeEventListener('paste', this._onTreePaste);
        }
        if (this._onTreeBlur) {
            this.fileTree.container.removeEventListener('blur', this._onTreeBlur);
        }
        if (this._onDocumentPointerDown) {
            document.removeEventListener('pointerdown', this._onDocumentPointerDown, true);
        }
        this._blankAreaClickCleanup?.();

        // 清空引用
        this._onTreeDragOver = null;
        this._onTreeDragLeave = null;
        this._onTreeDrop = null;
        this._onTreeDragEnter = null;
        this._onMouseMoveDuringDrag = null;
        this._onTreeKeyDown = null;
        this._onTreePaste = null;
        this._onTreeBlur = null;
        this._onDocumentPointerDown = null;
        this._blankAreaClickCleanup = null;
        this._blankAreaPasteArmed = false;
        this._clipboardPastePending = false;

    }
}
