import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    appendBulletListItem,
    createMarkdownRoundTripSession,
    replaceFirstDocumentText,
} from './helpers/markdownRoundTripHarness.js';

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const CORPUS_DIRECTORY = path.join(TEST_DIRECTORY, 'fixtures', 'markdown-roundtrip');

/**
 * 读取回归样本。
 * @param {string} fileName - 样本文件名。
 * @returns {Promise<string>} Markdown 源码。
 */
function readFixture(fileName) {
    return readFile(path.join(CORPUS_DIRECTORY, fileName), 'utf8');
}

test('真实 Markdown 语法库在未编辑时逐字往返', async t => {
    const fileNames = (await readdir(CORPUS_DIRECTORY))
        .filter(fileName => fileName.endsWith('.md'))
        .sort();
    assert.ok(fileNames.length >= 5, '回归库不应为空');

    for (const fileName of fileNames) {
        await t.test(fileName, async () => {
            const source = await readFixture(fileName);
            const session = createMarkdownRoundTripSession(source);
            assert.equal(session.serialize(), source);
        });
    }
});

test('普通文字修改只替换目标文本，其余源码逐字不变', async () => {
    const source = await readFixture('syntax-showcase.md');
    const session = createMarkdownRoundTripSession(source);
    const changedDocument = replaceFirstDocumentText(session.documentNode, '旧文字', '新文字');

    assert.equal(session.serialize(changedDocument), source.replace('旧文字', '新文字'));
});

test('修改表格单元格不会改写对齐符号和表格排版', async () => {
    const source = await readFixture('table-layout.md');
    const session = createMarkdownRoundTripSession(source);
    const changedDocument = replaceFirstDocumentText(session.documentNode, '待修改', '已通过');

    assert.equal(session.serialize(changedDocument), source.replace('待修改', '已通过'));
});

test('修改代码块文字仍保留原始围栏类型', async () => {
    const source = await readFixture('blocks-and-extensions.md');
    const session = createMarkdownRoundTripSession(source);
    const changedDocument = replaceFirstDocumentText(session.documentNode, '保留围栏', '仍是波浪线');
    const output = session.serialize(changedDocument);

    assert.equal(output, source.replace('保留围栏', '仍是波浪线'));
    assert.match(output, /~~~~javascript[\s\S]*~~~~/);
});

test('列表结构变化只重建列表块，块外注释和引用定义保持不变', async () => {
    const source = await readFixture('structural-edit.md');
    const session = createMarkdownRoundTripSession(source);
    const changedDocument = appendBulletListItem(session.documentNode, 'gamma');
    const output = session.serialize(changedDocument);

    assert.match(output, /- alpha\n- beta\n- gamma/);
    assert.ok(output.startsWith('局部结构编辑\n==============\n\n<!-- before-list -->\n\n'));
    assert.ok(output.endsWith('\n\n<!-- after-list -->\n[outside]: /keep-me\n\n尾部 [引用][outside]。\n\n'));
});

test('只含隐式源码的文档插入正文后仍保留全部原文', async () => {
    const source = await readFixture('hidden-source-only.md');
    const session = createMarkdownRoundTripSession(source);
    const paragraph = session.schema.nodes.paragraph.create(null, session.schema.text('新正文'));
    const changedDocument = session.schema.nodes.doc.create(null, paragraph);

    assert.equal(session.serialize(changedDocument), `${source}新正文\n\n`);
});
