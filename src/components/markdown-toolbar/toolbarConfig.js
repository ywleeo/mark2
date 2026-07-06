/**
 * Markdown 工具栏按钮配置
 * 包含所有按钮的图标、标题和快捷键
 */
import { t } from '../../i18n/index.js';

/**
 * 生成 Flaticon Uicons 图标。
 * 顶部工具栏只使用 regular rounded 系列，避免混用多套线条风格。
 */
const uicon = (name) => `<i class="toolbar-icon toolbar-icon--uicon fi fi-rr-${name}" aria-hidden="true"></i>`;

/**
 * 生成紧凑文字类工具栏图标。
 * B/I/标题/有序列表这类动作直接用字形更像写作工具，避免图标库字形过重。
 */
const textIcon = (content, className = '') => `<span class="toolbar-icon toolbar-icon--text ${className}" aria-hidden="true">${content}</span>`;

/**
 * 生成列表类 SVG 图标。
 * 三个列表动作共用同一尺寸和线宽，避免字体/文本 glyph 在小尺寸下发散。
 */
const listIcon = (content) => `<svg class="toolbar-icon toolbar-icon--list-svg" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true">${content}</svg>`;

const unorderedListIcon = listIcon(`
    <circle cx="3.2" cy="4" r="0.85" fill="currentColor" stroke="none"/>
    <circle cx="3.2" cy="8" r="0.85" fill="currentColor" stroke="none"/>
    <circle cx="3.2" cy="12" r="0.85" fill="currentColor" stroke="none"/>
    <path d="M6.2 4h6.6M6.2 8h6.6M6.2 12h6.6"/>
`);

export const BUTTON_CONFIG = {
    bold: {
        icon: textIcon('B', 'toolbar-icon--bold'),
        title: `${t('toolbar.bold')} (Ctrl+B)`,
        shortcut: 'Ctrl+B'
    },
    italic: {
        icon: textIcon('I', 'toolbar-icon--italic'),
        title: `${t('toolbar.italic')} (Ctrl+I)`,
        shortcut: 'Ctrl+I'
    },
    strikethrough: {
        icon: textIcon('S', 'toolbar-icon--strike'),
        title: t('toolbar.strikethrough'),
        shortcut: 'Ctrl+Shift+S'
    },
    heading1: {
        icon: textIcon('H1', 'toolbar-icon--heading-level'),
        title: t('toolbar.heading1'),
        shortcut: 'Ctrl+1'
    },
    heading2: {
        icon: textIcon('H2', 'toolbar-icon--heading-level'),
        title: t('toolbar.heading2'),
        shortcut: 'Ctrl+2'
    },
    heading3: {
        icon: textIcon('H3', 'toolbar-icon--heading-level'),
        title: t('toolbar.heading3'),
        shortcut: 'Ctrl+3'
    },
    code: {
        icon: uicon('square-code'),
        title: t('toolbar.code'),
        shortcut: 'Ctrl+`'
    },
    quote: {
        icon: textIcon('“”', 'toolbar-icon--quote'),
        title: t('toolbar.quote'),
        shortcut: 'Ctrl+Shift+>'
    },
    unorderedList: {
        icon: unorderedListIcon,
        title: t('toolbar.unorderedList'),
        shortcut: 'Ctrl+Shift+8'
    },
    orderedList: {
        icon: listIcon(`
            <path class="toolbar-icon--fill" d="M2.75 11.8V4.25H1.35V2.7h3.3v9.1h-1.9Z"/>
            <path d="M6.6 4h6.2M6.6 8h6.2M6.6 12h6.2"/>
        `),
        title: t('toolbar.orderedList'),
        shortcut: 'Ctrl+Shift+7'
    },
    taskList: {
        icon: uicon('list-check'),
        title: t('toolbar.taskList'),
        shortcut: 'Ctrl+Shift+9'
    },
    link: {
        icon: uicon('link'),
        title: t('toolbar.link'),
        shortcut: 'Ctrl+K'
    },
    image: {
        icon: uicon('picture'),
        title: t('toolbar.image'),
        shortcut: 'Ctrl+Shift+I'
    },
    table: {
        icon: uicon('table'),
        title: t('toolbar.table'),
        shortcut: 'Ctrl+Shift+T'
    },
    horizontalRule: {
        icon: uicon('hr'),
        title: t('toolbar.horizontalRule'),
        shortcut: 'Ctrl+Shift+-'
    },
    codeBlock: {
        icon: uicon('brackets-curly'),
        title: t('toolbar.codeBlock'),
        shortcut: 'Ctrl+Shift+C'
    },
    clearFormatting: {
        icon: uicon('eraser'),
        title: t('toolbar.clearFormatting')
    },
    emoji: {
        icon: uicon('smile'),
        title: t('toolbar.emoji')
    },
    copy: {
        icon: uicon('copy'),
        title: t('toolbar.copy')
    },
    copyMarkdown: {
        icon: uicon('copy'),
        title: t('toolbar.copyMarkdown')
    },
    toggleViewMode: {
        icon: uicon('square-code'),
        title: t('toolbar.toggleViewMode'),
        shortcut: 'Ctrl+E'
    },
    toc: {
        icon: uicon('document'),
        title: t('toolbar.toc')
    },
    centerContent: {
        icon: uicon('align-center'),
        title: t('toolbar.centerContent')
    },
    heading: {
        icon: textIcon('T', 'toolbar-icon--heading'),
        title: t('toolbar.heading')
    },
    list: {
        icon: unorderedListIcon,
        title: t('toolbar.list')
    },
    insert: {
        icon: uicon('plus'),
        title: t('toolbar.insert')
    },
    aiWriting: {
        icon: textIcon('AI', 'toolbar-icon--ai-writing'),
        title: t('toolbar.aiWriting')
    },
    video: {
        icon: uicon('video-camera'),
        title: t('toolbar.video')
    },
    navBack: {
        icon: uicon('arrow-small-left'),
        title: t('toolbar.navBack')
    },
    navForward: {
        icon: uicon('arrow-small-right'),
        title: t('toolbar.navForward')
    },
    shareLink: {
        icon: uicon('share'),
        title: t('toolbar.shareLink')
    }
};

/**
 * 工具栏布局分组
 * - fixed：左侧固定区，始终可见，不参与溢出收纳
 * - flow：左侧流动区，空间不足时从右往左收进「更多」菜单
 * - right：右侧保留区，仅放必须常驻的极少数动作
 * 每个内层数组是一个按钮组，组与组之间渲染分隔符；'heading' 渲染为标题下拉。
 */
export const TOOLBAR_GROUPS = {
    fixed: [
        ['navBack', 'navForward'],
        ['bold', 'italic', 'strikethrough', 'code'],
        ['heading', 'list', 'insert', 'aiWriting'],
    ],
    flow: [
        ['quote', 'codeBlock'],
        ['clearFormatting'],
        ['centerContent', 'copy', 'shareLink'],
    ],
    right: ['toggleViewMode'],
};

/**
 * 下拉选择器配置：把一组互斥操作收进下拉（标题、列表）。
 * 'heading'/'list' 在 TOOLBAR_GROUPS 中作为特殊项，渲染为下拉而非按钮。
 * onSelect 回调由 MarkdownToolbar 在渲染时注入。
 */
export const SELECT_CONFIGS = {
    heading: {
        dataAction: 'heading',
        icon: BUTTON_CONFIG.heading.icon,
        ariaLabel: t('toolbar.heading'),
        items: [
            { value: 0, label: t('toolbar.paragraph'), itemClass: 'toolbar-select-panel__item--h0' },
            { value: 1, label: t('toolbar.heading1'), itemClass: 'toolbar-select-panel__item--h1' },
            { value: 2, label: t('toolbar.heading2'), itemClass: 'toolbar-select-panel__item--h2' },
            { value: 3, label: t('toolbar.heading3'), itemClass: 'toolbar-select-panel__item--h3' },
        ],
    },
    list: {
        dataAction: 'list',
        icon: BUTTON_CONFIG.list.icon,
        ariaLabel: t('toolbar.list'),
        items: [
            { value: 'unorderedList', label: t('toolbar.unorderedList'), iconHtml: BUTTON_CONFIG.unorderedList.icon },
            { value: 'orderedList', label: t('toolbar.orderedList'), iconHtml: BUTTON_CONFIG.orderedList.icon },
            { value: 'taskList', label: t('toolbar.taskList'), iconHtml: BUTTON_CONFIG.taskList.icon },
        ],
    },
    insert: {
        dataAction: 'insert',
        icon: BUTTON_CONFIG.insert.icon,
        ariaLabel: t('toolbar.insert'),
        items: [
            { value: 'link', label: t('toolbar.link'), iconHtml: BUTTON_CONFIG.link.icon },
            { value: 'image', label: t('toolbar.image'), iconHtml: BUTTON_CONFIG.image.icon },
            { value: 'video', label: t('toolbar.video'), iconHtml: BUTTON_CONFIG.video.icon },
            { value: 'table', label: t('toolbar.table'), iconHtml: BUTTON_CONFIG.table.icon },
            { value: 'horizontalRule', label: t('toolbar.horizontalRule'), iconHtml: BUTTON_CONFIG.horizontalRule.icon },
            { value: 'emoji', label: t('toolbar.emoji'), iconHtml: BUTTON_CONFIG.emoji.icon },
        ],
    },
    copy: {
        dataAction: 'copy',
        icon: BUTTON_CONFIG.copyMarkdown.icon,
        ariaLabel: t('toolbar.copy'),
        items: [
            { value: 'copy', label: t('toolbar.copySelection') },
            { value: 'copyMarkdown', label: t('toolbar.copyMarkdown') },
            { value: 'copyPlainText', label: t('toolbar.copyPlainText') },
        ],
    },
};
