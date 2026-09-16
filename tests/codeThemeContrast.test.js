/** 代码主题在经典白底和编辑部纸底上的可读性回归测试。 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
    availableThemes,
    getHighlightColors,
    getThemeColors,
} from '../src/components/code-editor/ThemeSupport.js';
import { DEFAULT_CODE_FONT_FAMILY } from '../src/components/code-editor/constants.js';

/** 独立计算 sRGB 相对亮度，避免测试复用生产实现而漏掉公式错误。 */
function luminance(hex) {
    const channels = hex.slice(1).match(/../g).map(channel => {
        const value = parseInt(channel, 16) / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

/** 返回两种颜色的 WCAG 对比度。 */
function contrast(foreground, background) {
    const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    return (values[0] + 0.05) / (values[1] + 0.05);
}

/** 所有浅色代码主题都应在两套应用皮肤上达到正文阅读对比度。 */
test('浅色代码主题的正文与语法色在白底和纸底都清晰', () => {
    const themes = [...availableThemes.map(theme => theme.id), 'markdown-sql', 'csv'];
    for (const themeName of themes) {
        const theme = getThemeColors(themeName, false);
        const syntax = getHighlightColors(themeName, false);
        for (const background of ['#FDFDFD', '#F3EEE4']) {
            assert.ok(contrast(theme.foreground, background) >= 8.5, `${themeName} 正文对比度不足`);
            assert.ok(contrast(theme.gutterForeground, background) >= 5, `${themeName} 行号对比度不足`);
            for (const [token, color] of Object.entries(syntax)) {
                assert.ok(contrast(color, background) >= 8.5, `${themeName} ${token} 对比度不足`);
            }
        }
    }
});

/** 深色主题不经浅色纠偏，手动选择的主题语义仍保持原色。 */
test('深色代码主题保留原有配色', () => {
    assert.equal(getThemeColors('monokai', true).foreground, '#F8F8F2');
    assert.equal(getHighlightColors('monokai', true).string, '#E6DB74');
});

/** Windows 默认字体不应再退到细弱的 Courier New。 */
test('默认代码字体优先使用 Windows 清晰的等宽字体', () => {
    assert.match(DEFAULT_CODE_FONT_FAMILY, /^Consolas,/);
    assert.doesNotMatch(DEFAULT_CODE_FONT_FAMILY, /Courier New/);
});
