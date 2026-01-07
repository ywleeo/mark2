/**
 * Sidebar 布局管理服务
 * 负责显示/隐藏、宽度调整
 */

import { saveSidebarWidth, loadSidebarWidth, saveSidebarVisible, loadSidebarVisible } from '../utils/sidebarStorage.js';

const WIDTH_CONSTRAINTS = {
    MIN: 280,
    MAX: 600,
};

/**
 * 创建布局服务
 */
export async function createLayoutService() {
    let width = await loadSidebarWidth();
    let visible = await loadSidebarVisible();
    let listeners = [];

    /**
     * 更新 DOM
     */
    function updateDOM() {
        // 更新 body class
        if (visible) {
            document.body.classList.add('ai-sidebar-visible');
        } else {
            document.body.classList.remove('ai-sidebar-visible');
        }

        // 更新 CSS 变量
        document.documentElement.style.setProperty('--ai-sidebar-width', `${width}px`);
    }

    /**
     * 通知所有监听器
     */
    function notify() {
        updateDOM();

        listeners.forEach(listener => {
            try {
                listener({ width, visible });
            } catch (error) {
                console.error('[LayoutService] 监听器执行失败:', error);
            }
        });
    }

    /**
     * 设置宽度
     */
    function setWidth(newWidth) {
        const clamped = Math.max(WIDTH_CONSTRAINTS.MIN, Math.min(WIDTH_CONSTRAINTS.MAX, newWidth));
        if (width === clamped) {
            return;
        }

        width = clamped;
        saveSidebarWidth(width); // 异步保存，不阻塞
        notify();
    }

    /**
     * 显示 sidebar
     */
    function show() {
        if (visible) {
            return;
        }

        visible = true;
        saveSidebarVisible(visible); // 异步保存，不阻塞
        notify();
    }

    /**
     * 隐藏 sidebar
     */
    function hide() {
        if (!visible) {
            return;
        }

        visible = false;
        saveSidebarVisible(visible); // 异步保存，不阻塞
        notify();
    }

    /**
     * 切换显示状态
     */
    function toggle() {
        if (visible) {
            hide();
        } else {
            show();
        }
    }

    /**
     * 获取当前状态
     */
    function getState() {
        return { width, visible };
    }

    /**
     * 订阅变化
     */
    function subscribe(listener) {
        listeners.push(listener);
        // 立即更新 DOM 和通知当前状态
        updateDOM();
        listener({ width, visible });
        return () => {
            listeners = listeners.filter(l => l !== listener);
        };
    }

    // 初始化时更新 DOM
    updateDOM();

    return {
        setWidth,
        show,
        hide,
        toggle,
        getState,
        subscribe,
        WIDTH_CONSTRAINTS,
    };
}
