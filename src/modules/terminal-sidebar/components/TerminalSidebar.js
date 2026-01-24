/**
 * Terminal Sidebar 主组件
 */

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { loadEditorSettings } from '../../../utils/editorSettings.js';

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

        // 触控板选择保护
        this.tapGuardState = null;
        this.tapGuardCleanup = null;
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

        // 读取用户设置
        const settings = loadEditorSettings();
        const fontSize = settings.terminalFontSize || 13;
        const fontFamily = settings.terminalFontFamily || 'Menlo, Monaco, "Courier New", monospace';

        // 创建 xterm 终端
        this.terminal = new Terminal({
            cursorBlink: true,
            fontSize,
            fontFamily,
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
            this.markInputHandled(data); // 标记 xterm 已处理，避免 IME workaround 重复发送
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

        // 处理 Cmd+K 清屏
        this.terminal.attachCustomKeyEventHandler((event) => {
            // IME 输入中（包括中文标点），不拦截
            if (event.isComposing || event.key === 'Process') {
                return true;
            }
            const key = typeof event.key === 'string' ? event.key.toLowerCase() : '';
            if ((event.metaKey || event.ctrlKey) && key === 'k') {
                event.preventDefault();
                this.terminal.clear();
                return false;
            }
            return true;
        });

        // 监听主题变化
        this.setupThemeObserver();

        // 设置触控板选择保护
        this.setupTapSelectionGuard();

        // 修复 xterm.js 在 macOS 上中文标点输入需要按两下的问题
        // xterm.js 的 CompositionHelper 对非 composition 的直接输入（如中文标点）处理有 bug
        this.setupIMEWorkaround();

        console.log('[Terminal Sidebar] xterm.js 已初始化');
    }

    /**
     * 设置触控板/触摸选择保护，防止移动触控板时意外选中内容
     */
    setupTapSelectionGuard() {
        if (!this.terminalContainer) {
            return;
        }
        if (this.tapGuardCleanup) {
            this.tapGuardCleanup();
            this.tapGuardCleanup = null;
        }
        this.tapGuardState = null;

        const target = this.terminalContainer;

        const normalizedPointerType = (event) => {
            const pointerType = typeof event.pointerType === 'string'
                ? event.pointerType.toLowerCase()
                : '';
            return pointerType || 'mouse';
        };

        const shouldGuardPointer = (event) => {
            const pointerType = normalizedPointerType(event);
            if (pointerType === 'touch' || pointerType === 'pen') {
                return true;
            }
            if (pointerType === 'mouse') {
                // 触控板移动时 buttons === 0 且 pressure === 0
                if (typeof event.buttons === 'number' && event.buttons === 0) {
                    return true;
                }
                if (typeof event.pressure === 'number') {
                    return event.pressure === 0;
                }
            }
            return false;
        };

        const stopEventForTap = (event) => {
            if (!event) {
                return;
            }
            if (typeof event.stopImmediatePropagation === 'function') {
                event.stopImmediatePropagation();
            } else if (typeof event.stopPropagation === 'function') {
                event.stopPropagation();
            }
            if (event.cancelable) {
                event.preventDefault();
            }
        };

        const pointerDown = (event) => {
            if (event.button !== 0 || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) {
                this.tapGuardState = null;
                return;
            }
            if (!shouldGuardPointer(event)) {
                this.tapGuardState = null;
                return;
            }

            const pointerType = normalizedPointerType(event);
            const blockTapDrag = pointerType === 'touch'
                || pointerType === 'pen'
                || (pointerType === 'mouse' && (typeof event.buttons !== 'number' || event.buttons === 0));

            this.tapGuardState = {
                pointerId: event.pointerId,
                guardActive: blockTapDrag,
                blockTapDrag,
                startClientX: event.clientX,
                startClientY: event.clientY,
                pointerType,
            };

            if (blockTapDrag) {
                stopEventForTap(event);
            }
        };

        const pointerMove = (event) => {
            const state = this.tapGuardState;
            if (!state || event.pointerId !== state.pointerId) {
                return;
            }
            if (state.blockTapDrag) {
                stopEventForTap(event);
                return;
            }

            // 检测是否有移动
            const dx = Math.abs(event.clientX - (state.startClientX ?? event.clientX));
            const dy = Math.abs(event.clientY - (state.startClientY ?? event.clientY));
            const movementExceedsThreshold = dx > 1 || dy > 1;

            if (!state.guardActive && movementExceedsThreshold && shouldGuardPointer(event)) {
                state.guardActive = true;
                stopEventForTap(event);
            } else if (state.guardActive) {
                stopEventForTap(event);
            }
        };

        const pointerUp = (event) => {
            const state = this.tapGuardState;
            if (!state || event.pointerId !== state.pointerId) {
                return;
            }
            if (state.guardActive) {
                stopEventForTap(event);
            }
            this.tapGuardState = null;
        };

        const pointerCancel = () => {
            this.tapGuardState = null;
        };

        target.addEventListener('pointerdown', pointerDown, true);
        window.addEventListener('pointermove', pointerMove, true);
        window.addEventListener('pointerup', pointerUp, true);
        window.addEventListener('pointercancel', pointerCancel, true);

        this.tapGuardCleanup = () => {
            target.removeEventListener('pointerdown', pointerDown, true);
            window.removeEventListener('pointermove', pointerMove, true);
            window.removeEventListener('pointerup', pointerUp, true);
            window.removeEventListener('pointercancel', pointerCancel, true);
            this.tapGuardState = null;
        };
    }

    /**
     * 修复 xterm.js 在 macOS 上中文标点输入需要按两下的问题
     * xterm.js 的 CompositionHelper 对非 composition 的直接输入处理有 bug
     *
     * 两种情况：
     * - 问号：input 触发但 onData 不触发 → 需要手动发送
     * - 逗号：onData 先触发，input 后触发 → 不需要手动发送
     */
    setupIMEWorkaround() {
        if (!this.terminal?.textarea) {
            return;
        }

        const textarea = this.terminal.textarea;
        this._pendingIMEInput = null;
        this._recentOnData = null;

        textarea.addEventListener('input', (e) => {
            // 只处理非 composition 的 insertText 输入（中文标点等）
            if (e.inputType === 'insertText' && e.data && !e.isComposing) {
                const now = Date.now();

                // 检查是否刚刚有相同数据的 onData 触发过（50ms 内）
                if (this._recentOnData &&
                    this._recentOnData.data === e.data &&
                    now - this._recentOnData.time < 50) {
                    // xterm 已经处理过了，不需要再发送
                    return;
                }

                this._pendingIMEInput = {
                    data: e.data,
                    time: now,
                };

                // 延迟检查 xterm 是否已处理
                setTimeout(() => {
                    const pending = this._pendingIMEInput;
                    if (pending && pending.data === e.data && Date.now() - pending.time < 100) {
                        // xterm 没处理，手动发送
                        if (this.onTerminalData) {
                            this.onTerminalData(pending.data);
                        }
                        this._pendingIMEInput = null;
                    }
                }, 30);
            }
        });
    }

    /**
     * 标记 xterm 已处理输入（在 onData 触发时调用）
     */
    markInputHandled(data) {
        // 控制序列（ESC 开头）不清除 pending，因为可能是输入法发送的光标移动
        // 例如输入《时，输入法会发送《》然后发送左箭头移动光标
        if (data && data.charCodeAt(0) === 0x1b) {
            return;
        }
        this._pendingIMEInput = null;
        // 记录最近的 onData，用于检测 onData 先于 input 触发的情况
        this._recentOnData = {
            data: data,
            time: Date.now(),
        };
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

    /**
     * 更新终端字体设置
     */
    updateFontSettings() {
        if (!this.terminal) {
            return;
        }
        const settings = loadEditorSettings();
        const fontSize = settings.terminalFontSize || 13;
        const fontFamily = settings.terminalFontFamily || 'Menlo, Monaco, "Courier New", monospace';

        this.terminal.options.fontSize = fontSize;
        this.terminal.options.fontFamily = fontFamily;
        this.fitTerminal();
        console.log('[Terminal Sidebar] 字体设置已更新');
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
        if (this.tapGuardCleanup) {
            this.tapGuardCleanup();
            this.tapGuardCleanup = null;
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
