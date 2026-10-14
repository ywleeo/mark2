/** 文档任务恢复协议：继续原会话、不重放已执行工具，并把可恢复状态交给界面。 */

/** 创建不会携带模型正文或凭据的任务状态错误。 */
export function createDocumentTaskInterruption(code) {
    const error = new Error(code);
    error.code = code;
    return error;
}

/** 判断模型侧中断是否适合显示为保留输入的轻提示。 */
export function isRecoverableDocumentTaskError(error) {
    return ['AI_TASK_INCOMPLETE', 'AI_RESPONSE_REFUSED', 'AI_IDLE_TIMEOUT'].includes(error?.code);
}

/**
 * 空响应时在原上下文中追加恢复提示；连续空响应只更新最后一条提示，避免无限积累。
 * 提示不要求模型结束任务，由模型选择继续工具工作或给出最终回复。
 */
export function continueAfterEmptyResponse(messages, attempt) {
    const prefix = '响应恢复提示：';
    const content = `${prefix}第 ${attempt} 次响应没有可显示的回复，也没有可执行的工具调用。请根据已有上下文继续完成当前任务，使用可用工具或给出最终回复。已经成功的工具操作无需重复执行，修改清单仍等待用户点击应用；不要只输出思考过程。`;
    const last = messages.at(-1);
    if (last?.role === 'user' && last.content?.startsWith(prefix)) last.content = content;
    else messages.push({ role: 'user', content });
}
