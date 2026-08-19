import test from 'node:test';
import assert from 'node:assert/strict';
import MarkdownIt from 'markdown-it';
import { addDetailsBlockMarkdownRule } from '../src/modules/detailsBlockMarkdown.js';

/**
 * 创建仅加载 details 块规则的 MarkdownIt 测试实例。
 * @returns {MarkdownIt}
 */
function createDetailsMarkdownIt() {
    const md = new MarkdownIt({ html: true, breaks: true });
    addDetailsBlockMarkdownRule(md);
    return md;
}

test('details 块保留 summary、正文 Markdown 和基础属性', () => {
    const md = createDetailsMarkdownIt();
    const source = `<details open class="faq" id="answer">
<summary>**点击**查看</summary>

正文段落

- 项目一
- 项目二
</details>`;

    const tokens = md.parse(source, {});
    assert.deepEqual(tokens.map(token => token.type), [
        'details_open',
        'details_summary_open',
        'inline',
        'details_summary_close',
        'paragraph_open',
        'inline',
        'paragraph_close',
        'bullet_list_open',
        'list_item_open',
        'paragraph_open',
        'inline',
        'paragraph_close',
        'list_item_close',
        'list_item_open',
        'paragraph_open',
        'inline',
        'paragraph_close',
        'list_item_close',
        'bullet_list_close',
        'details_close',
    ]);
    assert.deepEqual(tokens[0].meta.attrs, {
        open: true,
        id: 'answer',
        class: 'faq',
        style: null,
    });
    assert.equal(tokens[2].content, '**点击**查看');
});

test('details 块支持嵌套且不会被通用 HTML 规则拆散', () => {
    const md = createDetailsMarkdownIt();
    const source = `<details>
<summary>外层</summary>

<details>
<summary>内层</summary>

内容
</details>
</details>`;

    const tokens = md.parse(source, {});
    assert.equal(tokens.filter(token => token.type === 'details_open').length, 2);
    assert.equal(tokens.filter(token => token.type === 'details_close').length, 2);
    assert.equal(tokens.filter(token => token.type === 'details_summary_open').length, 2);
    assert.equal(tokens.some(token => token.type === 'html_block'), false);
});

test('不完整 details 继续交给原有 HTML 兜底规则处理', () => {
    const md = createDetailsMarkdownIt();
    const tokens = md.parse('<details>\n<summary>缺少结束标签</summary>\n', {});

    assert.equal(tokens.some(token => token.type === 'details_open'), false);
    assert.equal(tokens.some(token => token.type === 'html_block'), true);
});
