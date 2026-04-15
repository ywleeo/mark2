/**
 * EventBus 事件名集中定义,防止字符串 typo。
 * 约定: `<域>:<动作>`,kebab-case。
 */

export const EVENT_IDS = Object.freeze({
    APP_INITIALIZED: 'app:initialized',
    EDITOR_READY: 'editor:ready',
    VIEW_MODE_CHANGED: 'view-mode-changed',
    FILE_CHANGED: 'file-changed',
    TAB_SWITCH: 'tab:switch',
    DOCUMENT_IO_PREFIX: 'document:io:',
});
