import assert from 'node:assert/strict';
import test from 'node:test';

import {
    calculateGridExtent,
    calculateMergedRegionRect,
    findMergedRegionAtColumn,
    getMergedRegionsForRow,
    getMergedRegionsInWindow,
    normalizeMergedRegions,
} from '../src/components/spreadsheet-viewer/mergeLayout.js';

/**
 * 验证后端坐标协议归一化并过滤不安全的合并区域。
 */
test('归一化合并区域并兼容两种字段命名', () => {
    const regions = normalizeMergedRegions([
        { startRow: 1, startColumn: 2, endRow: 3, endColumn: 4 },
        { start_row: 0, start_column: 0, end_row: 0, end_column: 1 },
        { startRow: 4, startColumn: 4, endRow: 4, endColumn: 4 },
        { startRow: -1, startColumn: 0, endRow: 2, endColumn: 0 },
    ]);

    assert.deepEqual(regions, [
        { startRow: 0, startColumn: 0, endRow: 0, endColumn: 1 },
        { startRow: 1, startColumn: 2, endRow: 3, endColumn: 4 },
    ]);
});

/**
 * 验证只有合并区域占用的空白行列也会进入虚拟表格范围。
 */
test('合并区域参与虚拟表格边界计算', () => {
    const extent = calculateGridExtent(
        [['标题']],
        [{ startRow: 0, startColumn: 0, endRow: 2, endColumn: 3 }],
    );

    assert.deepEqual(extent, { rowCount: 3, columnCount: 4 });
});

/**
 * 验证跨行合并在滚动窗口和单元格命中查询中保持可见。
 */
test('跨虚拟窗口查找纵向合并区域', () => {
    const regions = [
        { startRow: 2, startColumn: 1, endRow: 8, endColumn: 2 },
        { startRow: 12, startColumn: 0, endRow: 12, endColumn: 3 },
    ];

    assert.deepEqual(getMergedRegionsInWindow(regions, 5, 10), [regions[0]]);
    assert.deepEqual(getMergedRegionsForRow(regions, 6), [regions[0]]);
    assert.equal(findMergedRegionAtColumn([regions[0]], 2), regions[0]);
    assert.equal(findMergedRegionAtColumn([regions[0]], 3), null);
});

/**
 * 验证合并单元格尺寸由跨列宽度和跨行高度精确累加。
 */
test('计算缩放后的合并单元格覆盖层坐标', () => {
    const rect = calculateMergedRegionRect(
        { startRow: 3, startColumn: 1, endRow: 4, endColumn: 2 },
        [80, 120, 160],
        48,
        1.5,
        2,
        60,
    );

    assert.deepEqual(rect, {
        left: 210,
        top: 48,
        width: 420,
        height: 96,
    });
});
