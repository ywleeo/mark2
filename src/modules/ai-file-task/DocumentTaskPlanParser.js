const PRESENTATIONS = new Set(['answer', 'document']);
const OPERATIONS = new Set(['synthesize', 'transform']);
const MODES = new Set(['precise', 'creative']);

/**
 * 去掉模型常见的 JSON 代码围栏。
 * @param {string} text - 模型原始输出
 * @returns {string}
 */
function stripOuterFence(text) {
    const value = String(text || '').trim();
    const match = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    return (match ? match[1] : value).trim();
}

/**
 * 清理模型建议的临时 Markdown 文件名，避免目录穿越和非法路径字符。
 * @param {unknown} value - 原始文件名
 * @returns {string|null}
 */
export function sanitizeDocumentFilename(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    const name = value
        .trim()
        .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
        .replace(/^\.+/, '')
        .replace(/\s+/g, ' ')
        .slice(0, 120)
        .trim();
    if (!name) return null;
    return /\.md$/i.test(name) ? name : `${name}.md`;
}

/**
 * 解析轻量任务计划。计划只描述执行策略，不承载生成正文。
 * @param {string} text - 模型输出
 * @returns {{presentation:'answer'|'document',operation:'synthesize'|'transform',mode:'precise'|'creative',filename:string|null}}
 */
export function parseDocumentTaskPlan(text) {
    const raw = stripOuterFence(text);
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('Invalid document task plan');

    const parsed = JSON.parse(raw.slice(start, end + 1));
    if (!PRESENTATIONS.has(parsed?.presentation)
        || !OPERATIONS.has(parsed?.operation)
        || !MODES.has(parsed?.mode)) {
        throw new Error('Invalid document task plan');
    }

    return {
        presentation: parsed.presentation,
        operation: parsed.operation,
        mode: parsed.mode,
        filename: parsed.presentation === 'document'
            ? sanitizeDocumentFilename(parsed.filename)
            : null,
    };
}
