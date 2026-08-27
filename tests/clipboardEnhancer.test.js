import test from 'node:test';
import assert from 'node:assert/strict';
import {
    isProseMirrorClipboardHtml,
    sanitizePastedHtml,
} from '../src/features/clipboardEnhancer.js';

/** 验证结构化编辑器的剪贴板标记可以被稳定识别。 */
test('复制增强器保留 ProseMirror 的结构化剪贴板 HTML', () => {
    assert.equal(isProseMirrorClipboardHtml('<ul data-pm-slice="1 1 []"><li>Task</li></ul>'), true);
    assert.equal(isProseMirrorClipboardHtml('<p data-PM-slice = "0 0 []">Text</p>'), true);
    assert.equal(isProseMirrorClipboardHtml('<ul><li>Task</li></ul>'), false);
    assert.equal(isProseMirrorClipboardHtml(''), false);
});

/** 验证外部富文本的展示属性不会进入 Markdown 编辑文档。 */
test('粘贴清理器移除 Word 展示格式并保留语义标签', () => {
    const html = [
        '<meta charset="utf-8">',
        '<p class="MsoNormal" style="font-family: Calibri; font-size: 16pt; color: red">',
        '<span lang="ZH-CN" style="background: yellow"><strong>正文</strong></span>',
        '<a href="https://example.com" style="color: blue">链接</a>',
        '</p>',
    ].join('');

    const cleaned = sanitizePastedHtml(html, null);
    assert.equal(cleaned.includes('MsoNormal'), false);
    assert.equal(cleaned.includes('font-family'), false);
    assert.equal(cleaned.includes('font-size'), false);
    assert.equal(cleaned.includes('<span'), false);
    assert.match(cleaned, /<strong>正文<\/strong>/);
    assert.match(cleaned, /<a href="https:\/\/example\.com">链接<\/a>/);
});

/** 验证编辑器内部复制的结构化切片不被外部富文本规则破坏。 */
test('粘贴清理器原样保留 ProseMirror 内部切片', () => {
    const html = '<ul data-pm-slice="1 1 []"><li style="color:red">Task</li></ul>';
    assert.equal(sanitizePastedHtml(html, null), html);
});
