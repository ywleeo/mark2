import assert from 'node:assert/strict';
import test from 'node:test';

import { isActiveContentTab } from '../src/modules/navigation/tabActivity.js';

/**
 * 验证文件被外部删除、活动路径已提前清空时，标签栏状态仍能识别当前内容。
 */
test('已删除文件的活动标签仍被识别为当前内容', () => {
    const deletedPath = '/tmp/deleted.md';
    const isActive = isActiveContentTab({
        tab: { id: deletedPath, type: 'file', path: deletedPath },
        activeTabId: deletedPath,
        activePaths: [null, null, null],
    });

    assert.equal(isActive, true);
});

/**
 * 验证关闭后台标签不会因其他活动路径而误清当前内容。
 */
test('非活动标签不会被识别为当前内容', () => {
    const isActive = isActiveContentTab({
        tab: { id: '/tmp/deleted.md', type: 'file', path: '/tmp/deleted.md' },
        activeTabId: '/tmp/active.md',
        activePaths: ['/tmp/active.md'],
    });

    assert.equal(isActive, false);
});

/**
 * 验证标签 ID 尚未同步时，文档路径仍可识别活动标签。
 */
test('文档路径可补偿尚未同步的标签栏状态', () => {
    const isActive = isActiveContentTab({
        tab: { id: 'shared-preview', type: 'shared', path: '/tmp/current.md' },
        activeTabId: null,
        activePaths: ['/tmp/current.md'],
    });

    assert.equal(isActive, true);
});
