/**
 * Emerald 主题排版边界回归测试。
 * 主题文件只负责视觉配色，字号、字体、间距、换行和表格结构统一由 editor.css 管理。
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const LAYOUT_DECLARATION_PATTERN = /^\s*(?:font-family|font-size|font-weight|font-variant-ligatures|line-height|letter-spacing|margin(?:-[a-z-]+)?|padding(?:-[a-z-]+)?|overflow-wrap|word-break|border-collapse|border-spacing|table-layout)\s*:/m;

/**
 * 确保 Emerald 不再通过主题选择器改变 Markdown 的公共排版骨架。
 */
test('Emerald 主题不覆盖公共排版属性', async () => {
    const css = await readFile(new URL('../styles/themes/emerald.css', import.meta.url), 'utf8');

    assert.doesNotMatch(css, LAYOUT_DECLARATION_PATTERN);
});
