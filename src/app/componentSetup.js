/**
 * UI 组件设置
 * 负责初始化状态栏、文件树、标签管理器等组件
 */

import { requireElementById, requireElementWithin } from './domHelpers.js';
import { createStatusBarController } from '../modules/statusBarController.js';
import { ZOOM_STEP } from './viewController.js';

/**
 * 初始化状态栏控制器
 * @param {Object} params - 参数对象
 * @returns {Object} 状态栏控制器实例
 */
export function setupStatusBar({
    appState,
    appServices,
    editorRegistry,
    normalizeFsPath,
    handleZoomControl,
    updateZoomDisplayForActiveView,
}) {
    const statusBarElement = requireElementById('statusBar', '未找到状态栏元素 statusBar');
    const statusBarFilePathElement = requireElementById('statusBarPath', '状态栏缺少文件路径区域');
    const statusBarProgressElement = requireElementById('statusBarProgress', '状态栏缺少进度区域');
    const statusBarProgressTextElement = requireElementById('statusBarProgressText', '状态栏缺少进度文本区域');
    const statusBarWordCountElement = requireElementById('statusBarWordCount', '状态栏缺少字数区域');
    const statusBarLastModifiedElement = requireElementById('statusBarLastModified', '状态栏缺少更新日期区域');
    const statusBarZoomElement = requireElementById('statusBarZoom', '状态栏缺少缩放控件');
    const statusBarZoomValueElement = requireElementById('statusBarZoomValue', '状态栏缺少缩放显示');
    const statusBarZoomOutButton = requireElementWithin(statusBarZoomElement, '[data-zoom="out"]', '状态栏缺少缩小按钮');
    const statusBarZoomInButton = requireElementWithin(statusBarZoomElement, '[data-zoom="in"]', '状态栏缺少放大按钮');
    const statusBarPageInfoElement = requireElementById('statusBarPageInfo', '状态栏缺少页码区域');

    const statusBarController = createStatusBarController({
        statusBarElement,
        statusBarFilePathElement,
        statusBarWordCountElement,
        statusBarLastModifiedElement,
        statusBarProgressElement,
        statusBarProgressTextElement,
        statusBarZoomElement,
        statusBarZoomValueElement,
        statusBarZoomInButton,
        statusBarZoomOutButton,
        statusBarPageInfoElement,
        normalizeFsPath,
        fileService: appServices.file,
        onVisibilityChange: () => {
            window.requestAnimationFrame(() => {
                const codeEditor = editorRegistry.getCodeEditor();
                codeEditor?.requestLayout?.();
            });
        },
    });

    appState.setStatusBarController(statusBarController);
    statusBarController.updateStatusBar();
    statusBarController.setupStatusBarPathInteraction({
        getCurrentFile: () => appState.getCurrentFile(),
    });
    statusBarController.setupZoomControls({
        onZoomIn: () => handleZoomControl(ZOOM_STEP),
        onZoomOut: () => handleZoomControl(-ZOOM_STEP),
    });
    updateZoomDisplayForActiveView();
    statusBarController.setPageInfo('');

    return statusBarController;
}

/**
 * 初始化文件树
 * @param {Object} params - 参数对象
 * @returns {Object} 文件树实例
 */
export function setupFileTree({
    FileTreeCtor,
    appState,
    executeCommand,
    handleFileSelect,
    handleOpenFilesChange,
    handleSidebarStateChange,
    applyPathChange,
    handleTabClose,
    normalizeFsPath,
    documentSessions,
    onRunFile,
    onOpenFile,
    onOpenFolder,
}) {
    const fileTreeElement = document.getElementById('fileTree');
    const fileTree = new FileTreeCtor(fileTreeElement, handleFileSelect, {
        executeCommand,
        onFolderChange: (...args) => appState.getFileWatcherController()?.handleFolderWatcherEvent(...args),
        onFileChange: (...args) => appState.getFileWatcherController()?.handleFileWatcherEvent(...args),
        onOpenFilesChange: handleOpenFilesChange,
        onStateChange: handleSidebarStateChange,
        onPathRenamed: applyPathChange,
        onOpenFileRequest: onOpenFile,
        onOpenFolderRequest: onOpenFolder,
        onCloseFileRequest: (path) => {
            if (!path) {
                return;
            }
            const normalized = normalizeFsPath(path) || path;
            if (!normalized) {
                return;
            }
            // 检查文件是否在打开文件列表中，决定是 file 还是 shared tab
            const isInOpenList = fileTree?.isInOpenList?.(normalized);
            return handleTabClose({
                id: isInOpenList ? normalized : 'shared-preview',
                type: isInOpenList ? 'file' : 'shared',
                path: normalized,
            });
        },
        onRunFile,
        documentSessions,
    });

    appState.setFileTree(fileTree);
    return fileTree;
}

/**
 * 初始化标签管理器
 * @param {Object} params - 参数对象
 * @returns {Object} 标签管理器实例
 */
export function setupTabManager({
    TabManagerCtor,
    appState,
    handleTabSelect,
    handleTabClose,
    handleTabRenameConfirm,
    handleTabRenameCancel,
    handleTabReorder,
    handleCreateUntitled,
}) {
    const tabBarElement = document.getElementById('tabBar');
    const tabManager = new TabManagerCtor(tabBarElement, {
        onTabSelect: handleTabSelect,
        onTabClose: handleTabClose,
        onRenameConfirm: handleTabRenameConfirm,
        onRenameCancel: handleTabRenameCancel,
        onTabReorder: handleTabReorder,
        onCreateUntitled: handleCreateUntitled,
    });

    appState.setTabManager(tabManager);
    return tabManager;
}
