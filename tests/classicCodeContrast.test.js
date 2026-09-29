/** Classic 暗色 Markdown 代码块的语法色可读性回归测试。 */

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

/** 读取指定 Classic 配色暗色规则中的十六进制语义变量。 */
function readPaletteColor(css, scheme, variable) {
    const selector = `[data-color-scheme='${scheme}'][data-theme-appearance='dark']`;
    const selectorIndex = css.indexOf(selector);
    assert.notEqual(selectorIndex, -1, `缺少 ${scheme} 暗色配色`);
    const blockStart = css.indexOf('{', selectorIndex);
    const blockEnd = css.indexOf('}', blockStart);
    const block = css.slice(blockStart, blockEnd);
    return block.match(new RegExp(`${variable}:\\s*(#[0-9a-f]{6})`, 'i'))?.[1];
}

/** 所有 Classic 暗色配色的主要语法色应达到清晰高于 AA 的 5.5:1 对比度。 */
test('Classic 暗色配色完整覆盖主要语法色并保持清晰', async () => {
    const [themeCss, paletteCss] = await Promise.all([
        readFile(new URL('../styles/themes/default.css', import.meta.url), 'utf8'),
        readFile(new URL('../styles/color-schemes/classic.css', import.meta.url), 'utf8'),
    ]);
    const variables = [
        '--classic-palette-syntax-ink',
        '--classic-palette-syntax-comment',
        '--classic-palette-syntax-keyword',
        '--classic-palette-syntax-value',
        '--classic-palette-syntax-string',
        '--classic-palette-syntax-title',
        '--classic-palette-syntax-deletion',
    ];

    assert.match(themeCss, /color:\s*var\(--classic-palette-syntax-keyword/);
    assert.match(themeCss, /color:\s*var\(--classic-palette-syntax-title/);

    for (const scheme of ['default', 'forest', 'violet']) {
        const background = readPaletteColor(paletteCss, scheme, '--classic-palette-syntax-bg');
        assert.ok(background, `${scheme} 缺少代码块背景色`);
        for (const variable of variables) {
            const color = readPaletteColor(paletteCss, scheme, variable);
            assert.ok(color, `${scheme} ${variable} 没有明确颜色`);
            assert.ok(contrast(color, background) >= 5.5, `${scheme} ${variable} 对比度不足`);
        }
    }
});
