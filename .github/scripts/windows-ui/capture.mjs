/**
 * Capture the real Windows Tauri/WebView2 UI through CDP, without a browser mock.
 * CI-only dependencies and fixtures stay outside the application bundle.
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { access, copyFile, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';

const output = path.resolve(process.env.MARK2_UI_OUTPUT || 'output/playwright/windows-ui');
const report = { screenshots: [], scenarios: [], console: [], pageErrors: [] };
let browser;
let page;
let app;
let temp;
let appLogPath;
let launchError;
let fixtureCopy;
let referenceCopy;

/** Validate choice inputs before interpolating them into selectors or filenames. */
function choices(value, supported) {
    if (!value || value === 'both') return supported;
    assert(supported.includes(value), `Unsupported choice: ${value}`);
    return [value];
}

/** Allocate an available loopback port for this application's debugging endpoint. */
async function unusedPort() {
    const server = createServer();
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const { port } = server.address();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    return port;
}

/** Wait for WebView2 with a deadline, preserving useful process diagnostics on failure. */
async function connect(port) {
    const endpoint = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
        if (launchError) throw launchError;
        assert(app.exitCode === null, `Mark2 exited before CDP was ready (${app.exitCode})`);
        try {
            const response = await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(1000) });
            if (response.ok) return await chromium.connectOverCDP(endpoint, { timeout: 5000 });
        } catch {
            // The debugging port does not exist until WebView2 has initialized.
        }
        await delay(500);
    }
    throw new Error('WebView2 CDP did not become ready in 60 seconds; inspect app-stderr.log.');
}

/** Wait for the fixture and the application's asynchronous UI initialization. */
async function ready(fileName) {
    await page.locator('.settings-modal').waitFor({ state: 'attached' });
    await page.locator('.app-menu').waitFor({ state: 'attached' });
    await page.waitForFunction(name => document.querySelector('#tabBar')?.textContent.includes(name), fileName);
    const editor = page.locator('#primaryPane .ProseMirror:visible');
    await editor.waitFor();
    await page.waitForFunction(() => document.querySelector('#primaryPane .ProseMirror')?.textContent.trim().length > 0);
}

/** Open settings through the Windows menu, exercising the real command routing. */
async function openSettings() {
    await page.locator('#titlebar-menu').click();
    await page.locator('.app-menu:not(.hidden) [data-menu-id="settings"]').click();
    await page.locator('.settings-modal:not(.hidden)').waitFor();
}

/** Select an appearance using the same custom dropdown as a desktop user. */
async function chooseAppearance(value) {
    await page.locator('select[name="appearance"] + .dropdown__trigger').click();
    await page.locator(`.dropdown__panel.is-open .dropdown__option[data-value="${value}"]`).click();
}

/** Apply a skin and appearance via settings, then assert the resulting application state. */
async function applyAppearance(skin, appearance) {
    await openSettings();
    await page.locator(`.settings-skin-card:has(input[value="${skin}"])`).click();
    await chooseAppearance(appearance);
    await page.locator('.settings-form button[type="submit"]').click();
    await page.locator('.settings-modal').waitFor({ state: 'hidden' });
    await page.waitForFunction(({ skin, appearance }) => {
        const root = document.documentElement;
        return root.dataset.appSkin === skin && root.dataset.themeAppearance === appearance;
    }, { skin, appearance });
    // Theme loading is asynchronous; wait for the actual document stylesheet as well.
    await page.waitForFunction(skin => {
        const expected = skin === 'editorial' ? 'editorial' : 'default';
        const link = document.querySelector('#markdown-theme-stylesheet');
        return link?.dataset.themeName === expected && Boolean(link.sheet);
    }, skin);
    await page.locator('#primaryPane .markdown-pane').evaluate(element => element.scrollTo(0, 0));
}

/** Wait for fonts and stable layout before capturing the full native WebView client area. */
async function capture(name, scenario) {
    await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    await page.mouse.move(600, 35);
    await page.screenshot({ path: path.join(output, `${name}.png`), animations: 'disabled' });
    report.screenshots.push({ file: `${name}.png`, ...scenario });
    console.log(`[windows-ui] Captured ${name}.png`);
}

/** Locate an actual tab by its displayed filename, without accessing application internals. */
function tabByName(name) {
    return page.locator('#tabBar .tab').filter({ hasText: name });
}

/** Pin a fixture using the same file-tree double-click a desktop user performs. */
async function openFixture(filePath) {
    const name = path.basename(filePath);
    await page.locator('#fileTree .tree-file').filter({ hasText: name }).dblclick();
    const tab = tabByName(name);
    await tab.waitFor();
    await page.waitForFunction(name => {
        const active = document.querySelector('#tabBar .tab.active');
        return active?.textContent.includes(name) && active.dataset.tabType === 'file';
    }, name);
    return tab;
}

/** Wait for a real tab's activation after a click or a close fallback. */
async function waitForActiveTab(id) {
    await page.waitForFunction(id => document.querySelector('#tabBar .tab.active')?.dataset.tabId === id, id);
}

/** Open a context menu with a real right-click and verify it does not activate its target. */
async function openTabMenu(tab) {
    const activeId = await page.locator('#tabBar .tab.active').getAttribute('data-tab-id');
    await tab.click({ button: 'right' });
    const menu = page.locator('.tab-context-menu:not(.hidden)');
    await menu.waitFor();
    assert.equal(await page.locator('#tabBar .tab.active').getAttribute('data-tab-id'), activeId,
        'Right-click must not change the active document.');
    return menu;
}

/** Exercise the shipped tab menu, close transactions, clipboard and split pane on WebView2. */
async function captureTabContextScenario(prefix, scenario) {
    const checks = [];
    const primaryName = path.basename(fixtureCopy);
    const referenceName = path.basename(referenceCopy);
    const reference = await openFixture(referenceCopy);
    const primary = tabByName(primaryName);
    await primary.click();
    await waitForActiveTab(await primary.getAttribute('data-tab-id'));

    let menu = await openTabMenu(reference);
    assert.equal(await menu.locator('[data-action]').count(), 7);
    for (const action of ['current', 'others', 'saved', 'all']) {
        assert.equal(await menu.locator(`[data-action="${action}"] svg`).count(), 0,
            'Close items must not contain cross icons.');
    }
    assert.equal(await menu.locator('[data-action="reveal"]').innerText(), '在资源管理器中显示');
    const bounds = await menu.evaluate(element => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
            width: innerWidth, height: innerHeight };
    });
    assert(bounds.left >= 0 && bounds.top >= 0 && bounds.right <= bounds.width && bounds.bottom <= bounds.height,
        'The menu must stay inside the WebView viewport.');
    await capture(`${prefix}-tab-context-menu`, scenario);
    checks.push('background-target', 'seven-actions', 'no-close-icons', 'windows-reveal-label', 'menu-in-viewport');

    await menu.locator('[data-action="copy-path"]').click();
    const copied = await page.evaluate(() => window.__TAURI__.core.invoke('read_clipboard_text'));
    assert.equal(copied, referenceCopy, 'Copy Path must copy the right-click target, not the active document.');
    checks.push('copy-target-path');

    const primaryContent = await page.locator('#primaryPane .ProseMirror:visible').innerText();
    menu = await openTabMenu(reference);
    await menu.locator('[data-action="split"]').click();
    await page.locator('#secondaryPane .ProseMirror:visible').waitFor();
    await page.waitForFunction(() => document.querySelector('#secondaryPane .ProseMirror')?.textContent.includes('Windows tab reference'));
    assert.equal(await page.locator('#primaryPane .ProseMirror:visible').innerText(), primaryContent);
    await capture(`${prefix}-tab-split`, scenario);
    await page.locator('#secondaryPaneClose').click();
    await page.locator('#secondaryPane').waitFor({ state: 'hidden' });
    checks.push('split-target-document', 'keep-primary-document');

    await page.locator('#tabBar .tab-new-btn').click();
    const draft = page.locator('#tabBar .tab[data-tab-id^="untitled://"]');
    await draft.waitFor();
    const draftId = await draft.getAttribute('data-tab-id');
    await waitForActiveTab(draftId);
    menu = await openTabMenu(draft);
    for (const action of ['split', 'copy-path', 'reveal']) {
        assert.equal(await menu.locator(`[data-action="${action}"]`).isDisabled(), true);
    }
    await capture(`${prefix}-tab-context-untitled`, scenario);
    await page.keyboard.press('Escape');
    await menu.waitFor({ state: 'hidden' });
    checks.push('untitled-disabled-actions', 'escape-dismisses-menu');

    await reference.click();
    await waitForActiveTab(await reference.getAttribute('data-tab-id'));
    const editor = page.locator('#primaryPane .ProseMirror:visible');
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText(' Windows unsaved marker');
    await page.waitForFunction(name => Array.from(document.querySelectorAll('#tabBar .tab'))
        .some(tab => tab.textContent.includes(name) && tab.classList.contains('is-dirty')), referenceName);
    menu = await openTabMenu(reference);
    await capture(`${prefix}-tab-context-dirty`, scenario);
    await menu.locator('[data-action="saved"]').click();
    await primary.waitFor({ state: 'detached' });
    assert.equal(await page.locator('#tabBar .tab').count(), 2);
    assert.equal(await reference.count(), 1);
    assert.equal(await draft.count(), 1);
    assert((await editor.innerText()).includes('Windows unsaved marker'));
    await capture(`${prefix}-tab-close-saved`, scenario);
    checks.push('close-saved-keeps-dirty-and-untitled');

    menu = await openTabMenu(reference);
    await menu.locator('[data-action="current"]').click();
    await reference.waitFor({ state: 'detached' });
    assert((await readFile(referenceCopy, 'utf8')).includes('Windows unsaved marker'));
    await waitForActiveTab(draftId);
    menu = await openTabMenu(draft);
    assert.equal(await menu.locator('[data-action="others"]').isDisabled(), true);
    assert.equal(await menu.locator('[data-action="saved"]').isDisabled(), true);
    await page.keyboard.press('Escape');
    checks.push('close-current-saves-disk-document', 'single-draft-disabled-bulk-actions');

    await openFixture(fixtureCopy);
    await openFixture(referenceCopy);
    menu = await openTabMenu(primary);
    await menu.locator('[data-action="others"]').click();
    await page.waitForFunction(name => {
        const tabs = document.querySelectorAll('#tabBar .tab');
        return tabs.length === 1 && tabs[0].textContent.includes(name);
    }, primaryName);
    await waitForActiveTab(await primary.getAttribute('data-tab-id'));
    checks.push('close-others-keeps-right-click-target');

    menu = await openTabMenu(primary);
    await menu.locator('[data-action="all"]').click();
    await page.waitForFunction(() => document.querySelectorAll('#tabBar .tab').length === 0);
    await capture(`${prefix}-tab-close-all`, scenario);
    checks.push('close-all-clears-tabs');
    await openFixture(fixtureCopy);
    report.scenarios.push({ ...scenario, feature: 'tab-context-menu', status: 'passed', checks,
        notCovered: ['native Explorer window', 'native save/cancel dialogs'] });
}

/** Capture a workspace, Windows menu, and settings dialog for one combination. */
async function captureScenario(skin, appearance) {
    const scenario = { skin, appearance };
    report.currentScenario = scenario;
    const prefix = `${skin}-${appearance}`;
    await applyAppearance(skin, appearance);
    await capture(`${prefix}-workspace`, scenario);

    await page.locator('#titlebar-menu').click();
    await page.locator('.app-menu:not(.hidden)').waitFor();
    await capture(`${prefix}-menu`, scenario);
    await page.locator('.app-menu:not(.hidden) [data-menu-id="settings"]').click();
    await page.locator('.settings-modal:not(.hidden)').waitFor();
    await page.locator('[data-tab-content="general"]').evaluate(element => element.scrollTo(0, 0));
    await capture(`${prefix}-settings`, scenario);
    await page.locator('.settings-form [data-action="cancel"]').click();
    await page.locator('.settings-modal').waitFor({ state: 'hidden' });
    if (skin === 'classic') await captureTabContextScenario(prefix, scenario);
    else report.scenarios.push({ ...scenario, feature: 'tab-context-menu', status: 'not-applicable',
        reason: 'Editorial uses the document library and intentionally hides the tab bar.' });
    report.scenarios.push({ ...scenario, status: 'passed' });
    delete report.currentScenario;
}

/** Escape report content so reproduction filenames and error messages remain plain text. */
function html(value) {
    return String(value).replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[char]);
}

/** Write a portable gallery, machine-readable diagnostics, and the Actions summary. */
async function writeReport() {
    await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    const gallery = report.screenshots.map(shot => `
        <figure><figcaption>${html(shot.file)}</figcaption>
        <a href="${html(shot.file)}"><img src="${html(shot.file)}" loading="lazy" alt="${html(shot.file)}"></a></figure>`).join('');
    await writeFile(path.join(output, 'index.html'), `<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><title>Mark2 Windows 界面截图</title>
<style>body{font:16px system-ui;margin:32px;background:#eee;color:#222}figure{margin:28px 0}img{max-width:100%;border:1px solid #bbb}figcaption{margin:8px 0}pre{white-space:pre-wrap}</style>
<h1>Mark2 Windows 界面截图</h1><p>真实 Tauri / WebView2 应用的客户区截图，包含前端标题栏、菜单和设置。系统原生对话框不在截图范围内。</p>
<p>下载完整 artifact 并解压后，打开本文件查看。截图需要人工验收；自动检查通过不代表视觉效果已经确认。</p>
<pre>${html(JSON.stringify({ ...report, screenshots: undefined, console: undefined }, null, 2))}</pre>${gallery}</html>`);
    if (process.env.GITHUB_STEP_SUMMARY) {
        await writeFile(process.env.GITHUB_STEP_SUMMARY, [
            '## Windows UI Screenshots',
            `Captured **${report.screenshots.length}** screenshots from the real Tauri/WebView2 application.`,
            `Result: **${report.error ? 'failed' : 'passed'}**.`,
            'Download the `windows-ui-*` artifact below, extract it, and open **index.html** to compare the screenshots.',
            'Includes Classic / Editorial, light / dark (unless filtered), and workspace / menu / settings.',
            'This is a Windows Server runner; native OS dialogs, GPU/DPI-specific bugs and Windows 11-only behavior require separate verification.',
            report.error ? `\nFailure: ${report.error}` : '',
        ].join('\n\n'));
    }
}

/** Launch an isolated native app and run the requested screenshot scenarios. */
async function main() {
    await mkdir(output, { recursive: true });
    try {
        assert.equal(process.platform, 'win32', 'This harness requires a real Windows desktop runner.');
        const skins = choices(process.env.MARK2_UI_SKIN, ['classic', 'editorial']);
        const appearances = choices(process.env.MARK2_UI_APPEARANCE, ['light', 'dark']);
        const repository = await realpath(process.cwd());
        const fixture = await realpath(path.resolve(process.env.MARK2_UI_FIXTURE || 'tests/fixtures/windows-ui/showcase.md'));
        const relative = path.relative(repository, fixture);
        assert(relative && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), 'Fixture must be a repository file.');
        assert(/\.(md|markdown)$/i.test(fixture), 'Fixture must be a Markdown file.');
        const executable = path.resolve('src-tauri/target/release/mark2-tauri.exe');
        await access(executable);

        temp = await mkdtemp(path.join(os.tmpdir(), 'mark2-windows-ui-'));
        const fixtureDirectory = path.join(temp, 'documents');
        await mkdir(fixtureDirectory);
        fixtureCopy = path.join(fixtureDirectory, path.basename(fixture));
        await copyFile(fixture, fixtureCopy);
        referenceCopy = path.join(fixtureDirectory, 'tab-context-reference.md');
        await writeFile(referenceCopy, '# Windows tab reference\n\nCompare this document in the side pane.\n');
        const port = await unusedPort();
        report.environment = {
            os: os.release(), runner: process.env.ImageOS, runnerVersion: process.env.ImageVersion,
            commit: process.env.GITHUB_SHA, fixture: relative, node: process.version,
        };
        app = spawn(executable, [fixtureDirectory, fixtureCopy], {
            env: {
                ...process.env,
                WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
                WEBVIEW2_USER_DATA_FOLDER: path.join(temp, 'webview2'),
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        app.on('error', error => { launchError = error; });
        app.stdout.pipe(createWriteStream(path.join(output, 'app-stdout.log')));
        app.stderr.pipe(createWriteStream(path.join(output, 'app-stderr.log')));
        browser = await connect(port);
        const context = browser.contexts()[0];
        context.setDefaultTimeout(20_000);
        page = context.pages()[0] || await context.waitForEvent('page');
        page.on('console', message => report.console.push({ type: message.type(), text: message.text() }));
        page.on('pageerror', error => report.pageErrors.push(error.stack || error.message));
        await page.waitForFunction(() => Boolean(window.__TAURI_INTERNALS__));
        await ready(path.basename(fixture));
        await page.waitForFunction(name => {
            const state = localStorage.getItem('mark2:workspace:state');
            return state?.includes(name);
        }, path.basename(fixture));

        // Seed only user preferences, then reload through the real startup/restore path.
        await page.evaluate(() => {
            localStorage.setItem('mark2:i18n:locale', JSON.stringify('zh-CN'));
            const settings = JSON.parse(localStorage.getItem('mark2:editor:settings') || '{}');
            localStorage.setItem('mark2:editor:settings', JSON.stringify({ ...settings, allowAutoUpdate: false, autoSave: false }));
            localStorage.setItem('mark2:diagnostics:logLevel', JSON.stringify('debug'));
        });
        await page.reload();
        await ready(path.basename(fixture));
        appLogPath = await page.evaluate(() => window.__TAURI__.core.invoke('get_app_log_file_path'));
        const environment = await page.evaluate(() => ({
            userAgent: navigator.userAgent,
            native: Boolean(window.__TAURI_INTERNALS__),
            windowsStyles: document.documentElement.classList.contains('platform-windows'),
            width: innerWidth, height: innerHeight, devicePixelRatio,
        }));
        assert(environment.native && environment.windowsStyles, 'Expected the Windows Tauri application.');
        report.environment = { ...report.environment, ...environment, webview: browser.version() };
        for (const skin of skins) {
            for (const appearance of appearances) await captureScenario(skin, appearance);
        }
        assert.equal(report.pageErrors.length, 0, 'Uncaught UI errors were recorded; see report.json.');
    } catch (error) {
        report.error = error.stack || String(error);
        console.error(report.error);
        process.exitCode = 1;
        if (page && !page.isClosed()) {
            await page.screenshot({ path: path.join(output, 'failure.png'), timeout: 5000 }).catch(() => {});
            await page.content().then(content => writeFile(path.join(output, 'failure.html'), content)).catch(() => {});
        }
    } finally {
        if (appLogPath) await copyFile(appLogPath, path.join(output, 'mark2-debug.log')).catch(() => {});
        if (browser) await browser.close().catch(() => {});
        if (app?.pid) spawnSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], { timeout: 10_000, windowsHide: true });
        await writeReport();
    }
}

await main();
