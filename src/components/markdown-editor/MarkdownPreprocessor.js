import { ensureMarkdownTrailingEmptyLine } from '../../utils/markdownFormatting.js';

/**
 * 预处理加粗标记：将多星号组合转换为 HTML strong/em 标签。
 * 纯函数，无副作用。
 */
export function preprocessBold(markdown) {
    if (!markdown) return '';
    const withQuad = markdown.replace(/\*\*\*\*([\s\S]+?)\*\*\*\*/g, '<strong>$1</strong>');
    const withTriple = withQuad.replace(/\*\*\*([\s\S]+?)\*\*\*/g, '<em><strong>$1</strong></em>');
    return withTriple.replace(
        /(^|[^*])\*\*([\s\S]+?)\*\*(?!\*)/g,
        (match, prefix, content) => `${prefix}<strong>${content}</strong>`
    );
}

/**
 * 统一预处理 Markdown 文本，合并多步骤为一次处理。
 * 纯函数，无副作用。
 *
 * 处理步骤：
 *   1. 修复表格行内 <br> 断裂（按行扫描）
 *   2. 包含空格的链接/图片地址自动包裹尖括号
 *   3. 2 空格列表缩进修正为 4 空格
 */
export function preprocessMarkdown(markdown) {
    if (!markdown) return '';

    let text = markdown;

    // 1. 表格 <br> 断裂修复
    if (text.includes('<br')) {
        const lines = text.split('\n');
        const result = [];
        let i = 0;
        while (i < lines.length) {
            let line = lines[i];
            if (/^\s*\|/.test(line) && /<br\s*\/?\s*>\s*$/.test(line)) {
                i++;
                while (i < lines.length) {
                    if (lines[i].trim() === '') { i++; continue; }
                    if (/^\s*<br\s*\/?\s*>/.test(lines[i])) {
                        line += lines[i].replace(/^\s*<br\s*\/?\s*>\s*/, '');
                        i++;
                        if (!/<br\s*\/?\s*>\s*$/.test(line)) break;
                    } else {
                        break;
                    }
                }
                result.push(line);
            } else {
                result.push(line);
                i++;
            }
        }
        text = result.join('\n');
    }

    // 2. 包含空格的链接/图片地址自动包裹尖括号
    text = text.replace(/(!?\[[^\]]*\]\()([^)\n]+)(\))/g, (match, prefix, target, suffix) => {
        const trimmed = target.trim();
        if (!trimmed || trimmed.startsWith('<') || !/\s/.test(trimmed)) return match;
        if (trimmed.includes('"') || trimmed.includes("'")) return match;
        const leading = target.match(/^\s*/)?.[0] ?? '';
        const trailing = target.match(/\s*$/)?.[0] ?? '';
        return `${prefix}${leading}<${trimmed.replace(/>/g, '\\>')}>${trailing}${suffix}`;
    });

    // 3. 2 空格列表缩进修正为 4 空格
    text = text.replace(/\n  ([-*+]) /g, (match, marker, offset, string) => {
        const lastNewLine = string.lastIndexOf('\n', offset - 1);
        const previousLine = string.slice(lastNewLine === -1 ? 0 : lastNewLine + 1, offset);
        if (/^\s*(?:[*+-]|\d+\.)\s+/.test(previousLine)) return `\n    ${marker} `;
        return match;
    });

    return text;
}

/**
 * 将 TipTap 文档序列化为 Markdown 字符串。
 * 当内容未变更时直接返回缓存的原始内容。
 */
export function serializeMarkdown({ contentChanged, originalMarkdown, markdownSerializer, editor }) {
    if (!contentChanged) return originalMarkdown;
    const markdown = markdownSerializer?.serialize(editor.state.doc) ?? '';
    return ensureMarkdownTrailingEmptyLine(markdown.replace(/\u200B/g, ''));
}
