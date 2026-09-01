import assert from 'node:assert/strict';
import test from 'node:test';

import {
    hasTextSelectionWithin,
    isCellContentTruncated,
    writeCellValueToCopyEvent,
} from '../src/components/spreadsheet-viewer/cellInteraction.js';

/**
 * 验证浮层只针对真实发生截断的单元格显示。
 */
test('仅将发生内容溢出的单元格识别为截断状态', () => {
    assert.equal(isCellContentTruncated({ scrollWidth: 240, clientWidth: 120, scrollHeight: 32, clientHeight: 32 }), true);
    assert.equal(isCellContentTruncated({ scrollWidth: 121, clientWidth: 120, scrollHeight: 32, clientHeight: 32 }), false);
    assert.equal(isCellContentTruncated({ scrollWidth: 120, clientWidth: 120, scrollHeight: 48, clientHeight: 32 }), true);
});

/**
 * 验证局部文本选择优先于整格复制，保留双击和拖选能力。
 */
test('识别表格视口内的非折叠文本选择', () => {
    const anchorNode = {};
    const focusNode = {};
    const viewport = {
        contains(node) {
            return node === anchorNode || node === focusNode;
        },
    };

    assert.equal(hasTextSelectionWithin(viewport, {
        isCollapsed: false,
        rangeCount: 1,
        anchorNode,
        focusNode,
    }), true);
    assert.equal(hasTextSelectionWithin(viewport, {
        isCollapsed: true,
        rangeCount: 1,
        anchorNode,
        focusNode,
    }), false);
});

/**
 * 验证整格复制写入完整原始值，而不是界面中的省略文本。
 */
test('copy 事件接管后写入完整单元格内容', () => {
    const clipboard = new Map();
    let prevented = false;
    const event = {
        clipboardData: {
            setData(type, value) {
                clipboard.set(type, value);
            },
        },
        preventDefault() {
            prevented = true;
        },
    };

    assert.equal(writeCellValueToCopyEvent(event, '一段界面中显示不全的完整内容'), true);
    assert.equal(clipboard.get('text/plain'), '一段界面中显示不全的完整内容');
    assert.equal(prevented, true);
});
