/**
 * 核心模块加载器
 * 负责加载和注册所有编辑器/查看器构造函数
 */

import { loadCoreModules } from './coreModules.js';

/**
 * 加载核心模块并注册到 EditorRegistry
 * @param {EditorRegistry} editorRegistry - 编辑器注册表实例
 * @returns {Promise<Object>} 返回所有构造函数的对象
 */
export async function loadAndRegisterModules(editorRegistry) {
    const coreModules = await loadCoreModules();

    // 注册编辑器/查看器构造函数
    editorRegistry.registerConstructor('markdown', coreModules.MarkdownEditor);
    editorRegistry.registerConstructor('code', coreModules.CodeEditor);
    editorRegistry.registerConstructor('image', coreModules.ImageViewer);
    editorRegistry.registerConstructor('media', coreModules.MediaViewer);
    editorRegistry.registerConstructor('spreadsheet', coreModules.SpreadsheetViewer);
    editorRegistry.registerConstructor('pdf', coreModules.PdfViewer);
    editorRegistry.registerConstructor('unsupported', coreModules.UnsupportedViewer);

    return {
        MarkdownEditor: coreModules.MarkdownEditor,
        CodeEditor: coreModules.CodeEditor,
        ImageViewer: coreModules.ImageViewer,
        MediaViewer: coreModules.MediaViewer,
        SpreadsheetViewer: coreModules.SpreadsheetViewer,
        PdfViewer: coreModules.PdfViewer,
        UnsupportedViewer: coreModules.UnsupportedViewer,
        WorkflowEditor: coreModules.WorkflowEditor,
        FileTree: coreModules.FileTree,
        TabManager: coreModules.TabManager,
        SettingsDialog: coreModules.SettingsDialog,
    };
}
