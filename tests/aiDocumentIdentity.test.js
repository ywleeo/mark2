/** 临时路径复用、聊天恢复和创建工具授权的回归测试。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createUntitledFileManager } from '../src/modules/untitledFileManager.js';
import { DocumentTaskResultStore } from '../src/modules/ai-file-task/DocumentTaskResultStore.js';
import { authorizeDocumentCreation } from '../src/modules/ai-file-task/DocumentTaskCreationGuard.js';

/** 创建独立持久化替身，模拟应用重启但存储仍保留。 */
function memoryStore(initial = []) {
    let records = initial;
    return {
        get: () => structuredClone(records),
        set: (_key, value) => { records = structuredClone(value); return true; },
    };
}

test('重启后相同 untitled-1 路径不继承旧文档的聊天', () => {
    const first = createUntitledFileManager();
    const path = first.createUntitledFile();
    const results = new DocumentTaskResultStore({ store: memoryStore() });
    assert.equal(results.set(path, { documentId: first.getDocumentId(path), content: '旧文档回答', instruction: '旧文档任务' }), true);
    const second = createUntitledFileManager();
    assert.equal(second.createUntitledFile(), path);
    assert.notEqual(second.getDocumentId(path), first.getDocumentId(path));
    assert.equal(results.get(path, second.getDocumentId(path)), null);
});

test('关闭后重新导入同名临时文档获得新身份，聊天不串用', () => {
    const manager = createUntitledFileManager();
    const path = manager.createImportFile('card.md');
    const oldId = manager.getDocumentId(path);
    const results = new DocumentTaskResultStore({ store: memoryStore() });
    results.set(path, { documentId: oldId, content: '旧卡片回答' });
    manager.removeUntitledFile(path);
    assert.equal(manager.createImportFile('card.md'), path);
    assert.notEqual(manager.getDocumentId(path), oldId);
    assert.equal(results.get(path, manager.getDocumentId(path)), null);
});

test('临时聊天支持本次多轮与编辑，重启恢复正文后不恢复任何聊天', () => {
    const manager = createUntitledFileManager();
    const path = manager.createUntitledFile();
    manager.setContent(path, '原文');
    const id = manager.getDocumentId(path);
    const storage = memoryStore();
    const results = new DocumentTaskResultStore({ store: storage });
    results.set(path, { documentId: id, content: '属于原文的回答' });
    manager.setContent(path, '编辑后的原文');
    assert.equal(manager.getDocumentId(path), id);
    assert.equal(results.get(path, id).content, '属于原文的回答');
    assert.deepEqual(storage.get(), []);
    const restored = createUntitledFileManager();
    restored.restoreFromSnapshot(manager.getSnapshot());
    assert.equal(restored.getContent(path), '编辑后的原文');
    assert.notEqual(restored.getDocumentId(path), id);
    const reopened = new DocumentTaskResultStore({ store: storage });
    assert.equal(reopened.get(path, id), null);
    assert.equal(reopened.get(path, restored.getDocumentId(path)), null);
});

test('旧版临时文档记录没有可验证身份时不恢复，磁盘文件仍可恢复', () => {
    const path = 'untitled://untitled-1.md';
    const results = new DocumentTaskResultStore({ store: memoryStore([
        { path, content: '归属不明的回答' }, { path: '/docs/a.md', content: '正常文件回答' },
    ]) });
    const manager = createUntitledFileManager();
    manager.restoreFromSnapshot([{ path, content: '文档内容' }]);
    assert.ok(manager.getDocumentId(path));
    assert.equal(results.get(path, manager.getDocumentId(path)), null);
    assert.equal(results.get(path), null);
    assert.equal(results.get('/docs/a.md').content, '正常文件回答');
});

test('持久层临时聊天即使 ID 匹配也不读取，只恢复正常文件的记录', () => {
    const results = new DocumentTaskResultStore({ store: memoryStore([
        { path: 'untitled://a.md', documentId: 'same-id', content: '旧临时聊天' },
        { path: '/docs/a.md', content: '正常聊天' },
    ]) });
    assert.equal(results.get('untitled://a.md', 'same-id'), null);
    assert.equal(results.get('/docs/a.md').content, '正常聊天');
});

test('创建授权核对只接收本轮用户意图与最近对话，不接收执行器计划', async () => {
    let request;
    assert.equal(await authorizeDocumentCreation({
        client: { complete: async options => { request = options; return { content: '{"allow":true}' }; } },
        instruction: '好的，创建到新文档',
        messages: [{ role: 'user', content: '美化这篇文章' }, { role: 'assistant', content: '要创建到新文档吗？' }],
    }), true);
    assert.equal(request.temperature, 0);
    assert.equal(request.tools, undefined);
    assert.equal(JSON.parse(request.messages[1].content).currentUserMessage, '好的，创建到新文档');
});

test('核对拒绝、返回畸形内容或请求失败都不执行创建', async () => {
    for (const content of ['{"allow":false}', '{"allow":"true"}', '当然可以', '{}']) {
        assert.equal(await authorizeDocumentCreation({
            client: { complete: async () => ({ content }) }, instruction: 'hi',
        }), false);
    }
    assert.equal(await authorizeDocumentCreation({
        client: { complete: async () => { throw new Error('timeout'); } }, instruction: '创建新文档',
    }), false);
});
