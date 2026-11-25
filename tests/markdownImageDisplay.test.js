/** 图片显示更新保留源路径，拒绝无效显示目标。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorState } from '@tiptap/pm/state';
import { createMarkdownTestSchema } from './helpers/markdownRoundTripHarness.js';
import { createMarkdownParser } from '../src/modules/markdownPipeline.js';
import { createImageDisplayTransaction } from '../src/modules/markdownImageDisplay.js';

/** 使用真实 Markdown schema 创建文档状态。 */
function createDocumentState() {
    const schema = createMarkdownTestSchema();
    return EditorState.create({
        doc: createMarkdownParser(schema).parse('![原图](assets/original.png)正文\n'),
    });
}

/** 有效的图片显示更新只能改变显示地址，原图片路径始终保留。 */
test('图片显示更新，并保留首次解析前后的原路径', () => {
    let state = createDocumentState();
    for (const src of ['blob:first', 'blob:second']) {
        state = state.apply(createImageDisplayTransaction(state, 1, src));
        assert.equal(state.doc.nodeAt(1).attrs.src, src);
        assert.equal(state.doc.nodeAt(1).attrs.dataOriginalSrc, 'assets/original.png');
        assert.equal(state.doc.textContent, '正文');
    }
});

/** 显示更新只接受文档中的图片及运行期 blob 地址。 */
test('图片显示事务拒绝替换源路径或非图片节点', () => {
    const state = createDocumentState();
    assert.throws(() => createImageDisplayTransaction(state, 1, 'assets/other.png'), TypeError);
    assert.throws(() => createImageDisplayTransaction(state, 0, 'blob:other'), TypeError);
});
