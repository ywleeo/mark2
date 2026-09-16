import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { resolveAiWritingToolbarActions } from '../src/components/markdown-toolbar/AiWritingToolbarPolicy.js';

/** 将菜单状态按 action 转成便于断言的 Map。 */
function byAction(state) {
    return new Map(resolveAiWritingToolbarActions(state).map(item => [item.action, item]));
}

test('AI toolbar 在没有选区时保持续写、灵感和全篇美化可用', () => {
    const actions = byAction({
        completionConfigured: true,
        beautifyConfigured: true,
        selectionRange: null,
    });

    assert.equal(actions.get('continue').enabled, true);
    assert.equal(actions.get('inspiration').enabled, true);
    assert.equal(actions.get('beautifyDocument').enabled, true);
    assert.equal(actions.get('polish').enabled, false);
    assert.equal(actions.get('polish').reasonKey, 'aiWriting.selectTextHint');
});

test('AI toolbar 有选区时开放全部改写能力，并按场景模型单独禁用', () => {
    const actions = byAction({
        completionConfigured: true,
        beautifyConfigured: false,
        selectionRange: { from: 4, to: 10 },
    });

    for (const action of ['continue', 'polish', 'shorten', 'expand', 'inspiration']) {
        assert.equal(actions.get(action).enabled, true);
    }
    assert.equal(actions.get('beautifyDocument').enabled, false);
    assert.equal(actions.get('beautifyDocument').reasonKey, 'aiWriting.modelNotConfigured');
});

test('AI toolbar 在 Markdown 源码视图中不执行位置不兼容的动作', () => {
    const actions = resolveAiWritingToolbarActions({
        editorAvailable: false,
        completionConfigured: true,
        beautifyConfigured: true,
        selectionRange: { from: 4, to: 10 },
    });

    assert.equal(actions.every(action => !action.enabled), true);
    assert.equal(actions.every(action => action.reasonKey === 'aiWriting.richViewOnly'), true);
});

test('Markdown 编辑器关闭正文左侧 AI 光标入口', async () => {
    const source = await readFile(
        new URL('../src/components/markdown-editor/MarkdownEditor.js', import.meta.url),
        'utf8',
    );

    assert.match(source, /aiWritingEntryManager\.setup\(\{ cursorEntry: false \}\)/);
});

test('AI 写作集中到 Toolbar 后不再注册 Markdown 右键菜单', async () => {
    const source = await readFile(
        new URL('../src/modules/card-export/index.js', import.meta.url),
        'utf8',
    );

    assert.doesNotMatch(source, /EditorContextMenu|contextmenu|onAiSelectionAction/);
});

test('AI toolbar 图标与菜单动作图标均声明了实际字形映射', async () => {
    const css = await readFile(
        new URL('../styles/markdown-toolbar.css', import.meta.url),
        'utf8',
    );

    for (const icon of ['sparkles', 'pen-nib', 'magic-wand', 'compress-alt', 'expand-arrows', 'lightbulb-on', 'align-justify']) {
        assert.match(css, new RegExp(`\\.fi-rr-${icon}::before\\s*\\{\\s*content:`));
    }
});
