import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
    getWritingModeState,
    setWritingModeState,
    subscribeWritingModeState,
} from '../src/modules/writing-modes/writingModeState.js';

const projectRoot = new URL('../', import.meta.url);

/** 读取项目源码，验证跨模块装配没有遗漏。 */
async function readProjectFile(path) {
    return readFile(new URL(path, projectRoot), 'utf8');
}

test('写作模式状态只在真实变化时广播，并向新订阅者提供当前快照', () => {
    setWritingModeState({ focusMode: false, typewriterMode: false });
    const snapshots = [];
    const unsubscribe = subscribeWritingModeState(state => snapshots.push({ ...state }));

    setWritingModeState({ focusMode: true, typewriterMode: false });
    setWritingModeState({ focusMode: true, typewriterMode: false });
    setWritingModeState({ focusMode: true, typewriterMode: true });
    unsubscribe();

    assert.deepEqual(snapshots, [
        { focusMode: false, typewriterMode: false },
        { focusMode: true, typewriterMode: false },
        { focusMode: true, typewriterMode: true },
    ]);
    assert.deepEqual(getWritingModeState(), { focusMode: true, typewriterMode: true });
    setWritingModeState({ focusMode: false, typewriterMode: false });
});

test('专注与打字机模式完整接入设置、命令、双编辑器和菜单', async () => {
    const [settings, commands, handlers, markdownEditor, codeEditor, menuListeners, rustMenu] = await Promise.all([
        readProjectFile('src/utils/editorSettings.js'),
        readProjectFile('src/app/commandSetup.js'),
        readProjectFile('src/app/commandHandlers.js'),
        readProjectFile('src/components/markdown-editor/MarkdownEditor.js'),
        readProjectFile('src/components/code-editor/CodeEditor.js'),
        readProjectFile('src/modules/menuListeners.js'),
        readProjectFile('src-tauri/src/menu.rs'),
    ]);

    for (const mode of ['focusMode', 'typewriterMode']) {
        assert.match(settings, new RegExp(`${mode}: false`));
        assert.match(handlers, new RegExp(`toggle${mode[0].toUpperCase()}${mode.slice(1)}`));
    }
    assert.match(commands, /VIEW_TOGGLE_FOCUS_MODE/);
    assert.match(commands, /VIEW_TOGGLE_TYPEWRITER_MODE/);
    assert.match(markdownEditor, /MarkdownWritingModeController/);
    assert.match(codeEditor, /CodeWritingModeController/);
    assert.match(menuListeners, /menu-toggle-focus-mode/);
    assert.match(menuListeners, /menu-toggle-typewriter-mode/);
    assert.match(rustMenu, /CheckMenuItemBuilder::with_id\("toggle-focus-mode"/);
    assert.match(rustMenu, /CheckMenuItemBuilder::with_id\("toggle-typewriter-mode"/);
});

test('专注样式仅作用于编辑器，打字机模式不制造实体留白', async () => {
    const [css, markdownController, codeController] = await Promise.all([
        readProjectFile('styles/writing-modes.css'),
        readProjectFile('src/modules/writing-modes/MarkdownWritingModeController.js'),
        readProjectFile('src/modules/writing-modes/CodeWritingModeController.js'),
    ]);
    assert.match(css, /\.view-pane\.markdown-pane\.writing-focus-mode/);
    assert.match(css, /\.code-editor-pane\.writing-focus-mode/);
    assert.doesNotMatch(css, /\.view-content\.writing-/);
    assert.doesNotMatch(css, /writing-typewriter-mode[\s\S]*padding-(top|bottom)/);
    assert.doesNotMatch(markdownController, /writing-typewriter-space/);
    assert.doesNotMatch(codeController, /writing-typewriter-space/);
});

test('Markdown 专注模式通过 ProseMirror 节点装饰跟随当前选区', async () => {
    const plugin = await readProjectFile('src/modules/writing-modes/MarkdownFocusModePlugin.js');
    assert.match(plugin, /Decoration\.node/);
    assert.match(plugin, /state\.selection\.\$head/);
    assert.match(plugin, /class: 'writing-focus-block'/);
});
