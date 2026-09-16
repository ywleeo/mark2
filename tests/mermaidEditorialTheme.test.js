/** Mermaid 必须跟随 Editorial 皮肤，并保持 Classic 现有行为。 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createMermaidConfig, resolveMermaidThemeProfile } from '../src/config/mermaidThemes.js';
import { shouldPreserveMermaidSvgColors } from '../src/components/markdown-editor/MermaidExportHandler.js';
import {
    allocateMermaidRenderId,
    hasInteractiveChartValues,
    rekeyCachedMermaidSvg,
} from '../src/utils/mermaidRenderer.js';

/** 创建只包含渲染器所需 dataset 的根节点替身。 */
function createThemeRoot(appSkin, themeAppearance) {
    return { dataset: { appSkin, themeAppearance } };
}

/** Classic 皮肤继续使用原配色，避免新皮肤影响默认主题。 */
test('Classic Mermaid 保留原有蓝色主题', () => {
    const profile = resolveMermaidThemeProfile(createThemeRoot('classic', 'dark'));
    assert.equal(profile.key, 'classic');
    assert.equal(profile.editorial, false);
    assert.equal(profile.flowchartPalettes[0].nodeBorder, '#4a90f4');
    assert.equal(profile.themeVariables.primaryColor, '#eef4ff');
});

/** Editorial 浅色和深色必须分别使用纸墨配色，不能回退到默认蓝色。 */
test('Editorial Mermaid 根据明暗外观生成纸墨主题', () => {
    const light = resolveMermaidThemeProfile(createThemeRoot('editorial', 'light'));
    const dark = resolveMermaidThemeProfile(createThemeRoot('editorial', 'dark'));

    assert.equal(light.key, 'editorial-light');
    assert.equal(dark.key, 'editorial-dark');
    assert.equal(light.themeVariables.primaryBorderColor, '#9c4b37');
    assert.equal(dark.themeVariables.primaryBorderColor, '#dc866e');
    assert.equal(light.flowchartPalettes[0].nodeBg, '#eadfd3');
    assert.equal(dark.flowchartPalettes[0].nodeBg, '#3a322d');
    assert.notEqual(light.themeVariables.pie1, '#5b8ff9');
    assert.notEqual(dark.themeVariables.pie1, '#5b8ff9');
});

/** Mermaid 初始化参数应把同一主题扩展到流程图、时序图和统计图。 */
test('Editorial Mermaid 配置覆盖主要图表类型', () => {
    const profile = resolveMermaidThemeProfile(createThemeRoot('editorial', 'light'));
    const config = createMermaidConfig(profile);

    assert.equal(config.theme, 'base');
    assert.equal(config.flowchart.htmlLabels, true);
    assert.equal(config.themeVariables.actorBorder, '#9c4b37');
    assert.equal(config.themeVariables.noteBorderColor, '#a47b43');
    assert.match(config.themeVariables.xyChart.plotColorPalette, /#9c4b37/);
    assert.match(config.themeVariables.fontFamily, /--editor-font-family/);
});

/** Editorial 深色 SVG 使用原生深色配色，不能再经过 Classic 的反色滤镜。 */
test('Editorial Mermaid 绕过 Classic 深色反色滤镜并支持分享导出', async () => {
    const [editorCss, editorialCss, imageModalCss, shareBuilder] = await Promise.all([
        readFile(new URL('../styles/editor.css', import.meta.url), 'utf8'),
        readFile(new URL('../styles/themes/editorial.css', import.meta.url), 'utf8'),
        readFile(new URL('../styles/image-modal.css', import.meta.url), 'utf8'),
        readFile(new URL('../src/modules/share/sharePageBuilder.js', import.meta.url), 'utf8'),
    ]);

    assert.match(editorCss, /data-theme-appearance='dark'\]:not\(\[data-app-skin='editorial'\]\).*\.mermaid svg/);
    assert.match(editorialCss, /\.mermaid svg\s*\{\s*filter: none !important;/);
    assert.match(imageModalCss, /\.image-modal-img\.is-svg:not\(\.preserve-svg-colors\)/);
    assert.match(imageModalCss, /\.image-modal-img\.is-svg\.preserve-svg-colors\s*\{\s*filter: none;/);
    assert.match(editorialCss, /font-family: var\(--editor-font-family/);
    assert.match(shareBuilder, /data-app-skin="\$\{settings\.skin\}" data-theme-appearance/);
});

/** 只有原生生成明暗配色的 Editorial SVG 才跳过弹窗滤镜。 */
test('Mermaid 预览按皮肤选择原生配色或 Classic 反色滤镜', () => {
    assert.equal(shouldPreserveMermaidSvgColors(createThemeRoot('editorial', 'dark')), true);
    assert.equal(shouldPreserveMermaidSvgColors(createThemeRoot('classic', 'dark')), false);
});

/** 流程图矩形不是柱形数据，hover 时不应创建图表指示竖线。 */
test('Mermaid 数值提示只识别含 bar 或 line 数据的图表', () => {
    assert.equal(hasInteractiveChartValues('flowchart LR\nA[开始] --> B[结束]'), false);
    assert.equal(hasInteractiveChartValues('xychart-beta\nbar [12, 18, 9]'), true);
    assert.equal(hasInteractiveChartValues('xychart-beta\nline [2, 5, 8]'), true);
});

/** WebKit 主题重绘必须使用新 id，避免 Mermaid 命中页面里的旧 SVG 后生成空图。 */
test('Mermaid 每次重绘都分配新 id，并安全复用缓存 SVG', () => {
    const attributes = new Map([['data-mermaid-id', 'mermaid-old']]);
    const element = {
        setAttribute(name, value) {
            attributes.set(name, value);
        },
    };

    const firstId = allocateMermaidRenderId(element);
    const secondId = allocateMermaidRenderId(element);
    assert.notEqual(firstId, 'mermaid-old');
    assert.notEqual(firstId, secondId);
    assert.equal(attributes.get('data-mermaid-id'), secondId);

    const cachedSvg = '<svg id="mermaid-old"><style>#mermaid-old .node{fill:red}</style><path marker-end="url(#mermaid-old-arrow)"/></svg>';
    const rekeyedSvg = rekeyCachedMermaidSvg(cachedSvg, 'mermaid-old', firstId);
    assert.doesNotMatch(rekeyedSvg, /mermaid-old/);
    assert.match(rekeyedSvg, new RegExp(`<svg id="${firstId}"`));
    assert.match(rekeyedSvg, new RegExp(`url\\(#${firstId}-arrow\\)`));
});
