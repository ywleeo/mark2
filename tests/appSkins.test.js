/** 整体皮肤选择、兼容旧主题与样式隔离的回归测试。 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { normalizeAppSkin, resolveMarkdownTheme } from '../src/config/appSkins.js';

/** 未知或旧版设置必须稳定回退到经典皮肤。 */
test('未知皮肤回退经典，旧 Markdown 主题保持不变', () => {
    assert.equal(normalizeAppSkin(undefined), 'classic');
    assert.equal(normalizeAppSkin('unsupported'), 'classic');
    assert.equal(resolveMarkdownTheme(undefined, 'emerald'), 'emerald');
    assert.equal(resolveMarkdownTheme('classic', 'notion'), 'notion');
});

/** 整体皮肤应接管正文，但不能清除用户原有主题偏好。 */
test('编辑部皮肤使用专属 Markdown 主题', () => {
    assert.equal(normalizeAppSkin('editorial'), 'editorial');
    assert.equal(resolveMarkdownTheme('editorial', 'emerald'), 'editorial');
    assert.equal(resolveMarkdownTheme('classic', 'emerald'), 'emerald');
});

/** 用户选择的编辑器字体必须同时作用于编辑部主题的正文和一级标题。 */
test('编辑部标题跟随用户选择的正文字体', async () => {
    const css = await readFile(new URL('../styles/themes/editorial.css', import.meta.url), 'utf8');
    const headingRule = css.match(/\.tiptap-editor\[data-theme-appearance\] h1\s*\{([^}]*)\}/)?.[1];

    assert.match(headingRule || '', /font-family:\s*var\(--editor-font-family,/);
});

/** 外壳 CSS 必须通过皮肤标记隔离，防止经典主题被意外覆盖。 */
test('编辑部外壳样式只在整体皮肤标记下生效', async () => {
    const css = await readFile(new URL('../styles/skins/editorial.css', import.meta.url), 'utf8');
    assert.match(css, /data-app-skin='editorial'/);
    assert.match(css, /\.sidebar/);
    assert.match(css, /\.markdown-toolbar/);
    assert.match(css, /\.settings-dialog/);
    assert.match(css, /\.view-pane\.markdown-pane/);
    assert.match(css, /border-right: 1px solid var\(--editorial-seam\)/);
    assert.match(css, /\.toc-panel\[data-position='left'\]/);
    assert.match(css, /\.ai-file-task-sidebar/);
    assert.match(css, /\.html-embed__frame/);
    assert.match(css, /\.pdf-viewer__loading/);
});

/** Windows 专项层保留可点开的 M2 图标，菜单与窗口按钮仍保持独立。 */
test('Windows 编辑部皮肤保留标题栏品牌并统一菜单样式', async () => {
    const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
    const css = await readFile(new URL('../styles/skins/editorial-windows.css', import.meta.url), 'utf8');
    const menu = await readFile(new URL('../src/components/AppMenu.js', import.meta.url), 'utf8');

    assert.ok(html.indexOf('/styles/skins/editorial-windows.css') > html.indexOf('/styles/platform-windows.css'));
    assert.match(html, /id="titlebar-logo"/);
    assert.doesNotMatch(css, /#titlebar-logo\s*\{[^}]*display:\s*none/);
    assert.match(css, /\.titlebar-menu\s*\{/);
    assert.match(css, /\.app-menu__submenu\s*\{[^}]*background: var\(--editorial-paper\);/);
    assert.match(css, /\.app-menu__item\.danger \.app-menu__label\s*\{[^}]*color: var\(--app-danger-text\);/);
    assert.doesNotMatch(css, /\.titlebar-(?:menu|minimize|maximize|close)\s*\{[^}]*display: none/);
    assert.match(menu, /id: 'about'[^\n]*command: COMMAND_IDS\.APP_ABOUT/);
});

/** Classic 浅色菜单只纠正继承的 300 字重，不更换字体或压掉危险操作红色。 */
test('Windows Classic 浅色菜单使用常规字重', async () => {
    const classic = await readFile(new URL('../styles/layout.css', import.meta.url), 'utf8');
    const editorial = await readFile(new URL('../styles/skins/editorial-windows.css', import.meta.url), 'utf8');
    const classicLabel = classic.match(/data-app-skin='classic'\]\[data-theme-appearance='light'\] \.app-menu__item:not\(\.danger\) \.app-menu__label\s*\{([^}]*)\}/)?.[1];
    assert.match(classicLabel || '', /font-weight: 400/);
    assert.doesNotMatch(classicLabel || '', /font-family/);
    assert.match(classic, /data-app-skin='classic'\]\[data-theme-appearance='light'\] \.app-menu__shortcut\s*\{[^}]*opacity: 0\.9;/);
    assert.match(editorial, /\.app-menu__item\.danger \.app-menu__label\s*\{[^}]*color: var\(--app-danger-text\);/);
});

/** 完整文件名只在书页皮肤换行显示，经典皮肤仍使用原有中间截断。 */
test('目录文件名保留完整文本并由皮肤决定排版', async () => {
    const renderer = await readFile(new URL('../src/utils/fileNameDisplay.js', import.meta.url), 'utf8');
    const classicCss = await readFile(new URL('../styles/file-tree.css', import.meta.url), 'utf8');
    const editorialCss = await readFile(new URL('../styles/skins/editorial.css', import.meta.url), 'utf8');
    assert.match(renderer, /full\.textContent = label\.dataset\.fullName/);
    assert.match(classicCss, /\.tree-item-name__full\s*\{\s*display: none/);
    assert.match(editorialCss, /-webkit-line-clamp: 2/);
});

/** 编辑部侧栏只留文字署名和折叠箭头，打开动作由文件菜单承载。 */
test('编辑部侧栏不在箭头上覆盖打开链接', async () => {
    const renderer = await readFile(new URL('../src/components/file-tree/FileTreeRenderer.js', import.meta.url), 'utf8');
    const events = await readFile(new URL('../src/components/file-tree/FileTreeEvents.js', import.meta.url), 'utf8');
    const css = await readFile(new URL('../styles/skins/editorial.css', import.meta.url), 'utf8');
    const menu = await readFile(new URL('../src/components/AppMenu.js', import.meta.url), 'utf8');

    assert.match(renderer, /class="skin-masthead__name" role="img" aria-label="Mark2"/);
    assert.match(renderer, /class="skin-masthead__word" aria-hidden="true">Mark<\/span>/);
    assert.doesNotMatch(renderer, /skin-masthead__action/);
    assert.doesNotMatch(renderer, /section-action-label/);
    assert.match(events, /onOpenFileRequest\?\.\(\)/);
    assert.match(events, /onOpenFolderRequest\?\.\(\)/);
    assert.match(css, /\.skin-masthead \{ display: none; \}/);
    assert.match(css, /\.skin-masthead__word\s*\{[^}]*letter-spacing: 0\.08em;/);
    assert.match(css, /\.sidebar \.section-action-btn \{ display: none; \}/);
    assert.doesNotMatch(css, /\.section-header:is\(:hover, :focus-within\) \.section-action-btn/);
    assert.match(menu, /command: COMMAND_IDS\.APP_OPEN_FILE/);
    assert.match(menu, /command: COMMAND_IDS\.APP_OPEN_FOLDER/);
    assert.doesNotMatch(renderer, /A PLACE FOR WORDS/);
});

/** 栏目滚动条不应在鼠标进入时占用新宽度，造成文件名换行跳动。 */
test('编辑部侧栏 hover 只改变滑块颜色，不改变滚动条占位', async () => {
    const css = await readFile(new URL('../styles/skins/editorial.css', import.meta.url), 'utf8');
    assert.match(css, /\.sidebar \.section-content\s*\{[^}]*scrollbar-width: thin;[^}]*scrollbar-gutter: stable;/);
    assert.match(css, /\.sidebar \.section-content:hover\s*\{[^}]*scrollbar-color:/);
    assert.doesNotMatch(css, /\.sidebar \.section-content:hover\s*\{[^}]*scrollbar-width:/);
});

/** 顶部保留连续操作区，不把可变的正文页宽强加给 tab 和 toolbar。 */
test('编辑部 tab 与工具栏靠近侧栏边界，正文独立居中', async () => {
    const css = await readFile(new URL('../styles/skins/editorial.css', import.meta.url), 'utf8');
    const toolbar = await readFile(new URL('../src/components/markdown-toolbar/MarkdownToolbar.js', import.meta.url), 'utf8');

    assert.match(css, /\.tab-bar\s*\{[^}]*padding-inline: clamp\(16px, 2vw, 28px\)/);
    assert.match(css, /\.markdown-toolbar--dark\s*\{[^}]*padding-inline: clamp\(16px, 2vw, 28px\)/);
    assert.doesNotMatch(css, /\.tab-bar\s*\{[^}]*--markdown-centered-width/);
    assert.doesNotMatch(toolbar, /wrapper\.style\.setProperty\('--markdown-centered-width'/);
});

/** 导出主题应使用稳定名称，而非 Vite 构建后的带 hash 文件名。 */
test('主题加载与导出共享稳定的主题名称', async () => {
    const loader = await readFile(new URL('../src/utils/editorSettings.js', import.meta.url), 'utf8');
    const exporter = await readFile(new URL('../src/utils/exportUtils.js', import.meta.url), 'utf8');
    const shareBuilder = await readFile(new URL('../src/modules/share/sharePageBuilder.js', import.meta.url), 'utf8');
    assert.match(loader, /link\.dataset\.themeName = theme/);
    assert.match(exporter, /themeLink\?\.dataset\.themeName/);
    assert.match(exporter, /const exportBackground = isEditorial \? '#f3eee4' : '#ffffff'/);
    assert.match(exporter, /const exportFontOverride = isEditorial/);
    assert.match(shareBuilder, /resolveMarkdownTheme\(settings\.skin, settings\.theme\)/);
});
