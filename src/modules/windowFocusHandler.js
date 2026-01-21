/**
 * 窗口焦点处理模块
 * 监听窗口焦点变化，在获取焦点时校验文件树状态
 */
import { getCurrentWindow } from '@tauri-apps/api/window';

/**
 * 创建窗口焦点处理器
 * @param {Object} options
 * @param {Function} options.getFileTree - 获取 FileTree 实例
 * @param {Function} options.normalizePath - 路径规范化函数
 */
export function createWindowFocusHandler(options = {}) {
    const { getFileTree, normalizePath } = options;

    let unlisten = null;
    let isChecking = false;

    /**
     * 从 DOM 中获取某个目录当前渲染的子项
     * @param {HTMLElement} container - FileTree 容器
     * @param {string} folderPath - 目录路径
     * @returns {Set<string>} 子项路径集合
     */
    function getRenderedChildren(container, folderPath) {
        const result = new Set();
        const folderElement = container.querySelector(`.tree-folder[data-path="${folderPath}"]`);
        if (!folderElement) {
            return result;
        }

        const childrenContainer = folderElement.querySelector('.tree-folder-children');
        if (!childrenContainer) {
            return result;
        }

        // 遍历直接子项
        for (const child of childrenContainer.children) {
            const path = child.dataset?.path;
            if (path) {
                result.add(path);
            }
        }

        return result;
    }

    /**
     * 对比两个集合是否相同
     */
    function setsEqual(a, b) {
        if (a.size !== b.size) return false;
        for (const item of a) {
            if (!b.has(item)) return false;
        }
        return true;
    }

    /**
     * 递归校验目录及其展开的子目录
     * @param {Object} fileTree - FileTree 实例
     * @param {string} folderPath - 目录路径
     * @param {Set<string>} checkedPaths - 已检查的路径（避免重复）
     * @returns {Promise<boolean>} 是否有差异
     */
    async function checkFolderRecursively(fileTree, folderPath, checkedPaths = new Set()) {
        if (checkedPaths.has(folderPath)) {
            return false;
        }
        checkedPaths.add(folderPath);

        const container = fileTree.container;
        if (!container) {
            return false;
        }

        // 获取 DOM 中渲染的子项
        const renderedChildren = getRenderedChildren(container, folderPath);
        if (renderedChildren.size === 0) {
            // 目录可能未展开，跳过
            return false;
        }

        // 读取文件系统实际状态
        let actualEntries;
        try {
            actualEntries = await fileTree.readDirectory(folderPath);
        } catch (error) {
            console.warn('[windowFocusHandler] 读取目录失败:', folderPath, error);
            return false;
        }

        const actualPaths = new Set(actualEntries.map(e => e.path));

        // 对比
        if (!setsEqual(renderedChildren, actualPaths)) {
            return true; // 有差异
        }

        // 递归检查展开的子目录
        for (const entry of actualEntries) {
            if (!entry.isDir) continue;

            const folderKey = fileTree.buildFolderKey(entry.path, folderPath, false);
            const isExpanded = fileTree.expandedFolders.has(folderKey);

            if (isExpanded) {
                const hasDiff = await checkFolderRecursively(fileTree, entry.path, checkedPaths);
                if (hasDiff) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * 窗口获取焦点时的处理逻辑
     */
    async function onWindowFocus() {
        const fileTree = getFileTree?.();
        if (!fileTree) {
            return;
        }

        // 防止并发检查
        if (isChecking) {
            return;
        }
        isChecking = true;

        try {
            const rootPaths = fileTree.getRootPaths();
            if (rootPaths.length === 0) {
                return;
            }

            const foldersToRefresh = [];

            for (const rootPath of rootPaths) {
                const hasDiff = await checkFolderRecursively(fileTree, rootPath);
                if (hasDiff) {
                    foldersToRefresh.push(rootPath);
                }
            }

            // 刷新有差异的目录
            if (foldersToRefresh.length > 0) {
                console.log('[windowFocusHandler] 检测到文件变化，刷新目录:', foldersToRefresh);
                await Promise.all(
                    foldersToRefresh.map(path => fileTree.loadFolder(path))
                );
            }
        } catch (error) {
            console.error('[windowFocusHandler] 校验文件树失败:', error);
        } finally {
            isChecking = false;
        }
    }

    /**
     * 启动窗口焦点监听
     */
    async function setup() {
        try {
            const appWindow = getCurrentWindow();
            unlisten = await appWindow.onFocusChanged(({ payload: focused }) => {
                if (focused) {
                    // 延迟一点执行，避免和其他焦点逻辑冲突
                    setTimeout(() => {
                        onWindowFocus().catch(error => {
                            console.error('[windowFocusHandler] 处理焦点事件失败:', error);
                        });
                    }, 100);
                }
            });
            console.log('[windowFocusHandler] 窗口焦点监听已启动');
        } catch (error) {
            console.error('[windowFocusHandler] 启动窗口焦点监听失败:', error);
        }
    }

    /**
     * 停止监听
     */
    function dispose() {
        if (unlisten) {
            unlisten();
            unlisten = null;
        }
    }

    return {
        setup,
        dispose,
        // 暴露手动触发的方法，方便测试
        checkNow: onWindowFocus,
    };
}
