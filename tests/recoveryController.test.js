import assert from 'node:assert/strict';
import test from 'node:test';
import { DocumentModel } from '../src/core/documents/DocumentModel.js';
import { createRecoveryController } from '../src/modules/recoveryController.js';

/** 创建只覆盖恢复事务所需协议的控制器测试环境。 */
function createHarness({ exists = true, diskModifiedTime = 10 } = {}) {
    const path = '/tmp/recovery-controller.md';
    const documentModel = new DocumentModel({
        uri: path,
        viewMode: 'markdown',
        content: '磁盘正文',
        modifiedTime: diskModifiedTime,
    });
    const calls = [];
    const controller = createRecoveryController({
        recoveryService: {
            async loadPendingRecoveries() { return []; },
            async loadHistory() { return []; },
            async deleteSnapshot(id) { calls.push({ type: 'delete', id }); },
        },
        fileService: {
            async exists() { return exists; },
            async readText() { return '磁盘正文'; },
            async metadata() { return { modified_time: diskModifiedTime }; },
        },
        documentRegistry: {
            async getFileContent() { return { content: documentModel.getContent() }; },
            getDocument(candidate) { return candidate === path ? documentModel : null; },
        },
        documentSessions: {
            markExternalConflict(filePath, details) {
                calls.push({ type: 'conflict', filePath, details });
            },
        },
        getCurrentFile: () => path,
        async openPathsFromSelection(paths, options) {
            calls.push({ type: 'open', paths, options });
        },
        async importAsUntitled(content, suggestedName) {
            calls.push({ type: 'import', content, suggestedName });
            return 'untitled://recovered.md';
        },
        getStatusBarController: () => null,
    });
    return { path, documentModel, calls, controller };
}

test('恢复现有文件只更新 DocumentModel，并保持为未保存修改', async () => {
    const harness = createHarness();

    const restored = await harness.controller.restoreSnapshot({
        id: 'pending-1',
        filePath: harness.path,
        content: '崩溃前正文',
        diskModifiedTime: 10,
    });

    assert.equal(restored, true);
    assert.equal(harness.documentModel.getContent(), '崩溃前正文');
    assert.equal(harness.documentModel.getOriginalContent(), '磁盘正文');
    assert.equal(harness.documentModel.dirty, true);
    assert.deepEqual(harness.calls, [{
        type: 'open',
        paths: [harness.path],
        options: { source: 'recovery' },
    }]);
});

test('磁盘在恢复点后发生变化时标记外部冲突', async () => {
    const harness = createHarness({ diskModifiedTime: 20 });

    await harness.controller.restoreSnapshot({
        id: 'pending-2',
        filePath: harness.path,
        content: '较早的未保存正文',
        diskModifiedTime: 10,
    });

    assert.equal(harness.calls[0].type, 'conflict');
    assert.equal(harness.calls[0].filePath, harness.path);
    assert.equal(harness.calls[1].type, 'open');
});

test('原文件已不存在时恢复为 untitled，不创建磁盘文件', async () => {
    const harness = createHarness({ exists: false });

    const restored = await harness.controller.restoreSnapshot({
        id: 'pending-3',
        filePath: harness.path,
        content: '孤立恢复正文',
        diskModifiedTime: 10,
    });

    assert.equal(restored, true);
    assert.deepEqual(harness.calls, [{
        type: 'import',
        content: '孤立恢复正文',
        suggestedName: 'recovery-controller.md',
    }]);
});
