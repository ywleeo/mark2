/**
 * 终端面板模块:多 pane 分栏终端,支持底部/右侧停靠。
 */

import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { FitAddon } from '@xterm/addon-fit';

import { createPtyService } from './ptyService.js';
import { getTerminalTheme } from './theme.js';
import { installSelectionGate } from './selectionGate.js';
import {
    trackInputData,
    showHistoryPopup,
    closeHistoryPopup,
} from './history.js';
import {
    loadTerminalSettings,
    saveTerminalSettings,
    openSettingsPopover,
} from './settings.js';

import { isFeatureEnabled } from '../../config/features.js';
import { addClickHandler } from '../../utils/PointerHelper.js';
import { t } from '../../i18n/index.js';

const STORAGE_KEY = 'mark2_terminal_height';
const WIDTH_KEY = 'mark2_terminal_width';
const POSITION_KEY = 'mark2_terminal_position';
const DEFAULT_HEIGHT = 240;
const MIN_HEIGHT = 100;
const MAX_HEIGHT = 600;
const DEFAULT_WIDTH = 420;
const MIN_WIDTH = 240;
const MAX_WIDTH = 900;
const VALID_POSITIONS = ['bottom', 'right'];

let paneCounter = 0;

export function createTerminalPanel(options = {}) {
    const { getWorkspaceCwd } = options;

    let panelElement = null;
    let contentWrapperEl = null;
    let panesContainer = null;
    let tabsContainer = null;
    let isVisible = false;
    let currentHeight = DEFAULT_HEIGHT;
    let currentWidth = DEFAULT_WIDTH;
    let currentPosition = (() => {
        const saved = localStorage.getItem(POSITION_KEY);
        return VALID_POSITIONS.includes(saved) ? saved : 'bottom';
    })();
    let resizeObserver = null;
    let themeObserver = null;
    let isResizing = false;
    let settingsHandle = null;
    const currentSettings = loadTerminalSettings();

    /** @type {Array<{id: string, terminal: Terminal, fitAddon: FitAddon, ptyService: any, tabEl: HTMLElement, containerEl: HTMLElement, isStopping: boolean, inputBuffer: string}>} */
    const panes = [];
    let activePaneId = null;

    // ── 初始化 ──

    function initialize() {
        if (!isFeatureEnabled('terminal')) return;

        panelElement = document.getElementById('terminalPanel');
        if (!panelElement) return;

        contentWrapperEl = panelElement.closest('.content-wrapper');
        panesContainer = panelElement.querySelector('.terminal-panes');
        tabsContainer = panelElement.querySelector('.terminal-tabs');
        if (!panesContainer || !tabsContainer) return;

        const savedHeight = localStorage.getItem(STORAGE_KEY);
        if (savedHeight) {
            currentHeight = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, parseInt(savedHeight, 10)));
        }
        const savedWidth = localStorage.getItem(WIDTH_KEY);
        if (savedWidth) {
            currentWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, parseInt(savedWidth, 10)));
        }
        applyPositionStyles();

        const closeBtn = panelElement.querySelector('.terminal-close-btn');
        if (closeBtn) addClickHandler(closeBtn, () => hide());

        const splitBtn = panelElement.querySelector('.terminal-split-btn');
        if (splitBtn) addClickHandler(splitBtn, () => addPane());

        const stopBtn = panelElement.querySelector('.terminal-stop-btn');
        if (stopBtn) {
            addClickHandler(stopBtn, () => stopActivePaneProcess());
            stopBtn.disabled = true;
        }

        const settingsBtn = panelElement.querySelector('.terminal-settings-btn');
        if (settingsBtn) addClickHandler(settingsBtn, () => toggleSettings(settingsBtn));

        setupResizer();

        themeObserver = new MutationObserver(() => {
            for (const pane of panes) {
                pane.terminal.options.theme = getTerminalTheme();
            }
        });
        themeObserver.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['data-theme-appearance'],
        });

        resizeObserver = new ResizeObserver(() => fitAllPanes());
        resizeObserver.observe(panesContainer);
    }

    // ── Pane 管理 ──

    function addPane() {
        const id = `pane_${++paneCounter}`;
        const displayNum = panes.length + 1;

        const containerEl = document.createElement('div');
        containerEl.className = 'terminal-pane';
        containerEl.dataset.paneId = id;
        panesContainer.appendChild(containerEl);

        const tabEl = document.createElement('div');
        tabEl.className = 'terminal-tab';
        tabEl.dataset.paneId = id;
        tabEl.innerHTML = `
            <svg class="terminal-tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
            <span class="terminal-tab-label">Terminal ${displayNum}</span>
            <button type="button" class="terminal-tab-close" aria-label="${t('terminal.closePane')}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
        `;
        tabsContainer.appendChild(tabEl);

        addClickHandler(tabEl, (e) => {
            if (e.target.closest('.terminal-tab-close')) return;
            setActivePane(id);
        });

        const tabCloseBtn = tabEl.querySelector('.terminal-tab-close');
        addClickHandler(tabCloseBtn, () => removePane(id));

        containerEl.addEventListener('mousedown', () => setActivePane(id));

        const terminal = new Terminal({
            fontFamily: `${currentSettings.fontFamily}, monospace`,
            fontSize: currentSettings.fontSize,
            lineHeight: 1.2,
            cursorBlink: true,
            cursorStyle: 'block',
            theme: getTerminalTheme(),
            allowProposedApi: true,
        });

        const fitAddon = new FitAddon();
        terminal.loadAddon(fitAddon);
        terminal.open(containerEl);

        // Cmd+K 清屏, Cmd+D 分栏
        terminal.attachCustomKeyEventHandler((e) => {
            if (e.type === 'keydown' && e.metaKey) {
                if (e.key === 'k') {
                    e.preventDefault();
                    terminal.clear();
                    return false;
                }
                if (e.key === 'd') {
                    e.preventDefault();
                    addPane();
                    return false;
                }
            }
            return true;
        });

        installSelectionGate(containerEl, () => {
            setActivePane(id);
            terminal.focus();
        });

        const pane = {
            id,
            terminal,
            fitAddon,
            ptyService: null,
            tabEl,
            containerEl,
            isStopping: false,
            inputBuffer: '',
        };
        panes.push(pane);

        setActivePane(id);
        updateTabCloseVisibility();

        requestAnimationFrame(async () => {
            fitPane(pane);
            await spawnPtyForPane(pane);
            terminal.focus();
        });

        return pane;
    }

    function removePane(id) {
        const idx = panes.findIndex(p => p.id === id);
        if (idx === -1) return;

        // 只剩一个 pane 就关掉整个面板
        if (panes.length === 1) {
            hide();
            return;
        }

        const pane = panes[idx];
        if (pane.ptyService) pane.ptyService.kill();
        pane.terminal.dispose();
        pane.tabEl.remove();
        pane.containerEl.remove();
        panes.splice(idx, 1);

        if (activePaneId === id) {
            const newIdx = Math.min(idx, panes.length - 1);
            setActivePane(panes[newIdx].id);
        }

        updateTabCloseVisibility();
        updateStopButtonState();
        fitAllPanes();
    }

    function setActivePane(id) {
        activePaneId = id;
        for (const pane of panes) {
            const isActive = pane.id === id;
            pane.tabEl.classList.toggle('is-active', isActive);
            pane.containerEl.classList.toggle('is-active', isActive);
        }
        const active = panes.find(p => p.id === id);
        if (active) active.terminal.focus();
        updateStopButtonState();
    }

    function updateTabCloseVisibility() {
        const single = panes.length <= 1;
        for (const pane of panes) {
            const closeBtn = pane.tabEl.querySelector('.terminal-tab-close');
            if (closeBtn) closeBtn.style.display = single ? 'none' : '';
        }
    }

    function getActivePane() {
        return panes.find(p => p.id === activePaneId) || panes[0] || null;
    }

    function updateStopButtonState() {
        if (!panelElement) return;
        const stopBtn = panelElement.querySelector('.terminal-stop-btn');
        if (!stopBtn) return;
        const activePane = getActivePane();
        stopBtn.disabled = !activePane || !activePane.ptyService?.isSpawned() || activePane.isStopping;
    }

    async function stopActivePaneProcess() {
        const pane = getActivePane();
        if (!pane?.ptyService?.isSpawned() || pane.isStopping) return;

        pane.isStopping = true;
        updateStopButtonState();

        try {
            await pane.ptyService.kill();
            pane.terminal.reset();
            pane.terminal.writeln('[进程已强制终止]');
            pane.isStopping = false;
            await spawnPtyForPane(pane);
            fitPane(pane);
            if (activePaneId === pane.id) pane.terminal.focus();
        } catch (error) {
            pane.isStopping = false;
            console.error('[TerminalPanel] 停止终端进程失败:', error);
            pane.terminal.writeln(`\r\n[停止进程失败: ${error.message || error}]`);
            updateStopButtonState();
        }
    }

    // ── PTY ──

    async function spawnPtyForPane(pane) {
        if (pane.ptyService?.isSpawned()) return;

        const ptyService = createPtyService();
        pane.ptyService = ptyService;

        ptyService.onData((data) => pane.terminal.write(data));
        ptyService.onExit(() => {
            pane.isStopping = false;
            pane.terminal.writeln('\r\n[进程已退出]');
            updateStopButtonState();
        });

        pane.terminal.onData((data) => {
            ptyService.write(data);
            trackInputData(pane, data);
        });

        let cwd = null;
        if (typeof getWorkspaceCwd === 'function') cwd = getWorkspaceCwd();

        try {
            await ptyService.spawn({
                cols: pane.terminal.cols,
                rows: pane.terminal.rows,
                cwd,
            });
            updateStopButtonState();
        } catch (error) {
            console.error('[TerminalPanel] 启动 PTY 失败:', error);
            pane.terminal.writeln(`\r\n[启动终端失败: ${error.message || error}]`);
            updateStopButtonState();
        }
    }

    // ── Fit ──

    function fitPane(pane) {
        if (!pane.terminal || !pane.fitAddon || !isVisible) return;
        try {
            pane.fitAddon.fit();
            if (pane.ptyService?.isSpawned()) {
                pane.ptyService.resize(pane.terminal.cols, pane.terminal.rows);
            }
        } catch { /* ignore */ }
    }

    function fitAllPanes() {
        if (!isVisible) return;
        for (const pane of panes) fitPane(pane);
    }

    // ── 设置 ──

    function applyTerminalSettings() {
        for (const pane of panes) {
            pane.terminal.options.fontFamily = `${currentSettings.fontFamily}, monospace`;
            pane.terminal.options.fontSize = currentSettings.fontSize;
        }
        fitAllPanes();
    }

    function toggleSettings(anchorBtn) {
        if (settingsHandle) {
            settingsHandle.close();
            return;
        }
        settingsHandle = openSettingsPopover({
            anchor: anchorBtn,
            container: panelElement.querySelector('.terminal-header'),
            settings: currentSettings,
            getPosition: () => currentPosition,
            onChange: () => {
                saveTerminalSettings(currentSettings);
                applyTerminalSettings();
            },
            onPositionChange: (pos) => setPosition(pos),
            onClose: () => { settingsHandle = null; },
        });
    }

    // ── 位置/停靠 ──

    function applyPositionStyles() {
        if (!panelElement) return;
        if (contentWrapperEl) {
            contentWrapperEl.setAttribute('data-terminal-position', currentPosition);
        }
        if (currentPosition === 'right') {
            panelElement.style.width = `${currentWidth}px`;
            panelElement.style.height = '';
        } else {
            panelElement.style.height = `${currentHeight}px`;
            panelElement.style.width = '';
        }
    }

    function setPosition(pos) {
        if (!VALID_POSITIONS.includes(pos) || pos === currentPosition) return;
        currentPosition = pos;
        localStorage.setItem(POSITION_KEY, pos);
        applyPositionStyles();
        requestAnimationFrame(() => {
            fitAllPanes();
            const active = getActivePane();
            if (active) active.terminal.focus();
        });
    }

    // ── 调整大小 ──

    function setupResizer() {
        const resizer = panelElement.querySelector('.terminal-resizer');
        if (!resizer) return;

        let startX = 0;
        let startY = 0;
        let startHeight = 0;
        let startWidth = 0;
        let axis = 'y';

        const onMouseDown = (e) => {
            e.preventDefault();
            isResizing = true;
            axis = currentPosition === 'right' ? 'x' : 'y';
            startX = e.clientX;
            startY = e.clientY;
            startHeight = panelElement.offsetHeight;
            startWidth = panelElement.offsetWidth;
            document.body.classList.add(axis === 'x' ? 'terminal-resizing-x' : 'terminal-resizing');
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        };

        const onMouseMove = (e) => {
            if (!isResizing) return;
            if (axis === 'y') {
                const delta = startY - e.clientY;
                currentHeight = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, startHeight + delta));
                panelElement.style.height = `${currentHeight}px`;
            } else {
                // 面板在右侧,向左拖动增大宽度
                const delta = startX - e.clientX;
                currentWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth + delta));
                panelElement.style.width = `${currentWidth}px`;
            }
            fitAllPanes();
        };

        const onMouseUp = () => {
            isResizing = false;
            document.body.classList.remove('terminal-resizing');
            document.body.classList.remove('terminal-resizing-x');
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            if (axis === 'y') {
                localStorage.setItem(STORAGE_KEY, String(currentHeight));
            } else {
                localStorage.setItem(WIDTH_KEY, String(currentWidth));
            }
            fitAllPanes();
        };

        resizer.addEventListener('mousedown', onMouseDown);
    }

    // ── 显示/隐藏 ──

    async function show() {
        if (!isFeatureEnabled('terminal')) return;
        if (!panelElement) initialize();
        if (!panelElement) return;

        isVisible = true;
        panelElement.classList.add('is-visible');

        requestAnimationFrame(() => {
            if (panes.length === 0) {
                addPane();
            } else {
                fitAllPanes();
                const active = getActivePane();
                if (active) active.terminal.focus();
            }
        });
    }

    function hide() {
        if (!panelElement) return;
        isVisible = false;
        panelElement.classList.remove('is-visible');
        closeHistoryPopup();
        updateStopButtonState();
    }

    async function toggle() {
        if (isVisible) hide();
        else await show();
    }

    function getIsVisible() {
        return isVisible;
    }

    // ── 销毁 ──

    function destroy() {
        for (const pane of panes) {
            if (pane.ptyService) pane.ptyService.kill();
            pane.terminal.dispose();
            pane.tabEl.remove();
            pane.containerEl.remove();
        }
        panes.length = 0;
        activePaneId = null;

        if (themeObserver) { themeObserver.disconnect(); themeObserver = null; }
        if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null; }

        panelElement = null;
        panesContainer = null;
        tabsContainer = null;
        isVisible = false;
    }

    // ── 执行命令 ──

    async function runCommand(command) {
        if (!isFeatureEnabled('terminal')) return;
        if (!panelElement) initialize();
        if (!panelElement) return;

        if (!isVisible) {
            isVisible = true;
            panelElement.classList.add('is-visible');
        }

        await new Promise(resolve => requestAnimationFrame(resolve));

        let pane = getActivePane();
        if (!pane) {
            pane = addPane();
            await new Promise(resolve => setTimeout(resolve, 200));
        }

        fitAllPanes();

        if (pane.ptyService?.isSpawned()) {
            pane.ptyService.write(command + '\n');
        }

        pane.terminal.focus();
    }

    // ── 命令历史浮层 ──

    function showHistory() {
        if (!getIsVisible()) show();
        const pane = getActivePane();
        if (!pane) return;
        pane.terminal.focus();
        // xterm 的光标位置在 rAF 里刷新,等下一帧再读才能拿到最新位置
        // (例如 Cmd+K 清屏后,光标位置需要下一次 render 才更新)
        requestAnimationFrame(() => {
            const { x, y, anchorTop } = computeCursorAnchor(pane);
            showHistoryPopup(pane, x, y, anchorTop);
        });
    }

    /**
     * 优先从 xterm buffer 直接算光标像素位置(最新、最可靠);
     * 拿不到 screen/buffer 时回退用 helper-textarea 的 rect;
     * 再失败就用 pane 容器左上角作兜底。
     */
    function computeCursorAnchor(pane) {
        const paneRect = pane.containerEl.getBoundingClientRect();
        let x = paneRect.left + 12;
        let y = paneRect.top + 12;
        let anchorTop = null;

        const screen = pane.containerEl.querySelector('.xterm-screen');
        const buffer = pane.terminal.buffer?.active;
        if (screen && buffer) {
            const screenRect = screen.getBoundingClientRect();
            const cols = pane.terminal.cols || 80;
            const rows = pane.terminal.rows || 24;
            const cellW = screenRect.width / cols;
            const cellH = screenRect.height / rows;
            const col = buffer.cursorX;
            const row = buffer.cursorY; // viewport 内的行号
            x = screenRect.left + col * cellW;
            const caretTop = screenRect.top + row * cellH;
            y = caretTop + cellH + 2;
            anchorTop = caretTop - 2;
            return { x, y, anchorTop };
        }

        const textarea = pane.containerEl.querySelector('.xterm-helper-textarea');
        if (textarea) {
            const caret = textarea.getBoundingClientRect();
            x = caret.left;
            y = caret.bottom + 2;
            anchorTop = caret.top - 2;
        }
        return { x, y, anchorTop };
    }

    return {
        initialize,
        show,
        hide,
        toggle,
        getIsVisible,
        runCommand,
        showHistory,
        destroy,
    };
}
