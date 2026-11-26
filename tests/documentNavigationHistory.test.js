/** 覆盖工具栏切换到附件以及返回文稿的历史回归。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createToolbarController } from '../src/app/toolbarController.js';
import { navigationHistory } from '../src/modules/navigationHistory.js';

test('视频预览隐藏编辑工具时，仍可以返回文稿并前进到视频', async t => {
    const notePath = '/example/production-log.md';
    const videoPath = '/example/scene.mp4';
    const laneId = 'example-preview';
    let currentFile = notePath;
    let previewReturnPath = null;
    let allowNavigation = true;
    let editorHidden = false;
    const editor = {};
    const toolbar = createToolbarController({
        getMarkdownEditor: () => editor,
        getCodeEditor: () => null,
        getCurrentFile: () => currentFile,
        getPreviewReturnPath: () => previewReturnPath,
        getNavLaneId: () => laneId,
        getActiveViewMode: () => currentFile === notePath ? 'markdown' : 'media',
        getToggleMarkdownCodeMode: () => null,
        isMarkdownFilePath: path => path.endsWith('.md'),
        getMarkdownToolbarManager: () => ({
            isVisible: true,
            initialize() {},
            show() { editorHidden = false; },
            hide() { editorHidden = true; },
        }),
    });
    navigationHistory.setNavigator(async (path, entry) => {
        if (!allowNavigation) return false;
        currentFile = path;
        previewReturnPath = entry.previewReturnPath;
        toolbar.handleToolbarOnFileChange();
        return true;
    });
    t.after(() => {
        navigationHistory.dropLane(laneId);
        navigationHistory.setNavigator(null);
    });

    toolbar.handleToolbarOnFileChange();
    assert.equal(editorHidden, false);
    currentFile = videoPath;
    previewReturnPath = notePath;
    toolbar.handleToolbarOnFileChange();
    assert.equal(editorHidden, true);
    assert.equal(navigationHistory.canGoBack(), true);

    allowNavigation = false;
    await navigationHistory.goBack();
    assert.equal(currentFile, videoPath);
    assert.equal(navigationHistory.canGoBack(), true);

    allowNavigation = true;
    await navigationHistory.goBack();
    assert.equal(currentFile, notePath);
    assert.equal(previewReturnPath, null);
    assert.equal(editorHidden, false);
    assert.equal(navigationHistory.canGoForward(), true);

    await navigationHistory.goForward();
    assert.equal(currentFile, videoPath);
    assert.equal(previewReturnPath, notePath);
    assert.equal(editorHidden, true);
    assert.equal(navigationHistory.canGoBack(), true);
});

/** 切到尚无历史的皮肤时，当前附件仍能后退到原文稿。 */
test('新的导航历史会从当前预览恢复来源', async t => {
    const laneId = 'switched-skin';
    const notePath = '/example/notes.md';
    navigationHistory.setActiveLane(laneId);
    navigationHistory.record('/example/clip.mp4', { previewReturnPath: notePath });
    t.after(() => {
        navigationHistory.dropLane(laneId);
        navigationHistory.setNavigator(null);
    });
    navigationHistory.setNavigator(path => assert.equal(path, notePath));
    assert.equal(navigationHistory.canGoBack(), true);
    await navigationHistory.goBack();
    assert.equal(navigationHistory.canGoForward(), true);
});
