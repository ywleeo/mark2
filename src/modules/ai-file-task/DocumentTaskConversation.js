import { restoreDocumentEdits } from './DocumentEdits.js';
/** 文档 AI 对话协议：只保留完整问答，并限制历史上下文的大小。 */
const MAX_TURNS = 20;
const MAX_HISTORY_CHARS = 120_000;

/** 修改提案与消息正文一起计入历史预算，不增加无提案消息的开销。 */
function countMessageChars(message) {
    return message.content.length + (message.edits ? JSON.stringify(message.edits).length : 0);
}

/**
 * 清理历史消息并按完整问答淘汰最旧内容，禁止持久层注入 system/tool 消息。
 * 最新一轮始终完整保留；超长回答由存储层的总容量规则处理，不截断正文。
 * @param {Array} messages - 原始问答消息
 * @param {{maxTurns?:number,maxChars?:number}} [options] - 历史预算
 * @returns {Array<{role:'user'|'assistant',content:string}>} 独立的消息快照
 */
export function normalizeConversation(messages, { maxTurns = MAX_TURNS, maxChars = MAX_HISTORY_CHARS } = {}) {
    const turns = [];
    let pendingUser = null;
    for (const message of Array.isArray(messages) ? messages : []) {
        if (typeof message?.content !== 'string' || !message.content.trim()) continue;
        if (message.role === 'user') pendingUser = { role: 'user', content: message.content };
        if (message.role === 'assistant' && pendingUser) {
            const reply = { role: 'assistant', content: message.content };
            if (Number.isFinite(message.durationMs) && message.durationMs >= 0) reply.durationMs = message.durationMs;
            const edits = restoreDocumentEdits(message.edits);
            if (edits.length) reply.edits = edits;
            turns.push([pendingUser, reply]);
            pendingUser = null;
        }
    }
    let totalChars = turns.flat().reduce((sum, message) => sum + countMessageChars(message), 0);
    while (turns.length > 1 && (turns.length > maxTurns || totalChars > maxChars)) {
        const removed = turns.shift();
        totalChars -= removed.reduce((sum, message) => sum + countMessageChars(message), 0);
    }
    return turns.flat();
}

/**
 * 从旧工作稿恢复唯一可确认的最近一轮，不编造已丢失的早期对话。
 * @param {object|null} record - 已保存的文档 AI 状态
 * @returns {Array<{role:'user'|'assistant',content:string}>} 对话历史
 */
export function restoreConversation(record) {
    if (Array.isArray(record?.messages)) return normalizeConversation(record.messages);
    const instruction = record?.lastInstruction || record?.initialInstruction || record?.instruction;
    return normalizeConversation(instruction && record?.content ? [
        { role: 'user', content: instruction },
        { role: 'assistant', content: record.content },
    ] : []);
}
