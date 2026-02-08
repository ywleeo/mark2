/**
 * 文档编辑执行器
 * 在 markdown 字符串层面执行编辑操作，确保 AI 看到的内容和搜索的内容一致
 */

import { addEditHighlight } from './highlightPlugin.js';

/**
 * 在 TipTap 文档中查找纯文本位置（用于高亮）
 * 注意：这里搜索的是纯文本内容，不含 markdown 标记
 */
function findPlainTextInDoc(doc, searchText) {
    if (!searchText) return null;

    const textParts = [];
    doc.descendants((node, pos) => {
        if (node.isText) {
            textParts.push({ text: node.text, pos });
        } else if (node.isBlock && textParts.length > 0) {
            textParts.push({ text: '\n', pos: -1 });
        }
    });

    let fullText = '';
    const posMap = [];
    for (const part of textParts) {
        for (let i = 0; i < part.text.length; i++) {
            posMap.push(part.pos === -1 ? -1 : part.pos + i);
            fullText += part.text[i];
        }
    }

    const index = fullText.indexOf(searchText);
    if (index === -1) return null;

    let from = posMap[index];
    let to = posMap[index + searchText.length - 1] + 1;

    if (from === -1) {
        for (let i = index; i < posMap.length; i++) {
            if (posMap[i] !== -1) { from = posMap[i]; break; }
        }
    }
    if (to <= 0) {
        for (let i = index + searchText.length - 1; i >= 0; i--) {
            if (posMap[i] !== -1) { to = posMap[i] + 1; break; }
        }
    }

    return { from, to };
}

/**
 * 从 markdown 文本中提取纯文本（去掉 markdown 标记）
 * 用于在 TipTap doc 中定位高亮区域
 */
function extractPlainText(markdown) {
    return markdown
        .replace(/^#{1,6}\s+/gm, '')     // 标题标记
        .replace(/^[-*+]\s+/gm, '')       // 无序列表标记
        .replace(/^\d+\.\s+/gm, '')       // 有序列表标记
        .replace(/^>\s+/gm, '')           // 引用标记
        .replace(/\*\*(.+?)\*\*/g, '$1')  // 粗体
        .replace(/\*(.+?)\*/g, '$1')      // 斜体
        .replace(/~~(.+?)~~/g, '$1')      // 删除线
        .replace(/`(.+?)`/g, '$1')        // 行内代码
        .replace(/\[(.+?)\]\(.+?\)/g, '$1'); // 链接
}

/**
 * 高亮新内容区域
 */
function highlightNewContent(tiptapEditor, newMarkdown) {
    if (!tiptapEditor || !newMarkdown) return;

    setTimeout(() => {
        try {
            // 提取纯文本用于在 TipTap doc 中查找
            const plainText = extractPlainText(newMarkdown).trim();
            if (!plainText) return;

            // 取前 50 个字符查找（避免长文本匹配问题）
            const searchSnippet = plainText.substring(0, 50);
            const match = findPlainTextInDoc(tiptapEditor.state.doc, searchSnippet);
            if (match) {
                // 高亮整个新内容区域（估算长度）
                const estimatedEnd = Math.min(
                    match.from + plainText.length,
                    tiptapEditor.state.doc.content.size
                );
                addEditHighlight(tiptapEditor, match.from, estimatedEnd);
            }
        } catch (e) {
            console.warn('[documentEditor] 高亮失败:', e);
        }
    }, 50);
}

/**
 * 执行 edit_document：在 markdown 字符串中查找替换
 */
function executeEditDocument(markdownEditor, oldText, newText) {
    const markdown = markdownEditor.getMarkdown();
    const index = markdown.indexOf(oldText);

    if (index === -1) {
        return { success: false, message: `未找到匹配文本: "${oldText.substring(0, 50)}..."` };
    }

    const newMarkdown = markdown.substring(0, index) + newText + markdown.substring(index + oldText.length);
    markdownEditor.setContent(newMarkdown, false);

    if (newText) {
        highlightNewContent(markdownEditor.editor, newText);
    }

    return { success: true, message: newText === '' ? '已删除文本' : '已替换文本' };
}

/**
 * 执行 insert_text：在锚点前或后插入内容
 */
function executeInsertText(markdownEditor, anchor, content, position) {
    const markdown = markdownEditor.getMarkdown();
    const index = markdown.indexOf(anchor);

    if (index === -1) {
        return { success: false, message: `未找到锚点文本: "${anchor.substring(0, 50)}..."` };
    }

    // 自动确保插入内容和相邻文本之间有换行分隔
    let newMarkdown;
    if (position === 'before') {
        const before = markdown.substring(0, index);
        const needLeadingNewline = before.length > 0 && !before.endsWith('\n');
        const needTrailingNewline = !content.endsWith('\n') && !markdown.substring(index).startsWith('\n');
        const pad = (needLeadingNewline ? '\n' : '') + content + (needTrailingNewline ? '\n' : '');
        newMarkdown = before + pad + markdown.substring(index);
    } else {
        const afterIndex = index + anchor.length;
        const after = markdown.substring(afterIndex);
        const needLeadingNewline = !anchor.endsWith('\n') && !content.startsWith('\n');
        const needTrailingNewline = after.length > 0 && !content.endsWith('\n') && !after.startsWith('\n');
        const pad = (needLeadingNewline ? '\n' : '') + content + (needTrailingNewline ? '\n' : '');
        newMarkdown = markdown.substring(0, afterIndex) + pad + after;
    }

    markdownEditor.setContent(newMarkdown, false);

    if (content) {
        highlightNewContent(markdownEditor.editor, content);
    }

    return { success: true, message: `已${position === 'before' ? '在前方' : '在后方'}插入内容` };
}

/**
 * 执行 replace_all：全局查找替换
 */
function executeReplaceAll(markdownEditor, search, replace) {
    const markdown = markdownEditor.getMarkdown();

    if (!markdown.includes(search)) {
        return { success: false, message: `未找到匹配文本: "${search}"`, count: 0 };
    }

    const count = markdown.split(search).length - 1;
    const newMarkdown = markdown.replaceAll(search, replace);
    markdownEditor.setContent(newMarkdown, false);

    if (replace) {
        highlightNewContent(markdownEditor.editor, replace);
    }

    return { success: true, message: `已替换 ${count} 处`, count };
}

/**
 * 执行 AI 返回的 tool calls
 * @param {Array} toolCalls - 解析后的 tool call 数组
 * @param {Object} markdownEditor - MarkdownEditor 实例（需要 getMarkdown/setContent/editor）
 * @returns {{ results: Array, summary: string }}
 */
export function executeToolCalls(toolCalls, markdownEditor) {
    if (!markdownEditor) {
        return { results: [], summary: '编辑器不可用' };
    }

    const results = [];

    for (const call of toolCalls) {
        const { name, arguments: args } = call.function;
        let parsed;

        try {
            parsed = typeof args === 'string' ? JSON.parse(args) : args;
        } catch (e) {
            results.push({ name, success: false, message: `参数解析失败: ${e.message}` });
            continue;
        }

        let result;
        switch (name) {
            case 'edit_document':
                result = executeEditDocument(markdownEditor, parsed.old_text, parsed.new_text);
                break;
            case 'insert_text':
                result = executeInsertText(markdownEditor, parsed.anchor, parsed.content, parsed.position);
                break;
            case 'replace_all':
                result = executeReplaceAll(markdownEditor, parsed.search, parsed.replace);
                break;
            default:
                result = { success: false, message: `未知操作: ${name}` };
        }

        results.push({ name, ...result });
    }

    // 生成摘要
    const failCount = results.filter(r => !r.success).length;
    const messages = results.map(r => r.message);

    let summary;
    if (failCount === 0) {
        summary = messages.join('；');
    } else {
        summary = messages.join('；') + `（${failCount} 项操作失败）`;
    }

    return { results, summary };
}
