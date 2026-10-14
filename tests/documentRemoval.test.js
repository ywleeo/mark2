/** 列表减号的真实关闭链路回归：保存取消、预览/固定文档、邻居导航及连续操作。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { DocumentHistory } from '../src/modules/document-library/DocumentHistory.js';
import { createDocumentManager } from '../src/core/documents/DocumentManager.js';
import { createDocumentRemovalAction } from '../src/modules/document-library/documentRemoval.js';
import { getDocumentCloseTarget } from '../src/modules/document-library/documentNavigation.js';

// 仅隔离 Vite 的 JSON 翻译导入及其原生初始化；关闭、保存和资源释放仍运行真实控制器。
const imports = registerHooks({
    /** 当前测试不依赖翻译文本，也不应初始化 Tauri 的 locale 文件写入。 */
    resolve(specifier, context, nextResolve) {
        if (specifier === '../i18n/index.js' && context.parentURL?.endsWith('/navigationController.js')) {
            return { url: 'data:text/javascript,export const t = key => key;', shortCircuit: true };
        }
        return nextResolve(specifier, context);
    },
});
const { createNavigationController } = await import('../src/modules/navigationController.js');
imports.deregister();

/** 将真实 DocumentManager 和关闭控制器连接到列表动作，文件读写、对话框由替身提供。 */
function fixture({ paths = ['/a.md', '/b.md', '/c.md'], active = '/a.md', pinned = false, dirty = false,
    saveSucceeds = true, missing = [], onSave = () => {} } = {}) {
    let current = null;
    let clock = 100;
    const calls = [];
    const history = new DocumentHistory({ store: { get: () => ({}), set: () => true }, now: () => ++clock });
    for (const path of [...paths].reverse()) history.touch(path);
    const registry = { isDirty: () => dirty, clearEntry: path => calls.push(['clear', path]) };
    const manager = createDocumentManager({ appState: { setCurrentFile: path => { current = path; } }, documentRegistry: registry });
    manager.openDocument(active, { pinned });
    const tabs = { activeTabId: pinned ? active : 'shared-preview',
        sharedTab: pinned ? null : getDocumentCloseTarget(active, { pinned }),
        getAllTabs: () => [
            ...(tabs.sharedTab ? [tabs.sharedTab] : []),
            ...manager.getOpenDocuments().map(doc => getDocumentCloseTarget(doc.path, doc)),
            { path: '/unrelated.md', id: '/unrelated.md', type: 'file' }],
        setActiveTab: id => { tabs.activeTabId = id; },
        removeFileTab: path => manager.closeDocument(path),
        removeSharedTab: () => { tabs.sharedTab = null; } };
    const fileTree = { stopWatchingFile: () => {}, selectFile: path => { current = path; } };
    const navigation = createNavigationController({ getFileTree: () => fileTree, getTabManager: () => tabs,
        getCurrentFile: () => current, documentManager: manager, documentRegistry: registry,
        documentSessions: { closeSessionForPath: path => calls.push(['close-session', path]) },
        saveCurrentEditorContentToCache: () => {}, clearActiveFileView: () => { current = null; },
        loadFile: path => { calls.push(['unexpected-fallback-load', path]); },
        persistWorkspaceState: () => {}, saveFile: async path => {
            calls.push(['save', path]); onSave(history, path, manager, tabs); return saveSucceeds;
        },
        getActiveViewMode: () => 'markdown', getEditor: () => ({ hasUnsavedChanges: () => dirty,
            clearAutoSaveTimer: () => calls.push(['stop-auto-save']) }),
        getCodeEditor: () => null, confirm: async () => false });
    const remove = createDocumentRemovalAction({ getEntries: () => history.list(), getCurrentPath: () => current,
        isOpen: path => Boolean(manager.getDocumentByPath(path)),
        close: (path, options) => navigation.handleTabClose(getDocumentCloseTarget(path, manager.getDocumentByPath(path)), options),
        select: async path => {
            calls.push(['select', path]);
            if (missing.includes(path)) { history.remove(path); return false; }
            manager.openDocument(path, { pinned: false });
            return true;
        }, removeRecord: path => { calls.push(['remove', path]); history.remove(path); } });
    return { remove, calls, history, manager, current: () => current };
}

test('减号关闭真实预览和固定文档，再打开列表下一篇，不先加载无关 tab', async () => {
    for (const pinned of [false, true]) {
        const setup = fixture({ pinned });
        assert.equal(await setup.remove('/a.md'), true);
        assert.equal(setup.manager.getDocumentByPath('/a.md'), null);
        assert.equal(setup.current(), '/b.md');
        assert.deepEqual(setup.history.list().map(entry => entry.path), ['/b.md', '/c.md']);
        assert.ok(setup.calls.findIndex(call => call[0] === 'close-session') < setup.calls.findIndex(call => call[0] === 'remove'));
        assert.deepEqual(setup.calls.filter(call => call[0] === 'unexpected-fallback-load'), []);
    }
});

test('最后一篇打开上一篇，移除唯一文档后保持空视图', async () => {
    const last = fixture({ active: '/c.md' });
    await last.remove('/c.md');
    assert.equal(last.current(), '/b.md');
    const only = fixture({ paths: ['/a.md'] });
    await only.remove('/a.md');
    assert.equal(only.current(), null);
    assert.deepEqual(only.history.list(), []);
});

test('保存失败并取消关闭时保留打开文档和列表，不跳到下一篇', async () => {
    for (const pinned of [false, true]) {
        const setup = fixture({ pinned, dirty: true, saveSucceeds: false });
        assert.equal(await setup.remove('/a.md'), false);
        assert.equal(setup.current(), '/a.md');
        assert.equal(setup.history.list().length, 3);
        assert.deepEqual(setup.calls, [['stop-auto-save'], ['save', '/a.md']]);
    }
});

test('后台打开文档先关闭再移除，未打开的历史记录直接移除，两者都不切换当前内容', async () => {
    for (const opened of [false, true]) {
        const setup = fixture();
        if (opened) setup.manager.openDocument('/b.md', { pinned: true, activate: false });
        await setup.remove('/b.md');
        assert.equal(setup.current(), '/a.md');
        assert.equal(setup.manager.getDocumentByPath('/b.md'), null);
        assert.deepEqual(setup.calls.filter(call => call[0] === 'select'), []);
        assert.equal(setup.calls.some(call => call[0] === 'close-session'), opened);
        assert.equal(setup.calls.some(call => call[0] === 'stop-auto-save'), false);
    }
});

test('下一篇已缺失时继续寻找可打开的文档，连续减号按实际更新后的列表导航', async () => {
    const missing = fixture({ missing: ['/b.md'] });
    await missing.remove('/a.md');
    assert.equal(missing.current(), '/c.md');
    const rapid = fixture();
    await Promise.all([rapid.remove('/a.md'), rapid.remove('/b.md')]);
    assert.equal(rapid.current(), '/c.md');
    assert.deepEqual(rapid.history.list().map(entry => entry.path), ['/c.md']);
});

test('关闭前保存导致目标置顶，仍按点击前的列表位置选择下一篇', async () => {
    const setup = fixture({ active: '/b.md', dirty: true,
        onSave: (history, path) => history.recordSave(path, { type: 'saved', contentChanged: true }) });
    await setup.remove('/b.md');
    assert.equal(setup.current(), '/c.md');
    assert.deepEqual(setup.history.list().map(entry => entry.path), ['/a.md', '/c.md']);
});

test('关闭过程中切到固定文档或复用新预览，移除完成不会覆盖新的选择', async () => {
    for (const pinned of [true, false]) {
        const setup = fixture({ dirty: true, onSave: (_history, _path, manager, tabs) => {
            manager.openDocument('/picked.md', { pinned });
            tabs.activeTabId = pinned ? '/picked.md' : 'shared-preview';
            if (!pinned) tabs.sharedTab = getDocumentCloseTarget('/picked.md', { pinned });
        } });
        await setup.remove('/a.md');
        assert.equal(setup.current(), '/picked.md');
        assert.deepEqual(setup.calls.filter(call => call[0] === 'select'), []);
        assert.ok(setup.manager.getDocumentByPath('/picked.md'));
    }
});
