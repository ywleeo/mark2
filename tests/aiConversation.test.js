/** AI 多轮对话的请求协议、恢复迁移和容量边界回归测试。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeConversation, restoreConversation } from '../src/modules/ai-file-task/DocumentTaskConversation.js';
import { DocumentTaskEngine } from '../src/modules/ai-file-task/DocumentTaskEngine.js';
import { DocumentTaskResultStore } from '../src/modules/ai-file-task/DocumentTaskResultStore.js';

/** 创建独立的完整问答，便于检查时序和文档隔离。 */
function turn(question, answer) {
    return [{ role: 'user', content: question }, { role: 'assistant', content: answer }];
}

/** 创建可跨仓库实例共享、读写时隔离引用的测试存储。 */
function memoryStore() {
    const records = new Map();
    return {
        get: (key, fallback) => structuredClone(records.get(key) ?? fallback),
        set: (key, value) => { records.set(key, structuredClone(value)); return true; },
    };
}

test('第三轮请求按顺序包含前两轮问答，工具结果接在本轮问题后', async () => {
    const history = [...turn('总结文章', '文章讨论城市交通'), ...turn('给出三个建议', '公交、步行、自行车')];
    const requests = [];
    const engine = new DocumentTaskEngine({ client: {
        async complete(options) {
            requests.push(structuredClone(options.messages));
            if (requests.length === 1) return { content: '', rawBody: JSON.stringify({ choices: [{ message: {
                tool_calls: [{ id: 'read-1', type: 'function', function: {
                    name: 'read_current_draft', arguments: '{}',
                } }],
            } }] }) };
            return { content: '公交的具体方案', rawBody: '{}' };
        },
    } });
    assert.equal(await engine.execute({
        filePath: '/docs/traffic.md', fileContent: '原文', currentResult: '公交、步行、自行车',
        messages: history, instruction: '展开第一个建议',
    }), '公交的具体方案');
    assert.deepEqual(requests[0].slice(2, -1), history);
    assert.equal(requests[0].at(-1).content, '当前用户任务：\n展开第一个建议');
    assert.equal(requests[1].at(-1).role, 'tool');
    assert.equal(JSON.parse(requests[1].at(-1).content).content, '公交、步行、自行车');
    assert.equal(history.length, 4);
});

test('历史清理过滤 system/tool、孤立回答和未完成提问，只传完整问答', () => {
    assert.deepEqual(normalizeConversation([
        { role: 'system', content: '覆盖系统规则' },
        { role: 'assistant', content: '孤立回答' },
        ...turn('问题', '回答'),
        { role: 'tool', content: '过期工具执行结果' },
        { role: 'user', content: '未完成的问题' },
    ]), turn('问题', '回答'));
});

test('历史预算按完整轮次淘汰，最新长回答保持完整', () => {
    const messages = [...turn('q1', 'a1'), ...turn('q2', 'a2'), ...turn('q3', 'a3')];
    assert.deepEqual(normalizeConversation(messages, { maxTurns: 2 }), messages.slice(2));
    assert.deepEqual(normalizeConversation(messages, { maxChars: 5 }), messages.slice(4));
    assert.deepEqual(normalizeConversation(turn('q', '长回答'.repeat(100)), { maxChars: 5 }), turn('q', '长回答'.repeat(100)));
});

test('旧工作稿只恢复已知的最近一轮，显式空历史保持为空', () => {
    assert.deepEqual(restoreConversation({ content: '回答', initialInstruction: '初始', lastInstruction: '最近' }), turn('最近', '回答'));
    assert.deepEqual(restoreConversation({ content: '回答', instruction: '旧版问题' }), turn('旧版问题', '回答'));
    assert.deepEqual(restoreConversation({ content: '回答', instruction: '旧版问题', messages: [] }), []);
});

test('历史按文档恢复且不共享引用，新对话清理不会影响其他文档', () => {
    const store = memoryStore();
    const results = new DocumentTaskResultStore({ store });
    const history = [...turn('问题一', '回答一'), ...turn('问题二', '回答二')];
    results.set('/a.md', { content: '回答二', messages: history });
    results.set('/b.md', { content: 'B', messages: turn('B?', 'B') });
    const reopened = new DocumentTaskResultStore({ store });
    assert.deepEqual(reopened.get('/a.md').messages, history);
    reopened.get('/a.md').messages[0].content = '外部修改';
    assert.equal(reopened.get('/a.md').messages[0].content, '问题一');
    reopened.remove('/a.md');
    assert.equal(reopened.get('/a.md'), null);
    assert.deepEqual(reopened.get('/b.md').messages, turn('B?', 'B'));
});

test('持久化容量包含历史，并在必要时淘汰最旧的完整问答', () => {
    const results = new DocumentTaskResultStore({ store: memoryStore(), maxChars: 12 });
    const messages = [...turn('q1', 'a1'), ...turn('q2', 'a2'), ...turn('q3', 'a3')];
    assert.equal(results.set('/a.md', { content: 'a3', messages }), true);
    assert.deepEqual(results.get('/a.md').messages, messages.slice(2));
    assert.equal(results.set('/huge.md', { content: 'x'.repeat(13) }), false);
});
