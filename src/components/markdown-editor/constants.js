/**
 * MarkdownEditor 常量定义
 */

/**
 * 需要自动补齐收尾段落的节点类型
 * 避免列表/标题被强制追加空行
 */
export const TRAILING_PARAGRAPH_NODE_TYPES = new Set([
    'codeBlock',
    'table',
    'mermaidBlock',
    'htmlDiv',
    'horizontalRule',
]);

/**
 * 默认自动保存延迟（毫秒）
 */
export const DEFAULT_AUTO_SAVE_DELAY = 3000;

/**
 * 最小自动保存延迟（毫秒）
 */
export const MIN_AUTO_SAVE_DELAY = 500;
