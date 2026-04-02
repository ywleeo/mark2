/**
 * Agent 工具定义 + 执行器
 *
 * 设计原则：
 * - 让 agent 自主决定用哪些工具，不预先注入文档内容
 * - 支持分块读取，避免大文件一次性撑满上下文
 * - 工具格式遵循 OpenAI function calling 规范
 */

import { readFile, writeFile, deleteEntry, renameEntry, listDirectory, createDirectory } from '../../api/filesystem.js';
import { getFileInfo, readFileChunk } from './fileReaders.js';
import { getDocumentVersion, relocateRangeByExcerpt, replaceDocumentRange, rewriteFullDocument } from './DocumentPatchService.js';

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
            description: '修改当前打开的文档。整篇改稿用 rewrite_full；只改已读取片段时用 replace_range，并提供 start_line/end_line。调用前应先读取文档信息或片段，并把 document_version 一并传回。',
            parameters: {
                type: 'object',
                properties: {
                    mode: { type: 'string', description: '写入模式：rewrite_full 或 replace_range' },
                    start_line: { type: 'integer', description: 'replace_range 的起始行（从 1 开始）' },
                    end_line: { type: 'integer', description: 'replace_range 的结束行（含）' },
                    document_version: { type: 'string', description: '来自 get_document_info / read_document_lines / search_in_document 的 document_version，应用前会校验' },
                    source_excerpt: { type: 'string', description: 'replace_range 时建议一并传入的原片段正文，用于文档变更后在最新内容中重定位' },
                    content: { type: 'string', description: 'rewrite_full 时是整篇新内容；replace_range 时是用于替换该行区间的新片段内容，不要带行号前缀。' },
                },
                required: [],
            },
        },
    },

    // ── 任意文件：info / 分块读 / 全量读 / 写 ───────────────────

    {
        type: 'function',
        function: {
            name: 'get_file_info',
            description: '获取文件元信息：类型、大小、总页数/行数/段落数/sheet 等。读取大文件前应先调用此工具，再用 read_file_chunk 分块读取。',
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
            name: 'read_file_chunk',
            description: '分块读取文件内容。不同格式的分块单位：PDF/PPTX 按页/幻灯片编号，Excel 按 sheet 名+行范围，CSV/文本按行范围，DOCX 按段落范围。先用 get_file_info 获取总量再决定范围。',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: '文件的绝对路径' },
                    start: { type: 'integer', description: '起始位置（含），从 1 开始。对应各格式的页/幻灯片/行/段落编号' },
                    end: { type: 'integer', description: '结束位置（含）' },
                    sheet: { type: 'string', description: 'Excel 专用：工作表名称。省略则读取第一个 sheet' },
                },
                required: ['path', 'start', 'end'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'read_file',
            description: '读取指定路径文件的完整内容（仅适合纯文本小文件）。对于 Excel/DOCX/PPTX/PDF 或大文件，请改用 get_file_info + read_file_chunk。',
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
 * @param {(p: {path,oldContent,newContent,patchPlan?:Array<object>,mode:'patch'|'replace'}) => Promise<{applied:boolean}>} options.onWriteCurrentDocument
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
                        document_version: getDocumentVersion(content),
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
                        document_version: getDocumentVersion(content),
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
                        document_version: getDocumentVersion(content),
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
                    const currentVersion = getDocumentVersion(oldContent);
                    const mode = typeof args.mode === 'string' ? args.mode : '';
                    let payload;
                    if (mode === 'replace_range') {
                        let startLine = Number(args.start_line);
                        let endLine = Number(args.end_line);
                        const hasVersionMismatch = typeof args.document_version === 'string'
                            && args.document_version
                            && args.document_version !== currentVersion;

                        if (hasVersionMismatch) {
                            const relocated = relocateRangeByExcerpt(oldContent, args.source_excerpt);
                            startLine = relocated.startLine;
                            endLine = relocated.endLine;
                        }

                        const { patchPlan, newContent } = replaceDocumentRange(
                            oldContent,
                            startLine,
                            endLine,
                            typeof args.content === 'string' ? args.content : ''
                        );
                        payload = {
                            path,
                            oldContent,
                            newContent,
                            patchPlan,
                            mode,
                        };
                    } else if (mode === 'rewrite_full' || typeof args.content === 'string') {
                        const { newContent } = rewriteFullDocument(oldContent, args.content);
                        payload = {
                            path,
                            oldContent,
                            newContent,
                            mode: 'rewrite_full',
                        };
                    } else {
                        return { error: 'write_current_document 缺少合法的 mode 或 content' };
                    }

                    const result = await onWriteCurrentDocument(payload);
                    return result.applied
                        ? { success: true, message: '修改已应用' }
                        : { cancelled: true, message: '用户取消了修改' };
                } catch (err) {
                    return { error: `操作失败: ${err.message}` };
                }
            }

            // ── 任意文件 ──────────────────────────────────────

            case 'get_file_info': {
                try {
                    return await getFileInfo(args.path);
                } catch (err) {
                    return { error: `获取文件信息失败: ${err.message}` };
                }
            }

            case 'read_file_chunk': {
                try {
                    return await readFileChunk(args.path, args.start, args.end, args.sheet);
                } catch (err) {
                    return { error: `分块读取失败: ${err.message}` };
                }
            }

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
