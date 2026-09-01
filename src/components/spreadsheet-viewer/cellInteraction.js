/**
 * 判断单元格当前是否因固定列宽而截断内容。
 * @param {HTMLElement|null|undefined} cell - 待检测的单元格元素。
 * @returns {boolean} 内容是否发生横向或纵向溢出。
 */
export function isCellContentTruncated(cell) {
    if (!cell) {
        return false;
    }
    return cell.scrollWidth > cell.clientWidth + 1 || cell.scrollHeight > cell.clientHeight + 1;
}

/**
 * 判断用户是否已在表格视口内主动选择了一段文本。
 * @param {HTMLElement|null|undefined} viewport - 表格视口元素。
 * @param {Selection|null|undefined} selection - 浏览器 Selection 对象。
 * @returns {boolean} 是否应优先保留浏览器原生的局部文本复制。
 */
export function hasTextSelectionWithin(viewport, selection) {
    if (!viewport || !selection || selection.isCollapsed || selection.rangeCount === 0) {
        return false;
    }
    return viewport.contains(selection.anchorNode) && viewport.contains(selection.focusNode);
}

/**
 * 将完整单元格值写入原生 copy 事件，避免依赖剪贴板权限。
 * @param {ClipboardEvent} event - 浏览器 copy 事件。
 * @param {string} value - 单元格的完整原始值。
 * @returns {boolean} 是否成功接管复制。
 */
export function writeCellValueToCopyEvent(event, value) {
    if (!event?.clipboardData || typeof event.clipboardData.setData !== 'function') {
        return false;
    }
    event.clipboardData.setData('text/plain', value ?? '');
    event.preventDefault();
    return true;
}
