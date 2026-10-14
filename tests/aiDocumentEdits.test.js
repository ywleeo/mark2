/** AI 文档修改的原文匹配、文档身份、预览提案与原生 undo/redo 回归。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorState } from '@tiptap/pm/state';
import { history, undo, redo } from '@tiptap/pm/history';
import { applyDocumentEdits, createDocumentEditApplier } from '../src/modules/ai-file-task/DocumentEdits.js';
import { DocumentTaskEngine } from '../src/modules/ai-file-task/DocumentTaskEngine.js';
import { normalizeConversation } from '../src/modules/ai-file-task/DocumentTaskConversation.js';
import { DocumentTaskResultStore } from '../src/modules/ai-file-task/DocumentTaskResultStore.js';
import { ContentLoader } from '../src/components/markdown-editor/ContentLoader.js';
import { createMarkdownSourceHistoryPlugin, MarkdownSourceStep } from '../src/components/markdown-editor/MarkdownSourceHistory.js';
import { createMarkdownTestSchema } from './helpers/markdownRoundTripHarness.js';
import { createMarkdownParser, createMarkdownSerializer } from '../src/modules/markdownPipeline.js';
import { extractFrontmatter, preprocessMarkdown } from '../src/components/markdown-editor/MarkdownPreprocessor.js';
import { SourcePreservingMarkdownSerializer } from '../src/components/markdown-editor/SourcePreservingMarkdownSerializer.js';

/** 构造模型的提案工具响应。 */
function proposal(edits) { return { content: '', rawBody: JSON.stringify({ choices: [{ message: { tool_calls: [{ id: 'edit', type: 'function', function: { name: 'propose_document_edits', arguments: JSON.stringify({ edits }) } }] } }] }) }; }

/** 使用真实解析、序列化与历史插件创建无 DOM 内容编辑器。 */
function editorHarness(source) {
    const schema = createMarkdownTestSchema();
    const parser = createMarkdownParser(schema);
    const serializer = new SourcePreservingMarkdownSerializer({ markdownSerializer: createMarkdownSerializer(schema) });
    const { body, raw } = extractFrontmatter(source);
    const doc = parser.parse(preprocessMarkdown(body));
    const editor = { state: EditorState.create({ doc, plugins: [history(), createMarkdownSourceHistoryPlugin()] }) };
    editor.view = { dispatch: tr => { editor.state = editor.state.apply(tr); }, focus: () => {} };
    editor.view.dispatch(editor.state.tr.step(new MarkdownSourceStep('', source)).setMeta('addToHistory', false));
    const loader = new ContentLoader({ getEditor: () => editor, markdownParser: parser, sourcePreservingSerializer: serializer, setUpdateSuppressed: () => {} });
    loader.originalMarkdown = source;
    loader._frontmatterRaw = raw;
    serializer.reset(body, doc);
    return { editor, loader };
}

test('多处局部修改保留所有其他源码，插入和删除可用且按原文定位', () => {
    const source = '# 原标题\n\n第一段。\n\n第二段。\n\n<!-- 保留 -->\n';
    assert.equal(applyDocumentEdits(source, [{ old_text: '原标题', new_text: '新标题' }, { old_text: '第一段。', new_text: '新第一段。\n\n新增段。' }, { old_text: '第二段。', new_text: '' }]).content, source.replace('原标题', '新标题').replace('第一段。', '新第一段。\n\n新增段。').replace('第二段。', ''));
});

test('任何一处原文缺失、重复或重叠都拒绝整批应用', () => {
    assert.throws(() => applyDocumentEdits('a b', [{ old_text: 'a', new_text: 'A' }, { old_text: 'c', new_text: 'C' }]), /missing/);
    assert.throws(() => applyDocumentEdits('a a', [{ old_text: 'a', new_text: 'A' }]), /ambiguous/);
    assert.throws(() => applyDocumentEdits('abc', [{ old_text: 'ab', new_text: 'A' }, { old_text: 'bc', new_text: 'B' }]), /overlap/);
});

test('修改只能应用到相同源文档和临时文档生命周期', () => {
    let content = '原文';
    let writes = 0;
    const target = { path: 'untitled://x', documentId: 'new', getContent: () => content, replace: value => { writes++; content = value; return true; } };
    const apply = createDocumentEditApplier({ getTarget: () => target });
    assert.throws(() => apply({ path: '/other.md', edits: [{ old_text: '原文', new_text: '修改' }] }), /differentDocument/);
    assert.throws(() => apply({ path: target.path, documentId: 'old', replacement: '修改' }), /differentDocument/);
    assert.equal(writes, 0);
    assert.equal(apply({ path: target.path, documentId: 'new', edits: [{ old_text: '原文', new_text: '修改' }] }), true);
    assert.equal(content, '修改');
});

test('模型只生成待应用提案，无正文写入；无效提案返回可修复的工具错误', async () => {
    for (const valid of [true, false]) {
        let calls = 0;
        let edits = [];
        const requests = [];
        const engine = new DocumentTaskEngine({ client: { complete: async options => {
            requests.push(options.messages);
            return ++calls === 1 ? proposal([{ old_text: valid ? '原段' : '不存在', new_text: '新段' }]) : { content: '请预览修改并应用。', rawBody: '{}' };
        } } });
        assert.equal(await engine.execute({ filePath: '/a.md', fileContent: '前言\n原段\n尾声', instruction: '修改中间一段', onDocumentEdits: value => { edits = value; } }), '请预览修改并应用。');
        assert.equal(edits.length, valid ? 1 : 0);
        const feedback = JSON.parse(requests.at(-1).at(-1).content);
        assert.equal(feedback.ok, valid);
        if (valid) assert.equal(feedback.status, 'awaiting_user_apply');
    }
});

test('提案与所属回复持久化，预算包含修改内容，API 历史只发送 role/content', async () => {
    const edits = [{ old_text: '原文', new_text: '新文' }];
    const messages = [{ role: 'user', content: '修改' }, { role: 'assistant', content: '预览', edits }];
    const records = new Map();
    const store = new DocumentTaskResultStore({ store: { get: (key, fallback) => records.get(key) || fallback, set: (key, value) => { records.set(key, value); return true; } } });
    store.set('/a.md', { content: '预览', messages });
    assert.deepEqual(store.get('/a.md').messages[1].edits, edits);
    normalizeConversation(messages)[1].edits[0].new_text = '外部';
    assert.equal(edits[0].new_text, '新文');
    const engine = new DocumentTaskEngine({ client: { complete: async options => {
        assert.deepEqual(options.messages.slice(2, -1), messages.map(({ role, content }) => ({ role, content })));
        return { content: '下一轮', rawBody: '{}' };
    } } });
    await engine.execute({ filePath: '/a.md', fileContent: '原文', instruction: '继续', messages });
});

test('真实 Markdown 局部替换与 undo/redo 逐字保留 frontmatter、标记和不可见源码', () => {
    const original = '---\ntitle: 旧标题\n---\n\n文章\n====\n\n__旧文字__\n\n<!-- 保留注释 -->\n\n```mermaid\ngraph LR\n A --> B\n```\n\n';
    const { editor, loader } = editorHarness(original);
    const next = original.replace('旧标题', '新标题').replace('__旧文字__', '**新文字**');
    assert.equal(loader.applyMarkdownChange(next), true);
    assert.equal(loader.getMarkdown(), next);
    assert.equal(loader.originalMarkdown, original);
    assert.equal(undo(editor.state, editor.view.dispatch), true);
    assert.equal(loader.getMarkdown(), original);
    assert.equal(redo(editor.state, editor.view.dispatch), true);
    assert.equal(loader.getMarkdown(), next);
});

test('仅修改 frontmatter 或隐式注释时，原生撤销仍恢复源码', () => {
    const original = '---\ntitle: 原题\n---\n\n正文\n\n<!-- before -->\n\n';
    const { editor, loader } = editorHarness(original);
    const next = original.replace('原题', '新题').replace('before', 'after');
    loader.applyMarkdownChange(next);
    assert.equal(loader.getMarkdown(), next);
    assert.equal(undo(editor.state, editor.view.dispatch), true);
    assert.equal(loader.getMarkdown(), original);
});

test('AI 修改与前后手动打字分别撤销，已有编辑历史不会被清空', () => {
    const original = '原文\n\n';
    const { editor, loader } = editorHarness(original);
    editor.view.dispatch(editor.state.tr.insertText('手动', 1));
    loader.contentChanged = true;
    assert.equal(loader.getMarkdown(), '手动原文\n\n');
    loader.applyMarkdownChange('AI 修改\n\n');
    editor.view.dispatch(editor.state.tr.insertText('后来', 1));
    assert.equal(loader.getMarkdown(), '后来AI 修改\n\n');
    undo(editor.state, editor.view.dispatch);
    assert.equal(loader.getMarkdown(), 'AI 修改\n\n');
    undo(editor.state, editor.view.dispatch);
    assert.equal(loader.getMarkdown(), '手动原文\n\n');
    undo(editor.state, editor.view.dispatch);
    assert.equal(loader.getMarkdown(), original);
});
