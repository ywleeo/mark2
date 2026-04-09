/**
 * 快捷键设置组件。
 * 在 Settings General tab 中展示可自定义的快捷键列表，
 * 点击快捷键区域进入录制模式，按下新组合键即可修改。
 */

import { t } from '../i18n/index.js';
import { isMac } from '../utils/platform.js';
import { loadCustomKeybindings } from '../utils/keybindingsStorage.js';
import { DEFAULT_KEYBINDINGS } from '../app/commandSetup.js';
import { COMMAND_IDS } from '../core/commands/commandIds.js';
import { addClickHandler } from '../utils/PointerHelper.js';

/**
 * 可自定义的命令列表（过滤掉重复的 commandId，只保留主快捷键）。
 */
const CUSTOMIZABLE_COMMANDS = [
    COMMAND_IDS.APP_OPEN,
    COMMAND_IDS.DOCUMENT_SAVE,
    COMMAND_IDS.EDITOR_FIND,
    COMMAND_IDS.DOCUMENT_NEW_UNTITLED,
    COMMAND_IDS.DOCUMENT_CLOSE_TAB,
    COMMAND_IDS.VIEW_TOGGLE_SOURCE_MODE,
    COMMAND_IDS.VIEW_TOGGLE_SIDEBAR,
    COMMAND_IDS.DOCUMENT_DELETE,
    COMMAND_IDS.DOCUMENT_RENAME,
    COMMAND_IDS.FEATURE_SCRATCHPAD_TOGGLE,
    COMMAND_IDS.EDITOR_SELECT_SEARCH_MATCHES,
];

/**
 * 命令 ID → i18n key 的映射。
 */
const COMMAND_LABELS = {
    [COMMAND_IDS.APP_OPEN]: 'settings.kb.open',
    [COMMAND_IDS.DOCUMENT_SAVE]: 'settings.kb.save',
    [COMMAND_IDS.EDITOR_FIND]: 'settings.kb.find',
    [COMMAND_IDS.DOCUMENT_NEW_UNTITLED]: 'settings.kb.newTab',
    [COMMAND_IDS.DOCUMENT_CLOSE_TAB]: 'settings.kb.closeTab',
    [COMMAND_IDS.VIEW_TOGGLE_SOURCE_MODE]: 'settings.kb.toggleSourceMode',
    [COMMAND_IDS.VIEW_TOGGLE_SIDEBAR]: 'settings.kb.toggleSidebar',
    [COMMAND_IDS.DOCUMENT_DELETE]: 'settings.kb.delete',
    [COMMAND_IDS.DOCUMENT_RENAME]: 'settings.kb.rename',
    [COMMAND_IDS.FEATURE_SCRATCHPAD_TOGGLE]: 'settings.kb.scratchpad',
    [COMMAND_IDS.EDITOR_SELECT_SEARCH_MATCHES]: 'settings.kb.selectAllMatches',
};

/**
 * 获取命令的默认快捷键。
 */
function getDefaultShortcut(commandId) {
    const entry = DEFAULT_KEYBINDINGS.find(([id]) => id === commandId);
    return entry ? entry[1] : '';
}

/**
 * 将快捷键字符串格式化为用户友好的显示文本。
 * Mod → ⌘ (macOS) 或 Ctrl (Windows)
 */
function formatShortcut(shortcut) {
    if (!shortcut) return '';
    return shortcut
        .split('+')
        .map(token => {
            const t = token.trim().toLowerCase();
            if (t === 'mod') return isMac ? '⌘' : 'Ctrl';
            if (t === 'shift') return isMac ? '⇧' : 'Shift';
            if (t === 'alt') return isMac ? '⌥' : 'Alt';
            if (t === 'delete') return isMac ? '⌫' : 'Del';
            if (t === 'backspace') return isMac ? '⌫' : 'Backspace';
            if (t === 'space') return 'Space';
            if (t === 'escape') return 'Esc';
            return token.trim().charAt(0).toUpperCase() + token.trim().slice(1);
        })
        .join(isMac ? ' ' : ' + ');
}

/**
 * 从 KeyboardEvent 构建快捷键字符串。
 * @returns {string|null} 快捷键字符串，如果只按了修饰键返回 null
 */
function eventToShortcut(event) {
    const key = event.key;

    // 忽略纯修饰键
    if (['Meta', 'Control', 'Shift', 'Alt'].includes(key)) {
        return null;
    }

    const parts = [];
    if (event.metaKey || event.ctrlKey) parts.push('Mod');
    if (event.shiftKey) parts.push('Shift');
    if (event.altKey) parts.push('Alt');

    // 规范化 key 名
    let normalizedKey = key;
    if (key === ' ') normalizedKey = 'Space';
    else if (key.length === 1) normalizedKey = key.toUpperCase();
    else {
        // 首字母大写
        normalizedKey = key.charAt(0).toUpperCase() + key.slice(1);
    }

    parts.push(normalizedKey);
    return parts.join('+');
}

export class KeybindingsSettings {
    /**
     * @param {{container: HTMLElement}} options
     */
    constructor({ container }) {
        this.container = container;
        this.customBindings = loadCustomKeybindings();
        this.recordingCommandId = null;
        this.cleanupFunctions = [];
        this.render();
    }

    render() {
        this.container.innerHTML = '';

        // 标题行
        const header = document.createElement('div');
        header.className = 'keybindings-header';
        header.innerHTML = `
            <span class="keybindings-title">${t('settings.kb.title')}</span>
            <button type="button" class="keybindings-reset-btn">${t('settings.kb.resetAll')}</button>
        `;
        this.container.appendChild(header);

        const resetBtn = header.querySelector('.keybindings-reset-btn');
        this.cleanupFunctions.push(addClickHandler(resetBtn, () => this.resetAll()));

        // 快捷键列表
        const list = document.createElement('div');
        list.className = 'keybindings-list';
        this.container.appendChild(list);

        for (const commandId of CUSTOMIZABLE_COMMANDS) {
            const currentShortcut = this.customBindings[commandId] ?? getDefaultShortcut(commandId);
            const isCustom = commandId in this.customBindings;

            const row = document.createElement('div');
            row.className = 'keybindings-row';
            row.dataset.commandId = commandId;

            const label = document.createElement('span');
            label.className = 'keybindings-row__label';
            label.textContent = t(COMMAND_LABELS[commandId]);
            row.appendChild(label);

            const right = document.createElement('div');
            right.className = 'keybindings-row__right';

            const kbd = document.createElement('button');
            kbd.type = 'button';
            kbd.className = 'keybindings-row__shortcut' + (isCustom ? ' keybindings-row__shortcut--custom' : '');
            kbd.textContent = formatShortcut(currentShortcut);
            kbd.title = t('settings.kb.clickToRecord');
            right.appendChild(kbd);

            if (isCustom) {
                const resetSingle = document.createElement('button');
                resetSingle.type = 'button';
                resetSingle.className = 'keybindings-row__reset';
                resetSingle.textContent = '↺';
                resetSingle.title = t('settings.kb.resetSingle');
                right.appendChild(resetSingle);
                this.cleanupFunctions.push(addClickHandler(resetSingle, () => this.resetSingle(commandId)));
            }

            row.appendChild(right);
            list.appendChild(row);

            this.cleanupFunctions.push(addClickHandler(kbd, () => this.startRecording(commandId, kbd)));
        }
    }

    startRecording(commandId, kbdEl) {
        // 取消之前的录制
        this.stopRecording();

        this.recordingCommandId = commandId;
        kbdEl.textContent = t('settings.kb.recording');
        kbdEl.classList.add('keybindings-row__shortcut--recording');

        this._recordingHandler = (event) => {
            event.preventDefault();
            event.stopPropagation();

            // Esc 取消录制
            if (event.key === 'Escape') {
                this.stopRecording();
                this.render();
                return;
            }

            const shortcut = eventToShortcut(event);
            if (!shortcut) return; // 纯修饰键，继续等待

            this.customBindings[commandId] = shortcut;
            this.stopRecording();
            this.render();
        };

        // 用 capture 拦截，避免被其他 handler 消费
        document.addEventListener('keydown', this._recordingHandler, true);
    }

    stopRecording() {
        if (this._recordingHandler) {
            document.removeEventListener('keydown', this._recordingHandler, true);
            this._recordingHandler = null;
        }
        this.recordingCommandId = null;
    }

    resetSingle(commandId) {
        delete this.customBindings[commandId];
        this.render();
    }

    resetAll() {
        this.customBindings = {};
        this.render();
    }

    /**
     * 获取当前自定义快捷键数据（供外部保存）。
     */
    getCustomBindings() {
        return { ...this.customBindings };
    }

    destroy() {
        this.stopRecording();
        for (const fn of this.cleanupFunctions) {
            try { fn(); } catch {}
        }
        this.cleanupFunctions = [];
    }
}
