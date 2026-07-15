import assert from 'node:assert/strict';
import test from 'node:test';
import { DocumentModel } from '../src/core/documents/DocumentModel.js';
import { createMarkdownCodeMode } from '../src/modules/markdownCodeMode.js';

/**
 * 构造只覆盖模式切换协议的轻量编辑器替身。
 * @param {string} filePath - 测试文档路径
 * @param {string} codeContent - CodeMirror 当前精确文本
 * @returns {{markdownEditor:object,codeEditor:object,loadedMarkdown:()=>string}}
 */
function createEditorDoubles(filePath, codeContent) {
    let markdown = '';
    let markdownAttachOptions = null;
    return {
        markdownEditor: {
            currentFile: filePath,
            isLoading: () => false,
            attachDocument: async (doc, options) => {
                markdown = doc.getContent();
                markdownAttachOptions = options;
            },
            loadFile: async (_path, content) => { markdown = content; },
            refreshSearch() {},
            getScrollContainer: () => null,
        },
        codeEditor: {
            currentFile: filePath,
            isLoading: () => false,
            getValue: () => codeContent,
            hasUnsavedChanges: () => true,
            getCurrentPosition: () => null,
            getScrollHeight: () => 0,
            getClientHeight: () => 0,
            getScrollTop: () => 0,
            saveViewStateForTab() {},
        },
        loadedMarkdown: () => markdown,
        getMarkdownAttachOptions: () => markdownAttachOptions,
    };
}

test('从 CodeMirror 切回编辑模式时使用刚修改的精确源码，而不是过期缓存', async t => {
    const previousAnimationFrame = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = () => 0;
    t.after(() => {
        if (previousAnimationFrame) globalThis.requestAnimationFrame = previousAnimationFrame;
        else delete globalThis.requestAnimationFrame;
    });
    const filePath = '/docs/story.md';
    const staleContent = '> *这句话原来是斜体*\n';
    const currentCodeContent = '> 这句话现在是普通文本\n';
    const documentModel = new DocumentModel({
        uri: filePath,
        viewMode: 'markdown',
        content: staleContent,
    });
    const {
        markdownEditor,
        codeEditor,
        loadedMarkdown,
        getMarkdownAttachOptions,
    } = createEditorDoubles(filePath, currentCodeContent);
    const snapshots = [];
    const mode = createMarkdownCodeMode({
        detectLanguageForPath: () => 'markdown',
        isMarkdownFilePath: () => true,
        view: { activate() {} },
        saveCurrentEditorContentToCache: snapshot => { snapshots.push(snapshot); },
        // 故意返回旧内容，验证可信的当前编辑器快照不会被缓存回读覆盖。
        getFileContent: async () => ({ content: staleContent, hasChanges: false }),
        getDocument: () => documentModel,
    });

    const result = await mode.toggle({
        currentFile: filePath,
        activeViewMode: 'code',
        editor: markdownEditor,
        codeEditor,
    });

    assert.equal(result.nextViewMode, 'markdown');
    assert.equal(loadedMarkdown(), currentCodeContent);
    assert.equal(documentModel.getContent(), currentCodeContent);
    assert.equal(getMarkdownAttachOptions()?.discardViewState, true);
    assert.equal(snapshots[0].activeViewMode, 'code');
    assert.equal(snapshots[0].codeEditor, codeEditor);
});
