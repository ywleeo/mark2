/** 相对路径图片读取、显示属性与源码/撤销历史隔离回归。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorState } from '@tiptap/pm/state';
import { history, undoDepth } from '@tiptap/pm/history';
import { ContentLoader } from '../src/components/markdown-editor/ContentLoader.js';
import { createMarkdownTestSchema } from './helpers/markdownRoundTripHarness.js';
import { createMarkdownParser, createMarkdownSerializer } from '../src/modules/markdownPipeline.js';
import { extractFrontmatter, preprocessMarkdown } from '../src/components/markdown-editor/MarkdownPreprocessor.js';
import { SourcePreservingMarkdownSerializer } from '../src/components/markdown-editor/SourcePreservingMarkdownSerializer.js';
import { createMarkdownSourceHistoryPlugin, MarkdownSourceStep, markdownSourceHistoryKey } from '../src/components/markdown-editor/MarkdownSourceHistory.js';
import { releaseImageObjectUrls } from '../src/utils/imageResolver.js';

/** 使用实际解析器、事务和文件 API 适配层，文件读取仅返回测试 PNG 字节。 */
function createHarness(t, source, readFile) {
    const previousWindow = globalThis.window;
    globalThis.window = { __TAURI_INTERNALS__: { invoke: async (command, args) => {
        assert.equal(command, 'plugin:fs|read_file');
        return readFile(args.path);
    } } };
    t.after(() => { releaseImageObjectUrls(); if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; });
    const schema = createMarkdownTestSchema();
    const parser = createMarkdownParser(schema);
    const serializer = new SourcePreservingMarkdownSerializer({ markdownSerializer: createMarkdownSerializer(schema) });
    const { body, raw } = extractFrontmatter(source);
    const editor = { state: EditorState.create({ doc: parser.parse(preprocessMarkdown(body)), plugins: [history(), createMarkdownSourceHistoryPlugin()] }) };
    const transactions = [];
    editor.view = { dispatch: tr => { transactions.push(tr); editor.state = editor.state.apply(tr); } };
    editor.view.dispatch(editor.state.tr.step(new MarkdownSourceStep('', source)).setMeta('addToHistory', false));
    const loader = new ContentLoader({ getEditor: () => editor, markdownParser: parser, sourcePreservingSerializer: serializer });
    loader.loadedFilePath = '/workspace/posts/article.md';
    loader.currentSessionId = 'fixture-session';
    loader.originalMarkdown = source;
    loader._frontmatterRaw = raw;
    serializer.reset(body, editor.state.doc);
    loader.sourceHistorySnapshot = markdownSourceHistoryKey.getState(editor.state);
    return { loader, editor, transactions };
}

/** 有效的 1×1 PNG，实际 blob 可以通过 fetch 读取。 */
const PNG = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5O8AAAAASUVORK5CYII=', 'base64'));

test('相对图片转换为可读取 blob，保留原 Markdown 路径且不污染源码快照或撤销历史', async t => {
    const source = '---\ntitle: 图片测试\n---\n\n![图片](assets/picture.png)\n\n![中文](../images/%E4%B8%AD%E6%96%87.png)\n\n<!-- 保留 -->\n\n';
    const reads = [];
    const { loader, editor, transactions } = createHarness(t, source, path => { reads.push(path); return PNG; });
    const snapshot = markdownSourceHistoryKey.getState(editor.state);
    await loader._resolveImageNodes('fixture-session');
    assert.deepEqual(reads, ['/workspace/posts/assets/picture.png', '/workspace/images/中文.png']);
    const images = [];
    editor.state.doc.descendants(node => { if (node.type.name === 'image') images.push(node); });
    assert.equal(images.length, 2);
    for (const image of images) {
        assert.match(image.attrs.src, /^blob:/);
        assert.deepEqual(new Uint8Array(await (await fetch(image.attrs.src)).arrayBuffer()), PNG);
    }
    assert.deepEqual(images.map(node => node.attrs.dataOriginalSrc), ['assets/picture.png', '../images/%E4%B8%AD%E6%96%87.png']);
    assert.equal(markdownSourceHistoryKey.getState(editor.state), snapshot);
    assert.equal(undoDepth(editor.state), 0);
    assert.equal(loader.getMarkdown(), source);
    loader.contentChanged = true;
    assert.equal(loader.getMarkdown(), source);
    assert.ok(transactions.slice(1).every(tr => tr.getMeta('addToHistory') === false && !tr.steps.some(step => step instanceof MarkdownSourceStep)));
});

test('读取图片期间切换文档，迟到的 blob 不回写新文档', async t => {
    let finishRead;
    let didStart;
    const started = new Promise(resolve => { didStart = resolve; });
    const { loader, editor, transactions } = createHarness(t, '![](assets/picture.png)\n\n', () => {
        didStart();
        return new Promise(resolve => { finishRead = resolve; });
    });
    const resolving = loader._resolveImageNodes('fixture-session');
    await started;
    loader.currentSessionId = 'next-document';
    finishRead(PNG);
    await resolving;
    assert.equal(transactions.length, 1);
    assert.equal(editor.state.doc.firstChild.firstChild.attrs.src, 'assets/picture.png');
});
