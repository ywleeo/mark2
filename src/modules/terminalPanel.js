/**
 * 终端面板模块
 * 支持多 pane 分栏终端
 */

import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { FitAddon } from '@xterm/addon-fit';
import { createPtyService } from './terminal-sidebar/services/ptyService.js';
import { isFeatureEnabled } from '../config/features.js';
import { addClickHandler } from '../utils/PointerHelper.js';

const STORAGE_KEY = 'mark2_terminal_height';
const SETTINGS_KEY = 'mark2_terminal_settings';
const DEFAULT_HEIGHT = 240;
const MIN_HEIGHT = 100;
const MAX_HEIGHT = 600;

const TERMINAL_FONTS = [
    { label: 'Menlo', value: 'Menlo' },
    { label: 'Monaco', value: 'Monaco' },
    { label: 'SF Mono', value: 'SF Mono' },
    { label: 'Courier New', value: '"Courier New"' },
    { label: 'Andale Mono', value: '"Andale Mono"' },
    { label: 'JetBrains Mono', value: '"JetBrains Mono"' },
    { label: 'Fira Code', value: '"Fira Code"' },
    { label: 'Source Code Pro', value: '"Source Code Pro"' },
];

const DEFAULT_SETTINGS = { fontFamily: 'Menlo', fontSize: 13 };

function loadTerminalSettings() {
    try {
        const stored = localStorage.getItem(SETTINGS_KEY);
        if (stored) {
            const parsed = JSON.parse(stored);
            return { ...DEFAULT_SETTINGS, ...parsed };
        }
    } catch { /* ignore */ }
    return { ...DEFAULT_SETTINGS };
}

function saveTerminalSettings(settings) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

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

let paneCounter = 0;

/**
 * 创建终端面板控制器
 */
export function createTerminalPanel(options = {}) {
    const { getWorkspaceCwd } = options;

    let panelElement = null;
    let panesContainer = null;
    let tabsContainer = null;
    let isVisible = false;
    let currentHeight = DEFAULT_HEIGHT;
    let resizeObserver = null;
    let themeObserver = null;
    let isResizing = false;
    let settingsPopover = null;
    let currentSettings = loadTerminalSettings();

    /** @type {Array<{id: string, terminal: Terminal, fitAddon: FitAddon, ptyService: any, tabEl: HTMLElement, containerEl: HTMLElement}>} */
    const panes = [];
    let activePaneId = null;

    // ── 初始化 ──

    function initialize() {
        if (!isFeatureEnabled('terminal')) return;

        panelElement = document.getElementById('terminalPanel');
        if (!panelElement) return;

        panesContainer = panelElement.querySelector('.terminal-panes');
        tabsContainer = panelElement.querySelector('.terminal-tabs');
        if (!panesContainer || !tabsContainer) return;

        const savedHeight = localStorage.getItem(STORAGE_KEY);
        if (savedHeight) {
            currentHeight = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, parseInt(savedHeight, 10)));
            panelElement.style.height = `${currentHeight}px`;
        }

        // 关闭按钮
        const closeBtn = panelElement.querySelector('.terminal-close-btn');
        if (closeBtn) addClickHandler(closeBtn, () => hide());

        // 分栏按钮
        const splitBtn = panelElement.querySelector('.terminal-split-btn');
        if (splitBtn) addClickHandler(splitBtn, () => addPane());

        // 设置按钮
        const settingsBtn = panelElement.querySelector('.terminal-settings-btn');
        if (settingsBtn) addClickHandler(settingsBtn, () => toggleSettingsPopover(settingsBtn));

        setupResizer();

        // 监听主题切换
        themeObserver = new MutationObserver(() => {
            for (const pane of panes) {
                pane.terminal.options.theme = getTerminalTheme();
            }
        });
        themeObserver.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['data-theme-appearance'],
        });

        // 监听容器大小变化
        resizeObserver = new ResizeObserver(() => fitAllPanes());
        resizeObserver.observe(panesContainer);
    }

    // ── Pane 管理 ──

    function addPane() {
        const id = `pane_${++paneCounter}`;
        const displayNum = panes.length + 1;

        // 创建 pane 容器
        const containerEl = document.createElement('div');
        containerEl.className = 'terminal-pane';
        containerEl.dataset.paneId = id;
        panesContainer.appendChild(containerEl);

        // 创建 tab
        const tabEl = document.createElement('div');
        tabEl.className = 'terminal-tab';
        tabEl.dataset.paneId = id;
        tabEl.innerHTML = `
            <svg class="terminal-tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
            <span class="terminal-tab-label">Terminal ${displayNum}</span>
            <button type="button" class="terminal-tab-close" aria-label="关闭分栏">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
        `;
        tabsContainer.appendChild(tabEl);

        // tab 点击聚焦
        addClickHandler(tabEl, (e) => {
            if (e.target.closest('.terminal-tab-close')) return;
            setActivePane(id);
        });

        // tab 关闭按钮
        const tabCloseBtn = tabEl.querySelector('.terminal-tab-close');
        addClickHandler(tabCloseBtn, () => removePane(id));

        // 点击 pane 区域聚焦
        containerEl.addEventListener('mousedown', () => setActivePane(id));

        // 创建 xterm
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

        const pane = { id, terminal, fitAddon, ptyService: null, tabEl, containerEl };
        panes.push(pane);

        setActivePane(id);
        updateTabCloseVisibility();

        // 延迟 fit 后启动 pty
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

        // 如果只剩一个 pane，关闭整个面板
        if (panes.length === 1) {
            hide();
            return;
        }

        const pane = panes[idx];

        // 清理资源
        if (pane.ptyService) {
            pane.ptyService.kill();
        }
        pane.terminal.dispose();
        pane.tabEl.remove();
        pane.containerEl.remove();
        panes.splice(idx, 1);

        // 如果关掉的是当前活跃 pane，切到相邻的
        if (activePaneId === id) {
            const newIdx = Math.min(idx, panes.length - 1);
            setActivePane(panes[newIdx].id);
        }

        updateTabCloseVisibility();
        fitAllPanes();
    }

    function setActivePane(id) {
        activePaneId = id;
        for (const pane of panes) {
            const isActive = pane.id === id;
            pane.tabEl.classList.toggle('is-active', isActive);
            pane.containerEl.classList.toggle('is-active', isActive);
        }
        // 聚焦活跃 pane 的终端
        const active = panes.find(p => p.id === id);
        if (active) active.terminal.focus();
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

    // ── PTY ──

    async function spawnPtyForPane(pane) {
        if (pane.ptyService?.isSpawned()) return;

        const ptyService = createPtyService();
        pane.ptyService = ptyService;

        ptyService.onData((data) => pane.terminal.write(data));
        ptyService.onExit(() => {
            pane.terminal.writeln('\r\n[进程已退出]');
        });

        pane.terminal.onData((data) => ptyService.write(data));

        let cwd = null;
        if (typeof getWorkspaceCwd === 'function') {
            cwd = getWorkspaceCwd();
        }

        try {
            await ptyService.spawn({
                cols: pane.terminal.cols,
                rows: pane.terminal.rows,
                cwd,
            });
        } catch (error) {
            console.error('[TerminalPanel] 启动 PTY 失败:', error);
            pane.terminal.writeln(`\r\n[启动终端失败: ${error.message || error}]`);
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

    function toggleSettingsPopover(anchorBtn) {
        if (settingsPopover) {
            settingsPopover.remove();
            settingsPopover = null;
            return;
        }

        settingsPopover = document.createElement('div');
        settingsPopover.className = 'terminal-settings-popover';
        settingsPopover.innerHTML = `
            <div class="terminal-settings-row">
                <label class="terminal-settings-label">字体</label>
                <select class="terminal-settings-select" data-field="fontFamily">
                    ${TERMINAL_FONTS.map(f =>
                        `<option value="${f.value}" ${f.value === currentSettings.fontFamily ? 'selected' : ''}>${f.label}</option>`
                    ).join('')}
                </select>
            </div>
            <div class="terminal-settings-row">
                <label class="terminal-settings-label">字号</label>
                <div class="terminal-settings-font-size">
                    <button type="button" class="terminal-settings-size-btn" data-delta="-1">−</button>
                    <span class="terminal-settings-size-value">${currentSettings.fontSize}</span>
                    <button type="button" class="terminal-settings-size-btn" data-delta="1">＋</button>
                </div>
            </div>
        `;

        const select = settingsPopover.querySelector('[data-field="fontFamily"]');
        select.addEventListener('change', () => {
            currentSettings.fontFamily = select.value;
            saveTerminalSettings(currentSettings);
            applyTerminalSettings();
        });

        settingsPopover.querySelectorAll('[data-delta]').forEach(btn => {
            addClickHandler(btn, () => {
                const delta = parseInt(btn.dataset.delta, 10);
                const newSize = Math.max(10, Math.min(24, currentSettings.fontSize + delta));
                if (newSize === currentSettings.fontSize) return;
                currentSettings.fontSize = newSize;
                settingsPopover.querySelector('.terminal-settings-size-value').textContent = newSize;
                saveTerminalSettings(currentSettings);
                applyTerminalSettings();
            });
        });

        panelElement.querySelector('.terminal-header').appendChild(settingsPopover);

        const onClickOutside = (e) => {
            if (!settingsPopover?.contains(e.target) && !anchorBtn.contains(e.target)) {
                settingsPopover?.remove();
                settingsPopover = null;
                document.removeEventListener('pointerdown', onClickOutside, true);
            }
        };
        setTimeout(() => document.addEventListener('pointerdown', onClickOutside, true), 0);
    }

    // ── 调整大小 ──

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
            fitAllPanes();
        };

        const onMouseUp = () => {
            isResizing = false;
            document.body.classList.remove('terminal-resizing');
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            localStorage.setItem(STORAGE_KEY, String(currentHeight));
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
            // 首次打开时创建第一个 pane
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

        // 在活跃 pane 执行，没有就创建
        let pane = getActivePane();
        if (!pane) {
            pane = addPane();
            // 等 pty 启动
            await new Promise(resolve => setTimeout(resolve, 200));
        }

        fitAllPanes();

        if (pane.ptyService?.isSpawned()) {
            pane.ptyService.write(command + '\n');
        }

        pane.terminal.focus();
    }

    return {
        initialize,
        show,
        hide,
        toggle,
        getIsVisible,
        runCommand,
        destroy,
    };
}
