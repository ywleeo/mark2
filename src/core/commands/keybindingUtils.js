/**
 * 快捷键解析与 KeyboardEvent 规范化工具。
 * 对字母、数字和符号键优先使用 event.code 对应的基础键帽，避免 Shift/Alt/Option
 * 改写 event.key 后导致 `Shift+[`、`Option+T` 等组合无法命中。
 */

import { isMac } from '../../utils/platform.js';

/** KeyboardEvent.code → 快捷键基础键名。 */
const PRINTABLE_CODE_KEYS = Object.freeze({
    Backquote: '`',
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
});

/**
 * 规范化快捷键 token。
 * @param {string} token - 原始 token
 * @returns {string}
 */
export function normalizeShortcutToken(token) {
    const normalized = String(token || '').trim().toLowerCase();
    if (normalized === 'cmd' || normalized === 'mod') {
        return 'mod';
    }
    if (normalized === 'ctrl') {
        return isMac ? 'ctrl' : 'mod';
    }
    if (normalized === 'space' || normalized === 'spacebar' || normalized === ' ') {
        return 'space';
    }
    if (normalized === 'esc') {
        return 'escape';
    }
    return normalized;
}

/**
 * 解析快捷键字符串。
 * @param {string} shortcut - 类似 `Mod+Shift+L`
 * @returns {{shortcut: string, modifiers: {mod:boolean, ctrl:boolean, shift:boolean, alt:boolean}, key: string}}
 */
export function parseShortcut(shortcut) {
    const tokens = String(shortcut || '')
        .split('+')
        .map(normalizeShortcutToken)
        .filter(Boolean);

    const parsed = {
        shortcut,
        modifiers: { mod: false, ctrl: false, shift: false, alt: false },
        key: '',
    };

    tokens.forEach((token) => {
        if (token === 'mod' || token === 'ctrl' || token === 'shift' || token === 'alt') {
            parsed.modifiers[token] = true;
            return;
        }
        parsed.key = token;
    });

    return parsed;
}

/**
 * 从物理键位读取可打印基础键名。
 * @param {KeyboardEvent|object} event - 键盘事件
 * @returns {string}
 */
function getPrintableCodeKey(event) {
    const code = typeof event?.code === 'string' ? event.code : '';
    if (/^Key[A-Z]$/.test(code)) {
        return code.slice(3).toLowerCase();
    }
    if (/^Digit[0-9]$/.test(code)) {
        return code.slice(5);
    }
    if (/^Numpad[0-9]$/.test(code)) {
        return code.slice(6);
    }
    return PRINTABLE_CODE_KEYS[code] || '';
}

/**
 * 读取事件的规范化按键名。
 * @param {KeyboardEvent|object} event - 键盘事件
 * @returns {string}
 */
export function getKeyboardEventKey(event) {
    const codeKey = getPrintableCodeKey(event);
    const key = typeof event?.key === 'string' ? event.key : '';
    const normalizedKey = key === ' ' ? 'space' : normalizeShortcutToken(key);
    if (codeKey) {
        // 未被 Alt/Shift 改写的字母数字保留当前键盘布局语义；符号和 Option 产物
        // 则退回基础键帽，保证 `Shift+[`、`Option+T` 等绑定稳定。
        if (/^[a-z0-9]$/.test(normalizedKey)) {
            return normalizedKey;
        }
        if (!event?.altKey && !event?.shiftKey && normalizedKey.length === 1) {
            return normalizedKey;
        }
        return codeKey;
    }
    return normalizedKey;
}

/**
 * 从 KeyboardEvent 构建可持久化的快捷键字符串。
 * @param {KeyboardEvent|object} event - 键盘事件
 * @returns {string|null} 纯修饰键返回 null
 */
export function keyboardEventToShortcut(event) {
    if (['Meta', 'Control', 'Shift', 'Alt'].includes(event?.key)) {
        return null;
    }

    const parts = [];
    if (isMac && event?.metaKey) parts.push('Mod');
    if (event?.ctrlKey) parts.push(isMac ? 'Ctrl' : 'Mod');
    if (event?.shiftKey) parts.push('Shift');
    if (event?.altKey) parts.push('Alt');

    const normalizedKey = getKeyboardEventKey(event);
    if (!normalizedKey) return null;
    const displayKey = normalizedKey.length === 1 && /[a-z]/.test(normalizedKey)
        ? normalizedKey.toUpperCase()
        : normalizedKey.charAt(0).toUpperCase() + normalizedKey.slice(1);
    parts.push(displayKey);
    return parts.join('+');
}
