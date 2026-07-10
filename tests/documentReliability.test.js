import assert from 'node:assert/strict';
import test from 'node:test';
import { createDocumentIO } from '../src/core/DocumentIO.js';
import {
    createExternalModificationConflict,
    isExternalModificationConflict,
} from '../src/core/documents/DocumentConflict.js';
import { reconcileSavedSnapshot } from '../src/core/documents/SaveSnapshot.js';
import { createDocumentSessionManager } from '../src/modules/documentSessionManager.js';

test('保存期间继续编辑时，旧快照写盘后仍保持待保存状态', () => {
    const result = reconcileSavedSnapshot('写盘快照', '写盘快照\n继续输入');
    assert.equal(result.pendingChanges, true);
    assert.equal(result.savedContent, '写盘快照');
});

test('保存完成且内容未变化时可以标记为干净', () => {
    const result = reconcileSavedSnapshot('完整内容', '完整内容');
    assert.equal(result.pendingChanges, false);
});

test('空白活跃文档不会回退到代码编辑器或缓存里的旧内容', () => {
    const documentIO = createDocumentIO({
        getCurrentFile: () => '/tmp/empty.md',
        getActiveViewMode: () => 'markdown',
        getEditor: () => ({
            currentFile: '/tmp/empty.md',
            getMarkdown: () => '',
        }),
        getCodeEditor: () => ({
            currentFile: '/tmp/empty.md',
            getValue: () => '旧代码内容',
        }),
        documentRegistry: {
            getCachedEntry: () => ({ content: '旧缓存内容' }),
        },
    });

    assert.deepEqual(documentIO.readDocument(), {
        filePath: '/tmp/empty.md',
        content: '',
        totalLines: 0,
    });
});

test('外部冲突跟随路径重命名并可显式解决', () => {
    const sessions = createDocumentSessionManager();
    sessions.beginSession('/tmp/old.md');
    sessions.markExternalConflict('/tmp/old.md', { source: 'test' });

    sessions.updateSessionPath('/tmp/old.md', '/tmp/new.md');
    assert.equal(sessions.hasExternalConflict('/tmp/old.md'), false);
    assert.equal(sessions.hasExternalConflict('/tmp/new.md'), true);

    sessions.clearExternalConflict('/tmp/new.md');
    assert.equal(sessions.hasExternalConflict('/tmp/new.md'), false);
});

test('外部修改错误使用稳定错误码供自动保存停止重试', () => {
    const error = createExternalModificationConflict('/tmp/conflict.md');
    assert.equal(isExternalModificationConflict(error), true);
    assert.equal(error.filePath, '/tmp/conflict.md');
});
