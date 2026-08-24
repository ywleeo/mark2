/**
 * 工作区左右栏布局快照的兼容性与容错测试。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createDefaultWorkspaceState,
    normalizeWorkspaceState,
} from '../src/utils/workspaceState.js';

test('旧工作区快照默认恢复为单栏', () => {
    const normalized = normalizeWorkspaceState({ openFiles: ['/tmp/a.md'] });

    assert.deepEqual(normalized.layout, createDefaultWorkspaceState().layout);
});

test('双栏快照保留副栏文档并约束拖动比例', () => {
    const normalized = normalizeWorkspaceState({
        currentFile: '/tmp/main.md',
        openFiles: ['/tmp/main.md'],
        layout: {
            mode: 'dual',
            splitRatio: 0.95,
            secondaryDocumentPath: '/tmp/compare.md',
            secondaryViewMode: 'code',
        },
    });

    assert.deepEqual(normalized.layout, {
        mode: 'dual',
        splitRatio: 0.75,
        secondaryDocumentPath: '/tmp/compare.md',
        secondaryViewMode: 'code',
    });
});

test('主副栏指向同一文档时安全降级为单栏', () => {
    const normalized = normalizeWorkspaceState({
        currentFile: '/tmp/same.md',
        openFiles: ['/tmp/same.md'],
        layout: {
            mode: 'dual',
            splitRatio: 0.4,
            secondaryDocumentPath: '/tmp/same.md',
            secondaryViewMode: 'markdown',
        },
    });

    assert.equal(normalized.layout.mode, 'single');
    assert.equal(normalized.layout.secondaryDocumentPath, null);
});

test('不存在的副栏 untitled 快照不会被恢复', () => {
    const normalized = normalizeWorkspaceState({
        layout: {
            mode: 'dual',
            secondaryDocumentPath: 'untitled://missing',
            secondaryViewMode: 'markdown',
        },
        untitledTabs: [],
    });

    assert.equal(normalized.layout.mode, 'single');
    assert.equal(normalized.layout.secondaryDocumentPath, null);
});
