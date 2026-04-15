/**
 * 终端命令历史(session 级,所有 pane 共享)和历史浮层。
 * pushHistory/trackInputData 维护历史队列;
 * showHistoryPopup 渲染浮层,支持数字键/方向键/Enter/Esc。
 */

import { addClickHandler } from '../../utils/PointerHelper.js';
import { t } from '../../i18n/index.js';

const MAX_HISTORY = 10;
const commandHistory = [];

let historyPopup = null;
let historyKeyHandler = null;
let historyDocClickHandler = null;

function escapeHtml(s) {
    return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function pushHistory(cmd) {
    const trimmed = cmd.trim();
    if (!trimmed) return;
    const existing = commandHistory.indexOf(trimmed);
    if (existing !== -1) commandHistory.splice(existing, 1);
    commandHistory.unshift(trimmed);
    if (commandHistory.length > MAX_HISTORY) commandHistory.length = MAX_HISTORY;
}

/**
 * 从一段 xterm 输入数据里还原用户正在敲的命令行,更新 pane.inputBuffer。
 * 覆盖可打印字符、Backspace、Ctrl+U、Ctrl+C 以及常见 ESC 序列。
 * 遇到回车时把 buffer 当成一条命令入队。
 */
export function trackInputData(pane, data) {
    for (let i = 0; i < data.length; i++) {
        const ch = data[i];
        const code = ch.charCodeAt(0);
        if (ch === '\r' || ch === '\n') {
            pushHistory(pane.inputBuffer);
            pane.inputBuffer = '';
            continue;
        }
        if (code === 0x7f || code === 0x08) { // Backspace
            pane.inputBuffer = pane.inputBuffer.slice(0, -1);
            continue;
        }
        if (code === 0x15 || code === 0x03) { // Ctrl+U / Ctrl+C
            pane.inputBuffer = '';
            continue;
        }
        if (ch === '\x1b') { // ESC:跳过整个转义序列
            if (data[i + 1] === '[' || data[i + 1] === 'O') {
                i += 2;
                while (i < data.length) {
                    const c = data.charCodeAt(i);
                    if (c >= 0x40 && c <= 0x7e) break;
                    i++;
                }
            } else {
                i++;
            }
            continue;
        }
        if (code >= 0x20 && code < 0x7f) {
            pane.inputBuffer += ch;
        }
    }
}

export function closeHistoryPopup() {
    if (historyPopup) {
        historyPopup.remove();
        historyPopup = null;
    }
    if (historyKeyHandler) {
        document.removeEventListener('keydown', historyKeyHandler, true);
        historyKeyHandler = null;
    }
    if (historyDocClickHandler) {
        document.removeEventListener('mousedown', historyDocClickHandler, true);
        historyDocClickHandler = null;
    }
}

function applyHistoryCommand(pane, cmd) {
    if (!pane?.ptyService?.isSpawned()) return;
    // 先发 Ctrl+U 清掉当前行,再写命令内容(不自动回车,让用户检查后再执行)
    pane.ptyService.write('\x15');
    pane.ptyService.write(cmd);
    pane.inputBuffer = cmd;
    pane.terminal.focus();
}

export function showHistoryPopup(pane, clientX, clientY, anchorTop = null) {
    closeHistoryPopup();
    if (commandHistory.length === 0) {
        const hint = document.createElement('div');
        hint.className = 'terminal-history-popup is-empty';
        hint.textContent = t('terminal.history.empty');
        hint.style.left = `${clientX}px`;
        hint.style.top = `${clientY}px`;
        document.body.appendChild(hint);
        setTimeout(() => hint.remove(), 1200);
        return;
    }

    historyPopup = document.createElement('div');
    historyPopup.className = 'terminal-history-popup';
    historyPopup.innerHTML = commandHistory.map((cmd, i) => {
        const key = (i + 1) % 10; // 1..9, 0
        return `
            <div class="terminal-history-item ${i === 0 ? 'is-highlighted' : ''}" data-index="${i}">
                <span class="terminal-history-key">${key}</span>
                <span class="terminal-history-cmd">${escapeHtml(cmd)}</span>
            </div>
        `;
    }).join('');
    document.body.appendChild(historyPopup);

    // 定位:优先放在 anchor 上方(避免挡住光标),空间不够再放下方
    const rect = historyPopup.getBoundingClientRect();
    const left = Math.min(clientX, window.innerWidth - rect.width - 8);
    let top;
    if (anchorTop != null) {
        const above = anchorTop - rect.height - 4;
        top = above >= 8 ? above : Math.min(clientY, window.innerHeight - rect.height - 8);
    } else {
        top = Math.min(clientY, window.innerHeight - rect.height - 8);
    }
    historyPopup.style.left = `${Math.max(8, left)}px`;
    historyPopup.style.top = `${Math.max(8, top)}px`;

    const items = Array.from(historyPopup.querySelectorAll('.terminal-history-item'));
    let highlightIdx = 0;
    const setHighlight = (idx) => {
        highlightIdx = (idx + items.length) % items.length;
        items.forEach((el, i) => el.classList.toggle('is-highlighted', i === highlightIdx));
    };
    items.forEach((el, i) => {
        el.addEventListener('mouseenter', () => setHighlight(i));
        addClickHandler(el, () => {
            applyHistoryCommand(pane, commandHistory[i]);
            closeHistoryPopup();
        });
    });

    historyKeyHandler = (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            closeHistoryPopup();
            return;
        }
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            e.stopPropagation();
            setHighlight(highlightIdx + 1);
            return;
        }
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            e.stopPropagation();
            setHighlight(highlightIdx - 1);
            return;
        }
        if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            applyHistoryCommand(pane, commandHistory[highlightIdx]);
            closeHistoryPopup();
            return;
        }
        // 数字键 0-9:0 代表第 10 条
        if (/^[0-9]$/.test(e.key)) {
            const pressed = parseInt(e.key, 10);
            const idx = pressed === 0 ? 9 : pressed - 1;
            if (idx < commandHistory.length) {
                e.preventDefault();
                e.stopPropagation();
                applyHistoryCommand(pane, commandHistory[idx]);
                closeHistoryPopup();
            }
        }
    };
    historyDocClickHandler = (e) => {
        if (historyPopup && !historyPopup.contains(e.target)) closeHistoryPopup();
    };
    document.addEventListener('keydown', historyKeyHandler, true);
    document.addEventListener('mousedown', historyDocClickHandler, true);
}
