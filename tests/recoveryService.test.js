import assert from 'node:assert/strict';
import test from 'node:test';
import { DocumentModel } from '../src/core/documents/DocumentModel.js';
import { createRecoveryService } from '../src/services/recoveryService.js';

/** 创建可观察 DocumentModel 的最小注册表替身。 */
function createRegistry(document) {
    const listeners = new Set();
    document.subscribe(event => {
        for (const listener of listeners) {
            listener({ path: document.uri, event, document });
        }
    });
    return {
        getDocument: path => path === document.uri ? document : null,
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
}

/** 创建记录恢复 API 调用的内存替身。 */
function createApiDouble() {
    const calls = [];
    return {
        calls,
        async upsertRecoverySnapshot(snapshot) {
            calls.push({ type: 'upsert', snapshot: { ...snapshot } });
            return { id: String(calls.length), ...snapshot };
        },
        async clearPendingRecovery(filePath) {
            calls.push({ type: 'clear', filePath });
        },
        async renameRecoveryDocument(oldPath, newPath) {
            calls.push({ type: 'rename', oldPath, newPath });
        },
        async listRecoverySnapshots() { return []; },
        async readRecoverySnapshot() { return null; },
        async deleteRecoverySnapshot() {},
    };
}

test('首次编辑先保留磁盘基线，再写入最新 pending 恢复点', async t => {
    const document = new DocumentModel({
        uri: '/tmp/recovery.md',
        viewMode: 'markdown',
        content: '磁盘正文',
        modifiedTime: 42,
    });
    const api = createApiDouble();
    const service = createRecoveryService({
        documentRegistry: createRegistry(document),
        isUntitledPath: path => path.startsWith('untitled://'),
        api,
        delay: 10,
    });
    t.after(() => service.dispose());

    document.applyEditorChange('第一版');
    document.applyEditorChange('第二版');
    await new Promise(resolve => setTimeout(resolve, 30));
    await service.flushAll();

    const writes = api.calls.filter(call => call.type === 'upsert');
    assert.equal(writes.length, 2);
    assert.equal(writes[0].snapshot.kind, 'history');
    assert.equal(writes[0].snapshot.content, '磁盘正文');
    assert.equal(writes[0].snapshot.clearPending, false);
    assert.equal(writes[1].snapshot.kind, 'pending');
    assert.equal(writes[1].snapshot.content, '第二版');
    assert.equal(writes[1].snapshot.diskModifiedTime, 42);
});

test('保存成功后记录 history 并由后端替换 pending', async t => {
    const document = new DocumentModel({
        uri: '/tmp/history.md',
        viewMode: 'markdown',
        content: '原文',
    });
    const api = createApiDouble();
    const service = createRecoveryService({
        documentRegistry: createRegistry(document),
        isUntitledPath: () => false,
        api,
        delay: 100,
    });
    t.after(() => service.dispose());

    document.applyEditorChange('保存后的正文');
    const token = document.beginSave();
    document.commitSave(token, 100);
    await service.flushAll();

    const history = api.calls.find(call => (
        call.type === 'upsert'
        && call.snapshot.kind === 'history'
        && call.snapshot.clearPending
    ));
    assert.equal(history?.snapshot.content, '保存后的正文');
    assert.equal(history?.snapshot.diskModifiedTime, 100);
    assert.equal(history?.snapshot.clearPending, true);
    assert.equal(api.calls.some(call => call.type === 'upsert' && call.snapshot.kind === 'pending'), false);
    assert.deepEqual(
        api.calls.filter(call => call.type === 'upsert').map(call => call.snapshot.content),
        ['原文', '保存后的正文'],
    );
});

test('窗口关闭前 flushAll 不等待防抖，直接保存 dirty 内容', async t => {
    const document = new DocumentModel({
        uri: '/tmp/flush.md',
        viewMode: 'code',
        content: 'const a = 1;',
    });
    const api = createApiDouble();
    const service = createRecoveryService({
        documentRegistry: createRegistry(document),
        isUntitledPath: () => false,
        api,
        delay: 10_000,
    });
    t.after(() => service.dispose());

    document.applyEditorChange('const a = 2;');
    await service.flushAll();

    const writes = api.calls.filter(call => call.type === 'upsert');
    assert.equal(writes[0].snapshot.content, 'const a = 1;');
    assert.equal(writes[1].snapshot.content, 'const a = 2;');
});

test('单个损坏恢复点不会阻断其余可用恢复内容', async t => {
    const document = new DocumentModel({
        uri: '/tmp/read-recovery.md',
        viewMode: 'markdown',
        content: '正文',
    });
    const api = createApiDouble();
    api.listRecoverySnapshots = async () => [{ id: 'bad' }, { id: 'good' }];
    api.readRecoverySnapshot = async id => {
        if (id === 'bad') throw new Error('snapshot missing');
        return { id, filePath: document.uri, content: '可恢复正文', kind: 'pending' };
    };
    const warnings = [];
    const service = createRecoveryService({
        documentRegistry: createRegistry(document),
        isUntitledPath: () => false,
        api,
        logger: { warn: (...args) => warnings.push(args) },
    });
    t.after(() => service.dispose());

    const recoveries = await service.loadPendingRecoveries();

    assert.deepEqual(recoveries.map(entry => entry.id), ['good']);
    assert.equal(warnings.length, 1);
});

test('untitled 文档继续由工作区热退出机制负责，不重复写恢复仓库', async t => {
    const document = new DocumentModel({
        uri: 'untitled://untitled-1.md',
        viewMode: 'markdown',
        content: '',
    });
    const api = createApiDouble();
    const service = createRecoveryService({
        documentRegistry: createRegistry(document),
        isUntitledPath: path => path.startsWith('untitled://'),
        api,
        delay: 5,
    });
    t.after(() => service.dispose());

    document.applyEditorChange('临时正文');
    await new Promise(resolve => setTimeout(resolve, 15));
    await service.flushAll();

    assert.deepEqual(api.calls, []);
});
