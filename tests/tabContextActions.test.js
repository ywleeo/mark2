/** 标签菜单回归：右键目标、预览复用、保存状态和批量关闭中断。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createTabCloseAction, getCloseTargets, isSavedTab } from '../src/modules/tab-context-menu/tabContextActions.js';

/** 创建普通标签或共享预览，保留显式路径以覆盖预览身份检查。 */
function tab(path, options = {}) {
    return { id: path, path, type: 'file', dirty: false, ...options };
}

/** 创建可模拟取消、编辑、预览复用和并发操作的关闭环境。 */
function harness(initialTabs, { activeId = initialTabs[0]?.id, onClose, hasUnsavedChanges = async () => false } = {}) {
    const state = { tabs: initialTabs, calls: [] };
    state.close = createTabCloseAction({
        getTabs: () => state.tabs,
        getActiveTabId: () => activeId,
        hasUnsavedChanges,
        closeTab: async id => {
            state.calls.push(id);
            if (await onClose?.(id, state) === false) return;
            state.tabs = state.tabs.filter(item => item.id !== id);
        },
    });
    return state;
}

test('关闭针对右键的后台标签，不改变当前文稿', async () => {
    const [a, b] = [tab('/a.md'), tab('/b.md')];
    const state = harness([a, b]);
    await state.close({ target: b, scope: 'current' });
    assert.deepEqual(state.tabs, [a]);
    assert.deepEqual(state.calls, [b.id]);
});

test('关闭其他保留右键目标，当前激活标签最后处理', async () => {
    const [a, b, c] = [tab('/a.md'), tab('/b.md'), tab('/c.md')];
    const state = harness([a, b, c]);
    await state.close({ target: b, scope: 'others' });
    assert.deepEqual(state.calls, [c.id, a.id]);
    assert.deepEqual(state.tabs, [b]);
});

test('关闭全部包含共享预览与草稿，且当前激活项最后关闭', async () => {
    const tabs = [tab('/a.md'), tab('/preview.md', { id: 'shared-preview', type: 'shared' }), tab('untitled://draft')];
    const state = harness(tabs);
    assert.equal(await state.close({ target: tabs[0], scope: 'all' }), true);
    assert.deepEqual(state.calls, ['shared-preview', 'untitled://draft', '/a.md']);
    assert.deepEqual(state.tabs, []);
});

test('关闭已保存保留 dirty、保存中、空白草稿及权威内容有改动的标签', async () => {
    const tabs = [tab('/saved.md'), tab('/dirty.md', { dirty: true }), tab('/saving.md', { syncing: true }),
        tab('untitled://empty'), tab('/changed.md'), tab('/preview.md', { id: 'shared-preview', type: 'shared' })];
    const state = harness(tabs, { hasUnsavedChanges: async path => path === '/changed.md' });
    await state.close({ target: tabs[1], scope: 'saved' });
    assert.deepEqual(state.calls, ['shared-preview', '/saved.md']);
    assert.deepEqual(state.tabs, tabs.slice(1, 5));
    assert.equal(isSavedTab(null), false);
});

test('取消关闭或保存失败后停止，不继续处理剩余标签', async () => {
    const tabs = [tab('/a.md'), tab('/b.md'), tab('/c.md')];
    const state = harness(tabs, { onClose: async () => false });
    assert.equal(await state.close({ target: tabs[0], scope: 'all' }), false);
    assert.deepEqual(state.calls, ['/b.md']);
    assert.deepEqual(state.tabs, tabs);
});

test('批量操作只处理开始时的快照，排除随后新开的标签和复用的预览', async () => {
    const a = tab('/a.md');
    const preview = tab('/old.md', { id: 'shared-preview', type: 'shared' });
    const state = harness([a, tab('/b.md'), preview], { onClose: async (id, state) => {
        if (id === '/b.md') state.tabs = [a, tab('/new.md'), tab('/replacement.md', { id: 'shared-preview', type: 'shared' })];
    } });
    await state.close({ target: a, scope: 'all' });
    assert.deepEqual(state.calls, ['/b.md', '/a.md']);
    assert.deepEqual(state.tabs.map(item => item.path), ['/new.md', '/replacement.md']);
});

test('已保存文稿在异步检查期间重新变 dirty 时保留', async () => {
    const a = tab('/a.md');
    const state = harness([a], { hasUnsavedChanges: async () => { a.dirty = true; return false; } });
    await state.close({ target: a, scope: 'saved' });
    assert.deepEqual(state.calls, []);
    assert.deepEqual(state.tabs, [a]);
});

test('重复关闭请求不并发执行，取消后可以重新发起', async () => {
    const a = tab('/a.md');
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const state = harness([a], { onClose: async () => { await gate; return false; } });
    const first = state.close({ target: a, scope: 'all' });
    assert.equal(await state.close({ target: a, scope: 'all' }), false);
    release();
    assert.equal(await first, false);
    assert.equal(await state.close({ target: a, scope: 'all' }), false);
    assert.deepEqual(state.calls, ['/a.md', '/a.md']);
});

test('关闭抛错中止后释放操作锁', async () => {
    const a = tab('/a.md');
    let fail = true;
    const state = harness([a], { onClose: async () => {
        if (fail) throw new Error('save failed');
    } });
    await assert.rejects(state.close({ target: a, scope: 'all' }), /save failed/);
    fail = false;
    assert.equal(await state.close({ target: a, scope: 'all' }), true);
});

test('已失效右键目标及未知 scope 不关闭任何标签', () => {
    const preview = tab('/new.md', { id: 'shared-preview', type: 'shared' });
    assert.deepEqual(getCloseTargets([preview], { id: 'shared-preview', path: '/old.md' }, 'all'), []);
    assert.deepEqual(getCloseTargets([preview], preview, 'invalid'), []);
});
