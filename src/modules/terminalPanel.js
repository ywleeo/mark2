/**
 * 终端面板模块
 * 提供底部可交互终端功能
 */

import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { FitAddon } from '@xterm/addon-fit';
import { createPtyService } from './terminal-sidebar/services/ptyService.js';
import { isFeatureEnabled } from '../config/features.js';
import { addClickHandler } from '../utils/PointerHelper.js';

const STORAGE_KEY = 'mark2_terminal_height';
const DEFAULT_HEIGHT = 240;
const MIN_HEIGHT = 100;
const MAX_HEIGHT = 600;

const DARK_THEME = {
    background: '#1e1e1e',
    foreground: '#d4d4d4',
    cursor: '#aeafad',
    cursorAccent: '#1e1e1e',
    selectionBackground: '#264f78',
    black: '#000000',
    red: '#cd3131',
    green: '#0dbc79',
    yellow: '#e5e510',
    blue: '#2472c8',
    magenta: '#bc3fbc',
    cyan: '#11a8cd',
    white: '#e5e5e5',
    brightBlack: '#666666',
    brightRed: '#f14c4c',
    brightGreen: '#23d18b',
    brightYellow: '#f5f543',
    brightBlue: '#3b8eea',
    brightMagenta: '#d670d6',
    brightCyan: '#29b8db',
    brightWhite: '#e5e5e5',
};

const LIGHT_THEME = {
    background: '#f5f5f5',
    foreground: '#383a42',
    cursor: '#526eff',
    cursorAccent: '#f5f5f5',
    selectionBackground: '#add6ff',
    black: '#383a42',
    red: '#e45649',
    green: '#50a14f',
    yellow: '#c18401',
    blue: '#4078f2',
    magenta: '#a626a4',
    cyan: '#0184bc',
    white: '#a0a1a7',
    brightBlack: '#4f525e',
    brightRed: '#e06c75',
    brightGreen: '#98c379',
    brightYellow: '#e5c07b',
    brightBlue: '#61afef',
    brightMagenta: '#c678dd',
    brightCyan: '#56b6c2',
    brightWhite: '#ffffff',
};

function isDarkMode() {
    return document.documentElement.dataset.themeAppearance !== 'light';
}

function getTerminalTheme() {
    return isDarkMode() ? DARK_THEME : LIGHT_THEME;
}

/**
 * 创建终端面板控制器
 */
export function createTerminalPanel(options = {}) {
    const { getWorkspaceCwd } = options;

    let panelElement = null;
    let contentElement = null;
    let terminal = null;
    let fitAddon = null;
    let ptyService = null;
    let isVisible = false;
    let currentHeight = DEFAULT_HEIGHT;
    let resizeObserver = null;
    let themeObserver = null;
    let isResizing = false;

    /**
     * 初始化终端面板
     */
    function initialize() {
        if (!isFeatureEnabled('terminal')) {
            return;
        }

        panelElement = document.getElementById('terminalPanel');
        if (!panelElement) {
            console.warn('[TerminalPanel] 找不到终端面板元素');
            return;
        }

        contentElement = panelElement.querySelector('.terminal-content');
        if (!contentElement) {
            console.warn('[TerminalPanel] 找不到终端内容元素');
            return;
        }

        // 恢复高度
        const savedHeight = localStorage.getItem(STORAGE_KEY);
        if (savedHeight) {
            currentHeight = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, parseInt(savedHeight, 10)));
            panelElement.style.height = `${currentHeight}px`;
        }

        // 设置关闭按钮
        const closeBtn = panelElement.querySelector('.terminal-close-btn');
        if (closeBtn) {
            addClickHandler(closeBtn, () => hide());
        }

        // 设置调整大小拖拽
        setupResizer();
    }

    /**
     * 设置拖拽调整大小
     */
    function setupResizer() {
        const resizer = panelElement.querySelector('.terminal-resizer');
        if (!resizer) return;

        let startY = 0;
        let startHeight = 0;

        const onMouseDown = (e) => {
            e.preventDefault();
            isResizing = true;
            startY = e.clientY;
            startHeight = panelElement.offsetHeight;
            document.body.classList.add('terminal-resizing');
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        };

        const onMouseMove = (e) => {
            if (!isResizing) return;
            const delta = startY - e.clientY;
            const newHeight = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, startHeight + delta));
            currentHeight = newHeight;
            panelElement.style.height = `${newHeight}px`;
            // 实时调整 xterm 大小
            fitTerminal();
        };

        const onMouseUp = () => {
            isResizing = false;
            document.body.classList.remove('terminal-resizing');
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            // 保存高度
            localStorage.setItem(STORAGE_KEY, String(currentHeight));
            // 最终调整 xterm 大小
            fitTerminal();
        };

        resizer.addEventListener('mousedown', onMouseDown);
    }

    /**
     * 创建 xterm 终端实例
     */
    function createTerminal() {
        if (terminal) return;

        terminal = new Terminal({
            fontFamily: 'Menlo, Monaco, "Courier New", monospace',
            fontSize: 13,
            lineHeight: 1.2,
            cursorBlink: true,
            cursorStyle: 'block',
            theme: getTerminalTheme(),
            allowProposedApi: true,
        });

        fitAddon = new FitAddon();
        terminal.loadAddon(fitAddon);

        terminal.open(contentElement);

        // Cmd+K 清屏
        terminal.attachCustomKeyEventHandler((e) => {
            if (e.type === 'keydown' && e.metaKey && e.key === 'k') {
                e.preventDefault();
                terminal.clear();
                return false;
            }
            return true;
        });

        // 监听主题切换
        themeObserver = new MutationObserver(() => {
            if (terminal) {
                terminal.options.theme = getTerminalTheme();
            }
        });
        themeObserver.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['data-theme-appearance'],
        });

        // 设置 ResizeObserver 监听容器大小变化
        resizeObserver = new ResizeObserver(() => {
            fitTerminal();
        });
        resizeObserver.observe(contentElement);

        // 延迟 fit 以确保容器已渲染
        requestAnimationFrame(() => {
            fitTerminal();
        });
    }

    /**
     * 调整终端大小以适应容器
     */
    function fitTerminal() {
        if (!terminal || !fitAddon || !isVisible) return;
        try {
            fitAddon.fit();
            // 同步 PTY 大小
            if (ptyService?.isSpawned()) {
                ptyService.resize(terminal.cols, terminal.rows);
            }
        } catch (e) {
            // 忽略 fit 错误
        }
    }

    /**
     * 启动 PTY 进程
     */
    async function spawnPty() {
        if (!terminal) return;
        if (ptyService?.isSpawned()) return;

        ptyService = createPtyService();

        // 设置数据回调
        ptyService.onData((data) => {
            terminal.write(data);
        });

        // 设置退出回调
        ptyService.onExit(() => {
            terminal.writeln('\r\n[进程已退出]');
            // 可选：自动重启
        });

        // 监听终端输入
        terminal.onData((data) => {
            ptyService.write(data);
        });

        // 获取工作目录
        let cwd = null;
        if (typeof getWorkspaceCwd === 'function') {
            cwd = getWorkspaceCwd();
        }

        try {
            await ptyService.spawn({
                cols: terminal.cols,
                rows: terminal.rows,
                cwd,
            });
        } catch (error) {
            console.error('[TerminalPanel] 启动 PTY 失败:', error);
            terminal.writeln(`\r\n[启动终端失败: ${error.message || error}]`);
        }
    }

    /**
     * 显示终端面板
     */
    async function show() {
        if (!isFeatureEnabled('terminal')) {
            console.warn('[TerminalPanel] 终端功能在 MAS 版本中不可用');
            return;
        }

        if (!panelElement) {
            initialize();
        }

        if (!panelElement) return;

        isVisible = true;
        panelElement.classList.add('is-visible');

        // 延迟创建终端（确保面板可见后再渲染）
        requestAnimationFrame(async () => {
            if (!terminal) {
                createTerminal();
            }
            fitTerminal();

            // 如果还没有启动 PTY，启动它
            if (!ptyService?.isSpawned()) {
                await spawnPty();
            }

            // 聚焦终端
            terminal?.focus();
        });
    }

    /**
     * 隐藏终端面板
     */
    function hide() {
        if (!panelElement) return;
        isVisible = false;
        panelElement.classList.remove('is-visible');
    }

    /**
     * 切换终端面板显示状态
     */
    async function toggle() {
        if (isVisible) {
            hide();
        } else {
            await show();
        }
    }

    /**
     * 检查是否可见
     */
    function getIsVisible() {
        return isVisible;
    }

    /**
     * 销毁终端面板
     */
    function destroy() {
        // 停止 PTY
        if (ptyService) {
            ptyService.kill();
            ptyService = null;
        }

        // 停止主题监听
        if (themeObserver) {
            themeObserver.disconnect();
            themeObserver = null;
        }

        // 停止 ResizeObserver
        if (resizeObserver) {
            resizeObserver.disconnect();
            resizeObserver = null;
        }

        // 销毁终端
        if (terminal) {
            terminal.dispose();
            terminal = null;
            fitAddon = null;
        }

        panelElement = null;
        contentElement = null;
        isVisible = false;
    }

    return {
        initialize,
        show,
        hide,
        toggle,
        getIsVisible,
        destroy,
    };
}
