/**
 * CodeMirror 6 主题支持
 * 将原有的 Monaco 主题配置转换为 CodeMirror 主题
 */

import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';

// ============================================================================
// 主题颜色定义
// ============================================================================

const THEMES = {
    'vs': {
        light: {
            background: '#ffffff',
            foreground: '#000000',
            lineHighlight: '#f0f0f0',
            selection: '#add6ff',
            cursor: '#000000',
            gutterForeground: '#858585',
            gutterActiveForeground: '#000000',
        },
        dark: {
            background: '#1e1e1e',
            foreground: '#d4d4d4',
            lineHighlight: '#2a2d2e',
            selection: '#264f78',
            cursor: '#d4d4d4',
            gutterForeground: '#858585',
            gutterActiveForeground: '#c6c6c6',
        },
    },
    'monokai': {
        light: {
            background: '#FAFAFA',
            foreground: '#3B3A32',
            lineHighlight: '#EFEFEF',
            selection: '#C9D0D9',
            cursor: '#000000',
            gutterForeground: '#A0A0A0',
            gutterActiveForeground: '#3B3A32',
        },
        dark: {
            background: '#272822',
            foreground: '#F8F8F2',
            lineHighlight: '#3E3D32',
            selection: '#49483E',
            cursor: '#F8F8F0',
            gutterForeground: '#90908A',
            gutterActiveForeground: '#C2C2BF',
        },
    },
    'dracula': {
        light: {
            background: '#F8F8F2',
            foreground: '#2F2F2F',
            lineHighlight: '#EFEFEF',
            selection: '#D0D0D0',
            cursor: '#000000',
            gutterForeground: '#858585',
            gutterActiveForeground: '#2F2F2F',
        },
        dark: {
            background: '#282A36',
            foreground: '#F8F8F2',
            lineHighlight: '#44475A',
            selection: '#44475A',
            cursor: '#F8F8F0',
            gutterForeground: '#6272A4',
            gutterActiveForeground: '#F8F8F2',
        },
    },
    'one-dark-pro': {
        light: {
            background: '#FAFAFA',
            foreground: '#383A42',
            lineHighlight: '#F0F0F0',
            selection: '#D0D0D0',
            cursor: '#4078F2',
            gutterForeground: '#9D9D9F',
            gutterActiveForeground: '#383A42',
        },
        dark: {
            background: '#282C34',
            foreground: '#ABB2BF',
            lineHighlight: '#2C313C',
            selection: '#3E4451',
            cursor: '#528BFF',
            gutterForeground: '#495162',
            gutterActiveForeground: '#ABB2BF',
        },
    },
    'github': {
        light: {
            background: '#FFFFFF',
            foreground: '#24292F',
            lineHighlight: '#F6F8FA',
            selection: '#B6E3FF',
            cursor: '#24292F',
            gutterForeground: '#8C959F',
            gutterActiveForeground: '#24292F',
        },
        dark: {
            background: '#0D1117',
            foreground: '#E6EDF3',
            lineHighlight: '#161B22',
            selection: '#264F78',
            cursor: '#E6EDF3',
            gutterForeground: '#6E7681',
            gutterActiveForeground: '#E6EDF3',
        },
    },
    'night-owl': {
        light: {
            background: '#FBFBFB',
            foreground: '#403F53',
            lineHighlight: '#F0F0F0',
            selection: '#E0E0E0',
            cursor: '#403F53',
            gutterForeground: '#90A7B2',
            gutterActiveForeground: '#403F53',
        },
        dark: {
            background: '#011627',
            foreground: '#D6DEEB',
            lineHighlight: '#01121F',
            selection: '#1D3B53',
            cursor: '#80A4C2',
            gutterForeground: '#4B6479',
            gutterActiveForeground: '#C5E4FD',
        },
    },
    'solarized': {
        light: {
            background: '#FDF6E3',
            foreground: '#657B83',
            lineHighlight: '#EEE8D5',
            selection: '#EEE8D5',
            cursor: '#DC322F',
            gutterForeground: '#93A1A1',
            gutterActiveForeground: '#586E75',
        },
        dark: {
            background: '#002B36',
            foreground: '#839496',
            lineHighlight: '#073642',
            selection: '#073642',
            cursor: '#D30102',
            gutterForeground: '#586E75',
            gutterActiveForeground: '#93A1A1',
        },
    },
    'markdown-sql': {
        light: {
            background: '#ffffff',
            foreground: '#000000',
            lineHighlight: '#f0f0f0',
            selection: '#add6ff',
            cursor: '#000000',
            gutterForeground: '#858585',
            gutterActiveForeground: '#000000',
        },
        dark: {
            background: '#1e1e1e',
            foreground: '#d4d4d4',
            lineHighlight: '#2a2d2e',
            selection: '#264f78',
            cursor: '#d4d4d4',
            gutterForeground: '#858585',
            gutterActiveForeground: '#c6c6c6',
        },
    },
    'csv': {
        light: {
            background: '#ffffff',
            foreground: '#000000',
            lineHighlight: '#f0f0f0',
            selection: '#add6ff',
            cursor: '#000000',
            gutterForeground: '#858585',
            gutterActiveForeground: '#000000',
        },
        dark: {
            background: '#1e1e1e',
            foreground: '#d4d4d4',
            lineHighlight: '#2a2d2e',
            selection: '#264f78',
            cursor: '#d4d4d4',
            gutterForeground: '#858585',
            gutterActiveForeground: '#c6c6c6',
        },
    },
};

// ============================================================================
// 语法高亮颜色定义
// ============================================================================

const HIGHLIGHT_COLORS = {
    'vs': {
        light: { keyword: '#0000FF', string: '#A31515', comment: '#008000', number: '#098658', type: '#267F99', function: '#795E26', variable: '#001080', operator: '#000000' },
        dark: { keyword: '#569CD6', string: '#CE9178', comment: '#6A9955', number: '#B5CEA8', type: '#4EC9B0', function: '#DCDCAA', variable: '#9CDCFE', operator: '#D4D4D4' },
    },
    'monokai': {
        light: { keyword: '#E8004F', string: '#C19C00', comment: '#75715E', number: '#9933CC', type: '#0087AF', function: '#739200', variable: '#3B3A32', operator: '#E8004F' },
        dark: { keyword: '#F92672', string: '#E6DB74', comment: '#88846F', number: '#AE81FF', type: '#66D9EF', function: '#A6E22E', variable: '#F8F8F2', operator: '#F92672' },
    },
    'dracula': {
        light: { keyword: '#C41A7E', string: '#A08800', comment: '#6272A4', number: '#8959A8', type: '#0184BC', function: '#00A800', variable: '#2F2F2F', operator: '#C41A7E' },
        dark: { keyword: '#FF79C6', string: '#F1FA8C', comment: '#6272A4', number: '#BD93F9', type: '#8BE9FD', function: '#50FA7B', variable: '#F8F8F2', operator: '#FF79C6' },
    },
    'one-dark-pro': {
        light: { keyword: '#A626A4', string: '#50A14F', comment: '#A0A1A7', number: '#986801', type: '#C18401', function: '#4078F2', variable: '#E45649', operator: '#0184BC' },
        dark: { keyword: '#C678DD', string: '#98C379', comment: '#5C6370', number: '#D19A66', type: '#E5C07B', function: '#61AFEF', variable: '#E06C75', operator: '#56B6C2' },
    },
    'github': {
        light: { keyword: '#CF222E', string: '#0A3069', comment: '#6E7781', number: '#0550AE', type: '#953800', function: '#8250DF', variable: '#953800', operator: '#CF222E' },
        dark: { keyword: '#FF7B72', string: '#A5D6FF', comment: '#8B949E', number: '#79C0FF', type: '#FFA657', function: '#D2A8FF', variable: '#FFA657', operator: '#FF7B72' },
    },
    'night-owl': {
        light: { keyword: '#994CC3', string: '#BC5454', comment: '#989FB1', number: '#AA0982', type: '#C96765', function: '#4876D6', variable: '#403F53', operator: '#994CC3' },
        dark: { keyword: '#C792EA', string: '#ECC48D', comment: '#637777', number: '#F78C6C', type: '#FFCB8B', function: '#82AAFF', variable: '#D6DEEB', operator: '#C792EA' },
    },
    'solarized': {
        light: { keyword: '#859900', string: '#2AA198', comment: '#93A1A1', number: '#D33682', type: '#B58900', function: '#268BD2', variable: '#657B83', operator: '#586E75' },
        dark: { keyword: '#859900', string: '#2AA198', comment: '#586E75', number: '#D33682', type: '#B58900', function: '#268BD2', variable: '#839496', operator: '#93A1A1' },
    },
};

/**
 * 构建 CodeMirror 编辑器主题
 */
export function buildTheme(themeName, isDark) {
    const themeColors = THEMES[themeName]
        ?? THEMES['vs'];
    const colors = isDark ? themeColors.dark : themeColors.light;

    // Convert hex to rgba so activeLine doesn't obscure selection layer beneath it
    const hexToRgba = (hex, alpha) => {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    };

    return EditorView.theme({
        '&': {
            backgroundColor: colors.background,
            color: colors.foreground,
        },
        '.cm-content': {
            caretColor: colors.cursor,
        },
        '.cm-cursor, .cm-dropCursor': {
            borderLeftColor: colors.cursor,
            borderLeftWidth: '2px',
        },
        '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
            backgroundColor: colors.selection,
        },
        '.cm-activeLine': {
            backgroundColor: hexToRgba(colors.lineHighlight, 0.7),
        },
        '.cm-gutters': {
            backgroundColor: colors.background,
            color: colors.gutterForeground,
            borderRight: `1px solid ${hexToRgba(colors.gutterForeground, 0.2)}`,
        },
        '.cm-activeLineGutter': {
            color: colors.gutterActiveForeground,
            backgroundColor: hexToRgba(colors.lineHighlight, 0.5),
        },
        '.cm-foldPlaceholder': {
            backgroundColor: 'transparent',
            border: 'none',
            color: colors.gutterForeground,
        },
        // Search result highlighting
        '.search-result': {
            backgroundColor: isDark ? 'rgba(255, 213, 0, 0.3)' : 'rgba(255, 213, 0, 0.4)',
            borderRadius: '2px',
        },
        '.search-result-current': {
            backgroundColor: isDark ? 'rgba(255, 150, 0, 0.5)' : 'rgba(255, 150, 0, 0.6)',
            borderRadius: '2px',
        },
    }, { dark: isDark });
}

/**
 * 构建语法高亮样式
 */
export function buildHighlightStyle(themeName, isDark) {
    const hlColors = HIGHLIGHT_COLORS[themeName]
        ?? HIGHLIGHT_COLORS['vs'];
    const colors = isDark ? hlColors.dark : hlColors.light;

    const style = HighlightStyle.define([
        { tag: tags.keyword, color: colors.keyword },
        { tag: tags.controlKeyword, color: colors.keyword },
        { tag: tags.operatorKeyword, color: colors.keyword },
        { tag: tags.definitionKeyword, color: colors.keyword },
        { tag: tags.moduleKeyword, color: colors.keyword },
        { tag: tags.string, color: colors.string },
        { tag: tags.regexp, color: colors.string },
        { tag: tags.comment, color: colors.comment, fontStyle: 'italic' },
        { tag: tags.lineComment, color: colors.comment, fontStyle: 'italic' },
        { tag: tags.blockComment, color: colors.comment, fontStyle: 'italic' },
        { tag: tags.docComment, color: colors.comment, fontStyle: 'italic' },
        { tag: tags.number, color: colors.number },
        { tag: tags.integer, color: colors.number },
        { tag: tags.float, color: colors.number },
        { tag: tags.bool, color: colors.number },
        { tag: tags.typeName, color: colors.type },
        { tag: tags.className, color: colors.type },
        { tag: tags.namespace, color: colors.type },
        { tag: tags.function(tags.variableName), color: colors.function },
        { tag: tags.function(tags.definition(tags.variableName)), color: colors.function },
        { tag: tags.variableName, color: colors.variable },
        { tag: tags.definition(tags.variableName), color: colors.variable },
        { tag: tags.propertyName, color: colors.variable },
        { tag: tags.operator, color: colors.operator },
        { tag: tags.punctuation, color: colors.operator },
        { tag: tags.bracket, color: colors.operator },
        { tag: tags.meta, color: colors.comment },
        { tag: tags.tagName, color: colors.keyword },
        { tag: tags.attributeName, color: colors.variable },
        { tag: tags.attributeValue, color: colors.string },
        // Markdown
        { tag: tags.heading, color: colors.keyword, fontWeight: 'bold' },
        { tag: tags.heading1, color: colors.keyword, fontWeight: 'bold' },
        { tag: tags.heading2, color: colors.keyword, fontWeight: 'bold' },
        { tag: tags.heading3, color: colors.keyword, fontWeight: 'bold' },
        { tag: tags.heading4, color: colors.keyword, fontWeight: 'bold' },
        { tag: tags.heading5, color: colors.keyword, fontWeight: 'bold' },
        { tag: tags.heading6, color: colors.keyword, fontWeight: 'bold' },
        { tag: tags.link, color: colors.function, textDecoration: 'underline' },
        { tag: tags.url, color: colors.function },
        { tag: tags.emphasis, color: colors.string, fontStyle: 'italic' },
        { tag: tags.strong, color: colors.number, fontWeight: 'bold' },
        { tag: tags.strikethrough, textDecoration: 'line-through', color: colors.comment },
        { tag: tags.quote, color: colors.comment, fontStyle: 'italic' },
        { tag: tags.list, color: colors.keyword },
        { tag: tags.contentSeparator, color: colors.comment },
        { tag: tags.processingInstruction, color: colors.type },
        // Markdown 内联代码
        { tag: tags.monospace, color: colors.string },
    ]);

    return syntaxHighlighting(style);
}

/**
 * 可用主题列表（用于设置页面展示）
 */
export const availableThemes = [
    { id: 'vs', name: 'VS Code' },
    { id: 'monokai', name: 'Monokai' },
    { id: 'dracula', name: 'Dracula' },
    { id: 'one-dark-pro', name: 'One Dark Pro' },
    { id: 'github', name: 'GitHub' },
    { id: 'night-owl', name: 'Night Owl' },
    { id: 'solarized', name: 'Solarized' },
];

/**
 * 获取主题的特定颜色模式版本（兼容旧 API）
 */
export function getThemeVariant(themeName, isDark) {
    return isDark ? `${themeName}-dark` : `${themeName}-light`;
}
