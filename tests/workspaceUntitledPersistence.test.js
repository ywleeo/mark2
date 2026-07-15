import assert from 'node:assert/strict';
import test from 'node:test';
import { DocumentModel } from '../src/core/documents/DocumentModel.js';
import { createUntitledPersistenceScheduler } from '../src/app/untitledPersistenceScheduler.js';
import { createUntitledFileManager } from '../src/modules/untitledFileManager.js';
import { createWorkspaceController } from '../src/modules/workspaceController.js';

/** 创建工作区控制器测试所需的最小持久化管理器。 */
function createWorkspaceManagerDouble(storedState = null) {
    const sidebar = {
        rootPaths: [],
        expandedFolders: [],
        sectionStates: { openFilesCollapsed: false, foldersCollapsed: false },
    };
    let persisted = null;
    let restoring = false;
    return {
        getSnapshot: () => ({ currentFile: null, sidebar, openFiles: [], untitledTabs: [] }),
        persistWorkspaceState: state => { persisted = state; },
        loadPersistedState: () => storedState,
        setRestoring: value => { restoring = Boolean(value); },
        isRestoring: () => restoring,
        getPersisted: () => persisted,
    };
}

/** 空文件服务替身；仅用于没有真实文件路径的 untitled 恢复。 */
function createFileServiceDouble() {
    return {
        isDirectory: async () => false,
        metadata: async () => ({ modified_time: 1 }),
    };
}

test('工作区快照保留空白 tab，并从 DocumentModel 读取 AI 文档正文', () => {
    const untitledFileManager = createUntitledFileManager();
    const emptyPath = untitledFileManager.createUntitledFile('md');
    const aiPath = untitledFileManager.createImportFile('AI-结果.md');
    // 故意让旧管理器仍为空，验证持久化不会再依赖过期副本。
    const aiDocument = new DocumentModel({
        uri: aiPath,
        viewMode: 'markdown',
        content: '# AI 结果\n\n完整正文。\n',
    });
    const workspaceManager = createWorkspaceManagerDouble();
    const controller = createWorkspaceController({
        getCurrentFile: () => aiPath,
        getFileTree: () => null,
        getTabManager: () => null,
        fileService: createFileServiceDouble(),
        workspaceManager,
        untitledFileManager,
        documentManager: {
            getOpenDocuments: () => [
                { path: emptyPath, label: 'untitled-1.md', viewMode: 'markdown', dirty: false },
                { path: aiPath, label: 'AI-结果.md', viewMode: 'markdown', dirty: true },
            ],
        },
        documentRegistry: {
            getDocument: path => path === aiPath ? aiDocument : null,
        },
    });

    controller.persistWorkspaceState();

    const tabs = workspaceManager.getPersisted().untitledTabs;
    assert.equal(tabs.length, 2);
    assert.equal(tabs.find(tab => tab.path === emptyPath)?.content, '');
    assert.equal(tabs.find(tab => tab.path === aiPath)?.content, '# AI 结果\n\n完整正文。\n');
});

test('启动恢复时先用快照正文创建 DocumentModel，再恢复 untitled tab', async () => {
    const aiPath = 'untitled://AI-结果.md';
    const emptyPath = 'untitled://untitled-1.md';
    const content = '# AI 结果\n\n重启后仍应存在。\n';
    const storedState = {
        currentFile: aiPath,
        sidebar: {
            rootPaths: [],
            expandedFolders: [],
            sectionStates: { openFilesCollapsed: false, foldersCollapsed: false },
        },
        openFiles: [],
        untitledTabs: [
            {
                path: emptyPath,
                label: 'untitled-1.md',
                content: '',
                hasChanges: false,
                viewMode: 'markdown',
            },
            {
                path: aiPath,
                label: 'AI-结果.md',
                content,
                hasChanges: true,
                viewMode: 'markdown',
            },
        ],
        sharedTabPath: null,
    };
    const untitledFileManager = createUntitledFileManager();
    const workspaceManager = createWorkspaceManagerDouble(storedState);
    const documents = new Map();
    const opened = [];
    let selectedPath = null;
    const fileTree = {
        restoreState: async () => {},
        restoreOpenFiles: () => {},
        getPersistedState: () => storedState.sidebar,
        getOpenFilePaths: () => [],
        selectFile: path => { selectedPath = path; },
    };
    const controller = createWorkspaceController({
        getCurrentFile: () => null,
        getFileTree: () => fileTree,
        getTabManager: () => ({ clearSharedTab() {} }),
        fileService: createFileServiceDouble(),
        workspaceManager,
        untitledFileManager,
        documentManager: {
            getOpenPaths: () => [],
            closeDocument() {},
            openDocument: (path, options) => { opened.push({ path, options }); },
        },
        documentRegistry: {
            registerInMemoryDocument: (path, options) => {
                const document = new DocumentModel({ uri: path, ...options });
                documents.set(path, document);
                return document;
            },
        },
    });

    await controller.restoreWorkspaceStateFromStorage();

    assert.equal(documents.get(aiPath)?.getContent(), content);
    assert.equal(documents.get(aiPath)?.dirty, true);
    assert.equal(documents.get(emptyPath)?.getContent(), '');
    assert.equal(opened.length, 2);
    assert.equal(selectedPath, aiPath);
});

test('untitled 编辑内容变化后自动防抖持久化工作区正文', async t => {
    let persisted = 0;
    const scheduler = createUntitledPersistenceScheduler({
        getCurrentFile: () => 'untitled://untitled-1.md',
        persistWorkspaceState: () => { persisted += 1; },
        isUntitledPath: path => path.startsWith('untitled://'),
        delay: 20,
    });
    t.after(() => scheduler.cancel());

    scheduler.schedule();
    scheduler.schedule();
    await new Promise(resolve => setTimeout(resolve, 40));

    assert.equal(persisted, 1);
});
