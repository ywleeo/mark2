/**
 * Markdown 工具栏按钮配置
 * 包含所有按钮的图标、标题和快捷键
 */
import { t } from '../../i18n/index.js';

/**
 * 生成统一的线性工具栏图标。
 * 工具栏图标全部使用 24px viewBox + 统一 stroke，由 CSS 控制实际尺寸和线宽。
 */
const strokeIcon = (content) => `<svg class="toolbar-icon toolbar-icon--stroke" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">${content}</svg>`;

/**
 * 生成字形类工具栏图标。
 * Bold/Italic 等编辑器通用字形用文本保留直觉，其余功能尽量使用 strokeIcon。
 */
const textIcon = (content, className = '') => `<svg class="toolbar-icon toolbar-icon--text ${className}" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">${content}</svg>`;

export const BUTTON_CONFIG = {
    bold: {
        icon: textIcon('<text x="7" y="17" font-size="15" font-weight="700" fill="currentColor">B</text>'),
        title: `${t('toolbar.bold')} (Ctrl+B)`,
        shortcut: 'Ctrl+B'
    },
    italic: {
        icon: textIcon('<text x="8" y="17" font-size="15" font-style="italic" font-weight="700" fill="currentColor">I</text>'),
        title: `${t('toolbar.italic')} (Ctrl+I)`,
        shortcut: 'Ctrl+I'
    },
    strikethrough: {
        icon: textIcon('<text x="7" y="17" font-size="15" font-weight="700" fill="currentColor">S</text><line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'),
        title: t('toolbar.strikethrough'),
        shortcut: 'Ctrl+Shift+S'
    },
    heading1: {
        icon: textIcon('<text x="6" y="18" font-size="18" font-weight="700" fill="currentColor">#</text>'),
        title: t('toolbar.heading1'),
        shortcut: 'Ctrl+1'
    },
    heading2: {
        icon: textIcon('<text x="7" y="17" font-size="15" font-weight="700" fill="currentColor">#</text>'),
        title: t('toolbar.heading2'),
        shortcut: 'Ctrl+2'
    },
    heading3: {
        icon: textIcon('<text x="8" y="16" font-size="13" font-weight="700" fill="currentColor">#</text>'),
        title: t('toolbar.heading3'),
        shortcut: 'Ctrl+3'
    },
    code: {
        icon: strokeIcon('<polyline points="9 8 5 12 9 16"/><polyline points="15 8 19 12 15 16"/>'),
        title: t('toolbar.code'),
        shortcut: 'Ctrl+`'
    },
    quote: {
        icon: strokeIcon('<path d="M8 9H5.8a3 3 0 0 0 0 6H8v-4.5a4.5 4.5 0 0 1-2.8 4"/><path d="M18 9h-2.2a3 3 0 0 0 0 6H18v-4.5a4.5 4.5 0 0 1-2.8 4"/>'),
        title: t('toolbar.quote'),
        shortcut: 'Ctrl+Shift+>'
    },
    unorderedList: {
        icon: strokeIcon('<line x1="9" y1="7" x2="20" y2="7"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="17" x2="20" y2="17"/><circle cx="5" cy="7" r="1"/><circle cx="5" cy="12" r="1"/><circle cx="5" cy="17" r="1"/>'),
        title: t('toolbar.unorderedList'),
        shortcut: 'Ctrl+Shift+8'
    },
    orderedList: {
        icon: strokeIcon('<path d="M5 7h1v4"/><path d="M4.5 11h3"/><path d="M5 15.5h2.5L5 19h3"/><line x1="11" y1="8" x2="20" y2="8"/><line x1="11" y1="17" x2="20" y2="17"/>'),
        title: t('toolbar.orderedList'),
        shortcut: 'Ctrl+Shift+7'
    },
    taskList: {
        icon: strokeIcon('<rect x="4" y="5" width="4" height="4" rx="1"/><path d="M11 7h9"/><path d="M5 16l2 2 3-4"/><path d="M13 16h7"/>'),
        title: t('toolbar.taskList'),
        shortcut: 'Ctrl+Shift+9'
    },
    link: {
        icon: strokeIcon('<path d="M10 13a5 5 0 0 0 7 0l1.5-1.5a5 5 0 0 0-7-7L10 6"/><path d="M14 11a5 5 0 0 0-7 0l-1.5 1.5a5 5 0 0 0 7 7L14 18"/>'),
        title: t('toolbar.link'),
        shortcut: 'Ctrl+K'
    },
    image: {
        icon: strokeIcon('<rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="M7 17l4-4 3 3 2-2 3 3"/>'),
        title: t('toolbar.image'),
        shortcut: 'Ctrl+Shift+I'
    },
    table: {
        icon: strokeIcon('<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M4 10h16"/><path d="M4 15h16"/><path d="M10 5v14"/><path d="M15 5v14"/>'),
        title: t('toolbar.table'),
        shortcut: 'Ctrl+Shift+T'
    },
    horizontalRule: {
        icon: strokeIcon('<path d="M5 12h14"/>'),
        title: t('toolbar.horizontalRule'),
        shortcut: 'Ctrl+Shift+-'
    },
    codeBlock: {
        icon: strokeIcon('<path d="M8 4H7a2 2 0 0 0-2 2v3a2 2 0 0 1-2 2 2 2 0 0 1 2 2v3a2 2 0 0 0 2 2h1"/><path d="M16 4h1a2 2 0 0 1 2 2v3a2 2 0 0 0 2 2 2 2 0 0 0-2 2v3a2 2 0 0 1-2 2h-1"/>'),
        title: t('toolbar.codeBlock'),
        shortcut: 'Ctrl+Shift+C'
    },
    clearFormatting: {
        icon: strokeIcon('<path d="M7 15l8-8 3 3-8 8H7v-3z"/><path d="M4 20h16"/>'),
        title: t('toolbar.clearFormatting')
    },
    emoji: {
        icon: strokeIcon('<circle cx="12" cy="12" r="8"/><path d="M9 10h.01"/><path d="M15 10h.01"/><path d="M8.5 14.5a5 5 0 0 0 7 0"/>'),
        title: t('toolbar.emoji')
    },
    copyMarkdown: {
        icon: strokeIcon('<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1"/>'),
        title: t('toolbar.copyMarkdown')
    },
    toggleViewMode: {
        icon: strokeIcon('<rect x="4" y="5" width="16" height="14" rx="2"/><polyline points="10 9 7 12 10 15"/><polyline points="14 9 17 12 14 15"/>'),
        title: t('toolbar.toggleViewMode'),
        shortcut: 'Ctrl+E'
    },
    toc: {
        icon: strokeIcon('<rect x="5" y="5" width="14" height="14" rx="2"/><path d="M8 9h8"/><path d="M8 12h8"/><path d="M8 15h5"/>'),
        title: t('toolbar.toc')
    },
    centerContent: {
        icon: strokeIcon('<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6" rx="1"/>'),
        title: t('toolbar.centerContent')
    },
    heading: {
        icon: textIcon('<text x="7" y="17" font-size="15" font-weight="700" fill="currentColor">T</text>'),
        title: t('toolbar.heading')
    },
    list: {
        icon: strokeIcon('<line x1="9" y1="7" x2="20" y2="7"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="17" x2="20" y2="17"/><circle cx="5" cy="7" r="1"/><circle cx="5" cy="12" r="1"/><circle cx="5" cy="17" r="1"/>'),
        title: t('toolbar.list')
    },
    insert: {
        icon: strokeIcon('<path d="M12 5v14"/><path d="M5 12h14"/>'),
        title: t('toolbar.insert')
    },
    video: {
        icon: strokeIcon('<rect x="4" y="7" width="11" height="10" rx="2"/><path d="M15 11l5-3v8l-5-3z"/>'),
        title: t('toolbar.video')
    },
    navBack: {
        icon: strokeIcon('<path d="M19 12H5"/><path d="M12 5l-7 7 7 7"/>'),
        title: t('toolbar.navBack')
    },
    navForward: {
        icon: strokeIcon('<path d="M5 12h14"/><path d="M12 5l7 7-7 7"/>'),
        title: t('toolbar.navForward')
    },
    shareLink: {
        icon: strokeIcon('<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.7 10.7l6.6-4.4"/><path d="M8.7 13.3l6.6 4.4"/>'),
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
        ['heading', 'list', 'insert'],
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
