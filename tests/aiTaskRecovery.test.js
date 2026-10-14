/** 长工具会话、空响应恢复、提案修订和取消边界回归。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { DocumentTaskEngine } from '../src/modules/ai-file-task/DocumentTaskEngine.js';
import { applyDocumentEdits, mergeDocumentEdits } from '../src/modules/ai-file-task/DocumentEdits.js';
import { continueAfterEmptyResponse } from '../src/modules/ai-file-task/DocumentTaskRecovery.js';

/** 构造标准工具调用，不包含用户文档或凭据。 */
function tool(name, args = {}) {
    return { content: '', rawBody: JSON.stringify({ choices: [{ message: { tool_calls: [{ id: 'fixture', type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] }), finishReason: 'tool_calls' };
}

const params = { filePath: '/fixture.md', fileContent: '第一段。\n第二段。', instruction: '修改第二段' };

test('超过原来的 8 轮后仍继续，模型最终回复时才停止', async () => {
    let calls = 0;
    const engine = new DocumentTaskEngine({ client: { complete: async () => {
        calls++;
        assert.ok(calls <= 13);
        return calls <= 12 ? tool('read_current_document', { offset: 0, max_chars: 24 }) : { content: '任务完成。', rawBody: '{}' };
    } } });
    assert.equal(await engine.execute(params), '任务完成。');
    assert.equal(calls, 13);
});

test('空回复在相同会话中恢复，已经提交的修改稿不丢失也不重复执行', async () => {
    let calls = 0;
    const requests = [];
    const progress = [];
    let edits = [];
    const proposed = [{ old_text: '第二段。', new_text: '第二段改好了。' }];
    const engine = new DocumentTaskEngine({ client: { complete: async options => {
        requests.push(structuredClone(options.messages));
        calls++;
        assert.ok(calls <= 4);
        if (calls === 1) return tool('propose_document_edits', { edits: proposed });
        if (calls < 4) return { content: '', rawBody: '{}', reasoningLength: 12 };
        return { content: '修改稿已准备好，请预览后应用。', rawBody: '{}' };
    } } });
    assert.equal(await engine.execute({ ...params, onDocumentEdits: value => { edits = value; }, onProgress: value => progress.push(value) }), '修改稿已准备好，请预览后应用。');
    assert.deepEqual(edits, proposed);
    assert.equal(requests.at(-1).filter(message => message.role === 'tool').length, 1);
    assert.equal(requests.at(-1).filter(message => message.content?.startsWith('响应恢复提示：')).length, 1);
    assert.deepEqual(progress, ['working', 'recovering', 'recovering']);
});

test('网关响应截断时恢复原任务，不把解析错误甩给用户', async () => {
    let calls = 0;
    const engine = new DocumentTaskEngine({ client: { complete: async () => {
        calls++;
        assert.ok(calls <= 2);
        if (calls === 1) throw Object.assign(new Error('incomplete'), { code: 'AI_RESPONSE_INCOMPLETE' });
        return { content: '可用回复', rawBody: '{}' };
    } } });
    assert.equal(await engine.execute(params), '可用回复');
});

test('同一原文的重复或修订提案更新旧稿，不制造 overlap 循环', async () => {
    const first = [{ old_text: '第二段。', new_text: '版本一。' }];
    assert.deepEqual(mergeDocumentEdits(params.fileContent, first, first), first);
    const merged = mergeDocumentEdits(params.fileContent, first, [{ old_text: '第二段。', new_text: '版本二。' }]);
    assert.equal(merged.length, 1);
    assert.equal(applyDocumentEdits(params.fileContent, merged).content, '第一段。\n版本二。');
    const expanded = mergeDocumentEdits(params.fileContent, merged, [{ old_text: params.fileContent, new_text: '完整修改稿。' }]);
    assert.equal(expanded.length, 1);
    assert.equal(applyDocumentEdits(params.fileContent, expanded).content, '完整修改稿。');
    assert.throws(() => mergeDocumentEdits(params.fileContent, first, [{ old_text: '第二段。', new_text: 'A' }, { old_text: '二段。', new_text: 'B' }]), /overlap/);
});

test('用户取消后停止后续请求与工具执行，迟到的提案不回写', async () => {
    let active = true;
    let calls = 0;
    let updates = 0;
    const engine = new DocumentTaskEngine({ client: { complete: async () => {
        calls++;
        active = false;
        return tool('propose_document_edits', { edits: [{ old_text: '第二段。', new_text: '迟到结果。' }] });
    } } });
    await assert.rejects(engine.execute({ ...params, isActive: () => active, onDocumentEdits: () => updates++ }), { code: 'AI_TASK_CANCELLED' });
    assert.equal(calls, 1);
    assert.equal(updates, 0);
});

test('模型明确停止处理时不无限重试，保留可显示解释', async () => {
    let calls = 0;
    const engine = new DocumentTaskEngine({ client: { complete: async () => { calls++; return { content: '', rawBody: '{}', refusal: true }; } } });
    await assert.rejects(engine.execute(params), { code: 'AI_RESPONSE_REFUSED' });
    assert.equal(calls, 1);
    const explained = new DocumentTaskEngine({ client: { complete: async () => ({ content: '请换一种要求再试。', rawBody: '{}', refusal: true }) } });
    assert.equal(await explained.execute(params), '请换一种要求再试。');
});

test('连续恢复提示不积累消息，不强制模型停止工作', () => {
    const messages = [{ role: 'user', content: '用户任务' }];
    for (let attempt = 1; attempt <= 50; attempt++) continueAfterEmptyResponse(messages, attempt);
    assert.equal(messages.length, 2);
    assert.ok(messages.at(-1).content.includes('第 50 次'));
    assert.ok(messages.at(-1).content.includes('使用可用工具或给出最终回复'));
});
