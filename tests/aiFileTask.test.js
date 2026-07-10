import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDocumentContext } from '../src/modules/ai-file-task/DocumentContextBuilder.js';
import {
    parseDocumentTaskPlan,
    sanitizeDocumentFilename,
} from '../src/modules/ai-file-task/DocumentTaskPlanParser.js';
import { DocumentTaskSession } from '../src/modules/ai-file-task/DocumentTaskSession.js';

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
