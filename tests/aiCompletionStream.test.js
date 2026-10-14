/** 流式完成协议与请求生命周期回归，无真实网络或凭据。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { CompletionStream } from '../src/modules/ai-assistant/services/CompletionStream.js';
import { requestDocumentTaskStream } from '../src/modules/ai-file-task/DocumentTaskStreamTransport.js';
import { parseNonStreamingResponse } from '../src/modules/ai-assistant/services/nonStreamingResponseParser.js';
import { parseDocumentTaskAgentTurn } from '../src/modules/ai-file-task/DocumentTaskAgentTools.js';

/** 创建标准 SSE 数据事件。 */
function event(delta, finishReason = null) {
    return 'data: ' + JSON.stringify({ choices: [{ delta, finish_reason: finishReason }] }) + '\r\n\r\n';
}

/** 创建只用于模拟的请求。 */
function request() { return { url: 'http://fixture/v1/chat/completions', apiKey: 'fixture-key', body: { model: 'fixture' }, idleTimeoutMs: 5 }; }

test('任意文本分片还原中文正文，思考只计数，SSE 心跳不是正文', () => {
    const parser = new CompletionStream();
    const stream = ': heartbeat\r\n\r\n' + event({ reasoning_content: '只用于内部思考' }) + event({ content: '中文正文🌲' }, 'stop') + 'data: [DONE]\n\n';
    for (const character of stream) parser.push(character);
    const response = parser.finish();
    assert.equal(parseNonStreamingResponse(response.body).content, '中文正文🌲');
    assert.equal(response.reasoningLength, '只用于内部思考'.length);
    assert.ok(!response.body.includes('只用于内部思考'));
});

test('工具名字和 JSON 参数分片完整合并后才可执行，保持多个调用的顺序', () => {
    const parser = new CompletionStream();
    parser.push(event({ tool_calls: [{ index: 0, id: 'call-0', function: { name: 'propose_document_', arguments: '{"edits":[' } }] }));
    parser.push(event({ tool_calls: [{ index: 1, id: 'call-1', function: { name: 'read_current_document', arguments: '{}' } }, { index: 0, function: { name: 'edits', arguments: '{"old_text":"旧段", "new_text":"新段"}]}' } }] }, 'tool_calls'));
    parser.push('data: [DONE]\n\n');
    const turn = parseDocumentTaskAgentTurn(parser.finish().body);
    assert.deepEqual(turn.toolCalls.map(call => call.name), ['propose_document_edits', 'read_current_document']);
    assert.deepEqual(turn.toolCalls[0].args.edits, [{ old_text: '旧段', new_text: '新段' }]);
});

test('兼容网关返回普通 JSON；中断的 SSE 不当成完整回复', () => {
    const body = JSON.stringify({ choices: [{ message: { content: 'JSON 兼容回复' } }] });
    const parser = new CompletionStream();
    for (const character of body) parser.push(character);
    assert.equal(parser.finish().body, body);
    const partial = new CompletionStream();
    partial.push(event({ content: '半截正文' }));
    assert.throws(() => partial.finish(), { code: 'AI_RESPONSE_INCOMPLETE' });
});

test('生成总时长超过 idle 数值不会由前端误截断，后端是无数据计时的唯一来源', async () => {
    let cleanupCount = 0;
    const result = await requestDocumentTaskStream(request(), {
        startStream: async options => {
            assert.equal(options.body.stream, true);
            assert.equal(options.idleTimeoutMs, 5);
            setTimeout(() => options.onChunk(event({ reasoning_content: '持续思考' })), 10);
            setTimeout(() => options.onChunk(event({ content: '最终回复' }, 'stop') + 'data: [DONE]\n\n'), 30);
            return () => cleanupCount++;
        },
        cancelStream: async () => true,
    });
    assert.equal(parseNonStreamingResponse(result.body).content, '最终回复');
    assert.equal(cleanupCount, 1);
});

test('后端无响应超时成为可恢复的状态，不混淆为生成总时限', async () => {
    await assert.rejects(requestDocumentTaskStream(request(), {
        startStream: async options => { queueMicrotask(() => options.onError('AI_IDLE_TIMEOUT: no response data')); return () => {}; },
        cancelStream: async () => true,
    }), { code: 'AI_IDLE_TIMEOUT' });
});

test('结束事件早于启动返回时也会释放晚到的监听，并取消已经完成的后端连接', async () => {
    let cleanups = 0;
    let cancels = 0;
    const promise = requestDocumentTaskStream(request(), {
        startStream: async options => {
            options.onChunk(event({ content: '已完成' }, 'stop') + 'data: [DONE]\n\n');
            return () => cleanups++;
        },
        cancelStream: async () => { cancels++; return true; },
    });
    await promise;
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(cleanups, 1);
    assert.ok(cancels >= 1);
});

test('任务失效时不启动请求；等待流数据时取消也会清理监听', async () => {
    await assert.rejects(requestDocumentTaskStream({ ...request(), isActive: () => false }, {
        startStream: () => assert.fail('must not start'), cancelStream: async () => true,
    }), { code: 'AI_TASK_CANCELLED' });
    let active = true;
    let cleanup = 0;
    const promise = requestDocumentTaskStream({ ...request(), isActive: () => active }, {
        checkIntervalMs: 1,
        startStream: async () => { active = false; return () => cleanup++; },
        cancelStream: async () => true,
    });
    await assert.rejects(promise, { code: 'AI_TASK_CANCELLED' });
    assert.equal(cleanup, 1);
});

test('SSE 的 BOM、CR 换行与多行 data 事件兼容', () => {
    const parser = new CompletionStream();
    const raw = '\uFEFFdata: {\rdata: "choices":[{"delta":{"content":"正确正文"},"finish_reason":"stop"}]}\r\rdata: [DONE]\r\r';
    for (const character of raw) parser.push(character);
    assert.equal(parseNonStreamingResponse(parser.finish().body).content, '正确正文');
});

test('服务商明确返回错误不伪装成空回复恢复，错误中的测试密钥遮罩', async () => {
    await assert.rejects(requestDocumentTaskStream(request(), {
        startStream: async options => {
            queueMicrotask(() => options.onChunk('data: {"error":{"message":"invalid fixture-key"}}\n\n'));
            return () => {};
        },
        cancelStream: async () => true,
    }), error => error.code === 'AI_PROVIDER_ERROR' && !error.message.includes('fixture-key'));
});
