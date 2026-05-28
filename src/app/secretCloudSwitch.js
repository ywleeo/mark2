/**
 * 隐藏暗号:在「非输入态」(焦点不在编辑器/输入框)依次按下 j j l l,
 * 切换 mark2 Cloud 账户的隐藏开关(localStorage 'cloudAccountEnabled'),并重载生效。
 *
 * 配合 src/config/features.js 的 readCloudAccountOverride():
 * features.cloudAccount 在模块加载时求值一次,所以改完必须重载页面。
 * 这是 toggle —— 同一个暗号既能开也能关。
 */

const SEQUENCE = ['j', 'j', 'l', 'l'];
const RESET_MS = 1500;            // 按键间隔超过此值则重置缓冲,要求「依次连按」
const STORAGE_KEY = 'cloudAccountEnabled';

// 当前焦点是否处于文本输入场景 —— 是则不计入暗号,避免编辑时打字误触发
function isTypingContext() {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
    if (el.isContentEditable) return true;
    // TipTap(.ProseMirror)/ CodeMirror6(.cm-editor)的可编辑区
    if (typeof el.closest === 'function'
        && el.closest('.ProseMirror, .cm-editor, [contenteditable="true"]')) {
        return true;
    }
    return false;
}

function flashToast(text) {
    try {
        const el = document.createElement('div');
        el.textContent = text;
        el.style.cssText = [
            'position:fixed', 'left:50%', 'top:24px', 'transform:translateX(-50%)',
            'z-index:99999', 'padding:8px 16px', 'border-radius:8px',
            'background:rgba(0,0,0,0.82)', 'color:#fff', 'font-size:13px',
            'box-shadow:0 4px 16px rgba(0,0,0,0.3)', 'pointer-events:none',
        ].join(';');
        document.body.appendChild(el);
    } catch (_) { /* DOM 不可用就算了,重载本身就是反馈 */ }
}

function toggleCloudAccount() {
    let enabled = false;
    try { enabled = localStorage.getItem(STORAGE_KEY) === '1'; } catch (_) { return; }
    const next = !enabled;
    try {
        if (next) localStorage.setItem(STORAGE_KEY, '1');
        else localStorage.removeItem(STORAGE_KEY);
    } catch (_) { return; }
    flashToast(next ? 'mark2 Cloud 已开启,正在重载…' : 'mark2 Cloud 已关闭,正在重载…');
    // features 在加载时求值,必须重载才生效;留一点时间让提示可见
    setTimeout(() => { try { window.location.reload(); } catch (_) {} }, 700);
}

/**
 * 注册暗号监听。无条件调用(开关关闭时也要能用它来开启)。
 * @returns {() => void} 取消监听
 */
export function setupSecretCloudSwitch() {
    let buffer = [];
    let lastTs = 0;

    const onKeyDown = (e) => {
        // 带修饰键的按键不计入(避免和快捷键冲突)
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        if (isTypingContext()) { buffer = []; return; }

        const key = (e.key || '').toLowerCase();
        if (key !== 'j' && key !== 'l') { buffer = []; return; }

        const now = Date.now();
        if (now - lastTs > RESET_MS) buffer = [];
        lastTs = now;

        buffer.push(key);
        if (buffer.length > SEQUENCE.length) buffer.shift();
        if (buffer.length === SEQUENCE.length && buffer.every((k, i) => k === SEQUENCE[i])) {
            buffer = [];
            toggleCloudAccount();
        }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
}
