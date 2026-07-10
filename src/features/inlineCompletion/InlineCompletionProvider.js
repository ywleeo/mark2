/**
 * 兼容入口：上下文构建与请求实现已拆分到独立模块。
 */
export { buildInlineCompletionContext } from './CompletionContextBuilder.js';
export { requestInlineCompletion } from './CompletionEngine.js';
