/**
 * 快捷键设置组件。
 * 在 Settings General tab 中展示可自定义的快捷键列表，
 * 点击快捷键区域进入录制模式，按下新组合键即可修改。
 */

import { t } from '../i18n/index.js';
import { isMac } from '../utils/platform.js';
import { loadCustomKeybindings } from '../utils/keybindingsStorage.js';
import { APP_DEFAULT_KEYBINDINGS } from '../app/commandSetup.js';
import { COMMAND_IDS } from '../core/commands/commandIds.js';
import { keyboardEventToShortcut } from '../core/commands/keybindingUtils.js';
import {
    MARKDOWN_DEFAULT_KEYBINDINGS,
    MARKDOWN_SHORTCUT_GROUPS,
} from '../modules/markdown-shortcuts/markdownShortcutDefinitions.js';
import { addClickHandler } from '../utils/PointerHelper.js';

/**
 * 可自定义的命令列表（过滤掉重复的 commandId，只保留主快捷键）。
 */
const GENERAL_COMMANDS = [
    COMMAND_IDS.APP_OPEN,
    COMMAND_IDS.DOCUMENT_SAVE,
    COMMAND_IDS.EDITOR_UNDO,
    COMMAND_IDS.EDITOR_REDO,
    COMMAND_IDS.EDITOR_FIND,
    COMMAND_IDS.DOCUMENT_NEW_UNTITLED,
    COMMAND_IDS.DOCUMENT_CLOSE_TAB,
    COMMAND_IDS.DOCUMENT_REOPEN_TAB,
    COMMAND_IDS.VIEW_TOGGLE_SOURCE_MODE,
    COMMAND_IDS.VIEW_TOGGLE_SIDEBAR,
    COMMAND_IDS.DOCUMENT_DELETE,
    COMMAND_IDS.DOCUMENT_RENAME,
    COMMAND_IDS.FEATURE_TRANSLATOR_TOGGLE,
    COMMAND_IDS.FEATURE_TOC_TOGGLE,
    COMMAND_IDS.APP_SETTINGS,
    COMMAND_IDS.EDITOR_SELECT_SEARCH_MATCHES,
    COMMAND_IDS.DOCUMENT_COPY_MARKDOWN,
    COMMAND_IDS.DOCUMENT_COPY_PLAIN_TEXT,
];

/** 设置页完整分组，Markdown 分组直接复用命令贡献定义。 */
const KEYBINDING_GROUPS = [
    { id: 'general', labelKey: 'settings.kb.groupGeneral', commandIds: GENERAL_COMMANDS },
    ...MARKDOWN_SHORTCUT_GROUPS.map(group => ({
        id: group.id,
        labelKey: group.labelKey,
        commandIds: group.commands.map(command => command.commandId),
    })),
];

/** 设置页可编辑的默认快捷键，由应用与 Markdown 模块分别贡献。 */
const EDITABLE_DEFAULT_KEYBINDINGS = [
    ...APP_DEFAULT_KEYBINDINGS,
    ...MARKDOWN_DEFAULT_KEYBINDINGS,
];

/**
 * 命令 ID → i18n key 的映射。
 */
const COMMAND_LABELS = {
    [COMMAND_IDS.APP_OPEN]: 'settings.kb.open',
    [COMMAND_IDS.DOCUMENT_SAVE]: 'settings.kb.save',
    [COMMAND_IDS.EDITOR_UNDO]: 'settings.kb.undo',
    [COMMAND_IDS.EDITOR_REDO]: 'settings.kb.redo',
    [COMMAND_IDS.EDITOR_FIND]: 'settings.kb.find',
    [COMMAND_IDS.DOCUMENT_NEW_UNTITLED]: 'settings.kb.newTab',
    [COMMAND_IDS.DOCUMENT_CLOSE_TAB]: 'settings.kb.closeTab',
    [COMMAND_IDS.DOCUMENT_REOPEN_TAB]: 'settings.kb.reopenTab',
    [COMMAND_IDS.VIEW_TOGGLE_SOURCE_MODE]: 'settings.kb.toggleSourceMode',
    [COMMAND_IDS.VIEW_TOGGLE_SIDEBAR]: 'settings.kb.toggleSidebar',
    [COMMAND_IDS.DOCUMENT_DELETE]: 'settings.kb.delete',
    [COMMAND_IDS.DOCUMENT_RENAME]: 'settings.kb.rename',
    [COMMAND_IDS.FEATURE_TRANSLATOR_TOGGLE]: 'settings.kb.translator',
    [COMMAND_IDS.FEATURE_TOC_TOGGLE]: 'settings.kb.toc',
    [COMMAND_IDS.APP_SETTINGS]: 'settings.kb.settings',
    [COMMAND_IDS.EDITOR_SELECT_SEARCH_MATCHES]: 'settings.kb.selectAllMatches',
    [COMMAND_IDS.DOCUMENT_COPY_MARKDOWN]: 'settings.kb.copyMarkdown',
    [COMMAND_IDS.DOCUMENT_COPY_PLAIN_TEXT]: 'settings.kb.copyPlainText',
    ...Object.fromEntries(
        MARKDOWN_SHORTCUT_GROUPS.flatMap(group => group.commands)
            .map(command => [command.commandId, command.labelKey])
    ),
};

/**
 * 获取命令的默认快捷键。
 */
function getDefaultShortcut(commandId) {
    const entry = EDITABLE_DEFAULT_KEYBINDINGS.find(([id]) => id === commandId);
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
            if (t === 'ctrl') return isMac ? '⌃' : 'Ctrl';
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
        this.stopRecording();
        this.disposeClickHandlers();
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

        for (const group of KEYBINDING_GROUPS) {
            const groupEl = document.createElement('section');
            groupEl.className = 'keybindings-group';
            groupEl.dataset.groupId = group.id;

            const groupTitle = document.createElement('h3');
            groupTitle.className = 'keybindings-group__title';
            groupTitle.textContent = t(group.labelKey);
            groupEl.appendChild(groupTitle);

            for (const commandId of group.commandIds) {
                groupEl.appendChild(this.createCommandRow(commandId));
            }
            list.appendChild(groupEl);
        }
    }

    /**
     * 创建一条快捷键设置行。
     * @param {string} commandId - 命令 ID
     * @returns {HTMLElement}
     */
    createCommandRow(commandId) {
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
        this.cleanupFunctions.push(addClickHandler(kbd, () => this.startRecording(commandId, kbd)));
        return row;
    }

    startRecording(commandId, kbdEl) {
        // 取消之前的录制
        this.stopRecording();

        this.recordingCommandId = commandId;
        document.documentElement.dataset.keybindingRecording = 'true';
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

            const shortcut = keyboardEventToShortcut(event);
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
        if (typeof document !== 'undefined') {
            delete document.documentElement.dataset.keybindingRecording;
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

    /** 释放当前渲染批次创建的点击处理器。 */
    disposeClickHandlers() {
        for (const fn of this.cleanupFunctions) {
            try { fn?.(); } catch {}
        }
        this.cleanupFunctions = [];
    }

    destroy() {
        this.stopRecording();
        this.disposeClickHandlers();
    }
}
