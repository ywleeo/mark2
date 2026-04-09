/**
 * Markdown 工具栏按钮配置
 * 包含所有按钮的图标、标题和快捷键
 */
import { t } from '../../i18n/index.js';

export const BUTTON_CONFIG = {
    bold: {
        icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M13.5,15.5H10V12.5H13.5A1.5,1.5 0 0,1 15,14A1.5,1.5 0 0,1 13.5,15.5M10,6.5H13A1.5,1.5 0 0,1 14.5,8A1.5,1.5 0 0,1 13,9.5H10M15.6,10.79C16.57,10.11 17.25,9 17.25,8C17.25,5.74 15.5,4 13.25,4H7V18H14.04C16.14,18 17.75,16.3 17.75,14.21C17.75,12.69 16.89,11.39 15.6,10.79Z" />
        </svg>`,
        title: `${t('toolbar.bold')} (Ctrl+B)`,
        shortcut: 'Ctrl+B'
    },
    italic: {
        icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M10,4V7H12.21L8.79,15H6V18H14V15H11.79L15.21,7H18V4H10Z" />
        </svg>`,
        title: `${t('toolbar.italic')} (Ctrl+I)`,
        shortcut: 'Ctrl+I'
    },
    strikethrough: {
        icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M23,12V14H18.61C19.61,16.14 19.56,22 12.38,22C4.05,22.05 4.37,15.5 4.37,15.5L8.34,15.55C8.34,15.55 8.14,18.82 11.5,18.82C14.86,18.82 15.12,16.5 14.5,14H1V12H23M3.41,10H20.59C20.59,10 20.59,8 19,8H17.92C17.91,7.56 17.78,4 11.83,4C4.46,4 4.82,10 4.82,10M9.03,8C9.03,8 9.03,6 11.5,6C13.97,6 13.97,8 13.97,8H9.03Z" />
        </svg>`,
        title: t('toolbar.strikethrough'),
        shortcut: 'Ctrl+Shift+S'
    },
    heading1: {
        icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <text x="6" y="18" font-size="20" font-weight="bold" fill="currentColor">#</text>
        </svg>`,
        title: t('toolbar.heading1'),
        shortcut: 'Ctrl+1'
    },
    heading2: {
        icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <text x="6" y="17" font-size="16" font-weight="bold" fill="currentColor">#</text>
        </svg>`,
        title: t('toolbar.heading2'),
        shortcut: 'Ctrl+2'
    },
    heading3: {
        icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <text x="7" y="16" font-size="13" font-weight="bold" fill="currentColor">#</text>
        </svg>`,
        title: t('toolbar.heading3'),
        shortcut: 'Ctrl+3'
    },
    code: {
        icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M9.4,16.6L4.8,12L9.4,7.4L8,6L2,12L8,18L9.4,16.6M14.6,16.6L19.2,12L14.6,7.4L16,6L22,12L16,18L14.6,16.6Z" />
        </svg>`,
        title: t('toolbar.code'),
        shortcut: 'Ctrl+`'
    },
    quote: {
        icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M14,17H17L19,13V7H13V13H16M6,17H9L11,13V7H5V13H8L6,17Z" />
        </svg>`,
        title: t('toolbar.quote'),
        shortcut: 'Ctrl+Shift+>'
    },
    unorderedList: {
        icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="4" cy="6" r="2.2" />
            <circle cx="4" cy="12" r="2.2" />
            <circle cx="4" cy="18" r="2.2" />
            <path d="M8,5H21V7H8V5M8,11H21V13H8V11M8,17H21V19H8V17Z" />
        </svg>`,
        title: t('toolbar.unorderedList'),
        shortcut: 'Ctrl+Shift+8'
    },
    orderedList: {
        icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <text x="4" y="17" font-size="16" font-weight="bold" fill="currentColor">1.</text>
        </svg>`,
        title: t('toolbar.orderedList'),
        shortcut: 'Ctrl+Shift+7'
    },
    taskList: {
        icon: `<svg width="16" height="16" viewBox="0 0 24 24" style="fill: none !important;" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect>
            <polyline points="8 12 11 15 16 9"></polyline>
        </svg>`,
        title: t('toolbar.taskList'),
        shortcut: 'Ctrl+Shift+9'
    },
    link: {
        icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M10.59,13.41C11,13.8 11,14.44 10.59,14.83C10.2,15.22 9.56,15.22 9.17,14.83C7.22,12.88 7.22,9.71 9.17,7.76V7.76L12.71,4.22C14.66,2.27 17.83,2.27 19.78,4.22C21.73,6.17 21.73,9.34 19.78,11.29L18.29,12.78C18.3,11.96 18.17,11.14 17.89,10.36L18.36,9.88C19.54,8.71 19.54,6.81 18.36,5.64C17.19,4.46 15.29,4.46 14.12,5.64L10.59,9.17C9.41,10.34 9.41,12.24 10.59,13.41M13.41,9.17C13.8,8.78 14.44,8.78 14.83,9.17C16.78,11.12 16.78,14.29 14.83,16.24V16.24L11.29,19.78C9.34,21.73 6.17,21.73 4.22,19.78C2.27,17.83 2.27,14.66 4.22,12.71L5.71,11.22C5.7,12.04 5.83,12.86 6.11,13.65L5.64,14.12C4.46,15.29 4.46,17.19 5.64,18.36C6.81,19.54 8.71,19.54 9.88,18.36L13.41,14.83C14.59,13.66 14.59,11.76 13.41,10.59C13,10.2 13,9.56 13.41,9.17Z" />
        </svg>`,
        title: t('toolbar.link'),
        shortcut: 'Ctrl+K'
    },
    image: {
        icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M21,17H7V3H21M21,1H7A2,2 0 0,0 5,3V17A2,2 0 0,0 7,19H21A2,2 0 0,0 23,17V3A2,2 0 0,0 21,1M3,5H1V21A2,2 0 0,0 3,23H19V21H3M15.96,10.29L13.21,13.83L11.25,11.47L8.5,15H19.5L15.96,10.29Z" />
        </svg>`,
        title: t('toolbar.image'),
        shortcut: 'Ctrl+Shift+I'
    },
    table: {
        icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M5,4H19A2,2 0 0,1 21,6V18A2,2 0 0,1 19,20H5A2,2 0 0,1 3,18V6A2,2 0 0,1 5,4M5,8V12H11V8H5M13,8V12H19V8H13M5,14V18H11V14H5M13,14V18H19V14H13Z" />
        </svg>`,
        title: t('toolbar.table'),
        shortcut: 'Ctrl+Shift+T'
    },
    horizontalRule: {
        icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M3,13H21V11H3M3,19H21V18H3M3,6H21V5H3V6Z" />
        </svg>`,
        title: t('toolbar.horizontalRule'),
        shortcut: 'Ctrl+Shift+-'
    },
    codeBlock: {
        icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8,3A2,2 0 0,0 6,5V9A2,2 0 0,1 4,11H3V13H4A2,2 0 0,1 6,15V19A2,2 0 0,0 8,21H10V19H8V14A2,2 0 0,0 6,12A2,2 0 0,0 8,10V5H10V3M16,3A2,2 0 0,1 18,5V9A2,2 0 0,0 20,11H21V13H20A2,2 0 0,0 18,15V19A2,2 0 0,1 16,21H14V19H16V14A2,2 0 0,1 18,12A2,2 0 0,1 16,10V5H14V3H16Z" />
        </svg>`,
        title: t('toolbar.codeBlock'),
        shortcut: 'Ctrl+Shift+C'
    },
    clearFormatting: {
        icon: `<svg width="16" height="16" viewBox="0 0 24 24" style="fill: none !important;" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <rect x="6" y="4" width="12" height="8" rx="1" transform="rotate(-45 12 8)"></rect>
            <line x1="3" y1="20" x2="21" y2="20"></line>
        </svg>`,
        title: t('toolbar.clearFormatting')
    },
    emoji: {
        icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20M8.5,11A1.5,1.5 0 0,1 7,9.5A1.5,1.5 0 0,1 8.5,8A1.5,1.5 0 0,1 10,9.5A1.5,1.5 0 0,1 8.5,11M15.5,11A1.5,1.5 0 0,1 14,9.5A1.5,1.5 0 0,1 15.5,8A1.5,1.5 0 0,1 17,9.5A1.5,1.5 0 0,1 15.5,11M12,17.5C14.33,17.5 16.3,16.04 17.11,14H6.89C7.69,16.04 9.67,17.5 12,17.5Z" />
        </svg>`,
        title: t('toolbar.emoji')
    },
    cardExport: {
        icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <rect x="4" y="5" width="16" height="14" rx="3"></rect>
            <path d="M8 9H16M8 13H13"></path>
        </svg>`,
        title: t('toolbar.cardExport')
    },
    copyMarkdown: {
        icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19,21H8V7H19M19,5H8A2,2 0 0,0 6,7V21A2,2 0 0,0 8,23H19A2,2 0 0,0 21,21V7A2,2 0 0,0 19,5M16,1H4A2,2 0 0,0 2,3V17H4V3H16V1Z" />
        </svg>`,
        title: t('toolbar.copyMarkdown')
    },
    toggleViewMode: {
        icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M9.4,16.6L4.8,12L9.4,7.4L8,6L2,12L8,18L9.4,16.6M14.6,16.6L19.2,12L14.6,7.4L16,6L22,12L16,18L14.6,16.6Z" />
        </svg>`,
        title: t('toolbar.toggleViewMode'),
        shortcut: 'Ctrl+E'
    },
    toc: {
        icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19,3H5C3.9,3,3,3.9,3,5V19C3,20.1,3.9,21,5,21H19C20.1,21,21,20.1,21,19V5C21,3.9,20.1,3,19,3M19,19H5V5H19V19M7,9H17V7H7V9M7,13H17V11H7V13M7,17H17V15H7V17Z" />
        </svg>`,
        title: t('toolbar.toc')
    },
    centerContent: {
        icon: `<svg width="16" height="16" viewBox="0 0 24 24" style="fill: none !important;" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="2" width="20" height="20" rx="2"></rect>
            <rect x="8" y="8" width="8" height="8" rx="1"></rect>
        </svg>`,
        title: t('toolbar.centerContent')
    }
};

/**
 * 默认工具栏按钮列表
 */
export const DEFAULT_BUTTONS = [
    'bold',
    'italic',
    'strikethrough',
    'heading1',
    'heading2',
    'heading3',
    'code',
    'quote',
    'unorderedList',
    'orderedList',
    'taskList',
    'link',
    'image',
    'table',
    'horizontalRule',
    'codeBlock',
    'clearFormatting',
    'emoji',
    'cardExport',
    'separator',
    'toggleViewMode'
];
