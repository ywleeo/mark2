/** 文档历史、临时文档生命周期、路径身份与侧栏投影回归测试。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DocumentHistory } from '../src/modules/document-library/DocumentHistory.js';
import { buildDocumentLibraryEntries } from '../src/modules/document-library/documentLibraryModel.js';
import { extractDocumentTitle, DocumentTitleReader } from '../src/modules/document-library/documentTitle.js';
import { createDocumentContextActions, getDocumentContextActions, documentRenameDestination }
    from '../src/modules/document-library/documentLibraryActions.js';
import { COMMAND_IDS } from '../src/core/commands/commandIds.js';
import { DocumentModel } from '../src/core/documents/DocumentModel.js';
import { createDocumentManager } from '../src/core/documents/DocumentManager.js';
import { prepareDocumentOpen, getDocumentCloseTarget, isDocumentWorkspace }
    from '../src/modules/document-library/documentNavigation.js';
import { getUntitledCloseContent } from '../src/modules/navigation/untitledClose.js';

/** 可在多个实例间共享的持久化替身，不涉及磁盘文件操作。 */
function storage() {
    let state = {};
    return { get: () => structuredClone(state), set: (_key, value) => { state = structuredClone(value); return true; } };
}

test('最近记录只迁移文件且只执行一次，移除记录后重启不重新导入', () => {
    const store = storage();
    const history = new DocumentHistory({ store });
    const items = [
        { path: '/docs', type: 'folder', lastOpenedAt: 30 },
        { path: '/docs/a.md', type: 'file', lastOpenedAt: 10 },
        { path: '/docs/b.md', type: 'file', lastOpenedAt: 20 },
        { path: 'untitled://a.md', type: 'file', lastOpenedAt: 40 },
    ];
    history.migrateRecent(items);
    assert.deepEqual(history.list().map(record => record.path), ['/docs/b.md', '/docs/a.md']);
    history.remove('/docs/a.md');
    const reopened = new DocumentHistory({ store });
    reopened.migrateRecent(items);
    assert.deepEqual(reopened.list().map(record => record.path), ['/docs/b.md']);
});

test('超过 50 个文档仍完整保留，点击与未保存的编辑不改变顺序，新增进入顶部', () => {
    let clock = 0;
    const store = storage();
    const history = new DocumentHistory({ store, now: () => ++clock });
    for (let i = 0; i < 80; i += 1) history.touch(`/docs/${i}.md`);
    const order = history.list().map(record => record.path);
    history.touch('/docs/0.md');
    assert.equal(history.list().length, 80);
    assert.deepEqual(history.list().map(record => record.path), order);
    history.setTitle('/docs/0.md', '新标题');
    assert.deepEqual(history.list().map(record => record.path), order);
    history.touch('/docs/1.md', { preserveExisting: true });
    assert.deepEqual(history.list().map(record => record.path), order);
    history.touch('/docs/new.md');
    assert.equal(history.list()[0].path, '/docs/new.md');
    assert.deepEqual(new DocumentHistory({ store }).list(), history.list());
});

test('真实保存完成才置顶，切换、改标题与未保存的编辑不重排，重启保留保存顺序', () => {
    let clock = 100;
    const store = storage();
    const history = new DocumentHistory({ store, now: () => ++clock });
    const a = new DocumentModel({ uri: '/docs/a.md', viewMode: 'markdown', content: 'A' });
    const b = new DocumentModel({ uri: '/docs/b.md', viewMode: 'code', content: 'B' });
    for (const doc of [a, b]) {
        history.touch(doc.uri);
        doc.subscribe(event => history.recordSave(doc.uri, event));
    }
    const initialOrder = history.list().map(record => record.path);
    history.touch(a.uri);
    history.setTitle(a.uri, '第一篇');
    a.applyEditorChange('A changed');
    assert.deepEqual(history.list().map(record => record.path), initialOrder);
    const saving = a.beginSave();
    assert.deepEqual(history.list().map(record => record.path), initialOrder);
    a.commitSave(saving);
    assert.deepEqual(history.list().map(record => record.path), [a.uri, b.uri]);
    assert.equal(history.list()[0].title, '第一篇');
    assert.ok(history.list()[0].lastSavedAt > 0);
    b.applyEditorChange('B changed');
    b.commitSave(b.beginSave());
    assert.deepEqual(history.list().map(record => record.path), [b.uri, a.uri]);
    // 没修改的重复保存和随后点击 A 都不能把 A 再移到顶部。
    const aSavedAt = history.list()[1].lastSavedAt;
    a.commitSave(a.beginSave());
    history.touch(a.uri);
    assert.deepEqual(history.list().map(record => record.path), [b.uri, a.uri]);
    assert.equal(history.list()[1].lastSavedAt, aSavedAt);
    assert.deepEqual(new DocumentHistory({ store }).list(), history.list());
});

test('保存失败不置顶，写盘期间继续编辑仍只在快照写盘成功后置顶', () => {
    const history = new DocumentHistory({ store: storage() });
    const doc = new DocumentModel({ uri: '/docs/a.md', viewMode: 'markdown', content: 'old' });
    history.touch(doc.uri);
    history.touch('/docs/b.md');
    doc.subscribe(event => history.recordSave(doc.uri, event));
    doc.applyEditorChange('first');
    doc.failSave(doc.beginSave(), new Error('disk full'));
    assert.equal(history.list()[0].path, '/docs/b.md');
    const token = doc.beginSave();
    doc.applyEditorChange('second');
    assert.equal(history.list()[0].path, '/docs/b.md');
    doc.commitSave(token);
    assert.equal(doc.dirty, true);
    assert.equal(doc.getOriginalContent(), 'first');
    assert.equal(history.list()[0].path, doc.uri);
    history.touch('/docs/c.md');
    doc.commitSave(token); // 已提交令牌不会再次产生 saved 事件。
    assert.equal(history.list()[0].path, '/docs/c.md');
});

test('内容重载与临时文档不参与保存排序，未知的已保存路径可加入目录', () => {
    const history = new DocumentHistory({ store: storage() });
    history.touch('/docs/existing.md');
    history.recordSave('/docs/other.md', { type: 'reload', contentChanged: true });
    history.recordSave('untitled://draft.md', { type: 'saved', contentChanged: true });
    assert.deepEqual(history.list().map(record => record.path), ['/docs/existing.md']);
    history.recordSave('/docs/new.md', { type: 'saved', contentChanged: true });
    assert.deepEqual(history.list().map(record => record.path), ['/docs/new.md', '/docs/existing.md']);
});

test('文档模式连续打开复用预览，不增加固定 tab，也不清掉既有文档与未保存草稿', () => {
    const manager = createDocumentManager();
    manager.openDocument('/docs/classic.md', { pinned: true });
    manager.openDocument('untitled://draft.md', { pinned: true, kind: 'untitled' });
    const originalPaths = manager.getOpenPaths();
    const tree = { addToOpenFiles: path => manager.openDocument(path, { pinned: true, activate: false }) };
    prepareDocumentOpen(tree, '/docs/first.md', true);
    assert.deepEqual(manager.getOpenPaths(), originalPaths);
    manager.openDocument('/docs/first.md', { pinned: false });
    prepareDocumentOpen(tree, '/docs/second.md', true);
    assert.deepEqual(manager.getOpenPaths(), originalPaths);
    manager.openDocument('/docs/second.md', { pinned: false });
    assert.equal(manager.getDocumentByPath('/docs/first.md'), null);
    assert.equal(manager.getActivePath(), '/docs/second.md');
    assert.deepEqual(manager.getOpenPaths(), originalPaths);
    assert.ok(manager.getDocumentByPath('untitled://draft.md'));
    assert.ok(manager.getDocumentByPath('/docs/classic.md'));
});

test('Classic 打开仍固定 tab，工作区模式在切换后重新读取，临时文档不当作磁盘文件', () => {
    const manager = createDocumentManager();
    const tree = { addToOpenFiles: path => manager.openDocument(path, { pinned: true, activate: false }) };
    const root = { dataset: { workspaceProfile: 'writing' } };
    assert.equal(isDocumentWorkspace(root), true);
    root.dataset.workspaceProfile = 'general';
    assert.equal(isDocumentWorkspace(root), false);
    prepareDocumentOpen(tree, '/docs/classic.md', isDocumentWorkspace(root));
    prepareDocumentOpen(tree, 'untitled://draft.md', false);
    assert.deepEqual(manager.getOpenPaths(), ['/docs/classic.md']);
});

test('列表关闭预览使用 shared 分支，临时草稿与固定文档使用原有 file 分支', () => {
    assert.deepEqual(getDocumentCloseTarget('/docs/preview.md', { pinned: false }),
        { path: '/docs/preview.md', id: 'shared-preview', type: 'shared' });
    assert.deepEqual(getDocumentCloseTarget('untitled://draft.md', { pinned: true }),
        { path: 'untitled://draft.md', id: 'untitled://draft.md', type: 'file' });
    assert.deepEqual(getDocumentCloseTarget('/docs/classic.md', { pinned: true }),
        { path: '/docs/classic.md', id: '/docs/classic.md', type: 'file' });
});

test('后台草稿关闭只读取目标自己的内容，不读取另一篇文章的活动编辑器', () => {
    const doc = new DocumentModel({ uri: 'untitled://draft.md', viewMode: 'markdown', content: '自己的草稿' });
    const deps = { path: doc.uri, isActive: false,
        documentRegistry: { getDocument: path => path === doc.uri ? doc : null },
        untitledFileManager: { getContent: () => '旧草稿缓存' },
        getActiveContent: () => { throw new Error('不能读取另一篇文章'); } };
    assert.equal(getUntitledCloseContent(deps), '自己的草稿');
    doc.applyEditorChange('');
    assert.equal(getUntitledCloseContent(deps), '');
    assert.equal(getUntitledCloseContent({ ...deps, documentRegistry: null }), '旧草稿缓存');
});

test('活动草稿关闭使用尚未同步到模型的实时输入', () => {
    assert.equal(getUntitledCloseContent({ path: 'untitled://active.md', isActive: true,
        getActiveContent: () => '最新输入',
        documentRegistry: { getDocument: () => ({ getContent: () => '旧快照' }) } }), '最新输入');
});

test('显示正文标题而不是文件名，标题、文件名和目录均可用于搜索且顺序保持稳定', () => {
    const params = {
        records: [{ path: '/docs/a.md', title: '城市交通的三种选择', lastUsedAt: 10 },
            { path: '/docs/b.md', title: '春天的第一封信', lastUsedAt: 20 }],
    };
    const entries = buildDocumentLibraryEntries(params);
    assert.equal(entries[0].label, '城市交通的三种选择');
    assert.equal(entries[0].filename, 'a.md');
    assert.equal(entries[1].label, '春天的第一封信');
    assert.equal(buildDocumentLibraryEntries({ ...params, query: '春天' })[0].path, '/docs/b.md');
    assert.equal(buildDocumentLibraryEntries({ ...params, query: 'a.md' })[0].path, '/docs/a.md');
    assert.deepEqual(buildDocumentLibraryEntries({ ...params, activePath: '/docs/b.md' }).map(entry => entry.path), ['/docs/a.md', '/docs/b.md']);
});

test('标题提取忽略元数据、注释和代码，支持 ATX、Setext 和无标题首句', () => {
    assert.equal(extractDocumentTitle('---\ntitle: 元数据\n---\n<!-- # 假标题 -->\n```md\n# 代码\n```\n引言。\n\n# **文章标题** #'), '文章标题');
    assert.equal(extractDocumentTitle('文章标题\n===\n正文'), '文章标题');
    assert.equal(extractDocumentTitle('## 小标题\n正文'), '小标题');
    assert.equal(extractDocumentTitle('这是[第一句话](https://example.com)。这是第二句。'), '这是第一句话。');
    assert.equal(extractDocumentTitle('The first sentence. A second one.'), 'The first sentence.');
    assert.equal(extractDocumentTitle('```js\nconst a = 1;\n```\n'), '');
    assert.equal(extractDocumentTitle('<!-- comment -->\n\n'), '');
});

test('标题读取并发受限，迟到的磁盘结果不覆盖最新编辑，卸载后不回写', async () => {
    const jobs = new Map();
    const seen = [];
    const reader = new DocumentTitleReader({
        readContent: path => new Promise(resolve => jobs.set(path, resolve)),
        onTitle: (path, title) => seen.push({ path, title }),
    });
    for (const path of ['a', 'b', 'c', 'd']) reader.ensure(path);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(jobs.size, 3);
    reader.update('a', '# 最新编辑');
    jobs.get('a')('# 磁盘旧内容');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(reader.titles.get('a'), '最新编辑');
    assert.equal(jobs.size, 4);
    reader.destroy();
    jobs.get('b')('# 迟到结果');
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(seen, [{ path: 'a', title: '最新编辑' }]);
});

test('Windows 路径按身份去重，重命名合并已有目标记录，POSIX 大小写保持独立', () => {
    const history = new DocumentHistory({ store: storage(), now: () => 100 });
    history.touch('C:/Docs/A.md');
    history.touch('c:\\docs\\a.md');
    assert.equal(history.list().length, 1);
    history.touch('C:/Docs/B.md');
    history.rename('C:/Docs/A.md', 'C:/Docs/B.md');
    assert.equal(history.list().length, 1);
    history.touch('/docs/A.md');
    history.touch('/docs/a.md');
    assert.equal(history.list().length, 3);
});

test('关闭 tab 不移除历史，未命名文档不持久化，列表移除不触及正文', () => {
    const store = storage();
    const history = new DocumentHistory({ store });
    history.touch('/docs/article.md');
    assert.equal(history.touch('untitled://untitled-1.md'), false);
    const records = history.list();
    const openDocuments = [{ path: 'untitled://untitled-1.md', dirty: true }];
    assert.equal(buildDocumentLibraryEntries({ records, openDocuments }).length, 2);
    assert.equal(buildDocumentLibraryEntries({ records, openDocuments: [] }).length, 1);
    history.remove('/docs/article.md');
    assert.deepEqual(history.list(), []);
    assert.equal(openDocuments[0].dirty, true);
});

test('侧栏搜索支持同名文档目录区分，未保存状态与当前选中来自文档会话', () => {
    const rows = buildDocumentLibraryEntries({
        records: [{ path: '/work/文章.md', lastUsedAt: 20 }, { path: '/notes/文章.md', lastUsedAt: 10 }],
        openDocuments: [{ path: '/work/文章.md', dirty: true }], activePath: '/work/文章.md', query: '/work',
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].label, '文章.md');
    assert.equal(rows[0].location, '/work');
    assert.equal(rows[0].dirty, true);
    assert.equal(rows[0].active, true);
});

test('索引快照不共享引用，存储失败会回报且保留当前内存记录', () => {
    const history = new DocumentHistory({ store: { get: () => ({}), set: () => false } });
    let notified;
    history.subscribe(event => { notified = event; });
    assert.equal(history.touch('/docs/a.md'), false);
    assert.equal(notified.persisted, false);
    history.list()[0].path = '/changed.md';
    assert.equal(history.list()[0].path, '/docs/a.md');
});

/** 文件操作替身，记录精确目标，成功或取消结果可由测试控制。 */
function contextFixture(overrides = {}) {
    const calls = [];
    const history = new DocumentHistory({ store: storage() });
    history.touch('/docs/current.md');
    history.touch('/docs/other.md');
    history.setTitle('/docs/other.md', '另一篇文章');
    const dependencies = {
        history,
        select: async path => { calls.push(['select', path]); return true; },
        close: async path => calls.push(['close', path]),
        saveDocument: async path => calls.push(['save-primary', path]),
        executeCommand: async (id, payload) => calls.push(['command', id, payload]),
        requestName: async () => 'renamed.md',
        fileService: { exists: async () => false },
        fileTree: {
            renameFile: async (path, name) => calls.push(['rename', path, name]),
            promptMoveTo: async path => { calls.push(['move', path]); return '/archive/other.md'; },
            confirmAndDelete: async path => { calls.push(['delete', path]); return true; },
        },
        ...overrides,
    };
    return { calls, history, dependencies, run: createDocumentContextActions(dependencies) };
}

test('右键菜单区分已关闭、已打开和临时文档，临时文档不能执行磁盘操作', async () => {
    assert.deepEqual(getDocumentContextActions('untitled://draft.md', true), ['save', 'close']);
    assert.equal(getDocumentContextActions('/docs/other.md', false).includes('close'), false);
    assert.equal(getDocumentContextActions('/docs/other.md', true).includes('close'), true);
    const fixture = contextFixture();
    for (const action of ['rename', 'move', 'delete', 'reveal', 'copy-path', 'open-secondary', 'remove']) {
        await fixture.run(action, 'untitled://draft.md');
    }
    assert.deepEqual(fixture.calls, []);
});

test('非活动文档的右键操作绑定目标路径，复制、分栏、关闭、移除都不激活当前文档', async () => {
    const { run, calls, history } = contextFixture();
    for (const action of ['copy-path', 'open-secondary', 'reveal', 'close', 'remove']) await run(action, '/docs/other.md');
    assert.deepEqual(calls, [
        ['command', COMMAND_IDS.WORKSPACE_COPY_PATH, { path: '/docs/other.md', targetType: 'file' }],
        ['command', COMMAND_IDS.VIEW_OPEN_IN_SECONDARY, { path: '/docs/other.md', targetType: 'file' }],
        ['command', COMMAND_IDS.WORKSPACE_REVEAL_IN_FINDER, { path: '/docs/other.md', targetType: 'file' }],
        ['close', '/docs/other.md'],
    ]);
    assert.deepEqual(history.list().map(record => record.path), ['/docs/current.md']);
});

test('重命名已关闭的文档也同步历史标题与位置，同名文件不能被覆盖', async () => {
    const { run, calls, history } = contextFixture();
    await run('rename', '/docs/other.md');
    assert.deepEqual(calls, [['rename', '/docs/other.md', 'renamed.md']]);
    assert.equal(history.list()[0].path, '/docs/renamed.md');
    assert.equal(history.list()[0].title, '另一篇文章');
    const occupied = contextFixture({ fileService: { exists: async () => true } });
    await assert.rejects(occupied.run('rename', '/docs/other.md'), { code: 'document-name-exists' });
    assert.deepEqual(occupied.calls, []);
    assert.equal(occupied.history.list()[0].path, '/docs/other.md');
    assert.equal(documentRenameDestination('/docs/other.md', '../escape.md'), null);
    assert.equal(documentRenameDestination('/docs/other.md', '..'), null);
    assert.equal(documentRenameDestination('C:\\Docs\\old.md', '中文.md'), 'C:\\Docs\\中文.md');
});

test('移动和删除仅在成功后更新索引，取消或文件操作失败保留记录', async () => {
    const cancelled = contextFixture();
    cancelled.dependencies.fileTree.promptMoveTo = async () => undefined;
    cancelled.dependencies.fileTree.confirmAndDelete = async () => undefined;
    await cancelled.run('move', '/docs/other.md');
    await cancelled.run('delete', '/docs/other.md');
    assert.equal(cancelled.history.list()[0].path, '/docs/other.md');
    cancelled.dependencies.fileTree.renameFile = async () => { throw new Error('permission denied'); };
    await assert.rejects(cancelled.run('rename', '/docs/other.md'), /permission denied/);
    assert.equal(cancelled.history.list()[0].path, '/docs/other.md');
    const moved = contextFixture();
    await moved.run('move', '/docs/other.md');
    assert.equal(moved.history.list()[0].path, '/archive/other.md');
    assert.equal(moved.history.list()[0].title, '另一篇文章');
    const deleted = contextFixture();
    await deleted.run('delete', '/docs/other.md');
    assert.deepEqual(deleted.history.list().map(record => record.path), ['/docs/current.md']);
});

test('临时文档保存先激活精确目标，打开失败时不会保存另一篇文档', async () => {
    const { run, calls } = contextFixture();
    await run('save', 'untitled://draft.md');
    assert.deepEqual(calls, [['select', 'untitled://draft.md'], ['save-primary', 'untitled://draft.md']]);
    const unavailable = contextFixture({ select: async () => false });
    await unavailable.run('save', 'untitled://draft.md');
    assert.deepEqual(unavailable.calls, []);
});
