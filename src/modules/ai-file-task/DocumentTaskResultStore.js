import { createStore } from '../../services/storage.js';

const RECORDS_KEY = 'documents';
const DEFAULT_MAX_ENTRIES = 30;
const DEFAULT_MAX_CHARS = 750_000;

/**
 * 按文档持久化 AI 文档任务的最后一次面板回答。
 * 采用有界 LRU 列表，避免模型长回答持续占用 localStorage。
 */
export class DocumentTaskResultStore {
    /**
     * @param {object} [options] - 存储配置
     * @param {{get:Function,set:Function}} [options.store] - 可注入存储，便于测试
     * @param {number} [options.maxEntries] - 最多保留的文档数
     * @param {number} [options.maxChars] - 所有回答的字符预算
     */
    constructor(options = {}) {
        this.store = options.store || createStore('ai-file-task-results', { version: 1 });
        this.maxEntries = options.maxEntries || DEFAULT_MAX_ENTRIES;
        this.maxChars = options.maxChars || DEFAULT_MAX_CHARS;
    }

    /** 读取指定文档最后一次有效回答。 */
    get(path) {
        if (!path) return null;
        const record = this.readRecords().find(item => item.path === path);
        if (!record) return null;
        return {
            content: record.content,
            instruction: record.instruction,
            updatedAt: record.updatedAt,
        };
    }

    /**
     * 保存指定文档的最后一次回答，并淘汰最旧记录。
     * 超过总容量的单条回答不会被截断保存，避免恢复出不完整内容。
     */
    set(path, { content, instruction = '' }) {
        const normalizedContent = String(content || '').trim();
        const normalizedInstruction = String(instruction || '');
        if (
            !path
            || !normalizedContent
            || normalizedContent.length + normalizedInstruction.length > this.maxChars
        ) return false;

        const nextRecord = {
            path,
            content: normalizedContent,
            instruction: normalizedInstruction,
            updatedAt: Date.now(),
        };
        const records = [
            nextRecord,
            ...this.readRecords().filter(item => item.path !== path),
        ];
        const bounded = [];
        let totalChars = 0;
        for (const record of records) {
            const recordChars = record.content.length + record.instruction.length;
            if (bounded.length >= this.maxEntries || totalChars + recordChars > this.maxChars) continue;
            bounded.push(record);
            totalChars += recordChars;
        }
        return this.store.set(RECORDS_KEY, bounded);
    }

    /** 从持久层读取并清理无效记录。 */
    readRecords() {
        const records = this.store.get(RECORDS_KEY, []);
        if (!Array.isArray(records)) return [];
        return records.filter(record => (
            record
            && typeof record.path === 'string'
            && typeof record.content === 'string'
            && record.content.trim()
        ));
    }
}
