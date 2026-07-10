import assert from 'node:assert/strict';
import test from 'node:test';
import { buildInlineCompletionContext } from '../src/features/inlineCompletion/CompletionContextBuilder.js';
import { buildCompletionPrompts } from '../src/features/inlineCompletion/CompletionPromptBuilder.js';
import { parseNonStreamingResponse } from '../src/modules/ai-assistant/services/nonStreamingResponseParser.js';
import {
    sanitizeCompletion,
    sanitizeCompletionWithMeta,
} from '../src/features/inlineCompletion/CompletionSanitizer.js';
import { CompletionSession } from '../src/features/inlineCompletion/CompletionSession.js';

/**
 * 创建列表光标场景的最小 ProseMirror 状态替身。
 * @returns {{state:object,serializer:object}} 测试上下文
 */
function createListState() {
    const text = '第一项';
    const root = { type: { name: 'doc' }, attrs: {} };
    const list = { type: { name: 'orderedList' }, attrs: { start: 1 } };
    const item = { type: { name: 'listItem' }, attrs: {} };
    const paragraph = {
        type: { name: 'paragraph' },
        attrs: {},
        content: { size: text.length },
        textBetween: (from, to) => text.slice(from, to),
    };
    const nodes = [root, list, item, paragraph];
    const serializedDoc = { kind: 'serialized-doc' };
    const doc = {
        content: { size: 20 },
        textBetween: () => text,
        eq: other => other === doc,
    };
    const state = {
        doc,
        schema: { text: marker => ({ marker }) },
        selection: {
            from: 10,
            to: 10,
            $from: {
                parent: paragraph,
                parentOffset: text.length,
                depth: nodes.length - 1,
                node: depth => nodes[depth],
            },
        },
        tr: {
            replaceWith: () => ({ doc: serializedDoc }),
        },
    };
    const serializer = {
        serialize: candidate => candidate === serializedDoc
            ? '1. 第一项MARK2CURSORPOINT\n2. 第二项'
            : '',
    };
    return { state, serializer };
}

test('上下文保留光标附近真实 Markdown，并识别列表内部插入', () => {
    const { state, serializer } = createListState();
    const context = buildInlineCompletionContext(state, '# 标题\n\n1. 第一项\n2. 第二项', serializer);

    assert.equal(context.beforeCursor, '1. 第一项');
    assert.equal(context.afterCursor, '\n2. 第二项');
    assert.equal(context.currentFormat.mode, 'list-item');
    assert.equal(context.currentFormat.insertionMode, 'inline');
});

test('清理器保留模型生成的 Markdown 结构', () => {
    const context = {
        beforeCursor: '常见误区：\n',
        currentFormat: { insertionMode: 'block' },
    };
    const completion = '- 第一项\n- 第二项';
    assert.equal(sanitizeCompletion(completion, context, 500), completion);
});

test('清理器删除完全重复前缀，但不会在去重为空时恢复旧内容', () => {
    const beforeCursor = '这是光标前已经存在的一整段文字。';
    const context = { beforeCursor, currentFormat: { insertionMode: 'inline' } };

    assert.equal(sanitizeCompletion(`${beforeCursor}这里才是新增内容。`, context, 500), '这里才是新增内容。');
    assert.equal(sanitizeCompletion(beforeCursor, context, 500), '');
    assert.equal(sanitizeCompletionWithMeta(beforeCursor, context, 500).reason, 'duplicate-only');
});

test('返回解析器兼容分段正文并识别 reasoning-only 返回', () => {
    const segmented = parseNonStreamingResponse(JSON.stringify({
        choices: [{
            finish_reason: 'stop',
            message: { content: [{ type: 'text', text: '第一段' }, { output_text: '第二段' }] },
        }],
        usage: { completion_tokens: 32 },
    }));
    assert.equal(segmented.content, '第一段第二段');
    assert.equal(segmented.completionTokens, 32);

    const reasoningOnly = parseNonStreamingResponse(JSON.stringify({
        choices: [{
            finish_reason: 'length',
            message: { content: '', reasoning_content: '正在分析续写方向' },
        }],
    }));
    assert.equal(reasoningOnly.content, '');
    assert.equal(reasoningOnly.reasoningLength, 8);
    assert.equal(reasoningOnly.finishReason, 'length');
});

test('行内英文续写自动保留单词边界', () => {
    const context = {
        beforeCursor: 'Mark2 is',
        currentFormat: { insertionMode: 'inline' },
    };
    assert.equal(sanitizeCompletion('fast and focused.', context, 500), ' fast and focused.');
});

test('统一 prompt 根据上下文判断文体并携带可选灵感', () => {
    const context = {
        beforeCursor: '上一段',
        afterCursor: '下一段',
        outline: '# 标题',
        writingMode: 'auto',
        currentFormat: {
            mode: 'paragraph',
            insertionMode: 'inline',
            instruction: '自然续写当前段落。',
        },
    };
    const prompts = buildCompletionPrompts(context, { lengthHint: '一小段', ideaText: '增加一个新阻碍' });

    assert.match(prompts.systemPrompt, /不要把非叙事文档改写成故事/);
    assert.match(prompts.userPrompt, /增加一个新阻碍/);
    assert.match(prompts.userPrompt, /<BeforeCursorMarkdown>/);
});

test('编辑内容或光标变化后，请求会话立即失效', () => {
    const originalDoc = { eq: other => other === originalDoc };
    const changedDoc = { eq: other => other === changedDoc };
    const view = {
        isDestroyed: false,
        state: { doc: originalDoc, selection: { from: 5, to: 5 } },
    };
    const session = new CompletionSession();
    const snapshot = session.begin(view);

    assert.equal(session.isCurrent(snapshot, view), true);
    view.state = { doc: changedDoc, selection: { from: 6, to: 6 } };
    assert.equal(session.isCurrent(snapshot, view), false);
});
