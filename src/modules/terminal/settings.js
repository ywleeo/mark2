/**
 * 终端设置:字体/字号/停靠位置。
 * 提供 localStorage 读写和弹出式设置面板工厂。
 */

import { addClickHandler } from '../../utils/PointerHelper.js';
import { Dropdown } from '../../components/Dropdown.js';

const SETTINGS_KEY = 'mark2_terminal_settings';
const DEFAULT_SETTINGS = { fontFamily: 'Menlo', fontSize: 13 };

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

const MIN_FONT_SIZE = 10;
const MAX_FONT_SIZE = 24;

export function loadTerminalSettings() {
    try {
        const stored = localStorage.getItem(SETTINGS_KEY);
        if (stored) {
            const parsed = JSON.parse(stored);
            return { ...DEFAULT_SETTINGS, ...parsed };
        }
    } catch { /* ignore */ }
    return { ...DEFAULT_SETTINGS };
}

export function saveTerminalSettings(settings) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

/**
 * 打开终端设置 popover。工厂返回一个 handle,包含 close() 方法。
 * 面板外点击自动关闭并调用 onClose。
 *
 * @param {Object} opts
 * @param {HTMLElement} opts.anchor         - 触发按钮(outside-click 检测时豁免)
 * @param {HTMLElement} opts.container      - 宿主容器(popover 插入到此)
 * @param {Object}      opts.settings       - 当前设置对象,会被原地修改
 * @param {() => string} opts.getPosition   - 读取当前停靠位置
 * @param {() => void}  opts.onChange       - 字体/字号变更时触发
 * @param {(pos: string) => void} opts.onPositionChange - 停靠位置变更时触发
 * @param {() => void}  opts.onClose        - 关闭(含外点关闭)回调
 */
export function openSettingsPopover({
    anchor,
    container,
    settings,
    getPosition,
    onChange,
    onPositionChange,
    onClose,
}) {
    const currentPosition = getPosition();
    const popover = document.createElement('div');
    popover.className = 'terminal-settings-popover';
    popover.innerHTML = `
        <div class="terminal-settings-row">
            <label class="terminal-settings-label">字体</label>
            <select class="terminal-settings-select" data-field="fontFamily">
                ${TERMINAL_FONTS.map(f =>
                    `<option value="${f.value}" ${f.value === settings.fontFamily ? 'selected' : ''}>${f.label}</option>`
                ).join('')}
            </select>
        </div>
        <div class="terminal-settings-row">
            <div class="terminal-settings-group">
                <label class="terminal-settings-label">字号</label>
                <div class="terminal-settings-font-size">
                    <button type="button" class="terminal-settings-size-btn" data-delta="-1">−</button>
                    <span class="terminal-settings-size-value">${settings.fontSize}</span>
                    <button type="button" class="terminal-settings-size-btn" data-delta="1">＋</button>
                </div>
            </div>
            <div class="terminal-settings-group">
                <label class="terminal-settings-label">位置</label>
                <div class="terminal-settings-position">
                    <button type="button" class="terminal-settings-dock-btn ${currentPosition === 'bottom' ? 'is-active' : ''}" data-position="bottom" title="靠下">
                        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                            <rect x="2.5" y="2.5" width="15" height="15" rx="1.5" stroke="currentColor" stroke-width="1.3"/>
                            <rect x="2.5" y="12" width="15" height="5.5" fill="currentColor"/>
                        </svg>
                    </button>
                    <button type="button" class="terminal-settings-dock-btn ${currentPosition === 'right' ? 'is-active' : ''}" data-position="right" title="靠右">
                        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                            <rect x="2.5" y="2.5" width="15" height="15" rx="1.5" stroke="currentColor" stroke-width="1.3"/>
                            <rect x="12" y="2.5" width="5.5" height="15" fill="currentColor"/>
                        </svg>
                    </button>
                </div>
            </div>
        </div>
    `;

    const select = popover.querySelector('[data-field="fontFamily"]');
    select.addEventListener('change', () => {
        settings.fontFamily = select.value;
        onChange?.();
    });

    popover.querySelectorAll('.terminal-settings-dock-btn').forEach(btn => {
        addClickHandler(btn, () => {
            const pos = btn.dataset.position;
            onPositionChange?.(pos);
            popover.querySelectorAll('.terminal-settings-dock-btn').forEach(b => {
                b.classList.toggle('is-active', b.dataset.position === pos);
            });
        });
    });

    popover.querySelectorAll('[data-delta]').forEach(btn => {
        addClickHandler(btn, () => {
            const delta = parseInt(btn.dataset.delta, 10);
            const newSize = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, settings.fontSize + delta));
            if (newSize === settings.fontSize) return;
            settings.fontSize = newSize;
            popover.querySelector('.terminal-settings-size-value').textContent = newSize;
            onChange?.();
        });
    });

    container.appendChild(popover);

    // 接管原生 <select>,规避 WebView2 上 select 弹窗背景色异常
    const fontDropdown = new Dropdown(select);

    let closed = false;
    const close = () => {
        if (closed) return;
        closed = true;
        document.removeEventListener('pointerdown', onClickOutside, true);
        fontDropdown.destroy();
        popover.remove();
        onClose?.();
    };

    const onClickOutside = (e) => {
        if (fontDropdown?.panel?.contains(e.target)) return;
        if (popover.contains(e.target) || anchor.contains(e.target)) return;
        close();
    };
    setTimeout(() => document.addEventListener('pointerdown', onClickOutside, true), 0);

    return { close };
}
