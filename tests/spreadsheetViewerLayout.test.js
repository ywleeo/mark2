import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

/**
 * 从样式表中读取指定选择器的声明，供布局契约测试使用。
 * @param {string} css - 完整 CSS 文本。
 * @param {string} selector - 需要查找的 CSS 选择器。
 * @returns {string} 选择器对应的声明文本。
 */
function getRuleDeclarations(css, selector) {
    const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = css.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`));
    assert.ok(match, `缺少样式规则：${selector}`);
    return match[1];
}

/**
 * 验证虚拟表格表头的裁剪层同时固定在横向与纵向视口中。
 */
test('电子表格横向滚动后表头裁剪层仍覆盖完整视口', async () => {
    const css = await readFile(new URL('../styles/spreadsheet-viewer.css', import.meta.url), 'utf8');
    const declarations = getRuleDeclarations(css, '.spreadsheet-grid__header-wrapper');

    assert.match(declarations, /position:\s*sticky\s*;/);
    assert.match(declarations, /top:\s*0\s*;/);
    assert.match(declarations, /left:\s*0\s*;/);
    assert.match(declarations, /width:\s*100%\s*;/);
    assert.match(declarations, /overflow:\s*hidden\s*;/);
});
