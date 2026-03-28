/**
 * Agent 工具定义 + 执行器
 *
 * 设计原则：
 * - 让 agent 自主决定用哪些工具，不预先注入文档内容
 * - 支持分块读取，避免大文件一次性撑满上下文
 * - 工具格式遵循 OpenAI function calling 规范
 */

import { readFile, writeFile, deleteEntry, renameEntry, listDirectory, createDirectory } from '../../api/filesystem.js';

export const TOOL_DEFINITIONS = [
    // ── 当前文档：信息 / 分块读 / 搜索 / 写入 ──────────────

    {
        type: 'function',
        function: {
            name: 'get_document_info',
            description: '获取当前文档的元信息：路径、总行数、字符数、前10行预览。用于了解文档规模，决定后续读取策略。',
            parameters: { type: 'object', properties: {}, required: [] },
        },
    },
    {
        type: 'function',
        function: {
            name: 'read_document_lines',
            description: '按行范围读取当前文档内容（行号从 1 开始）。适合分块理解大文件。',
            parameters: {
                type: 'object',
                properties: {
                    start_line: { type: 'integer', description: '起始行（含），从 1 开始' },
                    end_line: { type: 'integer', description: '结束行（含）' },
                },
                required: ['start_line', 'end_line'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'search_in_document',
            description: '在当前文档中搜索关键词，返回匹配的行号和上下文。用于快速定位特定内容。',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: '要搜索的关键词或短语' },
                    context_lines: { type: 'integer', description: '每个匹配结果上下各显示几行，默认 2' },
                },
                required: ['query'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'write_current_document',
            description: '将新内容写入当前打开的文档。会先展示 diff 供用户确认后才实际写入。',
            parameters: {
                type: 'object',
                properties: {
                    content: { type: 'string', description: '文档的完整新内容' },
                },
                required: ['content'],
            },
        },
    },

    // ── 任意文件：读 / 写 ────────────────────────────────────

    {
        type: 'function',
        function: {
            name: 'read_file',
            description: '读取指定路径文件的完整内容。建议先用 get_document_info 了解文件大小再决定是否全量读取。',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: '文件的绝对路径' },
                },
                required: ['path'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'write_file',
            description: '将内容写入指定路径的文件（不存在则创建）',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: '文件的绝对路径' },
                    content: { type: 'string', description: '要写入的内容' },
                },
                required: ['path', 'content'],
            },
        },
    },

    // ── 文件管理 ─────────────────────────────────────────────

    {
        type: 'function',
        function: {
            name: 'list_directory',
            description: '列出指定目录下的所有文件和子目录',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: '目录的绝对路径' },
                },
                required: ['path'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'delete_file',
            description: '删除指定路径的文件或目录。执行前会请求用户确认。',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: '要删除的文件或目录的绝对路径' },
                },
                required: ['path'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'rename_file',
            description: '重命名或移动文件/目录',
            parameters: {
                type: 'object',
                properties: {
                    old_path: { type: 'string', description: '当前绝对路径' },
                    new_path: { type: 'string', description: '新绝对路径' },
                },
                required: ['old_path', 'new_path'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'create_directory',
            description: '创建新目录（包括必要的父目录）',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: '新目录的绝对路径' },
                },
                required: ['path'],
            },
        },
    },
];

// ── 内部辅助 ─────────────────────────────────────────────────

function getLines(content) {
    // 保证尾部不多一个空行
    return content.endsWith('\n')
        ? content.slice(0, -1).split('\n')
        : content.split('\n');
}

/**
 * 创建工具执行器
 *
 * @param {Object} options
 * @param {() => string|null} options.getCurrentFile
 * @param {() => string|null} options.getCurrentContent - 从编辑器内存读取（优先于磁盘）
 * @param {(p: {path,oldContent,newContent}) => Promise<{applied:boolean}>} options.onWriteCurrentDocument
 * @param {(path: string) => Promise<boolean>} options.onDeleteConfirm
 */
export function createToolExecutor({ getCurrentFile, getCurrentContent, onWriteCurrentDocument, onDeleteConfirm }) {

    /** 从编辑器内存或磁盘读取当前文档内容 */
    async function fetchCurrentContent() {
        const content = getCurrentContent?.();
        if (typeof content === 'string') return content;
        const path = getCurrentFile();
        if (!path) return null;
        return await readFile(path);
    }

    return async function executeToolCall(name, args) {
        switch (name) {

            // ── 当前文档 ──────────────────────────────────────

            case 'get_document_info': {
                const path = getCurrentFile();
                if (!path) return { error: '当前没有打开的文档' };
                try {
                    const content = await fetchCurrentContent();
                    if (content === null) return { error: '无法读取文档内容' };
                    const lines = getLines(content);
                    const preview = lines.slice(0, 10)
                        .map((l, i) => `${i + 1}: ${l}`)
                        .join('\n');
                    return {
                        path,
                        line_count: lines.length,
                        char_count: content.length,
                        preview,
                    };
                } catch (err) {
                    return { error: `读取失败: ${err.message}` };
                }
            }

            case 'read_document_lines': {
                const path = getCurrentFile();
                if (!path) return { error: '当前没有打开的文档' };
                try {
                    const content = await fetchCurrentContent();
                    if (content === null) return { error: '无法读取文档内容' };
                    const lines = getLines(content);
                    const start = Math.max(1, args.start_line);
                    const end = Math.min(lines.length, args.end_line);
                    if (start > lines.length) {
                        return { error: `起始行 ${start} 超出文档总行数 ${lines.length}` };
                    }
                    const slice = lines.slice(start - 1, end);
                    return {
                        start_line: start,
                        end_line: start + slice.length - 1,
                        total_lines: lines.length,
                        content: slice.map((l, i) => `${start + i}: ${l}`).join('\n'),
                    };
                } catch (err) {
                    return { error: `读取失败: ${err.message}` };
                }
            }

            case 'search_in_document': {
                const path = getCurrentFile();
                if (!path) return { error: '当前没有打开的文档' };
                try {
                    const content = await fetchCurrentContent();
                    if (content === null) return { error: '无法读取文档内容' };
                    const lines = getLines(content);
                    const query = args.query;
                    const ctx = Math.max(0, args.context_lines ?? 2);
                    const queryLower = query.toLowerCase();

                    const matches = [];
                    lines.forEach((line, idx) => {
                        if (!line.toLowerCase().includes(queryLower)) return;
                        const s = Math.max(0, idx - ctx);
                        const e = Math.min(lines.length - 1, idx + ctx);
                        const context = lines.slice(s, e + 1)
                            .map((l, i) => `${s + i + 1}${s + i === idx ? ' >' : '  '}: ${l}`)
                            .join('\n');
                        matches.push({ line: idx + 1, context });
                    });

                    return {
                        query,
                        match_count: matches.length,
                        matches: matches.slice(0, 20),
                    };
                } catch (err) {
                    return { error: `搜索失败: ${err.message}` };
                }
            }

            case 'write_current_document': {
                const path = getCurrentFile();
                if (!path) return { error: '当前没有打开的文档' };
                try {
                    const oldContent = await fetchCurrentContent() ?? '';
                    const result = await onWriteCurrentDocument({ path, oldContent, newContent: args.content });
                    return result.applied
                        ? { success: true, message: '修改已应用' }
                        : { cancelled: true, message: '用户取消了修改' };
                } catch (err) {
                    return { error: `操作失败: ${err.message}` };
                }
            }

            // ── 任意文件 ──────────────────────────────────────

            case 'read_file': {
                try {
                    const content = await readFile(args.path);
                    return { content };
                } catch (err) {
                    return { error: `读取文件失败: ${err.message}` };
                }
            }

            case 'write_file': {
                try {
                    await writeFile(args.path, args.content);
                    return { success: true };
                } catch (err) {
                    return { error: `写入文件失败: ${err.message}` };
                }
            }

            // ── 文件管理 ──────────────────────────────────────

            case 'list_directory': {
                try {
                    const entries = await listDirectory(args.path);
                    return { entries };
                } catch (err) {
                    return { error: `列目录失败: ${err.message}` };
                }
            }

            case 'delete_file': {
                try {
                    const confirmed = await onDeleteConfirm(args.path);
                    if (!confirmed) return { cancelled: true, message: '用户取消了删除' };
                    await deleteEntry(args.path);
                    return { success: true };
                } catch (err) {
                    return { error: `删除失败: ${err.message}` };
                }
            }

            case 'rename_file': {
                try {
                    await renameEntry(args.old_path, args.new_path);
                    return { success: true };
                } catch (err) {
                    return { error: `重命名失败: ${err.message}` };
                }
            }

            case 'create_directory': {
                try {
                    await createDirectory(args.path);
                    return { success: true };
                } catch (err) {
                    return { error: `创建目录失败: ${err.message}` };
                }
            }

            default:
                return { error: `未知工具: ${name}` };
        }
    };
}
