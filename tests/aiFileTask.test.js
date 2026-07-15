import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDocumentContext } from '../src/modules/ai-file-task/DocumentContextBuilder.js';
import {
    createDocumentTaskAgentTools,
    parseDocumentTaskAgentTurn,
} from '../src/modules/ai-file-task/DocumentTaskAgentTools.js';
import { DocumentTaskEngine } from '../src/modules/ai-file-task/DocumentTaskEngine.js';
import { DocumentTaskSession } from '../src/modules/ai-file-task/DocumentTaskSession.js';
import { DocumentTaskResultStore } from '../src/modules/ai-file-task/DocumentTaskResultStore.js';

test('全文分块不裁剪正文，并尽量保持围栏代码块完整', () => {
    const source = `# 开头\n\n${'正文内容。'.repeat(60)}\n\n\`\`\`js\nconst value = 1;\n\`\`\`\n\n## 结尾\n最后一句。`;
    const context = buildDocumentContext(source, { targetChars: 120 });

    assert.equal(context.chunked, true);
    assert.equal(context.chunks.join(''), source);
    assert.equal(context.originalLength, source.length);
    assert.equal(context.chunks.some(chunk => chunk.includes('```js\nconst value = 1;\n```')), true);
});

/** 构造 OpenAI-compatible 工具调用响应。 */
function createToolResponse(name, args, id = 'call-1') {
    return JSON.stringify({
        choices: [{
            message: {
                content: null,
                tool_calls: [{
                    id,
                    type: 'function',
                    function: {
                        name,
                        arguments: JSON.stringify(args),
                    },
                }],
            },
        }],
    });
}

test('文档任务只向模型暴露能力，不提供任务类型枚举', () => {
    const tools = createDocumentTaskAgentTools();
    assert.deepEqual(tools.map(tool => tool.function.name), [
        'read_current_document',
        'read_current_draft',
        'read_initial_task',
        'run_subtask',
        'create_document',
    ]);
    assert.equal(JSON.stringify(tools).includes('context_scope'), false);
    assert.equal(JSON.stringify(tools).includes('synthesize'), false);
    assert.equal(JSON.stringify(tools).includes('transform'), false);
});

test('文档任务由模型主动读取资料，当前用户任务始终位于初始请求末尾', async () => {
    const calls = [];
    const client = {
        async complete(options) {
            calls.push(structuredClone(options));
            if (calls.length === 1) {
                const body = createToolResponse('read_current_document', { offset: 0, max_chars: 24000 });
                return { content: '', rawBody: body };
            }
            return { content: '根据文章内容生成的结尾。', rawBody: '{"choices":[{"message":{"content":"根据文章内容生成的结尾。"}}]}' };
        },
    };
    const engine = new DocumentTaskEngine({ client });
    const result = await engine.execute({
        filePath: '/docs/story.md',
        fileContent: '这是整篇文章的真实正文。',
        currentResult: '上一次工作稿',
        initialInstruction: '最初任务',
        instruction: '最后还能加什么内容，做一个结束',
    });

    assert.equal(result, '根据文章内容生成的结尾。');
    assert.equal(calls[0].messages.at(-1).content.endsWith('最后还能加什么内容，做一个结束'), true);
    assert.equal(calls[0].messages.some(message => message.content?.includes('真实正文')), false);
    assert.match(calls[1].messages.at(-1).content, /真实正文/);
});

test('模型可以自行规划子任务并在后续调用中综合结果', async () => {
    const calls = [];
    const client = {
        async complete(options) {
            calls.push(structuredClone(options));
            if (options.phase === 'subtask') {
                return { content: '子任务发现', rawBody: '{"choices":[{"message":{"content":"子任务发现"}}]}' };
            }
            if (calls.filter(call => call.phase === 'agent').length === 1) {
                return {
                    content: '',
                    rawBody: createToolResponse('run_subtask', { objective: '分析结尾方向', context: '文章摘要' }),
                };
            }
            return { content: '综合后的最终结果', rawBody: '{"choices":[{"message":{"content":"综合后的最终结果"}}]}' };
        },
    };
    const result = await new DocumentTaskEngine({ client }).execute({
        filePath: '/docs/story.md',
        fileContent: '正文',
        instruction: '完成结尾',
    });

    assert.equal(result, '综合后的最终结果');
    assert.equal(calls.some(call => call.phase === 'subtask'), true);
    assert.equal(calls.at(-1).messages.some(message => message.role === 'tool' && message.content === '子任务发现'), true);
});

test('模型可以自主创建新文档并获得真实执行结果', async () => {
    const calls = [];
    const created = [];
    const client = {
        async complete(options) {
            calls.push(structuredClone(options));
            if (calls.length === 1) {
                return {
                    content: '',
                    rawBody: createToolResponse('create_document', {
                        filename: '修改意见.md',
                        content: '# 修改意见\n\n- 调整结尾',
                    }),
                };
            }
            return { content: '已创建新文档。', rawBody: '{"choices":[{"message":{"content":"已创建新文档。"}}]}' };
        },
    };
    const result = await new DocumentTaskEngine({ client }).execute({
        filePath: '/docs/story.md',
        fileContent: '正文',
        currentResult: '- 调整结尾',
        instruction: '把这些意见写到新文档里',
        createDocument: async (document) => {
            created.push(document);
            return { path: 'untitled://修改意见.md' };
        },
    });

    assert.equal(result, '已创建新文档。');
    assert.deepEqual(created, [{ filename: '修改意见.md', content: '# 修改意见\n\n- 调整结尾' }]);
    assert.match(calls[1].messages.at(-1).content, /untitled:\/\/修改意见\.md/);
});

test('工具调用解析不从正文猜测模型决策', () => {
    const turn = parseDocumentTaskAgentTurn(createToolResponse('read_current_draft', { offset: 2, max_chars: 10 }));
    assert.equal(turn.toolCalls[0].name, 'read_current_draft');
    assert.deepEqual(turn.toolCalls[0].args, { offset: 2, max_chars: 10 });
    assert.equal(parseDocumentTaskAgentTurn('{"choices":[{"message":{"content":"直接回答"}}]}'), null);
});

test('关闭或重新打开面板后，旧文档任务会话立即失效', () => {
    const session = new DocumentTaskSession();
    const first = session.begin('/tmp/first.md');
    assert.equal(session.isCurrent(first), true);

    session.cancel();
    assert.equal(session.isCurrent(first), false);

    const second = session.begin('/tmp/second.md');
    assert.equal(session.isCurrent(second), true);
    assert.equal(second.sourcePath, '/tmp/second.md');
});

/** 创建可在多个仓库实例间共享的内存存储。 */
function createMemoryStore() {
    const values = new Map();
    return {
        get(key, fallback) {
            return values.has(key) ? structuredClone(values.get(key)) : fallback;
        },
        set(key, value) {
            values.set(key, structuredClone(value));
            return true;
        },
    };
}

test('AI 文档任务回答按文档持久化，并恢复原始 Markdown 和指令', () => {
    const storage = createMemoryStore();
    const firstStore = new DocumentTaskResultStore({ store: storage });
    firstStore.set('/docs/story.md', {
        content: '## 评价\n\n- 结构清晰',
        initialInstruction: '评价当前文章',
        lastInstruction: '把建议写得更具体',
        previousContent: '## 评价\n\n- 尚可',
        filename: 'story-review.md',
    });

    const restored = new DocumentTaskResultStore({ store: storage }).get('/docs/story.md');
    assert.equal(restored.content, '## 评价\n\n- 结构清晰');
    assert.equal(restored.initialInstruction, '评价当前文章');
    assert.equal(restored.lastInstruction, '把建议写得更具体');
    assert.equal(restored.previousContent, '## 评价\n\n- 尚可');
    assert.equal(restored.filename, 'story-review.md');
    assert.equal(new DocumentTaskResultStore({ store: storage }).get('/docs/other.md'), null);
});

test('AI 文档任务回答存储按最近使用顺序淘汰旧文档', () => {
    const storage = createMemoryStore();
    const resultStore = new DocumentTaskResultStore({ store: storage, maxEntries: 2 });
    resultStore.set('/docs/a.md', { content: 'A' });
    resultStore.set('/docs/b.md', { content: 'B' });
    resultStore.set('/docs/a.md', { content: 'A2' });
    resultStore.set('/docs/c.md', { content: 'C' });

    assert.equal(resultStore.get('/docs/a.md').content, 'A2');
    assert.equal(resultStore.get('/docs/b.md'), null);
    assert.equal(resultStore.get('/docs/c.md').content, 'C');
});

test('新文档任务开始时可删除已持久化的旧回答', () => {
    const storage = createMemoryStore();
    const resultStore = new DocumentTaskResultStore({ store: storage });
    resultStore.set('/docs/story.md', { content: '旧回答', instruction: '旧指令' });

    assert.equal(resultStore.remove('/docs/story.md'), true);
    assert.equal(resultStore.get('/docs/story.md'), null);
});
