/**
 * 事件设置
 * 负责设置所有事件监听器
 */

import { eventBus } from '../core/EventBus.js';
import { EVENT_IDS } from '../core/eventIds.js';

/**
 * 设置工具栏相关事件监听
 * @param {Object} params - 参数对象
 */
export function setupToolbarEvents({
    handleToolbarOnViewModeChange,
    handleToolbarOnFileChange,
}) {
    // 监听视图模式切换，自动更新工具栏
    eventBus.on(EVENT_IDS.VIEW_MODE_CHANGED, ({ mode }) => {
        handleToolbarOnViewModeChange(mode);
    });

    // 监听文件切换，只在Markdown文件时显示工具栏
    eventBus.on(EVENT_IDS.FILE_CHANGED, ({ path }) => {
        handleToolbarOnFileChange(path);
    });
}
