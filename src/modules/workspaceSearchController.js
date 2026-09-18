import { searchWorkspace, cancelWorkspaceSearch } from '../api/workspaceSearch.js';
import { WorkspaceSearchPanel } from '../components/WorkspaceSearchPanel.js';
import { t } from '../i18n/index.js';
import {
    collectWorkspaceSearchTargets,
    getWorkspaceSearchMatchText,
} from '../utils/workspaceSearchUtils.js';

const SEARCH_DEBOUNCE_MS = 180;

/**
 * 创建工作区全文搜索控制器。
 * @param {Object} dependencies - 应用级依赖。
 * @returns {{show: Function, hide: Function, destroy: Function}}
 */
export function createWorkspaceSearchController(dependencies) {
    const {
        host,
        fileTree,
        appState,
        editorRegistry,
        handleFileSelect,
        setSidebarVisibility,
    } = dependencies;
    let debounceTimer = null;
    let requestSerial = 0;

    /** 合并 Open Folders 与 Open Files，未保存文档不会进入磁盘搜索。 */
    const getSearchTargets = () => collectWorkspaceSearchTargets(
        fileTree?.getRootPaths?.() || Array.from(fileTree?.rootPaths || []),
        fileTree?.getOpenFilePaths?.() || Array.from(fileTree?.openFiles || []),
        fileTree?.normalizePath?.bind(fileTree) || (path => path),
    );

    /** 清除所有文本编辑视图中的工作区搜索导航高亮。 */
    const clearDocumentHighlight = () => {
        editorRegistry?.getMarkdownEditor?.()?.clearNavigationHighlight?.();
        editorRegistry?.getCodeEditor?.()?.clearNavigationHighlight?.();
    };

    /** 把搜索结果打开到主栏，并按源文件行列定位。 */
    const openResult = async (result) => {
        if (!result?.filePath) return;
        await fileTree?.selectFile?.(result.filePath, {
            autoFocus: false,
            preserveFocus: true,
            silent: true,
        });
        await handleFileSelect?.(result.filePath, { autoFocus: false });

        const currentPath = appState?.getCurrentFile?.();
        const normalize = fileTree?.normalizePath?.bind(fileTree) || String;
        if (normalize(currentPath) !== normalize(result.filePath)) return;

        const viewMode = appState?.getActiveViewMode?.();
        const matchText = getWorkspaceSearchMatchText(result);
        if (viewMode === 'markdown') {
            editorRegistry?.getMarkdownEditor?.()?.highlightSourceMatch?.(
                result.lineNumber,
                result.columnNumber,
                matchText,
            );
        } else if (viewMode === 'code') {
            const codeEditor = editorRegistry?.getCodeEditor?.();
            codeEditor?.highlightPosition?.(
                result.lineNumber,
                result.utf16ColumnNumber || result.columnNumber,
                matchText.length,
            );
            codeEditor?.editor?.focus?.();
        }
    };

    /** 立即执行一次搜索，并屏蔽已过期响应。 */
    const executeSearch = async ({ query, options }) => {
        const serial = ++requestSerial;
        const trimmedQuery = query.trim();
        if (!trimmedQuery) {
            panel.setMessage(t('workspaceSearch.startTyping'));
            void cancelWorkspaceSearch().catch(() => {});
            return;
        }
        const roots = getSearchTargets();
        if (roots.length === 0) {
            panel.setMessage(t('workspaceSearch.noFolder'));
            return;
        }

        panel.setLoading();
        try {
            const response = await searchWorkspace({
                roots,
                query: trimmedQuery,
                options: {
                    ...options,
                    maxResults: 500,
                    maxFileSize: 2 * 1024 * 1024,
                },
            });
            if (serial !== requestSerial || !panel.isVisible() || response?.cancelled) return;
            panel.setResults(response);
        } catch (error) {
            if (serial !== requestSerial || !panel.isVisible()) return;
            panel.setError(error);
        }
    };

    /** 合并快速连续输入，避免每个按键都启动一次目录遍历。 */
    const scheduleSearch = (request) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => void executeSearch(request), SEARCH_DEBOUNCE_MS);
    };

    const panel = new WorkspaceSearchPanel({
        host,
        onQueryChange: scheduleSearch,
        onSubmit: (request) => {
            clearTimeout(debounceTimer);
            void executeSearch(request);
        },
        onClose: () => controller.hide(),
        onOpenResult: (result) => void openResult(result),
    });

    /** 对外暴露的控制器接口。 */
    const controller = {
        /** 显示工作区搜索，并确保侧栏处于可见状态。 */
        show() {
            setSidebarVisibility?.(false);
            panel.show();
            if (!panel.getRequest().query) {
                panel.setMessage(getSearchTargets().length > 0
                    ? t('workspaceSearch.startTyping')
                    : t('workspaceSearch.noFolder'));
            }
        },

        /** 隐藏面板并取消仍在运行的搜索。 */
        hide() {
            requestSerial += 1;
            clearTimeout(debounceTimer);
            clearDocumentHighlight();
            panel.hide();
            void cancelWorkspaceSearch().catch(() => {});
        },

        /** 释放控制器和面板资源。 */
        destroy() {
            controller.hide();
            panel.destroy();
        },
    };

    panel.hide();
    return controller;
}
