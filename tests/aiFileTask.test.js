import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDocumentContext } from '../src/modules/ai-file-task/DocumentContextBuilder.js';
import {
    parseDocumentTaskPlan,
    sanitizeDocumentFilename,
} from '../src/modules/ai-file-task/DocumentTaskPlanParser.js';
import { DocumentTaskSession } from '../src/modules/ai-file-task/DocumentTaskSession.js';
import { DocumentTaskResultStore } from '../src/modules/ai-file-task/DocumentTaskResultStore.js';

test('全文分块不裁剪正文，并尽量保持围栏代码块完整', () => {
    const source = `# 开头\n\n${'正文内容。'.repeat(60)}\n\n\`\`\`js\nconst value = 1;\n\`\`\`\n\n## 结尾\n最后一句。`;
    const context = buildDocumentContext(source, { targetChars: 120 });

    assert.equal(context.chunked, true);
    assert.equal(context.chunks.join(''), source);
    assert.equal(context.originalLength, source.length);
    assert.equal(context.chunks.some(chunk => chunk.includes('```js\nconst value = 1;\n```')), true);
});

test('任务计划解析只保留受支持字段并清理临时文件名', () => {
    const plan = parseDocumentTaskPlan(`\`\`\`json
{"presentation":"document","operation":"synthesize","mode":"precise","filename":"../待办:清单"}
\`\`\``);

    assert.deepEqual(plan, {
        presentation: 'document',
        operation: 'synthesize',
        mode: 'precise',
        filename: '-待办-清单.md',
    });
    assert.equal(sanitizeDocumentFilename('draft'), 'draft.md');
    assert.throws(() => parseDocumentTaskPlan('{"presentation":"unknown"}'));
});

test('关闭或重新打开面板后，旧文档任务会话立即失效', () => {
    const session = new DocumentTaskSession();
    const first = session.begin('/tmp/first.md');
    assert.equal(session.isCurrent(first), true);

    session.cancel();
    assert.equal(session.isCurrent(first), false);

    const second = session.begin('/tmp/second.md');
    assert.equal(session.isCurrent(second), true);
    assert.equal(second.sourcePath, '/tmp/second.md');
});

/** 创建可在多个仓库实例间共享的内存存储。 */
function createMemoryStore() {
    const values = new Map();
    return {
        get(key, fallback) {
            return values.has(key) ? structuredClone(values.get(key)) : fallback;
        },
        set(key, value) {
            values.set(key, structuredClone(value));
            return true;
        },
    };
}

test('AI 文档任务回答按文档持久化，并恢复原始 Markdown 和指令', () => {
    const storage = createMemoryStore();
    const firstStore = new DocumentTaskResultStore({ store: storage });
    firstStore.set('/docs/story.md', {
        content: '## 评价\n\n- 结构清晰',
        instruction: '评价当前文章',
    });

    const restored = new DocumentTaskResultStore({ store: storage }).get('/docs/story.md');
    assert.equal(restored.content, '## 评价\n\n- 结构清晰');
    assert.equal(restored.instruction, '评价当前文章');
    assert.equal(new DocumentTaskResultStore({ store: storage }).get('/docs/other.md'), null);
});

test('AI 文档任务回答存储按最近使用顺序淘汰旧文档', () => {
    const storage = createMemoryStore();
    const resultStore = new DocumentTaskResultStore({ store: storage, maxEntries: 2 });
    resultStore.set('/docs/a.md', { content: 'A' });
    resultStore.set('/docs/b.md', { content: 'B' });
    resultStore.set('/docs/a.md', { content: 'A2' });
    resultStore.set('/docs/c.md', { content: 'C' });

    assert.equal(resultStore.get('/docs/a.md').content, 'A2');
    assert.equal(resultStore.get('/docs/b.md'), null);
    assert.equal(resultStore.get('/docs/c.md').content, 'C');
});
