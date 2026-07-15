import test from 'node:test';
import assert from 'node:assert/strict';
import { isProseMirrorClipboardHtml } from '../src/features/clipboardEnhancer.js';

/** 验证结构化编辑器的剪贴板标记可以被稳定识别。 */
test('复制增强器保留 ProseMirror 的结构化剪贴板 HTML', () => {
    assert.equal(isProseMirrorClipboardHtml('<ul data-pm-slice="1 1 []"><li>Task</li></ul>'), true);
    assert.equal(isProseMirrorClipboardHtml('<p data-PM-slice = "0 0 []">Text</p>'), true);
    assert.equal(isProseMirrorClipboardHtml('<ul><li>Task</li></ul>'), false);
    assert.equal(isProseMirrorClipboardHtml(''), false);
});
