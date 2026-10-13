/** 历史文件失效清理的回归测试，覆盖恢复、错误分类和异步保存交错。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DocumentHistory } from '../src/modules/document-library/DocumentHistory.js';
import { isMissingDocumentError, pruneMissingDocuments } from '../src/modules/document-library/documentAvailability.js';

/** 模拟可跨控制器恢复的持久化历史，并使用递增时钟区分异步生命周期。 */
function fixture(paths) {
    let catalog = {};
    let clock = 0;
    const store = { get: () => structuredClone(catalog),
        set: (_key, value) => { catalog = structuredClone(value); return true; } };
    const history = new DocumentHistory({ store, now: () => ++clock });
    history.migrateRecent(paths.map((path, index) => ({ path, type: 'file', lastOpenedAt: index })));
    return { history, store };
}

test('恢复时清理缺失历史，包括缓存了正文标题的记录，重启也不重新出现', async () => {
    const { history, store } = fixture(['/docs/gone.md', '/docs/present.md', '/docs/titled-gone.md']);
    history.setTitle('/docs/titled-gone.md', '曾经的文章');
    const before = history.list().filter(record => record.path === '/docs/present.md');
    let updates = 0;
    history.subscribe(() => { updates += 1; });
    await pruneMissingDocuments({ history, readMetadata: async path => {
        if (path !== '/docs/present.md') throw 'No such file or directory (os error 2)';
        return { file_size: 42 };
    } });
    assert.deepEqual(history.list(), before);
    assert.equal(updates, 1);
    const reopened = new DocumentHistory({ store });
    reopened.migrateRecent([{ path: '/docs/gone.md', type: 'file', lastOpenedAt: 100 }]);
    assert.deepEqual(reopened.list(), before);
});

test('未保存的内存文档、权限和其他读取错误都保留入口', async () => {
    const { history } = fixture(['/docs/draft.md', '/docs/denied.md', '/docs/offline.md']);
    const before = history.list();
    const checked = [];
    await pruneMissingDocuments({ history, shouldKeep: path => path.endsWith('draft.md'),
        readMetadata: async path => {
            checked.push(path);
            throw new Error(path.endsWith('denied.md') ? 'Permission denied (os error 13)' : 'IPC unavailable');
        } });
    assert.deepEqual(history.list(), before);
    assert.equal(checked.includes('/docs/draft.md'), false);
    for (const error of [{ code: 'ENOENT' }, { code: 'ENOTDIR' }, '系统找不到指定的路径。 (os error 3)']) {
        assert.equal(isMissingDocumentError(error), true);
    }
    assert.equal(isMissingDocumentError('Permission denied (os error 13)'), false);
});

test('磁盘校验期间保存、编辑或卸载，迟到的缺失结果不能移除文档', async () => {
    for (const action of ['save', 'edit', 'dispose']) {
        const { history } = fixture(['/docs/article.md']);
        let rejectMetadata;
        let dirty = false;
        let active = true;
        const checking = pruneMissingDocuments({ history,
            readMetadata: () => new Promise((_resolve, reject) => { rejectMetadata = reject; }),
            shouldKeep: () => dirty, isCurrent: () => active });
        if (action === 'save') history.recordSave('/docs/article.md', { type: 'saved', contentChanged: true });
        if (action === 'edit') dirty = true;
        if (action === 'dispose') active = false;
        rejectMetadata({ code: 'ENOENT' });
        await checking;
        assert.equal(history.list().length, 1, action);
    }
});

test('大量历史的元数据校验最多三个并发，不改变有效文档顺序', async () => {
    const { history } = fixture(Array.from({ length: 20 }, (_value, index) => `/docs/${index}.md`));
    const before = history.list();
    let active = 0;
    let maximum = 0;
    let checked = 0;
    await pruneMissingDocuments({ history, readMetadata: async () => {
        maximum = Math.max(maximum, ++active);
        await new Promise(resolve => setImmediate(resolve));
        active -= 1;
        checked += 1;
    } });
    assert.equal(maximum, 3);
    assert.equal(checked, 20);
    assert.deepEqual(history.list(), before);
});
