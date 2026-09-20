import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
    createSearchSnippet,
    collectWorkspaceSearchTargets,
    getWorkspaceSearchMatchText,
} from '../src/utils/workspaceSearchUtils.js';

test('工作区搜索同时覆盖打开文件夹和独立打开文件', () => {
    const targets = collectWorkspaceSearchTargets(
        ['/notes', '/notes'],
        ['/outside/todo.md', '/notes', 'untitled://draft-1'],
        path => path.replace('/outside', '/workspace'),
    );

    assert.deepEqual(targets, ['/notes', '/workspace/todo.md']);
});

test('工作区搜索片段按 Unicode 字符位置高亮', () => {
    const snippet = createSearchSnippet({
        lineText: '你好🙂 Mark2 世界',
        matchStart: 4,
        matchEnd: 9,
    });

    assert.equal(snippet.before, '你好🙂 ');
    assert.equal(snippet.hit, 'Mark2');
    assert.equal(snippet.after, ' 世界');
});

test('工作区搜索片段裁剪长行并保留省略标记', () => {
    const snippet = createSearchSnippet({
        lineText: '0123456789needleabcdefghij',
        matchStart: 10,
        matchEnd: 16,
    }, 4);

    assert.deepEqual(snippet, {
        before: '6789',
        hit: 'needle',
        after: 'abcd',
        leading: true,
        trailing: true,
    });
});

test('工作区搜索命中文本按 Unicode 字符区间还原', () => {
    assert.equal(getWorkspaceSearchMatchText({
        lineText: '甲🙂needle乙',
        matchStart: 2,
        matchEnd: 8,
    }), 'needle');
});

test('关闭工作区搜索时同时清除 Markdown 与源码视图高亮', async () => {
    const controller = await readFile(
        new URL('../src/modules/workspaceSearchController.js', import.meta.url),
        'utf8',
    );
    assert.match(controller, /getMarkdownEditor\?\.\(\)\?\.clearNavigationHighlight\?\.\(\)/);
    assert.match(controller, /getCodeEditor\?\.\(\)\?\.clearNavigationHighlight\?\.\(\)/);
    assert.match(controller, /hide\(\)\s*\{[\s\S]*clearDocumentHighlight\(\);[\s\S]*panel\.hide\(\);/);
});
