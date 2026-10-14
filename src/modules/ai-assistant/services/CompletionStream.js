/** 将 SSE 正文、思考活动和工具参数增量合并成完整 Chat Completions 结果。 */
import { parseStreamData } from './streamParser.js';

/** 把协议中断交给调用方恢复，不回显半包 JSON 或思考正文。 */
function incompleteResponse() {
    return Object.assign(new Error('AI_RESPONSE_INCOMPLETE'), { code: 'AI_RESPONSE_INCOMPLETE' });
}

/** 增量解析器只保留正文和工具参数，思考内容仅统计长度。 */
export class CompletionStream {
    /** 初始化单次模型响应的解析状态。 */
    constructor() {
        this.buffer = '';
        this.mode = null;
        this.dataLines = [];
        this.content = '';
        this.reasoningLength = 0;
        this.calls = new Map();
        this.finishReason = '';
        this.completionTokens = null;
        this.refusal = false;
        this.done = false;
    }

    /** 接收任意边界的文本块；心跳不产生正文，但网络侧仍按收到数据重置计时。 */
    push(chunk) {
        if (this.done) return;
        this.buffer += chunk;
        if (!this.mode) {
            this.buffer = this.buffer.replace(/^\uFEFF/, '');
            const prefix = this.buffer.trimStart();
            if (/^[{\[]/.test(prefix)) this.mode = 'json';
            else if (/^(?:data:|event:|id:|retry:|:)/.test(prefix) || prefix.includes('\n')) this.mode = 'sse';
            else return;
        }
        if (this.mode === 'json') return;
        let newline;
        while ((newline = this.buffer.search(/[\r\n]/)) >= 0 && !this.done) {
            // CR 位于块尾时等待下一块，以免把跨块 CRLF 错当成两个换行。
            if (this.buffer[newline] === '\r' && newline === this.buffer.length - 1) break;
            const length = this.buffer.slice(newline, newline + 2) === '\r\n' ? 2 : 1;
            const line = this.buffer.slice(0, newline);
            this.buffer = this.buffer.slice(newline + length);
            this.readLine(line);
        }
    }

    /** 收集一个 SSE 事件的 data 行，忽略心跳、事件名与重连元数据。 */
    readLine(line) {
        if (!line) this.readEvent();
        else if (line.startsWith('data:')) this.dataLines.push(line.slice(5).replace(/^ /, ''));
    }

    /** 合并一个完整事件，支持工具参数分片与旧 function_call 增量。 */
    readEvent() {
        if (!this.dataLines.length) return;
        const data = this.dataLines.join('\n');
        this.dataLines = [];
        if (data.trim() === '[DONE]') { this.done = true; return; }
        let payload;
        try { payload = JSON.parse(data); } catch { throw incompleteResponse(); }
        if (payload.error) {
            const error = new Error(String(payload.error.message || 'AI provider returned an error'));
            error.code = 'AI_PROVIDER_ERROR';
            throw error;
        }
        const choice = payload.choices?.[0];
        const delta = choice?.delta || choice?.message || {};
        const parsed = parseStreamData(JSON.stringify({ choices: [{ delta }] }));
        this.content += parsed.answerDelta;
        this.reasoningLength += parsed.reasoningDelta.length;
        this.refusal ||= Boolean(delta.refusal);
        this.finishReason = choice?.finish_reason || this.finishReason;
        if (Number.isFinite(payload.usage?.completion_tokens)) this.completionTokens = payload.usage.completion_tokens;
        const calls = parsed.toolCallDeltas || (delta.function_call ? [{ index: 0, id: 'legacy-call', function: delta.function_call }] : []);
        for (const deltaCall of calls) {
            const index = deltaCall.index || 0;
            const call = this.calls.get(index) || { id: '', type: 'function', function: { name: '', arguments: '' } };
            if (deltaCall.id && call.id !== deltaCall.id) call.id += deltaCall.id;
            const name = deltaCall.function?.name;
            if (name && call.function.name !== name) call.function.name += name;
            call.function.arguments += deltaCall.function?.arguments || '';
            this.calls.set(index, call);
        }
    }

    /** 只返回完整结果；网关忽略 stream=true 时兼容标准 JSON 响应。 */
    finish() {
        if (this.mode !== 'sse') {
            try { JSON.parse(this.buffer); } catch { throw incompleteResponse(); }
            return { body: this.buffer };
        }
        if (this.buffer.trim() && !this.done) this.readLine(this.buffer.replace(/\r$/, ''));
        if (!this.done) this.readEvent();
        if (!this.done && !this.finishReason) throw incompleteResponse();
        const message = { role: 'assistant', content: this.content };
        if (this.refusal) message.refusal = true;
        if (this.calls.size) message.tool_calls = [...this.calls.entries()].sort(([a], [b]) => a - b).map(([index, call]) => ({ ...call, id: call.id || `stream-call-${index}` }));
        return {
            body: JSON.stringify({ choices: [{ message, finish_reason: this.finishReason || 'stop' }], usage: { completion_tokens: this.completionTokens } }),
            reasoningLength: this.reasoningLength,
        };
    }
}
