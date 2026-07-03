/**
 * Markdown 工具栏按钮配置
 * 包含所有按钮的图标、标题和快捷键
 */
import { t } from '../../i18n/index.js';
import { copyIcon } from '../../icons/uiIcons.js';

/**
 * 生成统一的线性工具栏图标。
 * 工具栏图标全部使用 24px viewBox + 统一 stroke，由 CSS 控制实际尺寸和线宽。
 */
const strokeIcon = (content) => `<svg class="toolbar-icon toolbar-icon--stroke" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">${content}</svg>`;

/**
 * 生成字形类工具栏图标。
 * Bold/Italic 等编辑器通用字形用文本保留直觉，其余功能尽量使用 strokeIcon。
 */
const textIcon = (content, className = '') => `<svg class="toolbar-icon toolbar-icon--text ${className}" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">${content}</svg>`;

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
        icon: strokeIcon('<path d="m9 8-4 4 4 4"/><path d="m15 8 4 4-4 4"/>'),
        title: t('toolbar.code'),
        shortcut: 'Ctrl+`'
    },
    quote: {
        icon: strokeIcon('<path d="M6 7v10"/><path d="M10 9h8"/><path d="M10 12h6"/><path d="M10 15h7"/>'),
        title: t('toolbar.quote'),
        shortcut: 'Ctrl+Shift+>'
    },
    unorderedList: {
        icon: strokeIcon('<path d="M9 7h10"/><path d="M9 12h10"/><path d="M9 17h10"/><path d="M5 7h.01"/><path d="M5 12h.01"/><path d="M5 17h.01"/>'),
        title: t('toolbar.unorderedList'),
        shortcut: 'Ctrl+Shift+8'
    },
    orderedList: {
        icon: strokeIcon('<path d="M10 7h9"/><path d="M10 12h9"/><path d="M10 17h9"/><path d="M5 6.2h1v3"/><path d="M4.8 12h2.2"/><path d="M5 10.8h.7a1.1 1.1 0 0 1 0 2.2H5"/><path d="M4.8 15.8h2.1L5.2 18H7"/>'),
        title: t('toolbar.orderedList'),
        shortcut: 'Ctrl+Shift+7'
    },
    taskList: {
        icon: strokeIcon('<path d="M10 7h9"/><path d="M10 12h9"/><path d="M10 17h9"/><path d="m4.5 7 1 1 2-2"/><path d="m4.5 12 1 1 2-2"/><path d="m4.5 17 1 1 2-2"/>'),
        title: t('toolbar.taskList'),
        shortcut: 'Ctrl+Shift+9'
    },
    link: {
        icon: strokeIcon('<path d="M9.5 8.5h-1A3.5 3.5 0 0 0 5 12a3.5 3.5 0 0 0 3.5 3.5h1"/><path d="M14.5 8.5h1A3.5 3.5 0 0 1 19 12a3.5 3.5 0 0 1-3.5 3.5h-1"/><path d="M9 12h6"/>'),
        title: t('toolbar.link'),
        shortcut: 'Ctrl+K'
    },
    image: {
        icon: strokeIcon('<rect x="5" y="6" width="14" height="12" rx="2"/><path d="m7.5 15 3-3 2.5 2.5 1.5-1.5 2 2"/><path d="M9 9.5h.01"/>'),
        title: t('toolbar.image'),
        shortcut: 'Ctrl+Shift+I'
    },
    table: {
        icon: strokeIcon('<rect x="5" y="6" width="14" height="12" rx="2"/><path d="M5 10h14"/><path d="M10 6v12"/>'),
        title: t('toolbar.table'),
        shortcut: 'Ctrl+Shift+T'
    },
    horizontalRule: {
        icon: strokeIcon('<path d="M5 12h14"/>'),
        title: t('toolbar.horizontalRule'),
        shortcut: 'Ctrl+Shift+-'
    },
    codeBlock: {
        icon: strokeIcon('<path d="M9 6H7.5A2.5 2.5 0 0 0 5 8.5v1A2.5 2.5 0 0 1 2.5 12 2.5 2.5 0 0 1 5 14.5v1A2.5 2.5 0 0 0 7.5 18H9"/><path d="M15 6h1.5A2.5 2.5 0 0 1 19 8.5v1a2.5 2.5 0 0 0 2.5 2.5A2.5 2.5 0 0 0 19 14.5v1a2.5 2.5 0 0 1-2.5 2.5H15"/>'),
        title: t('toolbar.codeBlock'),
        shortcut: 'Ctrl+Shift+C'
    },
    clearFormatting: {
        icon: strokeIcon('<path d="m7 15 7-7a1.5 1.5 0 0 1 2.1 0l.9.9a1.5 1.5 0 0 1 0 2.1l-7 7H7z"/><path d="M5 20h14"/>'),
        title: t('toolbar.clearFormatting')
    },
    emoji: {
        icon: strokeIcon('<circle cx="12" cy="12" r="8"/><path d="M9 10h.01"/><path d="M15 10h.01"/><path d="M8.5 14.5a5 5 0 0 0 7 0"/>'),
        title: t('toolbar.emoji')
    },
    copyMarkdown: {
        icon: copyIcon({ className: 'toolbar-icon toolbar-icon--stroke', strokeWidth: 1.65 }),
        title: t('toolbar.copyMarkdown')
    },
    toggleViewMode: {
        icon: strokeIcon('<rect x="5" y="6" width="14" height="12" rx="2"/><path d="m10 10-2 2 2 2"/><path d="m14 10 2 2-2 2"/>'),
        title: t('toolbar.toggleViewMode'),
        shortcut: 'Ctrl+E'
    },
    toc: {
        icon: strokeIcon('<rect x="6" y="5" width="12" height="14" rx="2"/><path d="M9 9h6"/><path d="M9 12h6"/><path d="M9 15h4"/>'),
        title: t('toolbar.toc')
    },
    centerContent: {
        icon: strokeIcon('<rect x="5" y="5" width="14" height="14" rx="2.2"/><rect x="9.2" y="9.2" width="5.6" height="5.6" rx="1.2"/>'),
        title: t('toolbar.centerContent')
    },
    heading: {
        icon: textIcon('<text x="7" y="17" font-size="15" font-weight="700" fill="currentColor">T</text>'),
        title: t('toolbar.heading')
    },
    list: {
        icon: strokeIcon('<path d="M9 7h10"/><path d="M9 12h10"/><path d="M9 17h10"/><path d="M5 7h.01"/><path d="M5 12h.01"/><path d="M5 17h.01"/>'),
        title: t('toolbar.list')
    },
    insert: {
        icon: strokeIcon('<path d="M12 5v14"/><path d="M5 12h14"/>'),
        title: t('toolbar.insert')
    },
    video: {
        icon: strokeIcon('<rect x="5" y="7" width="11" height="10" rx="2"/><path d="m16 10 4-2v8l-4-2z"/>'),
        title: t('toolbar.video')
    },
    navBack: {
        icon: strokeIcon('<path d="M19 12H5.5"/><path d="m12 5.5-6.5 6.5 6.5 6.5"/>'),
        title: t('toolbar.navBack')
    },
    navForward: {
        icon: strokeIcon('<path d="M5 12h13.5"/><path d="m12 5.5 6.5 6.5-6.5 6.5"/>'),
        title: t('toolbar.navForward')
    },
    shareLink: {
        icon: strokeIcon('<circle cx="18" cy="6.5" r="2.2"/><circle cx="6" cy="12" r="2.2"/><circle cx="18" cy="17.5" r="2.2"/><path d="m8 11 8-3.6"/><path d="m8 13 8 3.6"/>'),
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
