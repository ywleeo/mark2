import assert from 'node:assert/strict';
import test from 'node:test';
import { Schema } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import {
    buildSelectionRewriteContext,
    buildSelectionRewriteRequestBody,
    buildWritingIdeaContext,
} from '../src/features/aiWriting/AiWritingBuilders.js';
import {
    createSelectionRewritePlugin,
    selectionRewritePluginKey,
} from '../src/features/aiWriting/SelectionRewritePlugin.js';

/**
 * 创建选区改写测试所需的最小 ProseMirror 文档。
 * @returns {{schema:Schema,state:EditorState}}
 */
function createEditorState() {
    const schema = new Schema({
        nodes: {
            doc: { content: 'block+' },
            paragraph: { content: 'text*', group: 'block' },
            text: { group: 'inline' },
        },
    });
    const plugin = createSelectionRewritePlugin();
    const state = EditorState.create({
        schema,
        doc: schema.node('doc', null, [schema.node('paragraph', null, [schema.text('abcdef')])]),
        plugins: [plugin],
    });
    return { schema, state };
}

test('Toolbar 捕获的选区范围用于构造上下文，不依赖随后变化的编辑器 selection', () => {
    const state = {
        selection: { from: 1, to: 1 },
        doc: {
            content: { size: 18 },
            textBetween(from, to) {
                return `range:${from}-${to}`;
            },
        },
    };
    const context = buildSelectionRewriteContext(state, '选中的句子', '# 标题', { from: 5, to: 9 });

    assert.equal(context.selectedText, '选中的句子');
    assert.equal(context.beforeSelection, 'range:0-5');
    assert.equal(context.afterSelection, 'range:9-18');
});

test('选区改写请求不再用小 token 上限截断推理模型正文', () => {
    const body = buildSelectionRewriteRequestBody({
        mode: 'polish',
        model: 'reasoning-model',
        temperature: 0.5,
        userPrompt: '<SelectedText>原文</SelectedText>',
    });

    assert.equal('max_tokens' in body, false);
    assert.equal('max_completion_tokens' in body, false);
    assert.match(body.messages[0].content, /只输出改写后的选中内容/);
});

test('Ideas 使用菜单点击前捕获的选区，不依赖随后变化的 selection', () => {
    const { state } = createEditorState();
    const context = buildWritingIdeaContext(
        state,
        '冻结的选区',
        '# 标题',
        null,
        { from: 2, to: 5 },
    );

    assert.equal(context.selectedText, '冻结的选区');
    assert.equal(context.beforeSelection, 'a');
    assert.equal(context.afterSelection, 'ef');
});

test('选区状态在请求中保持高亮范围，并随文档 transaction 映射', () => {
    const { state: initialState } = createEditorState();
    let state = initialState.apply(initialState.tr.setMeta(selectionRewritePluginKey, {
        type: 'loading',
        from: 2,
        to: 5,
        message: 'AI 正在改...',
    }));
    assert.deepEqual(selectionRewritePluginKey.getState(state), {
        status: 'loading',
        from: 2,
        to: 5,
        message: 'AI 正在改...',
    });

    state = state.apply(state.tr.insertText('X', 1));
    assert.equal(selectionRewritePluginKey.getState(state).from, 3);
    assert.equal(selectionRewritePluginKey.getState(state).to, 6);

    state = state.apply(state.tr.setMeta(selectionRewritePluginKey, { type: 'clear' }));
    assert.equal(selectionRewritePluginKey.getState(state).status, 'idle');
});
