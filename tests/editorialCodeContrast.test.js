/** Editorial 暗色 Markdown 代码块的语法色可读性回归测试。 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

/** 计算十六进制颜色的 sRGB 相对亮度。 */
function luminance(hex) {
    const channels = hex.slice(1).match(/../g).map(channel => {
        const value = Number.parseInt(channel, 16) / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

/** 返回前景色和背景色的 WCAG 对比度。 */
function contrast(foreground, background) {
    const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    return (values[0] + 0.05) / (values[1] + 0.05);
}

/** 读取包含指定选择器的 CSS 规则颜色。 */
function readRuleColor(css, selector) {
    const selectorIndex = css.indexOf(selector);
    assert.notEqual(selectorIndex, -1, `缺少 ${selector} 规则`);
    const blockStart = css.indexOf('{', selectorIndex);
    const blockEnd = css.indexOf('}', blockStart);
    return css.slice(blockStart, blockEnd).match(/color:\s*(#[0-9a-f]{6})/i)?.[1];
}

/** 暗色代码块所有主要 token 都应达到比 AA 更清晰的 5.5:1 对比度。 */
test('Editorial 暗色代码块完整覆盖主要语法色并保持清晰', async () => {
    const css = await readFile(new URL('../styles/themes/editorial.css', import.meta.url), 'utf8');
    const background = '#303630';
    const selectors = [
        "[data-theme-appearance='dark'] .hljs-comment",
        "[data-theme-appearance='dark'] .hljs-keyword",
        "[data-theme-appearance='dark'] .hljs-built_in",
        "[data-theme-appearance='dark'] .hljs-variable",
        "[data-theme-appearance='dark'] .hljs-title",
        "[data-theme-appearance='dark'] .hljs-link",
        "[data-theme-appearance='dark'] .hljs-deletion",
    ];

    for (const selector of selectors) {
        const color = readRuleColor(css, selector);
        assert.ok(color, `${selector} 没有明确颜色`);
        assert.ok(contrast(color, background) >= 5.5, `${selector} 对比度不足`);
    }
});
