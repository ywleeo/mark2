import { t } from '../../i18n/index.js';
import { DocumentTaskClient } from './DocumentTaskClient.js';
import { DocumentTaskEngine } from './DocumentTaskEngine.js';
import { DocumentTaskPlanner } from './DocumentTaskPlanner.js';

/**
 * AI 文档任务门面：先规划任务，再用独立执行引擎生成 Markdown 正文。
 */
export class AiFileTaskService {
    /**
     * @param {{planner?:DocumentTaskPlanner,engine?:DocumentTaskEngine,client?:DocumentTaskClient}} [options] - 依赖注入
     */
    constructor(options = {}) {
        const client = options.client || new DocumentTaskClient();
        this.planner = options.planner || new DocumentTaskPlanner({ client });
        this.engine = options.engine || new DocumentTaskEngine({ client });
    }

    /**
     * 根据用户自由指令处理完整文档。
     * @param {{filePath:string,fileContent:string,instruction:string}} options - 任务参数
     * @returns {Promise<{action:'show_answer'|'open_document',filename:string|null,content:string}>}
     */
    async runFileTask({ filePath, fileContent, instruction }) {
        const trimmedInstruction = String(instruction || '').trim();
        if (!trimmedInstruction) throw new Error(t('aiFileTask.error.emptyInstruction'));

        const plan = await this.planner.plan({ filePath, instruction: trimmedInstruction });
        const content = await this.engine.execute({
            filePath,
            fileContent: String(fileContent || ''),
            instruction: trimmedInstruction,
            plan,
        });
        if (!content.trim()) throw new Error(t('aiFileTask.error.noContent'));

        return {
            action: plan.presentation === 'document' ? 'open_document' : 'show_answer',
            filename: plan.filename,
            content: content.trim(),
        };
    }
}
