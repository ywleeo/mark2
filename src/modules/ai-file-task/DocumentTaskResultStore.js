import { createStore } from '../../services/storage.js';
import { restoreConversation } from './DocumentTaskConversation.js';

const RECORDS_KEY = 'documents';
const DEFAULT_MAX_ENTRIES = 30;
const DEFAULT_MAX_CHARS = 750_000;

/** 统计完整记录字符数，历史问答与编辑草稿都计入存储预算。 */
function countRecordChars(record) {
    return ['content', 'initialInstruction', 'instruction', 'lastInstruction', 'previousContent', 'filename']
        .reduce((sum, key) => sum + String(record[key] || '').length, 0)
        + restoreConversation(record).reduce((sum, message) => sum + message.content.length, 0);
}

/**
 * 磁盘文档持久化 AI 对话；临时文档只在本实例内保留当前生命周期的多轮问答。
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
        this.temporaryRecords = [];
    }

    /** 临时文档只读取本次使用中的问答，绝不读取持久层的旧聊天。 */
    get(path, documentId = '') {
        if (!path) return null;
        const records = path.startsWith('untitled://') ? this.temporaryRecords : this.readRecords();
        const record = records.find(item => item.path === path);
        if (!record) return null;
        if (path.startsWith('untitled://') && (!documentId || record.documentId !== documentId)) return null;
        return {
            content: record.content,
            initialInstruction: record.initialInstruction || record.instruction || '',
            lastInstruction: record.lastInstruction || '',
            previousContent: record.previousContent || '',
            filename: record.filename || '',
            messages: restoreConversation(record),
            updatedAt: record.updatedAt,
        };
    }

    /**
     * 保存指定文档的最后一次回答，并淘汰最旧记录。
     * 超过总容量的单条回答不会被截断保存，避免恢复出不完整内容。
     */
    set(path, {
        content,
        initialInstruction = '',
        lastInstruction = '',
        previousContent = '',
        filename = '',
        instruction = '',
        messages,
        documentId = '',
    }) {
        const normalizedContent = String(content || '').trim();
        const normalizedInitialInstruction = String(initialInstruction || instruction || '');
        const normalizedLastInstruction = String(lastInstruction || '');
        const normalizedPreviousContent = String(previousContent || '');
        const normalizedFilename = String(filename || '');
        const nextRecord = {
            path,
            documentId,
            content: normalizedContent,
            initialInstruction: normalizedInitialInstruction,
            lastInstruction: normalizedLastInstruction,
            previousContent: normalizedPreviousContent,
            filename: normalizedFilename,
            updatedAt: Date.now(),
        };
        nextRecord.messages = restoreConversation({ ...nextRecord, messages });
        // 存储预算不足时先逐轮淘汰旧历史，最新完整回答与工作稿不截断。
        while (nextRecord.messages.length > 2 && countRecordChars(nextRecord) > this.maxChars) {
            nextRecord.messages.splice(0, 2);
        }
        if (!path || !normalizedContent || countRecordChars(nextRecord) > this.maxChars) return false;
        if (path.startsWith('untitled://') && !documentId) return false;
        const temporary = path.startsWith('untitled://');
        const records = [
            nextRecord,
            ...(temporary ? this.temporaryRecords : this.readRecords()).filter(item => item.path !== path),
        ];
        const bounded = [];
        let totalChars = 0;
        for (const record of records) {
            const currentRecordChars = countRecordChars(record);
            if (bounded.length >= this.maxEntries || totalChars + currentRecordChars > this.maxChars) continue;
            bounded.push(record);
            totalChars += currentRecordChars;
        }
        if (temporary) {
            this.temporaryRecords = bounded;
            return true;
        }
        return this.store.set(RECORDS_KEY, bounded);
    }

    /** 删除指定文档的旧回答，用于新任务开始时清理过期结果。 */
    remove(path) {
        if (!path) return false;
        if (path.startsWith('untitled://')) {
            this.temporaryRecords = this.temporaryRecords.filter(item => item.path !== path);
            return true;
        }
        const records = this.readRecords();
        const nextRecords = records.filter(item => item.path !== path);
        if (nextRecords.length === records.length) return true;
        return this.store.set(RECORDS_KEY, nextRecords);
    }

    /** 从持久层读取并清理无效记录。 */
    readRecords() {
        const records = this.store.get(RECORDS_KEY, []);
        if (!Array.isArray(records)) return [];
        return records.filter(record => (
            record
            && typeof record.path === 'string'
            && !record.path.startsWith('untitled://')
            && typeof record.content === 'string'
            && record.content.trim()
        ));
    }
}
