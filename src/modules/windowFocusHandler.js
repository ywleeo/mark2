/**
 * 窗口焦点处理模块
 * 监听窗口焦点变化，在获取焦点时校验文件树状态和打开文件的更新
 */
import { getCurrentWindow } from '@tauri-apps/api/window';
import { confirm } from '@tauri-apps/plugin-dialog';

/**
 * 创建窗口焦点处理器
 * @param {Object} options
 * @param {Function} options.getFileTree - 获取 FileTree 实例
 * @param {Function} options.normalizePath - 路径规范化函数
 * @param {Object} options.fileService - 文件服务（用于获取 metadata）
 * @param {Function} options.getEditor - 获取 Markdown 编辑器
 * @param {Function} options.getCodeEditor - 获取代码编辑器
 * @param {Function} options.getCurrentFile - 获取当前文件路径
 * @param {Function} options.getActiveViewMode - 获取当前视图模式
 * @param {Function} options.scheduleLoadFile - 刷新文件的函数
 * @param {Object} options.fileSession - 文件会话（用于清除缓存）
 */
export function createWindowFocusHandler(options = {}) {
    const {
        getFileTree,
        normalizePath,
        fileService,
        getEditor,
        getCodeEditor,
        getCurrentFile,
        getActiveViewMode,
        scheduleLoadFile,
        fileSession,
    } = options;

    let unlisten = null;
    let isChecking = false;

    // 缓存文件的修改时间（用于检测外部修改）
    const fileModifiedTimeCache = new Map();
    let lastSidebarRefreshAt = 0;
    const SIDEBAR_REFRESH_COOLDOWN_MS = 800;

    async function getFileModifiedTime(filePath) {
        if (!filePath || typeof fileService?.metadata !== 'function') {
            return null;
        }
        try {
            const metadata = await fileService.metadata(filePath);
            if (!metadata || !metadata.modified_time) {
                return null;
            }
            return metadata.modified_time;
        } catch {
            return null;
        }
    }

    function hasUnsavedChangesForPath(filePath) {
        if (!filePath) {
            return false;
        }
        const normalized = typeof normalizePath === 'function' ? normalizePath(filePath) : filePath;
        if (!normalized) {
            return false;
        }

        const cached = fileSession?.getCachedEntry?.(normalized);
        if (cached?.hasChanges) {
            return true;
        }

        const currentFile = getCurrentFile?.();
        const currentNormalized = typeof normalizePath === 'function' ? normalizePath(currentFile) : currentFile;
        if (currentNormalized !== normalized) {
            return false;
        }

        const activeViewMode = getActiveViewMode?.();
        const editor = getEditor?.();
        const codeEditor = getCodeEditor?.();

        if (activeViewMode === 'markdown' && typeof editor?.hasUnsavedChanges === 'function') {
            return editor.hasUnsavedChanges();
        }
        if (activeViewMode === 'code' && typeof codeEditor?.hasUnsavedChanges === 'function') {
            return codeEditor.hasUnsavedChanges();
        }
        if (activeViewMode === 'html' && typeof codeEditor?.hasUnsavedChanges === 'function') {
            return codeEditor.hasUnsavedChanges();
        }

        return false;
    }

    async function refreshOpenFilesOnFocus(fileTree) {
        if (!fileTree) {
            return;
        }
        const openFiles = typeof fileTree.getOpenFilePaths === 'function'
            ? fileTree.getOpenFilePaths()
            : (Array.isArray(fileTree.openFiles) ? fileTree.openFiles : []);

        const normalizedOpenFiles = new Set();

        const currentFile = getCurrentFile?.();
        const currentNormalized = typeof normalizePath === 'function' ? normalizePath(currentFile) : currentFile;

        const allTargets = new Set(
            [currentNormalized, ...openFiles]
                .filter(Boolean)
                .map(path => (typeof normalizePath === 'function' ? normalizePath(path) : path))
                .filter(Boolean)
        );

        for (const normalized of allTargets) {
            if (!normalized) {
                continue;
            }
            normalizedOpenFiles.add(normalized);

            const latestModifiedTime = await getFileModifiedTime(normalized);
            if (latestModifiedTime === null) {
                fileModifiedTimeCache.delete(normalized);
                fileSession?.clearEntry?.(normalized);
                continue;
            }

            const previousModifiedTime = fileModifiedTimeCache.get(normalized);
            if (previousModifiedTime === undefined) {
                const cachedEntry = fileSession?.getCachedEntry?.(normalized);
                const cachedModifiedTime = cachedEntry?.modifiedTime ?? null;
                if (cachedModifiedTime !== null && cachedModifiedTime !== latestModifiedTime) {
                    const isActive = currentNormalized === normalized;
                    const hasUnsavedChanges = hasUnsavedChangesForPath(normalized);
                    if (isActive && hasUnsavedChanges) {
                        const shouldReload = await confirm(
                            '检测到文件在外部被修改，是否重新加载并覆盖当前未保存内容？',
                            {
                                title: '文件已更新',
                                kind: 'warning',
                                okLabel: '重新加载',
                                cancelLabel: '保留当前内容',
                            }
                        );
                        if (shouldReload && typeof scheduleLoadFile === 'function') {
                            await scheduleLoadFile(normalized);
                        }
                    } else if (!hasUnsavedChanges) {
                        if (isActive && typeof scheduleLoadFile === 'function') {
                            await scheduleLoadFile(normalized);
                        } else {
                            fileSession?.clearEntry?.(normalized);
                        }
                    }
                }
                fileModifiedTimeCache.set(normalized, latestModifiedTime);
                continue;
            }

            if (latestModifiedTime !== previousModifiedTime) {
                fileModifiedTimeCache.set(normalized, latestModifiedTime);
                const isActive = currentNormalized === normalized;
                const hasUnsavedChanges = hasUnsavedChangesForPath(normalized);

                if (isActive && hasUnsavedChanges) {
                    const shouldReload = await confirm(
                        '检测到文件在外部被修改，是否重新加载并覆盖当前未保存内容？',
                        {
                            title: '文件已更新',
                            kind: 'warning',
                            okLabel: '重新加载',
                            cancelLabel: '保留当前内容',
                        }
                    );
                    if (shouldReload && typeof scheduleLoadFile === 'function') {
                        await scheduleLoadFile(normalized);
                    }
                    continue;
                }

                if (hasUnsavedChanges) {
                    continue;
                }

                if (isActive && typeof scheduleLoadFile === 'function') {
                    await scheduleLoadFile(normalized);
                } else {
                    fileSession?.clearEntry?.(normalized);
                }
            }
        }

        for (const cachedPath of Array.from(fileModifiedTimeCache.keys())) {
            if (!normalizedOpenFiles.has(cachedPath)) {
                fileModifiedTimeCache.delete(cachedPath);
            }
        }
    }

    async function refreshSidebarOnFocus(fileTree) {
        const now = Date.now();
        if (now - lastSidebarRefreshAt < SIDEBAR_REFRESH_COOLDOWN_MS) {
            return;
        }
        lastSidebarRefreshAt = now;
        try {
            await fileTree.refreshCurrentFolder?.();
        } catch (error) {
            console.error('[windowFocusHandler] 刷新侧边栏失败:', error);
        }
    }

    async function syncFileModifiedTime(filePath, modifiedTime = null) {
        if (!filePath) {
            return null;
        }
        const normalized = typeof normalizePath === 'function' ? normalizePath(filePath) : filePath;
        if (!normalized) {
            return null;
        }
        const nextModifiedTime = modifiedTime ?? await getFileModifiedTime(normalized);
        if (nextModifiedTime === null) {
            return null;
        }
        fileModifiedTimeCache.set(normalized, nextModifiedTime);
        return nextModifiedTime;
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
            await refreshSidebarOnFocus(fileTree);
            await refreshOpenFilesOnFocus(fileTree);
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
        syncFileModifiedTime,
    };
}
