/** 验证列表在预处理、编辑保存和重新加载后保持原有层级。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { preprocessMarkdown } from '../src/components/markdown-editor/MarkdownPreprocessor.js';
import { createMarkdownSerializer } from '../src/modules/markdownPipeline.js';
import {
    appendBulletListItem,
    createMarkdownRoundTripSession,
    replaceFirstDocumentText,
} from './helpers/markdownRoundTripHarness.js';

/** 读取列表项文字和深度，忽略源码位置属性及任务框后的展示空格。 */
function listOutline(node, depth = 0) {
    const outline = [];
    const nextDepth = ['bulletList', 'orderedList', 'taskList'].includes(node.type.name)
        ? depth + 1 : depth;
    if (['listItem', 'taskItem'].includes(node.type.name)) {
        outline.push({ text: node.firstChild.textContent.trim(), depth });
    }
    node.forEach(child => outline.push(...listOutline(child, nextDepth)));
    return outline;
}

const THREE_LEVEL_OUTLINE = [
    { text: '1', depth: 1 },
    { text: '2', depth: 2 },
    { text: '3', depth: 3 },
];

for (const [name, source] of [
    ['issue #40 的两空格缩进', '- 1\n  - 2\n    - 3\n\n'],
    ['四空格缩进', '- 1\n    - 2\n        - 3\n\n'],
    ['混合缩进宽度', '- 1\n  - 2\n      - 3\n\n'],
    ['星号标记', '* 1\n  * 2\n    * 3\n\n'],
    ['加号标记', '+ 1\n  + 2\n    + 3\n\n'],
    ['任务列表', '- [ ] 1\n  - [x] 2\n    - [ ] 3\n\n'],
    ['有序与无序列表混合', '1. 1\n   - 2\n     - 3\n\n'],
    ['引用内的列表', '> - 1\n>   - 2\n>     - 3\n\n'],
]) {
    test(`加载并重新保存三级列表保持层级：${name}`, () => {
        const session = createMarkdownRoundTripSession(source);
        assert.deepEqual(listOutline(session.documentNode), THREE_LEVEL_OUTLINE);
        assert.equal(session.serialize(), source);

        // 结构编辑会触发 MarkdownSerializer；验证其输出也能正确重新加载。
        const saved = createMarkdownSerializer(session.schema).serialize(session.documentNode);
        const reopened = createMarkdownRoundTripSession(saved);
        assert.deepEqual(listOutline(reopened.documentNode), THREE_LEVEL_OUTLINE);
    });
}

test('列表文字编辑和结构编辑后重新加载均保留第三级', () => {
    const source = '- 1\n  - 2\n    - 3\n\n';
    const session = createMarkdownRoundTripSession(source);
    const edited = replaceFirstDocumentText(session.documentNode, '3', '三级');
    const saved = session.serialize(edited);
    assert.equal(saved, source.replace('3', '三级'));
    assert.deepEqual(listOutline(createMarkdownRoundTripSession(saved).documentNode), [
        ...THREE_LEVEL_OUTLINE.slice(0, 2),
        { text: '三级', depth: 3 },
    ]);

    const expanded = appendBulletListItem(session.documentNode, '4');
    const reopened = createMarkdownRoundTripSession(session.serialize(expanded));
    assert.deepEqual(listOutline(reopened.documentNode), [
        ...THREE_LEVEL_OUTLINE,
        { text: '4', depth: 1 },
    ]);
});

test('任务列表重建后保留勾选状态、同级项及子列表标记', () => {
    const session = createMarkdownRoundTripSession('- [ ] 1\n  - [x] 2\n    - [ ] 3\n- [x] 4\n\n');
    const saved = createMarkdownSerializer(session.schema).serialize(session.documentNode);
    const reopened = createMarkdownRoundTripSession(saved);
    assert.deepEqual(listOutline(reopened.documentNode), [
        ...THREE_LEVEL_OUTLINE,
        { text: '4', depth: 1 },
    ]);
    const checked = [];
    reopened.documentNode.descendants(node => {
        if (node.type.name === 'taskItem') checked.push(node.attrs.checked);
    });
    assert.deepEqual(checked, [false, true, false, true]);
    assert.match(saved, /^  - \[x\]/m);
    assert.match(saved, /^    - \[ \]/m);

    // 连续重建不能在任务框后累积空格，也不能改变列表层级。
    let current = reopened;
    for (let iteration = 0; iteration < 3; iteration += 1) {
        const next = createMarkdownSerializer(current.schema).serialize(current.documentNode);
        assert.equal(next, saved);
        current = createMarkdownRoundTripSession(next);
    }
});

test('同级子项和深层子项不会在加载时混淆', () => {
    const source = '- 1\n  - 2\n    - 3\n      - 4\n  - 5\n';
    assert.deepEqual(listOutline(createMarkdownRoundTripSession(source).documentNode), [
        ...THREE_LEVEL_OUTLINE,
        { text: '4', depth: 4 },
        { text: '5', depth: 2 },
    ]);
});

test('预处理保留围栏代码、缩进代码及列表续行中的空格', () => {
    const source = '```markdown\n- 1\n  - 2\n    - 3\n```\n\n'
        + '    - code\n      - nested code\n\n'
        + '- 1\n  - 2\n    continuation\n\n    another paragraph\n';
    assert.equal(preprocessMarkdown(source), source);
});
