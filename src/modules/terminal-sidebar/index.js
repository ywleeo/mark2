/**
 * Terminal Sidebar 模块
 * 提供集成终端功能
 */

import '@xterm/xterm/css/xterm.css';
import { TerminalSidebar } from './components/TerminalSidebar.js';
import { createTerminalLayoutService } from './services/layoutService.js';
import { createPtyService } from './services/ptyService.js';

/**
 * 初始化 Terminal Sidebar
 * @param {Object} options
 * @param {Object} options.eventBus - 事件总线
 * @param {Function} options.getAISidebar - 获取 AI Sidebar 的函数
 * @param {Function} options.getWorkspacePath - 获取当前工作区路径
 */
export async function initTerminalSidebar({ eventBus, getAISidebar, getWorkspacePath }) {
    console.log('[Terminal Sidebar] 正在初始化...');

    const layoutService = createTerminalLayoutService();
    const ptyService = createPtyService();

    // 创建 sidebar
    const sidebar = new TerminalSidebar({
        layoutService,
        onClose: () => {
            console.log('[Terminal Sidebar] 已关闭');
        },
    });

    // 连接 PTY 服务与终端
    sidebar.onTerminalData = (data) => {
        ptyService.write(data);
    };

    sidebar.onTerminalResize = (cols, rows) => {
        ptyService.resize(cols, rows);
    };

    // 接收 PTY 输出
    ptyService.onData((data) => {
        sidebar.write(data);
    });

    // PTY 退出处理
    ptyService.onExit(() => {
        console.log('[Terminal Sidebar] PTY 进程已退出');
        // 可以选择重新启动或显示提示
        sidebar.write('\r\n[进程已退出]\r\n');
    });

    // 渲染到 body
    document.body.appendChild(sidebar.render());

    // 首次显示时启动 PTY
    let ptySpawned = false;

    // 监听显示事件，实现与 AI Sidebar 的互斥
    layoutService.subscribe(async ({ visible }) => {
        if (visible) {
            // Terminal Sidebar 显示时，隐藏 AI Sidebar
            const aiSidebar = getAISidebar?.();
            if (aiSidebar?.hideSidebar) {
                aiSidebar.hideSidebar();
            }

            // 首次显示时启动 PTY
            if (!ptySpawned && !ptyService.isSpawned()) {
                ptySpawned = true;
                try {
                    const cwd = getWorkspacePath?.() || null;
                    await ptyService.spawn({
                        cols: 80,
                        rows: 24,
                        cwd,
                    });
                    // 聚焦终端
                    setTimeout(() => sidebar.focus(), 100);
                } catch (error) {
                    console.error('[Terminal Sidebar] 启动 PTY 失败:', error);
                    sidebar.write(`\r\n[错误] 无法启动终端: ${error}\r\n`);
                }
            } else {
                // 聚焦终端
                setTimeout(() => sidebar.focus(), 100);
            }
        }
    });

    // 监听 AI Sidebar 显示事件，隐藏 Terminal Sidebar
    if (eventBus) {
        eventBus.on('ai-sidebar:show', () => {
            layoutService.hide();
        });
    }

    console.log('[Terminal Sidebar] 初始化完成');

    return {
        sidebar,
        layoutService,
        ptyService,
        showSidebar() {
            // 发出事件通知 AI Sidebar 隐藏
            eventBus?.emit('terminal-sidebar:show');
            sidebar.show();
        },
        hideSidebar() {
            sidebar.hide();
        },
        toggleSidebar() {
            if (sidebar.isVisible()) {
                sidebar.hide();
            } else {
                eventBus?.emit('terminal-sidebar:show');
                sidebar.show();
            }
        },
        destroy() {
            ptyService.kill();
            sidebar.destroy();
        },
    };
}
