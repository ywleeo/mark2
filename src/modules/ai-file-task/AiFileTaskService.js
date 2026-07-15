import { t } from '../../i18n/index.js';
import { aiService } from '../ai-assistant/aiService.js';
import { DocumentTaskClient } from './DocumentTaskClient.js';
import { DocumentTaskEngine } from './DocumentTaskEngine.js';

/**
 * AI 文档任务门面：把每次提示词作为独立当前任务交给自主执行器。
 */
export class AiFileTaskService {
    /**
     * @param {{engine?:DocumentTaskEngine,client?:DocumentTaskClient}} [options] - 依赖注入
     */
    constructor(options = {}) {
        const client = options.client || new DocumentTaskClient();
        this.engine = options.engine || new DocumentTaskEngine({
            client,
            getTemperature: () => aiService.getTemperature(),
            createNoContentError: () => new Error(t('aiFileTask.error.noContent')),
        });
    }

    /**
     * 执行当前用户任务；资料选择、规划和子任务拆分均由 LLM 完成。
     * @param {{filePath:string,fileContent:string,currentResult?:string,initialInstruction?:string,instruction:string,createDocument?:(args:{filename:string,content:string})=>Promise<object|string>}} options - 本轮任务与界面能力
     * @returns {Promise<{action:'show_answer',filename:null,content:string}>} 本轮完整结果
     */
    async runTask({
        filePath,
        fileContent,
        currentResult = '',
        initialInstruction = '',
        instruction,
        createDocument = null,
    }) {
        const trimmedInstruction = String(instruction || '').trim();
        if (!trimmedInstruction) throw new Error(t('aiFileTask.error.emptyInstruction'));
        const content = await this.engine.execute({
            filePath,
            fileContent: String(fileContent || ''),
            currentResult: String(currentResult || ''),
            initialInstruction: String(initialInstruction || ''),
            instruction: trimmedInstruction,
            createDocument,
        });
        if (!content.trim()) throw new Error(t('aiFileTask.error.noContent'));
        return { action: 'show_answer', filename: null, content: content.trim() };
    }
}
