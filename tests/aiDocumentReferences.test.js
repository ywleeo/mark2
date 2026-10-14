/** 原文引用修改协议、任务耗时持久化与直接停止网络的回归。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { DocumentSourceReferences } from '../src/modules/ai-file-task/DocumentSourceReferences.js';
import { applyDocumentEdits } from '../src/modules/ai-file-task/DocumentEdits.js';
import { DocumentTaskEngine } from '../src/modules/ai-file-task/DocumentTaskEngine.js';
import { DocumentTaskSession } from '../src/modules/ai-file-task/DocumentTaskSession.js';
import { DocumentTaskTimer, formatTaskDuration } from '../src/modules/ai-file-task/DocumentTaskTimer.js';
import { DocumentTaskResultStore } from '../src/modules/ai-file-task/DocumentTaskResultStore.js';
import { requestDocumentTaskStream } from '../src/modules/ai-file-task/DocumentTaskStreamTransport.js';

/** 构造模型工具调用。 */
function tool(name, args) {
    return { content: '', rawBody: JSON.stringify({ choices: [{ message: { tool_calls: [{ id: 'fixture', type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] }) };
}

test('原文仅传输一次，顶层块保留代码/列表/表格和 CRLF，不要求模型计算位置', () => {
    const source = '# 标题\r\n\r\n段落。\r\n\r\n```js\r\nA\r\n\r\nB\r\n```\r\n\r\n- 项一\r\n- 项二\r\n\r\n| A | B |\r\n|---|---|\r\n| 1 | 2 |\r\n';
    const refs = new DocumentSourceReferences(source);
    const read = refs.read(0, source.length);
    assert.equal(read.blocks.map(block => block.content).join(''), source);
    assert.equal(read.blocks.length, 5);
    assert.equal(read.source_id, refs.read(0, source.length).source_id);
    assert.equal(applyDocumentEdits(source, refs.resolve([{ source_id: read.source_id, new_text: '整篇修改稿。' }])).content, '整篇修改稿。');
});

test('重复段落由引用精确区分，未知/过期引用和不一致原文整批拒绝', () => {
    const source = '相同段落。\n\n相同段落。\n';
    const refs = new DocumentSourceReferences(source);
    const read = refs.read(0, source.length);
    const edits = refs.resolve([{ source_id: read.blocks[1].source_id, new_text: '仅修改第二段。\n' }]);
    assert.equal(applyDocumentEdits(source, edits).content, '相同段落。\n\n仅修改第二段。\n');
    assert.throws(() => applyDocumentEdits('前面新增。\n' + source, edits), /missing/);
    assert.throws(() => refs.resolve([{ source_id: read.source_id, old_text: '改写的文字', new_text: 'x' }]), /missing/);
    assert.throws(() => new DocumentSourceReferences(source).resolve([{ source_id: read.source_id, new_text: 'x' }]), /unknown_source/);
    assert.throws(() => applyDocumentEdits(source, refs.resolve([{ source_id: read.source_id, new_text: 'x' }, { source_id: read.blocks[1].source_id, new_text: 'y' }])), /overlap/);
});

test('整篇排版读取、引用提交、最终回复即可完成，原文不需复制到工具参数', async () => {
    const source = '# 测试\n\n- 一句。\n- 二句。\n';
    let calls = 0;
    let edits;
    const engine = new DocumentTaskEngine({ client: { complete: async options => {
        calls++;
        assert.ok(calls <= 3);
        if (calls === 1) return tool('read_current_document', {});
        const read = JSON.parse(options.messages.find(message => message.role === 'tool').content);
        if (calls === 2) return tool('propose_document_edits', { edits: [{ source_id: read.source_id, new_text: '# 测试\n\n一句。二句。\n' }] });
        const result = JSON.parse(options.messages.at(-1).content);
        assert.equal(result.ok, true);
        assert.equal(result.status, 'awaiting_user_apply');
        return { content: '排版稿已准备好。', rawBody: '{}' };
    } } });
    assert.equal(await engine.execute({ filePath: '/fixture.md', fileContent: source, instruction: '改为段落式排版', onDocumentEdits: value => { edits = value; } }), '排版稿已准备好。');
    assert.equal(calls, 3);
    assert.equal(applyDocumentEdits(source, edits).content, '# 测试\n\n一句。二句。\n');
});

test('任务单调计时包含全部阶段，停止冻结、再次发送重新开始', () => {
    let time = 10;
    const ticks = [];
    const timer = new DocumentTaskTimer({ now: () => time, onTick: value => ticks.push(value) });
    try {
        timer.start(); time += 61234;
        assert.equal(formatTaskDuration(timer.elapsed()), '01:01');
        assert.equal(timer.stop(), 61234);
        time += 5000;
        assert.equal(timer.elapsed(), 61234);
        timer.start();
        assert.equal(timer.elapsed(), 0);
        assert.equal(formatTaskDuration(3661000), '01:01:01');
        assert.deepEqual(ticks, [0, 0]);
    } finally { timer.stop(); }
});

test('耗时与锚点跟随各自回复保存恢复，旧记录不伪造计时', () => {
    const values = new Map();
    const store = new DocumentTaskResultStore({ store: { get: (key, fallback) => values.get(key) || fallback, set: (key, value) => { values.set(key, value); return true; } } });
    store.set('/fixture.md', { content: '第二轮', messages: [
        { role: 'user', content: '第一问' }, { role: 'assistant', content: '第一轮', durationMs: 1234, edits: [{ old_text: 'a', new_text: 'b', from: 2 }] },
        { role: 'user', content: '第二问' }, { role: 'assistant', content: '第二轮' },
    ] });
    const replies = store.get('/fixture.md').messages;
    assert.equal(replies[1].durationMs, 1234);
    assert.equal(replies[1].edits[0].from, 2);
    assert.equal(replies[3].durationMs, undefined);
});

test('Stop 在无首包时立即取消代理、释放监听，不等轮询且迟到结果无效', async () => {
    const session = new DocumentTaskSession();
    const task = session.begin('/fixture.md');
    let callbacks;
    let cancels = 0;
    let cleaned = 0;
    const promise = requestDocumentTaskStream({ url: 'http://fixture', body: {}, signal: task.signal }, {
        startStream: async options => { callbacks = options; return () => cleaned++; },
        cancelStream: async () => { cancels++; }, checkIntervalMs: 60000,
    });
    await new Promise(resolve => setImmediate(resolve));
    session.cancel();
    await assert.rejects(promise, { code: 'AI_TASK_CANCELLED' });
    assert.equal(cleaned, 1);
    assert.ok(cancels >= 1);
    callbacks.onChunk('data: {"choices":[{"delta":{"content":"迟到"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
    assert.equal(session.isCurrent(task), false);
    assert.equal(session.begin('/fixture.md').signal.aborted, false);
});
