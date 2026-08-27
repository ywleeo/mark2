/**
 * Markdown 快捷键贡献定义。
 *
 * 段落、格式动作在这里集中声明，命令注册、默认键位和设置页共同消费，
 * 避免三处维护不同清单。默认键位参考 Typora；与 Mark2 既有全局动作冲突的
 * 组合统一改用 Alt/Option 变体，保证开箱即可用。
 */

import { COMMAND_IDS } from '../../core/commands/commandIds.js';
import { isMac } from '../../utils/platform.js';

/**
 * 创建一条 Markdown 快捷键定义。
 * @param {object} definition - 定义内容
 * @returns {object}
 */
function defineMarkdownShortcut(definition) {
    return Object.freeze(definition);
}

/** Markdown 段落类命令。 */
const PARAGRAPH_COMMANDS = [
    defineMarkdownShortcut({ commandId: COMMAND_IDS.MARKDOWN_PARAGRAPH, action: 'heading', payload: { level: 0 }, defaultShortcut: 'Mod+0', labelKey: 'settings.kb.mdParagraph', title: 'Markdown 正文' }),
    ...[1, 2, 3, 4, 5, 6].map(level => defineMarkdownShortcut({
        commandId: COMMAND_IDS[`MARKDOWN_HEADING_${level}`],
        action: 'heading',
        payload: { level },
        defaultShortcut: `Mod+${level}`,
        labelKey: `settings.kb.mdHeading${level}`,
        title: `Markdown ${level} 级标题`,
    })),
    defineMarkdownShortcut({ commandId: COMMAND_IDS.MARKDOWN_HEADING_INCREASE, action: 'increaseHeading', defaultShortcut: 'Mod+=', labelKey: 'settings.kb.mdIncreaseHeading', title: '提升标题级别' }),
    defineMarkdownShortcut({ commandId: COMMAND_IDS.MARKDOWN_HEADING_DECREASE, action: 'decreaseHeading', defaultShortcut: 'Mod+-', labelKey: 'settings.kb.mdDecreaseHeading', title: '降低标题级别' }),
    // Mark2 的 Mod+T 已用于新建标签页，表格统一使用 Mod+Alt+T。
    defineMarkdownShortcut({ commandId: COMMAND_IDS.MARKDOWN_TABLE, action: 'table', defaultShortcut: 'Mod+Alt+T', labelKey: 'settings.kb.mdTable', title: '插入 Markdown 表格' }),
    // Windows 的 Mod+Shift+K 已用于保险箱，代码块统一使用 Mod+Alt+C。
    defineMarkdownShortcut({ commandId: COMMAND_IDS.MARKDOWN_CODE_BLOCK, action: 'codeBlock', defaultShortcut: 'Mod+Alt+C', labelKey: 'settings.kb.mdCodeBlock', title: 'Markdown 代码块' }),
    defineMarkdownShortcut({ commandId: COMMAND_IDS.MARKDOWN_MATH_BLOCK, action: 'mathBlock', defaultShortcut: isMac ? 'Mod+Alt+B' : 'Mod+Shift+M', labelKey: 'settings.kb.mdMathBlock', title: '插入 Markdown 数学块' }),
    defineMarkdownShortcut({ commandId: COMMAND_IDS.MARKDOWN_QUOTE, action: 'quote', defaultShortcut: isMac ? 'Mod+Alt+Q' : 'Mod+Shift+Q', labelKey: 'settings.kb.mdQuote', title: 'Markdown 引用' }),
    defineMarkdownShortcut({ commandId: COMMAND_IDS.MARKDOWN_ORDERED_LIST, action: 'orderedList', defaultShortcut: isMac ? 'Mod+Alt+O' : 'Mod+Shift+[', labelKey: 'settings.kb.mdOrderedList', title: 'Markdown 有序列表' }),
    defineMarkdownShortcut({ commandId: COMMAND_IDS.MARKDOWN_UNORDERED_LIST, action: 'unorderedList', defaultShortcut: isMac ? 'Mod+Alt+U' : 'Mod+Shift+]', labelKey: 'settings.kb.mdUnorderedList', title: 'Markdown 无序列表' }),
    defineMarkdownShortcut({ commandId: COMMAND_IDS.MARKDOWN_INDENT, action: 'indent', defaultShortcut: 'Mod+[', labelKey: 'settings.kb.mdIndent', title: '增加 Markdown 缩进' }),
    defineMarkdownShortcut({ commandId: COMMAND_IDS.MARKDOWN_OUTDENT, action: 'outdent', defaultShortcut: 'Mod+]', labelKey: 'settings.kb.mdOutdent', title: '减少 Markdown 缩进' }),
];

/** Markdown 行内格式类命令。 */
const FORMAT_COMMANDS = [
    defineMarkdownShortcut({ commandId: COMMAND_IDS.MARKDOWN_BOLD, action: 'bold', defaultShortcut: 'Mod+B', labelKey: 'settings.kb.mdBold', title: 'Markdown 加粗' }),
    defineMarkdownShortcut({ commandId: COMMAND_IDS.MARKDOWN_ITALIC, action: 'italic', defaultShortcut: 'Mod+I', labelKey: 'settings.kb.mdItalic', title: 'Markdown 斜体' }),
    defineMarkdownShortcut({ commandId: COMMAND_IDS.MARKDOWN_UNDERLINE, action: 'underline', defaultShortcut: 'Mod+U', labelKey: 'settings.kb.mdUnderline', title: 'Markdown 下划线' }),
    defineMarkdownShortcut({ commandId: COMMAND_IDS.MARKDOWN_INLINE_CODE, action: 'code', defaultShortcut: 'Mod+Shift+`', labelKey: 'settings.kb.mdInlineCode', title: 'Markdown 行内代码' }),
    defineMarkdownShortcut({ commandId: COMMAND_IDS.MARKDOWN_STRIKETHROUGH, action: 'strikethrough', defaultShortcut: isMac ? 'Ctrl+Shift+`' : 'Alt+Shift+5', labelKey: 'settings.kb.mdStrikethrough', title: 'Markdown 删除线' }),
    defineMarkdownShortcut({ commandId: COMMAND_IDS.MARKDOWN_LINK, action: 'link', defaultShortcut: 'Mod+K', labelKey: 'settings.kb.mdLink', title: '插入 Markdown 链接' }),
    defineMarkdownShortcut({ commandId: COMMAND_IDS.MARKDOWN_IMAGE, action: 'image', defaultShortcut: isMac ? 'Mod+Ctrl+I' : 'Mod+Shift+I', labelKey: 'settings.kb.mdImage', title: '插入 Markdown 图片' }),
    // Mod+\ 已用于侧边栏，清除格式增加 Shift 以消除冲突。
    defineMarkdownShortcut({ commandId: COMMAND_IDS.MARKDOWN_CLEAR_FORMATTING, action: 'clearFormatting', defaultShortcut: 'Mod+Shift+\\', labelKey: 'settings.kb.mdClearFormatting', title: '清除 Markdown 格式' }),
];

/** 设置页展示的 Markdown 快捷键分组。 */
export const MARKDOWN_SHORTCUT_GROUPS = Object.freeze([
    Object.freeze({ id: 'paragraph', labelKey: 'settings.kb.groupParagraph', commands: Object.freeze(PARAGRAPH_COMMANDS) }),
    Object.freeze({ id: 'format', labelKey: 'settings.kb.groupFormat', commands: Object.freeze(FORMAT_COMMANDS) }),
]);

/** 扁平化后的 Markdown 命令清单，供注册层使用。 */
export const MARKDOWN_SHORTCUT_COMMANDS = Object.freeze(
    MARKDOWN_SHORTCUT_GROUPS.flatMap(group => group.commands)
);

/**
 * Markdown 编辑器默认快捷键。
 * 与应用级快捷键独立维护，仅在快捷键注册阶段合并。
 */
export const MARKDOWN_DEFAULT_KEYBINDINGS = Object.freeze(
    MARKDOWN_SHORTCUT_COMMANDS.map(definition => Object.freeze([
        definition.commandId,
        definition.defaultShortcut,
    ]))
);
