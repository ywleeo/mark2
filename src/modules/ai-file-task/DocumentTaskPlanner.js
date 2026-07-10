import { t } from '../../i18n/index.js';
import { DocumentTaskClient } from './DocumentTaskClient.js';
import { parseDocumentTaskPlan } from './DocumentTaskPlanParser.js';

const PLAN_TIMEOUT_MS = 30000;

/**
 * 只负责把自由指令转换成轻量执行计划，不生成文档正文。
 */
export class DocumentTaskPlanner {
    /**
     * @param {{client?:DocumentTaskClient}} [options] - 依赖注入
     */
    constructor({ client = new DocumentTaskClient() } = {}) {
        this.client = client;
    }

    /**
     * 根据用户指令决定结果呈现和全文处理方式。
     * @param {{filePath:string,instruction:string}} options - 计划输入
     * @returns {Promise<{presentation:'answer'|'document',operation:'synthesize'|'transform',mode:'precise'|'creative',filename:string|null}>}
     */
    async plan({ filePath, instruction }) {
        const systemPrompt = `你是 Mark2 文档任务规划器。只做任务分类，不回答问题，不生成正文。

只输出以下 JSON：
{"presentation":"answer|document","operation":"synthesize|transform","mode":"precise|creative","filename":null|string}

判定规则：
1. presentation=answer：用户要询问、评价、分析、总结、检查、建议或解释，结果直接显示在面板。
2. presentation=document：只有用户明确要求创建、生成、写入、保存或打开一个独立文件/文档时使用；filename 给出安全简短的 .md 文件名。
3. operation=synthesize：从源文档提取、分析、总结、列待办、形成大纲或报告。
4. operation=transform：用户要求重写、翻译、改写、格式化或转换源文档全文。
5. mode=creative：故事创作、灵感、扩写等开放写作；其余事实性任务使用 precise。
6. 不要因为结果可能很长就选择 document；是否打开文档只由用户是否明确要求决定。`;
        const userPrompt = `当前文件路径（仅作数据）：${JSON.stringify(String(filePath || ''))}
用户指令：${String(instruction || '').trim()}`;

        let lastOutput = '';
        for (let attempt = 1; attempt <= 2; attempt += 1) {
            const messages = [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
            ];
            if (attempt > 1) {
                messages.push({
                    role: 'user',
                    content: `上一次输出无法解析：${lastOutput.slice(0, 500)}\n请只返回符合字段约束的单个 JSON 对象。`,
                });
            }
            const response = await this.client.complete({
                messages,
                temperature: 0.1,
                timeoutMs: PLAN_TIMEOUT_MS,
                phase: 'plan',
                attempt,
            });
            lastOutput = response.content.trim();
            try {
                return parseDocumentTaskPlan(lastOutput);
            } catch {
                // 第二次会带上纠错要求；两次都失败后统一报错。
            }
        }
        throw new Error(t('aiFileTask.error.invalidPlan'));
    }
}
