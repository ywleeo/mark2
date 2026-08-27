/**
 * Markdown 快捷键命令、按键规范化和源码模式动作测试。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { APP_DEFAULT_KEYBINDINGS, registerCoreCommands } from '../src/app/commandSetup.js';
import { COMMAND_IDS } from '../src/core/commands/commandIds.js';
import { createKeybindingManager } from '../src/core/commands/KeybindingManager.js';
import { keyboardEventToShortcut } from '../src/core/commands/keybindingUtils.js';
import {
    MARKDOWN_DEFAULT_KEYBINDINGS,
    MARKDOWN_SHORTCUT_COMMANDS,
} from '../src/modules/markdown-shortcuts/markdownShortcutDefinitions.js';
import { ToolbarPlainMarkdownHandlers } from '../src/components/markdown-toolbar/ToolbarPlainMarkdownHandlers.js';

/** 创建可供源码处理器操作的最小 textarea 代理。 */
function createTextEditor(value, start = 0, end = start) {
    return {
        value,
        selectionStart: start,
        selectionEnd: end,
        focus() {},
        setSelectionRange(nextStart, nextEnd) {
            this.selectionStart = nextStart;
            this.selectionEnd = nextEnd;
        },
        setRangeText(text, from, to, selectionMode = 'end') {
            const rangeStart = from ?? this.selectionStart;
            const rangeEnd = to ?? this.selectionEnd;
            this.value = `${this.value.slice(0, rangeStart)}${text}${this.value.slice(rangeEnd)}`;
            if (selectionMode === 'select') {
                this.selectionStart = rangeStart;
                this.selectionEnd = rangeStart + text.length;
            } else {
                this.selectionStart = rangeStart + text.length;
                this.selectionEnd = this.selectionStart;
            }
        },
        dispatchEvent() {},
    };
}

test('Markdown 快捷键定义具有唯一命令和无冲突默认键位', () => {
    assert.equal(MARKDOWN_SHORTCUT_COMMANDS.length, 25);
    assert.equal(new Set(MARKDOWN_SHORTCUT_COMMANDS.map(item => item.commandId)).size, 25);
    assert.deepEqual(
        MARKDOWN_DEFAULT_KEYBINDINGS.map(([commandId]) => commandId),
        MARKDOWN_SHORTCUT_COMMANDS.map(item => item.commandId)
    );
    assert.ok(APP_DEFAULT_KEYBINDINGS.every(([commandId]) => !commandId.startsWith('markdown.')));
    assert.ok(MARKDOWN_DEFAULT_KEYBINDINGS.every(([commandId]) => commandId.startsWith('markdown.')));

    const allShortcuts = [...APP_DEFAULT_KEYBINDINGS, ...MARKDOWN_DEFAULT_KEYBINDINGS]
        .map(([, shortcut]) => shortcut.toLowerCase());
    assert.equal(new Set(allShortcuts).size, allShortcuts.length);
});

test('Markdown 命令通过统一命令层透传动作与标题参数', async () => {
    const registered = new Map();
    const calls = [];
    const commandManager = {
        registerCommand(definition) {
            registered.set(definition.id, definition.handler);
            return () => registered.delete(definition.id);
        },
    };

    registerCoreCommands({
        commandManager,
        handlers: {
            onMarkdownAction(action, payload) {
                calls.push({ action, payload });
            },
        },
    });

    await registered.get(COMMAND_IDS.MARKDOWN_HEADING_4)();
    await registered.get(COMMAND_IDS.MARKDOWN_QUOTE)();
    assert.deepEqual(calls, [
        { action: 'heading', payload: { level: 4 } },
        { action: 'quote', payload: {} },
    ]);
});

test('Shift 与 Alt 改写 event.key 时仍按基础键帽识别快捷键', async () => {
    const manager = createKeybindingManager();
    manager.registerBinding({ commandId: 'markdown.orderedList', shortcut: 'Mod+Shift+[' });
    manager.registerBinding({ commandId: 'markdown.table', shortcut: 'Mod+Alt+T' });

    let keydownHandler = null;
    let capture = null;
    const target = {
        addEventListener(type, handler, options) {
            if (type === 'keydown') {
                keydownHandler = handler;
                capture = options;
            }
        },
        removeEventListener() {},
    };
    const executed = [];
    manager.attach({
        target,
        executeCommand(commandId) {
            executed.push(commandId);
        },
    });

    const createEvent = overrides => ({
        key: '',
        code: '',
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        altKey: false,
        preventDefault() {},
        stopPropagation() {},
        ...overrides,
    });
    keydownHandler(createEvent({ key: '{', code: 'BracketLeft', ctrlKey: true, shiftKey: true }));
    keydownHandler(createEvent({ key: '†', code: 'KeyT', ctrlKey: true, altKey: true }));

    assert.equal(capture, true);
    assert.deepEqual(executed, ['markdown.orderedList', 'markdown.table']);
    assert.equal(keyboardEventToShortcut(createEvent({ key: '~', code: 'Backquote', ctrlKey: true, shiftKey: true })), 'Mod+Shift+`');
});

test('源码模式支持标题升降级、下划线和多行缩进', () => {
    const headingEditor = createTextEditor('## 标题', 3, 3);
    const headingHandlers = new ToolbarPlainMarkdownHandlers({ editor: headingEditor });
    assert.equal(headingHandlers.adjustHeadingLevel('increase'), true);
    assert.equal(headingEditor.value, '# 标题');
    assert.equal(headingHandlers.adjustHeadingLevel('decrease'), true);
    assert.equal(headingEditor.value, '## 标题');

    const underlineEditor = createTextEditor('文本', 0, 2);
    const underlineHandlers = new ToolbarPlainMarkdownHandlers({ editor: underlineEditor });
    underlineHandlers.toggleFormat('<u>', '</u>');
    assert.equal(underlineEditor.value, '<u>文本</u>');

    const indentEditor = createTextEditor('- 一\n- 二', 0, 7);
    const indentHandlers = new ToolbarPlainMarkdownHandlers({ editor: indentEditor });
    assert.equal(indentHandlers.adjustIndent('indent'), true);
    assert.equal(indentEditor.value, '    - 一\n    - 二');
    assert.equal(indentHandlers.adjustIndent('outdent'), true);
    assert.equal(indentEditor.value, '- 一\n- 二');
});
