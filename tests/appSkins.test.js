/** 整体皮肤选择、兼容旧主题与样式隔离的回归测试。 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
    getAppColorSchemes,
    normalizeAppColorSchemes,
    normalizeAppSkin,
    resolveAppColorScheme,
    resolveMarkdownTheme,
} from '../src/config/appSkins.js';

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

/** 配色按皮肤独立记忆，旧设置与未知值都必须安全回退。 */
test('应用配色按皮肤规范化并保留独立选择', () => {
    assert.deepEqual(normalizeAppColorSchemes(undefined), {
        classic: 'default',
        editorial: 'terracotta',
    });
    assert.deepEqual(normalizeAppColorSchemes({ classic: 'bad', editorial: 'pine' }), {
        classic: 'default',
        editorial: 'pine',
    });
    assert.equal(resolveAppColorScheme('editorial', { editorial: 'indigo' }), 'indigo');
    assert.equal(resolveAppColorScheme('classic', { classic: 'forest' }), 'forest');
    assert.deepEqual(getAppColorSchemes('classic').map(scheme => scheme.id), [
        'default',
        'forest',
        'violet',
    ]);
    assert.deepEqual(getAppColorSchemes('editorial').map(scheme => scheme.id), [
        'terracotta',
        'pine',
        'indigo',
    ]);
});

/** Classic 配色同样只提供颜色语义，不得夹带布局选择器。 */
test('Classic 配色完整覆盖黑白、森绿与鸢尾的明暗变量', async () => {
    const css = await readFile(new URL('../styles/color-schemes/classic.css', import.meta.url), 'utf8');
    for (const scheme of ['default', 'forest', 'violet']) {
        assert.match(css, new RegExp(`data-color-scheme='${scheme}'\\]\\[data-theme-appearance='light'\\]`));
        assert.match(css, new RegExp(`data-color-scheme='${scheme}'\\]\\[data-theme-appearance='dark'\\]`));
    }
    assert.match(css, /--classic-palette-accent:/);
    assert.match(css, /--classic-palette-chart-series:/);
    assert.doesNotMatch(css, /\.(?:sidebar|tab-bar|markdown-toolbar)\s*\{/);
    assert.doesNotMatch(css, /:root\[data-app-skin='classic'\]\s*\{/);
});

/** 有色 Classic 方案的 Sidebar、Toolbar 与 View 必须属于同一低色差底色体系。 */
test('Classic 有色方案协调 Sidebar 与 View 背景', async () => {
    const css = await readFile(new URL('../styles/color-schemes/classic.css', import.meta.url), 'utf8');

    for (const scheme of ['forest', 'violet']) {
        const selector = `[data-color-scheme='${scheme}'][data-theme-appearance='light']`;
        const start = css.indexOf(selector);
        const block = css.slice(css.indexOf('{', start), css.indexOf('}', css.indexOf('{', start)));
        const readHex = variable => block.match(new RegExp(`${variable}:\\s*(#[0-9a-f]{6})`, 'i'))?.[1];
        const sidebar = readHex('--classic-palette-sidebar');
        const content = readHex('--classic-palette-content');
        const paper = readHex('--classic-palette-md-paper');
        const channelDistance = (left, right) => left.slice(1).match(/../g)
            .reduce((sum, channel, index) => {
                const other = right.slice(1).match(/../g)[index];
                return sum + Math.abs(Number.parseInt(channel, 16) - Number.parseInt(other, 16));
            }, 0);

        assert.equal(content, paper, `${scheme} 的 View 与 Markdown 纸面应该连续`);
        assert.ok(channelDistance(sidebar, content) <= 18, `${scheme} 的 Sidebar 与 View 色差过大`);
    }
    assert.match(css, /--classic-toolbar-bg:/);
    assert.match(css, /--markdown-view-bg:\s*var\(--classic-palette-md-paper\)/);
});

/** Classic 的所有 Markdown 主题都必须允许配色接管最终 View 纸面。 */
test('Classic Markdown 主题统一消费 View 底色语义', async () => {
    const themes = await Promise.all(['default', 'notion', 'emerald'].map(async name => ({
        name,
        css: await readFile(new URL(`../styles/themes/${name}.css`, import.meta.url), 'utf8'),
    })));

    for (const { name, css } of themes) {
        const lightSurface = css.match(/\[data-theme-appearance='light'\] \.tiptap-editor:not\(\[data-theme-appearance\]\),[\s\S]*?\{([\s\S]*?)\}/)?.[1];
        const darkSurface = css.match(/\[data-theme-appearance='dark'\] \.tiptap-editor:not\(\[data-theme-appearance\]\),[\s\S]*?\{([\s\S]*?)\}/)?.[1];
        assert.match(lightSurface || '', /background-color:\s*var\(--markdown-view-bg,/, `${name} 浅色 View 未接入配色`);
        assert.match(darkSurface || '', /background-color:\s*var\(--markdown-view-bg,/, `${name} 深色 View 未接入配色`);
    }
});

/** 配色 CSS 只提供颜色变量，皮肤文件继续独立负责布局。 */
test('Editorial 配色完整覆盖红陶、松墨与靛青的明暗变量', async () => {
    const css = await readFile(new URL('../styles/color-schemes/editorial.css', import.meta.url), 'utf8');
    for (const scheme of ['terracotta', 'pine', 'indigo']) {
        assert.match(css, new RegExp(`data-color-scheme='${scheme}'\\]\\[data-theme-appearance='light'\\]`));
        assert.match(css, new RegExp(`data-color-scheme='${scheme}'\\]\\[data-theme-appearance='dark'\\]`));
    }
    assert.match(css, /--editorial-palette-accent:/);
    assert.match(css, /--editorial-palette-chart-series:/);
    assert.doesNotMatch(css, /\.(?:sidebar|tab-bar|markdown-toolbar)\s*\{/);
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

/** 编辑部侧栏隐藏文件打开动作，并在 Logo 旁保留全局搜索入口。 */
test('编辑部侧栏不在箭头上覆盖打开链接', async () => {
    const renderer = await readFile(new URL('../src/components/file-tree/FileTreeRenderer.js', import.meta.url), 'utf8');
    const events = await readFile(new URL('../src/components/file-tree/FileTreeEvents.js', import.meta.url), 'utf8');
    const fileTreeCss = await readFile(new URL('../styles/file-tree.css', import.meta.url), 'utf8');
    const css = await readFile(new URL('../styles/skins/editorial.css', import.meta.url), 'utf8');
    const menu = await readFile(new URL('../src/components/AppMenu.js', import.meta.url), 'utf8');

    assert.match(renderer, /class="skin-masthead__name" role="img" aria-label="Mark2"/);
    assert.match(renderer, /class="skin-masthead__word" aria-hidden="true">Mark<\/span>/);
    assert.match(renderer, /class="skin-masthead__actions"/);
    assert.match(renderer, /class="skin-masthead__action"[^>]*id="workspaceSearchAction"/);
    assert.match(fileTreeCss, /\.skin-masthead__word,\s*\.skin-masthead__edition\s*\{[^}]*text-transform: uppercase;/s);
    assert.doesNotMatch(renderer, /section-action-label/);
    assert.match(events, /onOpenFileRequest\?\.\(\)/);
    assert.match(events, /onOpenFolderRequest\?\.\(\)/);
    assert.doesNotMatch(css, /\.skin-masthead \{ display: none; \}/);
    assert.doesNotMatch(css, /\.skin-masthead__actions\s*\{[^}]*display:\s*none/);
    assert.match(css, /\.skin-masthead__word\s*\{[^}]*letter-spacing: 0\.08em;/);
    assert.match(css, /\.sidebar \.section-action-btn \{ display: none; \}/);
    assert.ok(renderer.indexOf('id="workspaceSearchAction"') < renderer.indexOf('open-files-section'));
    assert.match(css, /\.sidebar \.skin-masthead__action\s*\{/);
    assert.doesNotMatch(css, /\.section-header:is\(:hover, :focus-within\) \.section-action-btn/);
    assert.match(menu, /command: COMMAND_IDS\.APP_OPEN_FILE/);
    assert.match(menu, /command: COMMAND_IDS\.APP_OPEN_FOLDER/);
    assert.doesNotMatch(renderer, /A PLACE FOR WORDS/);
});

/** 所有皮肤的侧栏必须共用可见、无槽的 WebKit 滚动条机制。 */
test('侧栏滚动条机制由公共样式统一', async () => {
    const [layoutCss, fileTreeCss, editorialCss] = await Promise.all([
        readFile(new URL('../styles/layout.css', import.meta.url), 'utf8'),
        readFile(new URL('../styles/file-tree.css', import.meta.url), 'utf8'),
        readFile(new URL('../styles/skins/editorial.css', import.meta.url), 'utf8'),
    ]);

    assert.doesNotMatch(fileTreeCss, /\.section-content[^\{]*\{[^}]*scrollbar-(?:width|color):/);
    assert.doesNotMatch(editorialCss, /\.sidebar \.section-content[^\{]*\{[^}]*scrollbar-(?:width|color|gutter):/);
    assert.match(layoutCss, /\.section-content::-webkit-scrollbar[^\{]*\{[^}]*width:\s*var\(--scrollbar-size, 2px\);/);
    assert.match(layoutCss, /\.section-content::-webkit-scrollbar-track[^\{]*\{[^}]*background:\s*transparent;/);
    assert.match(layoutCss, /\.section-content::-webkit-scrollbar-thumb[^\{]*\{[^}]*background:\s*color-mix\([^}]*var\(--scrollbar-thumb-color,/);
});

/** 编辑部滚动条应从纸张与栏目暖色语义派生，不回退到经典皮肤的冷灰。 */
test('编辑部主视图与侧栏共用皮肤滚动条色阶', async () => {
    const css = await readFile(new URL('../styles/skins/editorial.css', import.meta.url), 'utf8');
    assert.match(css, /--editorial-scrollbar-thumb:\s*color-mix\([\s\S]*?var\(--editorial-rail-muted\)[\s\S]*?var\(--editorial-paper\)/);
    assert.match(css, /--scrollbar-thumb-color:\s*var\(--editorial-scrollbar-thumb\)/);
    assert.match(css, /--scrollbar-thumb-hover-color:\s*var\(--editorial-scrollbar-thumb-hover\)/);
    assert.doesNotMatch(css, /\.sidebar \.section-content::-webkit-scrollbar-thumb\s*\{[^}]*background:\s*transparent;/);
    assert.doesNotMatch(css, /--scrollbar-thumb-color:\s*#b7b4aa/);
});

/** Markdown 正文必须只走 WebKit 分支，避免侧栏挤压后出现系统白色滚动槽。 */
test('编辑部 Markdown 正文滚动条保持透明轨道', async () => {
    const [layoutCss, editorialCss, toolbarCss] = await Promise.all([
        readFile(new URL('../styles/layout.css', import.meta.url), 'utf8'),
        readFile(new URL('../styles/skins/editorial.css', import.meta.url), 'utf8'),
        readFile(new URL('../styles/markdown-toolbar.css', import.meta.url), 'utf8'),
    ]);

    assert.doesNotMatch(layoutCss, /body\s*\{[^}]*scrollbar-color\s*:/);
    assert.doesNotMatch(toolbarCss, /\.view-pane\.markdown-pane\.is-active\s*\{[^}]*scrollbar-(?:width|color)\s*:/);
    assert.doesNotMatch(editorialCss, /\.view-pane\.markdown-pane\.is-active\s*\{[^}]*scrollbar-(?:width|color)\s*:/);
    assert.match(toolbarCss, /\.view-pane\.markdown-pane\.is-active::-webkit-scrollbar-track\s*\{[^}]*background:\s*transparent;/);
    assert.match(toolbarCss, /\.view-pane\.markdown-pane\.is-active::-webkit-scrollbar-thumb\s*\{[^}]*background:\s*var\(--scrollbar-thumb-color,/);
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
    assert.match(exporter, /const exportFontOverride = isEditorial/);
    assert.match(shareBuilder, /resolveMarkdownTheme\(settings\.skin, settings\.theme\)/);
});

/** Editorial 的纸色只属于应用皮肤，PDF 页面和正文根节点必须保持白底。 */
test('编辑部主题导出 PDF 时移除应用背景色', async () => {
    const exporter = await readFile(new URL('../src/utils/exportUtils.js', import.meta.url), 'utf8');
    assert.match(exporter, /const exportBackground = '#ffffff'/);
    assert.match(exporter, /\.mark2-export-wrapper > \.tiptap-editor[\s\S]*background-color: transparent !important/);
    assert.match(exporter, /@media print \{[\s\S]*background: #ffffff !important/);
    assert.doesNotMatch(exporter, /exportBackground = isEditorial \? '#f3eee4'/);
});
