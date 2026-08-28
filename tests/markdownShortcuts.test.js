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

test('Markdown 命令通过统一命令层透传切换动作', async () => {
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
        { action: 'heading4', payload: {} },
        { action: 'quote', payload: {} },
    ]);
});

test('源码模式连续执行同级标题动作会在标题与正文之间切换', () => {
    for (let level = 1; level <= 6; level += 1) {
        const editor = createTextEditor('标题', 0, 0);
        const handlers = new ToolbarPlainMarkdownHandlers({ editor });

        handlers.toggleHeading(level);
        assert.equal(editor.value, `${'#'.repeat(level)} 标题`);

        handlers.toggleHeading(level);
        assert.equal(editor.value, '标题');
    }
});

test('源码模式代码块快捷键会包裹文本并在再次执行时移除围栏', () => {
    const editor = createTextEditor('const answer = 42;', 0, 18);
    const handlers = new ToolbarPlainMarkdownHandlers({ editor });

    assert.equal(handlers.toggleCodeBlock(), true);
    assert.equal(editor.value, '```\nconst answer = 42;\n```');

    assert.equal(handlers.toggleCodeBlock(), true);
    assert.equal(editor.value, 'const answer = 42;');

    const fencedEditor = createTextEditor('前文\n```js\nconst value = 1;\n```\n后文', 14, 14);
    const fencedHandlers = new ToolbarPlainMarkdownHandlers({ editor: fencedEditor });
    assert.equal(fencedHandlers.toggleCodeBlock(), true);
    assert.equal(fencedEditor.value, '前文\nconst value = 1;\n后文');

    const nestedFenceEditor = createTextEditor('示例：```', 0, 6);
    const nestedFenceHandlers = new ToolbarPlainMarkdownHandlers({ editor: nestedFenceEditor });
    assert.equal(nestedFenceHandlers.toggleCodeBlock(), true);
    assert.equal(nestedFenceEditor.value, '````\n示例：```\n````');
});

test('源码模式有序和无序列表快捷键会取消同类型并转换不同类型', () => {
    const orderedEditor = createTextEditor('1. 条目', 3, 3);
    const orderedHandlers = new ToolbarPlainMarkdownHandlers({ editor: orderedEditor });
    assert.equal(orderedHandlers.toggleList('unordered'), true);
    assert.equal(orderedEditor.value, '- 条目');
    assert.equal(orderedHandlers.toggleList('unordered'), true);
    assert.equal(orderedEditor.value, '条目');

    const unorderedEditor = createTextEditor('  * 条目', 4, 4);
    const unorderedHandlers = new ToolbarPlainMarkdownHandlers({ editor: unorderedEditor });
    assert.equal(unorderedHandlers.toggleList('ordered'), true);
    assert.equal(unorderedEditor.value, '  1. 条目');
    assert.equal(unorderedHandlers.toggleList('ordered'), true);
    assert.equal(unorderedEditor.value, '  条目');

    const multiLineEditor = createTextEditor('1. 第一项\n2) 第二项', 0, 13);
    const multiLineHandlers = new ToolbarPlainMarkdownHandlers({ editor: multiLineEditor });
    assert.equal(multiLineHandlers.toggleList('unordered'), true);
    assert.equal(multiLineEditor.value, '- 第一项\n- 第二项');
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
