import assert from 'node:assert/strict';
import test from 'node:test';
import {
    decorateTableDomSpec,
    getTableColumnCount,
    resolveTableLayoutMode,
} from '../src/extensions/AdaptiveTable.js';

/**
 * 创建测试使用的最小 ProseMirror 表格节点替身。
 *
 * @param {number[][]} rows - 每行各单元格的 colspan。
 * @param {string} style - 表格内联样式。
 * @returns {object} 表格节点替身。
 */
function createTableNode(rows, style = '') {
    const rowNodes = rows.map(colspans => ({
        childCount: colspans.length,
        child(index) {
            return { attrs: { colspan: colspans[index] } };
        },
    }));
    return {
        attrs: { style },
        childCount: rowNodes.length,
        child(index) {
            return rowNodes[index];
        },
    };
}

test('普通 Markdown 表格使用无横向滚动的自适应布局', () => {
    const table = createTableNode([[1, 1, 1, 1], [1, 1, 1, 1]]);

    assert.equal(getTableColumnCount(table), 4);
    assert.equal(resolveTableLayoutMode(table), 'responsive');
});

test('多列表格和显式宽度表格保留横向滚动布局', () => {
    assert.equal(resolveTableLayoutMode(createTableNode([[1, 1, 1, 1, 1, 1, 1]])), 'scrollable');
    assert.equal(resolveTableLayoutMode(createTableNode([[2, 2, 2, 1]])), 'scrollable');
    assert.equal(resolveTableLayoutMode(createTableNode([[1, 1]], 'width: 980px')), 'scrollable');
});

test('表格 DOM spec 携带布局 class 且保留 TipTap 原属性', () => {
    const tableSpec = ['div', { class: 'tableWrapper', role: 'group' }, ['table', {}, 0]];
    const decorated = decorateTableDomSpec(tableSpec, 'responsive');

    assert.equal(decorated[0], 'div');
    assert.equal(decorated[1].class, 'tableWrapper tableWrapper--responsive');
    assert.equal(decorated[1].role, 'group');
    assert.equal(decorated[1]['data-table-layout'], 'responsive');
    assert.deepEqual(decorated[2], ['table', {}, 0]);
});
