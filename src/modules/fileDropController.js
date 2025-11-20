import { getCurrentWindow } from '@tauri-apps/api/window';

export function createFileDropController({ openPathsFromSelection }) {
    if (typeof openPathsFromSelection !== 'function') {
        throw new Error('createFileDropController 需要提供 openPathsFromSelection 函数');
    }

    let isFileDropHoverActive = false;
    let cleanupHandler = null;

    function setFileDropHoverState(isActive) {
        // 如果是内部拖拽（通过全局变量判断），始终不显示 hover 效果
        if (window.__IS_INTERNAL_DRAG__) {
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

    async function setup() {
        await teardown();

        try {
            const windowRef = getCurrentWindow();
            if (typeof windowRef.onDragDropEvent === 'function') {
                let pendingPaths = [];
                const unlisten = await windowRef.onDragDropEvent(async (event) => {
                    const { payload } = event;
                    if (!payload) return;

                    if (payload.type === 'enter' || payload.type === 'over') {
                        if (Array.isArray(payload.paths) && payload.paths.length > 0) {
                            pendingPaths = payload.paths;
                        }
                        setFileDropHoverState(true);
                        return;
                    }

                    if (payload.type === 'leave') {
                        pendingPaths = [];
                        setFileDropHoverState(false);
                        return;
                    }

                    if (payload.type === 'drop') {
                        const targetPaths = Array.isArray(payload.paths) && payload.paths.length > 0
                            ? payload.paths
                            : pendingPaths;
                        pendingPaths = [];
                        setFileDropHoverState(false);
                        if (Array.isArray(targetPaths) && targetPaths.length > 0) {
                            try {
                                await openPathsFromSelection(targetPaths);
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
                    setFileDropHoverState(false);
                    try {
                        await openPathsFromSelection(event.payload);
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
