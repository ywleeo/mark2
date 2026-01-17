/**
 * Terminal Sidebar 主组件
 */

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

export class TerminalSidebar {
    constructor({ layoutService, onClose }) {
        this.element = null;
        this.layoutService = layoutService;
        this.onClose = onClose;

        // 子组件
        this.resizeHandle = null;
        this.terminalContainer = null;

        // xterm 实例
        this.terminal = null;
        this.fitAddon = null;

        // 订阅取消函数
        this.unsubscribeLayout = null;

        // 绑定方法
        this.handleResize = this.handleResize.bind(this);
        this.handleResizeMouseDown = this.handleResizeMouseDown.bind(this);
        this.handleResizeMouseMove = this.handleResizeMouseMove.bind(this);
        this.handleResizeMouseUp = this.handleResizeMouseUp.bind(this);
        this.handleWindowResize = this.handleWindowResize.bind(this);

        this.isDragging = false;
        this.startX = 0;
        this.startWidth = 0;

        // PTY 事件处理器（由外部设置）
        this.onTerminalData = null;
        this.onTerminalResize = null;

        // 主题监听
        this.themeObserver = null;
        this.handleThemeChange = this.handleThemeChange.bind(this);
    }

    render() {
        this.element = document.createElement('div');
        this.element.className = 'terminal-sidebar';

        // 创建 resize handle
        this.resizeHandle = document.createElement('div');
        this.resizeHandle.className = 'terminal-sidebar-resize-handle';
        this.resizeHandle.addEventListener('mousedown', this.handleResizeMouseDown);

        // 创建 header
        const header = document.createElement('div');
        header.className = 'terminal-sidebar-header';
        header.innerHTML = `
            <span class="terminal-sidebar-title">Terminal</span>
            <div class="terminal-sidebar-header-actions">
                <button class="terminal-sidebar-close-btn" title="关闭">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M4.28 3.22a.75.75 0 0 0-1.06 1.06L6.94 8l-3.72 3.72a.75.75 0 1 0 1.06 1.06L8 9.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L9.06 8l3.72-3.72a.75.75 0 0 0-1.06-1.06L8 6.94 4.28 3.22Z"/>
                    </svg>
                </button>
            </div>
        `;

        // 绑定关闭按钮
        const closeBtn = header.querySelector('.terminal-sidebar-close-btn');
        closeBtn.addEventListener('click', () => {
            this.layoutService.hide();
            this.onClose?.();
        });

        // 创建终端容器
        this.terminalContainer = document.createElement('div');
        this.terminalContainer.className = 'terminal-sidebar-content';

        // 组装 DOM
        this.element.appendChild(this.resizeHandle);
        this.element.appendChild(header);
        this.element.appendChild(this.terminalContainer);

        // 订阅布局变化
        this.subscribeToServices();

        // 监听窗口 resize
        window.addEventListener('resize', this.handleWindowResize);

        return this.element;
    }

    initTerminal() {
        if (this.terminal) {
            return;
        }

        // 创建 xterm 终端
        this.terminal = new Terminal({
            cursorBlink: true,
            fontSize: 13,
            fontFamily: 'Menlo, Monaco, "Courier New", monospace',
            theme: this.getTerminalTheme(),
            allowProposedApi: true,
        });

        // 创建 fit 插件
        this.fitAddon = new FitAddon();
        this.terminal.loadAddon(this.fitAddon);

        // 挂载终端
        this.terminal.open(this.terminalContainer);

        // 适配大小
        setTimeout(() => {
            this.fitTerminal();
        }, 0);

        // 监听终端输入
        this.terminal.onData((data) => {
            if (this.onTerminalData) {
                this.onTerminalData(data);
            }
        });

        // 监听终端 resize
        this.terminal.onResize(({ cols, rows }) => {
            if (this.onTerminalResize) {
                this.onTerminalResize(cols, rows);
            }
        });

        // 监听主题变化
        this.setupThemeObserver();

        console.log('[Terminal Sidebar] xterm.js 已初始化');
    }

    setupThemeObserver() {
        if (this.themeObserver) {
            return;
        }

        this.themeObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.attributeName === 'data-theme-appearance') {
                    this.handleThemeChange();
                    break;
                }
            }
        });

        this.themeObserver.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['data-theme-appearance'],
        });
    }

    handleThemeChange() {
        if (this.terminal) {
            const theme = this.getTerminalTheme();
            this.terminal.options.theme = theme;
            console.log('[Terminal Sidebar] 主题已切换');
        }
    }

    getTerminalTheme() {
        // 检测当前主题（使用应用的 data-theme-appearance 属性）
        const appearance = document.documentElement.getAttribute('data-theme-appearance');
        const isDark = appearance === 'dark';

        if (isDark) {
            return {
                background: '#0d1117',
                foreground: '#c9d1d9',
                cursor: '#58a6ff',
                cursorAccent: '#0d1117',
                selectionBackground: 'rgba(56, 139, 253, 0.4)',
                selectionForeground: '#c9d1d9',
                black: '#484f58',
                red: '#ff7b72',
                green: '#3fb950',
                yellow: '#d29922',
                blue: '#58a6ff',
                magenta: '#bc8cff',
                cyan: '#39c5cf',
                white: '#b1bac4',
                brightBlack: '#6e7681',
                brightRed: '#ffa198',
                brightGreen: '#56d364',
                brightYellow: '#e3b341',
                brightBlue: '#79c0ff',
                brightMagenta: '#d2a8ff',
                brightCyan: '#56d4dd',
                brightWhite: '#f0f6fc',
            };
        } else {
            return {
                background: '#ffffff',
                foreground: '#24292f',
                cursor: '#0969da',
                cursorAccent: '#ffffff',
                selectionBackground: 'rgba(9, 105, 218, 0.3)',
                selectionForeground: '#24292f',
                black: '#24292f',
                red: '#cf222e',
                green: '#116329',
                yellow: '#4d2d00',
                blue: '#0969da',
                magenta: '#8250df',
                cyan: '#1b7c83',
                white: '#6e7781',
                brightBlack: '#57606a',
                brightRed: '#a40e26',
                brightGreen: '#1a7f37',
                brightYellow: '#633c01',
                brightBlue: '#218bff',
                brightMagenta: '#a475f9',
                brightCyan: '#3192aa',
                brightWhite: '#8c959f',
            };
        }
    }

    fitTerminal() {
        if (this.fitAddon && this.terminal) {
            try {
                this.fitAddon.fit();
            } catch (error) {
                console.warn('[Terminal Sidebar] fit failed:', error);
            }
        }
    }

    /**
     * 写入数据到终端（从 PTY 接收的数据）
     */
    write(data) {
        if (this.terminal) {
            this.terminal.write(data);
        }
    }

    /**
     * 清空终端
     */
    clear() {
        if (this.terminal) {
            this.terminal.clear();
        }
    }

    subscribeToServices() {
        this.unsubscribeLayout = this.layoutService.subscribe(({ width, visible }) => {
            this.updateLayout(width, visible);
        });
    }

    updateLayout(width, visible) {
        if (!this.element) {
            return;
        }
        this.element.style.width = `${width}px`;

        if (visible) {
            this.element.classList.add('visible');
            // 首次显示时初始化终端
            if (!this.terminal) {
                setTimeout(() => this.initTerminal(), 50);
            } else {
                // 重新适配大小
                setTimeout(() => this.fitTerminal(), 50);
            }
        } else {
            this.element.classList.remove('visible');
        }
    }

    handleWindowResize() {
        if (this.layoutService.isVisible()) {
            this.fitTerminal();
        }
    }

    // Resize Handle 事件处理
    handleResizeMouseDown(e) {
        e.preventDefault();
        this.isDragging = true;
        this.startX = e.clientX;

        if (this.element) {
            this.startWidth = this.element.offsetWidth;
        }

        document.addEventListener('mousemove', this.handleResizeMouseMove);
        document.addEventListener('mouseup', this.handleResizeMouseUp);
        document.body.style.cursor = 'ew-resize';
        document.body.style.userSelect = 'none';
    }

    handleResizeMouseMove(e) {
        if (!this.isDragging) {
            return;
        }

        const deltaX = this.startX - e.clientX;
        const newWidth = this.startWidth + deltaX;

        this.handleResize(newWidth);
    }

    handleResizeMouseUp() {
        if (!this.isDragging) {
            return;
        }

        this.isDragging = false;
        document.removeEventListener('mousemove', this.handleResizeMouseMove);
        document.removeEventListener('mouseup', this.handleResizeMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';

        // resize 完成后重新适配终端
        this.fitTerminal();
    }

    handleResize(width) {
        this.layoutService.setWidth(width);
    }

    // 显示/隐藏
    show() {
        this.layoutService.show();
    }

    hide() {
        this.layoutService.hide();
    }

    toggle() {
        this.layoutService.toggle();
    }

    isVisible() {
        return this.layoutService.isVisible();
    }

    /**
     * 聚焦终端
     */
    focus() {
        if (this.terminal) {
            this.terminal.focus();
        }
    }

    destroy() {
        if (this.unsubscribeLayout) {
            this.unsubscribeLayout();
        }
        if (this.resizeHandle) {
            this.resizeHandle.removeEventListener('mousedown', this.handleResizeMouseDown);
        }
        if (this.themeObserver) {
            this.themeObserver.disconnect();
            this.themeObserver = null;
        }
        document.removeEventListener('mousemove', this.handleResizeMouseMove);
        document.removeEventListener('mouseup', this.handleResizeMouseUp);
        window.removeEventListener('resize', this.handleWindowResize);

        if (this.terminal) {
            this.terminal.dispose();
            this.terminal = null;
        }

        if (this.element && this.element.parentNode) {
            this.element.parentNode.removeChild(this.element);
        }

        this.element = null;
    }
}
