/**
 * AI 生成可写回文档的 Markdown 时必须遵守的语法合同。
 * 这里只约束模型输出，不在客户端解析或改写用户正文。
 */
export const AI_MARKDOWN_OUTPUT_RULES = `Markdown 语法要求：
1. 强调标记必须紧贴内容：使用 *斜体*、**加粗**、***加粗斜体***，禁止输出 * 文本 *、** 文本 ** 或带反斜杠的 \\*文本\\*。
2. 引用中的强调同样必须紧贴正文，例如：> ***（痛点）*** *因为这是正文。*
3. 列表、引用、标题和任务项必须使用合法 Markdown；不要把 Markdown 标记作为可见正文输出。
4. 除非用户明确要求展示 Markdown 源码，否则不要转义用于排版的 Markdown 标记。`;

/**
 * 将统一 Markdown 语法合同追加到具体 AI 任务提示词。
 * @param {string} instruction - 任务自身的系统提示词
 * @returns {string} 包含统一语法合同的完整提示词
 */
export function withAiMarkdownOutputRules(instruction) {
    return `${String(instruction || '').trim()}\n\n${AI_MARKDOWN_OUTPUT_RULES}`.trim();
}
