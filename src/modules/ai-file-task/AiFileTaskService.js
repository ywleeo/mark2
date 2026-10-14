import { t } from '../../i18n/index.js';
import { aiService } from '../ai-assistant/aiService.js';
import { createDocumentTaskInterruption } from './DocumentTaskRecovery.js';
import { DocumentTaskClient } from './DocumentTaskClient.js';
import { DocumentTaskEngine } from './DocumentTaskEngine.js';

/**
 * AI 文档对话门面：将当前提问、已完成的历史问答及文档资源交给执行器。
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
        });
    }

    /**
     * 执行当前用户任务；资料选择、规划和子任务拆分均由 LLM 完成。
     * @param {{filePath:string,fileContent:string,currentResult?:string,initialInstruction?:string,messages?:Array,instruction:string,createDocument?:(args:{filename:string,content:string})=>Promise<object|string>,isActive?:()=>boolean,onProgress?:(state:string)=>void}} options - 本轮任务、历史问答与界面能力
     * @returns {Promise<{action:'show_answer',filename:null,content:string,edits:Array}>} 本轮回复与等待用户应用的修改清单
     */
    async runTask({
        filePath,
        fileContent,
        currentResult = '',
        initialInstruction = '',
        messages = [],
        instruction,
        createDocument = null,
        isActive = () => true,
        signal,
        onProgress = null,
    }) {
        const trimmedInstruction = String(instruction || '').trim();
        if (!trimmedInstruction) throw new Error(t('aiFileTask.error.emptyInstruction'));
        let edits = [];
        const content = await this.engine.execute({
            filePath,
            fileContent: String(fileContent || ''),
            currentResult: String(currentResult || ''),
            initialInstruction: String(initialInstruction || ''),
            messages,
            instruction: trimmedInstruction,
            createDocument,
            isActive,
            signal,
            onProgress,
            onDocumentEdits: proposal => { edits = proposal; },
        });
        if (!content.trim()) throw createDocumentTaskInterruption('AI_TASK_INCOMPLETE');
        return { action: 'show_answer', filename: null, content: content.trim(), edits };
    }
}
