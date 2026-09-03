/**
 * 电子表格合并区域的纯数据归一化与布局计算，保持渲染组件只负责 DOM。
 */

const MAX_EXCEL_ROW_INDEX = 1_048_575;
const MAX_EXCEL_COLUMN_INDEX = 16_383;

/**
 * 从兼容 camelCase 与 snake_case 的协议对象中读取整数坐标。
 * @param {Object} region - 原始合并区域。
 * @param {string} camelKey - camelCase 字段名。
 * @param {string} snakeKey - snake_case 字段名。
 * @returns {number|null} 合法整数坐标。
 */
function readCoordinate(region, camelKey, snakeKey) {
    const value = region?.[camelKey] ?? region?.[snakeKey];
    return Number.isSafeInteger(value) ? value : null;
}

/**
 * 归一化后端合并区域，拒绝越界、反向和单格伪合并数据。
 * @param {Array<Object>} regions - 后端返回的合并区域。
 * @returns {Array<{startRow:number,startColumn:number,endRow:number,endColumn:number}>} 安全的合并区域。
 */
export function normalizeMergedRegions(regions) {
    if (!Array.isArray(regions)) {
        return [];
    }

    return regions
        .map((region) => ({
            startRow: readCoordinate(region, 'startRow', 'start_row'),
            startColumn: readCoordinate(region, 'startColumn', 'start_column'),
            endRow: readCoordinate(region, 'endRow', 'end_row'),
            endColumn: readCoordinate(region, 'endColumn', 'end_column'),
        }))
        .filter((region) => region.startRow !== null
            && region.startColumn !== null
            && region.endRow !== null
            && region.endColumn !== null
            && region.startRow >= 0
            && region.startColumn >= 0
            && region.endRow >= region.startRow
            && region.endColumn >= region.startColumn
            && region.endRow <= MAX_EXCEL_ROW_INDEX
            && region.endColumn <= MAX_EXCEL_COLUMN_INDEX
            && (region.startRow !== region.endRow || region.startColumn !== region.endColumn))
        .sort((left, right) => left.startRow - right.startRow
            || left.startColumn - right.startColumn);
}

/**
 * 根据数据和合并区域计算虚拟表格必须覆盖的行列范围。
 * @param {Array<Array<string>>} rows - 工作表二维数据。
 * @param {Array<Object>} regions - 已归一化的合并区域。
 * @returns {{rowCount:number,columnCount:number}} 表格范围。
 */
export function calculateGridExtent(rows, regions) {
    let rowCount = Array.isArray(rows) ? rows.length : 0;
    let columnCount = Array.isArray(rows)
        ? rows.reduce((maximum, row) => Math.max(maximum, Array.isArray(row) ? row.length : 0), 0)
        : 0;

    regions.forEach((region) => {
        rowCount = Math.max(rowCount, region.endRow + 1);
        columnCount = Math.max(columnCount, region.endColumn + 1);
    });
    return { rowCount, columnCount };
}

/**
 * 返回覆盖指定行的合并区域，供单行渲染快速复用。
 * @param {Array<Object>} regions - 已归一化的合并区域。
 * @param {number} rowIndex - 零基行号。
 * @returns {Array<Object>} 覆盖该行的区域。
 */
export function getMergedRegionsForRow(regions, rowIndex) {
    return regions.filter(region => region.startRow <= rowIndex && region.endRow >= rowIndex);
}

/**
 * 在当前行的区域列表中查找覆盖指定列的合并区域。
 * @param {Array<Object>} rowRegions - 覆盖当前行的合并区域。
 * @param {number} columnIndex - 零基列号。
 * @returns {Object|null} 命中的合并区域。
 */
export function findMergedRegionAtColumn(rowRegions, columnIndex) {
    return rowRegions.find(region => region.startColumn <= columnIndex
        && region.endColumn >= columnIndex) || null;
}

/**
 * 返回与当前虚拟行窗口相交的合并区域。
 * @param {Array<Object>} regions - 已归一化的合并区域。
 * @param {number} startRow - 可视窗口起始行（包含）。
 * @param {number} endRow - 可视窗口结束行（不包含）。
 * @returns {Array<Object>} 与窗口相交的区域。
 */
export function getMergedRegionsInWindow(regions, startRow, endRow) {
    return regions.filter(region => region.endRow >= startRow && region.startRow < endRow);
}

/**
 * 计算合并单元格在当前虚拟行容器中的绝对布局。
 * @param {Object} region - 已归一化的合并区域。
 * @param {Array<number>} columnWidths - 未缩放的列宽。
 * @param {number} rowHeight - 已缩放的固定行高。
 * @param {number} zoomScale - 当前缩放比例。
 * @param {number} renderedStartRow - 当前虚拟窗口起始行。
 * @param {number} rowIndexWidth - 未缩放的行号列宽。
 * @returns {{left:number,top:number,width:number,height:number}} CSS 像素布局。
 */
export function calculateMergedRegionRect(
    region,
    columnWidths,
    rowHeight,
    zoomScale,
    renderedStartRow,
    rowIndexWidth,
) {
    const precedingWidth = columnWidths
        .slice(0, region.startColumn)
        .reduce((total, width) => total + width, 0);
    const mergedWidth = columnWidths
        .slice(region.startColumn, region.endColumn + 1)
        .reduce((total, width) => total + width, 0);

    return {
        left: (rowIndexWidth + precedingWidth) * zoomScale,
        top: (region.startRow - renderedStartRow) * rowHeight,
        width: mergedWidth * zoomScale,
        height: (region.endRow - region.startRow + 1) * rowHeight,
    };
}
