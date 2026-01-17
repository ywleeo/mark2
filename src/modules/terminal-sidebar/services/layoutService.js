/**
 * Terminal Sidebar 布局服务
 * 管理 sidebar 的宽度和显示状态
 */

const STORAGE_KEY = 'terminal-sidebar-layout';
const MIN_WIDTH = 300;
const MAX_WIDTH = 800;
const DEFAULT_WIDTH = 450;

export function createTerminalLayoutService() {
    let state = {
        width: DEFAULT_WIDTH,
        visible: false,
    };

    const subscribers = new Set();

    // 从 localStorage 恢复状态
    function loadState() {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                state.width = parsed.width || DEFAULT_WIDTH;
                // visible 不恢复，默认隐藏
            }
        } catch (e) {
            console.warn('[TerminalLayoutService] 加载状态失败:', e);
        }
    }

    // 保存状态到 localStorage
    function saveState() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                width: state.width,
            }));
        } catch (e) {
            console.warn('[TerminalLayoutService] 保存状态失败:', e);
        }
    }

    // 通知订阅者
    function notify() {
        subscribers.forEach(callback => {
            try {
                callback({ ...state });
            } catch (e) {
                console.error('[TerminalLayoutService] 订阅回调执行失败:', e);
            }
        });
    }

    // 更新 body class
    function updateBodyClass() {
        if (state.visible) {
            document.body.classList.add('terminal-sidebar-visible');
        } else {
            document.body.classList.remove('terminal-sidebar-visible');
        }
    }

    // 初始化
    loadState();

    return {
        subscribe(callback) {
            subscribers.add(callback);
            // 立即通知当前状态
            callback({ ...state });
            return () => subscribers.delete(callback);
        },

        getState() {
            return { ...state };
        },

        setWidth(width) {
            const clampedWidth = Math.min(Math.max(width, MIN_WIDTH), MAX_WIDTH);
            if (state.width !== clampedWidth) {
                state.width = clampedWidth;
                saveState();
                notify();
            }
        },

        show() {
            if (!state.visible) {
                state.visible = true;
                updateBodyClass();
                notify();
            }
        },

        hide() {
            if (state.visible) {
                state.visible = false;
                updateBodyClass();
                notify();
            }
        },

        toggle() {
            state.visible = !state.visible;
            updateBodyClass();
            notify();
        },

        isVisible() {
            return state.visible;
        },
    };
}
