/** 图片段落装饰按真实 ProseMirror 内容更新，不改变源码或普通文字段落。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorState } from '@tiptap/pm/state';
import { ImageRowLayout } from '../src/extensions/ImageRowLayout.js';
import { createMarkdownTestSchema } from './helpers/markdownRoundTripHarness.js';
import { createMarkdownParser, createMarkdownSerializer } from '../src/modules/markdownPipeline.js';

/** 从 Markdown 创建真实编辑状态并获取图片布局插件。 */
function layout(source) {
    const schema = createMarkdownTestSchema();
    const parser = createMarkdownParser(schema);
    const plugin = ImageRowLayout.config.addProseMirrorPlugins()[0];
    const state = EditorState.create({ doc: parser.parse(source), plugins: [plugin] });
    return { schema, plugin, state };
}

test('单图及软换行分隔的多图段落获得统一间距，多图保留横排', () => {
    const { plugin, state } = layout('![单图](a.png)\n\n![一](b.png)\n![二](c.png)\n\n');
    const decorations = plugin.props.decorations(state).find();
    assert.deepEqual(decorations.map(item => item.type.attrs.class), ['image-paragraph', 'image-paragraph image-row']);
    assert.equal(state.doc.firstChild.firstChild.attrs.src, 'a.png');
    const serialized = createMarkdownSerializer(state.schema).serialize(state.doc);
    assert.ok(serialized.includes('![单图](a.png)'));
    assert.ok(!serialized.includes('image-paragraph'));
});

test('图文同段不使用纯图片段落间距；加入或删除文字时装饰实时更新', () => {
    const { schema, plugin, state } = layout('![图](a.png)后面的正文。\n\n');
    assert.equal(plugin.props.decorations(state).find().length, 0);
    const imageOnly = state.apply(state.tr.replaceWith(0, state.doc.content.size, schema.nodes.paragraph.create(null, schema.nodes.image.create({ src: 'a.png' }))));
    assert.equal(plugin.props.decorations(imageOnly).find()[0].type.attrs.class, 'image-paragraph');
    const withText = imageOnly.apply(imageOnly.tr.insertText('恢复正文。', 2));
    assert.equal(plugin.props.decorations(withText).find().length, 0);
});

test('列表和引用中的图片仍可装饰，链接徽章保持横排', () => {
    const { plugin, state } = layout('> ![引用图片](a.png)\n\n- ![列表图片](b.png)\n\n[![徽章一](c.png)](https://example.com) [![徽章二](d.png)](https://example.com)\n\n普通正文。\n\n');
    assert.deepEqual(plugin.props.decorations(state).find().sort((a, b) => a.from - b.from).map(item => item.type.attrs.class), ['image-paragraph', 'image-paragraph', 'image-paragraph image-row']);
});
