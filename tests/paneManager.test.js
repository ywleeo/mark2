import assert from 'node:assert/strict';
import test from 'node:test';
import {
    createPaneManager,
    DEFAULT_SPLIT_RATIO,
    MAX_SPLIT_RATIO,
    MIN_SPLIT_RATIO,
    PANE_IDS,
    PANE_LAYOUT_MODES,
} from '../src/core/layout/PaneManager.js';

/**
 * 验证 PaneManager 默认只暴露主栏，保证接入后不改变现有单栏行为。
 */
test('PaneManager 默认处于单栏主栏上下文', () => {
    const manager = createPaneManager();
    const snapshot = manager.getSnapshot();

    assert.equal(snapshot.mode, PANE_LAYOUT_MODES.SINGLE);
    assert.equal(snapshot.focusedPaneId, PANE_IDS.PRIMARY);
    assert.equal(snapshot.splitRatio, DEFAULT_SPLIT_RATIO);
    assert.equal(snapshot.panes.primary.documentPath, null);
    assert.equal(snapshot.panes.secondary.documentPath, null);
});

/**
 * 验证主栏同步不会隐式打开副栏。
 */
test('同步主栏文档保持单栏模式', () => {
    const manager = createPaneManager();

    manager.syncPrimaryDocument('/workspace/a.md', { viewMode: 'markdown' });

    assert.deepEqual(manager.getPrimaryPane(), {
        id: PANE_IDS.PRIMARY,
        documentPath: '/workspace/a.md',
        viewMode: 'markdown',
    });
    assert.equal(manager.getMode(), PANE_LAYOUT_MODES.SINGLE);
});

/**
 * 验证副栏不能重复打开主栏当前文档。
 */
test('副栏拒绝与主栏相同的文档', () => {
    const manager = createPaneManager();
    manager.syncPrimaryDocument('/workspace/a.md');

    const result = manager.openSecondary('/workspace/a.md');

    assert.deepEqual(result, { opened: false, reason: 'already-open-in-primary' });
    assert.equal(manager.getMode(), PANE_LAYOUT_MODES.SINGLE);
});

/**
 * 验证打开和关闭副栏时焦点与文档状态正确迁移。
 */
test('副栏打开与关闭形成完整状态事务', () => {
    const manager = createPaneManager();
    manager.syncPrimaryDocument('/workspace/a.md');

    assert.deepEqual(manager.openSecondary('/workspace/b.md', { viewMode: 'code' }), { opened: true });
    assert.equal(manager.getMode(), PANE_LAYOUT_MODES.DUAL);
    assert.equal(manager.getFocusedPane().id, PANE_IDS.SECONDARY);
    assert.equal(manager.getSecondaryPane().documentPath, '/workspace/b.md');

    assert.equal(manager.closeSecondary(), true);
    assert.equal(manager.getMode(), PANE_LAYOUT_MODES.SINGLE);
    assert.equal(manager.getFocusedPane().id, PANE_IDS.PRIMARY);
    assert.equal(manager.getSecondaryPane().documentPath, null);
});

/**
 * 验证拖动比例始终处于允许范围。
 */
test('分栏比例限制在 25% 到 75%', () => {
    const manager = createPaneManager();

    manager.setSplitRatio(0.1);
    assert.equal(manager.getSplitRatio(), MIN_SPLIT_RATIO);

    manager.setSplitRatio(0.9);
    assert.equal(manager.getSplitRatio(), MAX_SPLIT_RATIO);

    manager.setSplitRatio(Number.NaN);
    assert.equal(manager.getSplitRatio(), DEFAULT_SPLIT_RATIO);
});

/**
 * 验证重命名会更新所有 Pane 引用，避免路径变化后出现悬空上下文。
 */
test('文档重命名迁移 Pane 路径', () => {
    const manager = createPaneManager();
    manager.syncPrimaryDocument('/workspace/a.md');
    manager.openSecondary('/workspace/b.md');

    assert.equal(manager.renameDocumentPath('/workspace/b.md', '/workspace/c.md'), true);
    assert.equal(manager.getSecondaryPane().documentPath, '/workspace/c.md');
    assert.equal(manager.getPrimaryPane().documentPath, '/workspace/a.md');
});

/**
 * 验证无变化提交不会产生冗余事件。
 */
test('PaneManager 只广播实际状态变化', () => {
    const manager = createPaneManager();
    const events = [];
    manager.subscribe(event => events.push(event.type));

    manager.syncPrimaryDocument('/workspace/a.md');
    manager.syncPrimaryDocument('/workspace/a.md');
    manager.focusPane(PANE_IDS.PRIMARY);

    assert.deepEqual(events, ['primary-document']);
});

/**
 * 验证工作区恢复保留左右比例和副栏文档，但不会恢复副栏焦点。
 */
test('恢复双栏布局后默认聚焦主栏', () => {
    const manager = createPaneManager();
    manager.syncPrimaryDocument('/workspace/a.md');

    manager.restoreLayout({
        mode: PANE_LAYOUT_MODES.DUAL,
        splitRatio: 0.62,
        secondaryDocumentPath: '/workspace/b.md',
        secondaryViewMode: 'code',
    });

    assert.equal(manager.getMode(), PANE_LAYOUT_MODES.DUAL);
    assert.equal(manager.getSplitRatio(), 0.62);
    assert.equal(manager.getFocusedPane().id, PANE_IDS.PRIMARY);
    assert.equal(manager.getSecondaryPane().documentPath, '/workspace/b.md');
    assert.equal(manager.getSecondaryPane().viewMode, 'code');
});

/**
 * 验证主标签切到副栏同一文件时自动收起副栏，避免同一路径双写。
 */
test('主栏接管副栏文档时自动降级为单栏', () => {
    const manager = createPaneManager();
    manager.syncPrimaryDocument('/workspace/a.md');
    manager.openSecondary('/workspace/b.md');

    manager.syncPrimaryDocument('/workspace/b.md', { viewMode: 'markdown' });

    assert.equal(manager.getMode(), PANE_LAYOUT_MODES.SINGLE);
    assert.equal(manager.getPrimaryPane().documentPath, '/workspace/b.md');
    assert.equal(manager.getSecondaryPane().documentPath, null);
});
