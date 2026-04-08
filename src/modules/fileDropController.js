import { getCurrentWindow } from '@tauri-apps/api/window';
import { captureSecurityScopeForPath } from '../services/securityScopeService.js';
import { isInternalDrag } from '../utils/dragState.js';

export function createFileDropController({ openPathsFromSelection }) {
    if (typeof openPathsFromSelection !== 'function') {
        throw new Error('createFileDropController 需要提供 openPathsFromSelection 函数');
    }

    let isFileDropHoverActive = false;
    let cleanupHandler = null;
    // Windows WebView2 在窗口获得焦点时会重放 drag-drop 事件序列，
    // 用 userDragActive 标志区分真正的用户拖拽和焦点切换引起的假事件。
    // 只有用户真正拖入文件（enter）后才允许处理 drop。
    let userDragActive = false;

    function setFileDropHoverState(isActive) {
        // 如果是内部拖拽（通过全局变量判断），始终不显示 hover 效果
        if (isInternalDrag()) {
            if (isFileDropHoverActive) {
                isActive = false;
            } else {
                return;
            }
        }

        if (isFileDropHoverActive === isActive) {
            return;
        }

        const body = document.body;
        if (!body) {
            return;
        }

        isFileDropHoverActive = isActive;
        body.classList.toggle('is-file-drop-hover', isActive);
    }

    async function ensureSecurityScopes(paths) {
        if (!Array.isArray(paths) || paths.length === 0) {
            return;
        }
        for (const rawPath of paths) {
            if (!rawPath) continue;
            try {
                await captureSecurityScopeForPath(rawPath);
            } catch (error) {
                console.warn('[fileDropController] 捕获安全权限失败', rawPath, error);
            }
        }
    }

    async function setup() {
        await teardown();

        try {
            const windowRef = getCurrentWindow();
            if (typeof windowRef.onDragDropEvent === 'function') {
                let pendingPaths = [];
                const unlisten = await windowRef.onDragDropEvent(async (event) => {
                    const { payload } = event;
                    if (!payload) return;

                    if (payload.type === 'enter') {
                        userDragActive = true;
                        if (Array.isArray(payload.paths) && payload.paths.length > 0) {
                            pendingPaths = payload.paths;
                        }
                        setFileDropHoverState(true);
                        return;
                    }

                    if (payload.type === 'over') {
                        if (Array.isArray(payload.paths) && payload.paths.length > 0) {
                            pendingPaths = payload.paths;
                        }
                        if (userDragActive) {
                            setFileDropHoverState(true);
                        }
                        return;
                    }

                    if (payload.type === 'leave') {
                        userDragActive = false;
                        pendingPaths = [];
                        setFileDropHoverState(false);
                        return;
                    }

                    if (payload.type === 'drop') {
                        if (!userDragActive) {
                            // Windows 焦点切换触发的假 drop，忽略
                            pendingPaths = [];
                            setFileDropHoverState(false);
                            return;
                        }
                        userDragActive = false;
                        const targetPaths = Array.isArray(payload.paths) && payload.paths.length > 0
                            ? payload.paths
                            : pendingPaths;
                        pendingPaths = [];
                        setFileDropHoverState(false);
                        if (Array.isArray(targetPaths) && targetPaths.length > 0) {
                            await ensureSecurityScopes(targetPaths);
                            try {
                                await openPathsFromSelection(targetPaths, { source: 'external-drop' });
                            } catch (error) {
                                console.error('处理拖拽文件时出错:', error);
                            }
                        }
                    }
                });

                cleanupHandler = () => {
                    unlisten?.();
                    setFileDropHoverState(false);
                    pendingPaths = [];
                };
                return cleanupHandler;
            }

             const [unlistenDrop, unlistenHover, unlistenCancel] = await Promise.all([
                 windowRef.listen('tauri://file-drop', async (event) => {
                     const payloadPaths = Array.isArray(event.payload) ? event.payload : [];
                     setFileDropHoverState(false);
                     await ensureSecurityScopes(payloadPaths);
                     try {
                         await openPathsFromSelection(payloadPaths, { source: 'external-drop' });
                     } catch (error) {
                         console.error('处理拖拽文件时出错:', error);
                     }
                 }),
                 windowRef.listen('tauri://file-drop-hover', () => {
                     setFileDropHoverState(true);
                 }),
                 windowRef.listen('tauri://file-drop-cancel', () => {
                     setFileDropHoverState(false);
                 }),
             ]);

            cleanupHandler = () => {
                unlistenDrop?.();
                unlistenHover?.();
                unlistenCancel?.();
                setFileDropHoverState(false);
            };
            return cleanupHandler;
        } catch (error) {
            console.error('注册拖拽监听失败:', error);
            cleanupHandler = null;
            return null;
        }
    }

    async function teardown() {
        if (cleanupHandler) {
            try {
                cleanupHandler();
            } catch (error) {
                console.warn('清理拖拽监听失败:', error);
            }
            cleanupHandler = null;
        }
        setFileDropHoverState(false);
    }

    return {
        setup,
        teardown,
    };
}
