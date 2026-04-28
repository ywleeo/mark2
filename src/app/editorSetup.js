/**
 * 编辑器设置
 * 负责初始化所有编辑器和查看器实例
 */

import { ZOOM_DEFAULT } from './viewController.js';

/**
 * 创建编辑器回调函数
 * @param {Object} params - 参数对象
 * @returns {Object} 编辑器回调对象
 */
export function createEditorCallbacks({
    editorRegistry,
    appState,
    documentRegistry,
    documentManager,
    normalizeFsPath,
    updateWindowTitle,
    scheduleDocumentSnapshotSync,
    onFileSaved,
}) {
    return {
        onContentChange: () => {
            const editor = editorRegistry.getMarkdownEditor();
            const codeEditor = editorRegistry.getCodeEditor();
            const currentFile = documentManager?.getActivePath?.() || appState.getCurrentFile();
            const hasUnsaved = editor?.hasUnsavedChanges()
                || codeEditor?.hasUnsavedChanges()
                || false;
            if (currentFile) {
                documentManager?.markDirty?.(currentFile, hasUnsaved);
            }
            appState.setHasUnsavedChanges(hasUnsaved);
            void updateWindowTitle();
            scheduleDocumentSnapshotSync();
        },
        onAutoSaveSuccess: async ({ skipped, filePath }) => {
            if (skipped) {
                return;
            }
            const currentFile = appState.getCurrentFile();
            const targetPath = filePath || currentFile;
            if (!targetPath) {
                return;
            }
            const editor = editorRegistry.getMarkdownEditor();
            const codeEditor = editorRegistry.getCodeEditor();
            const activeViewMode = appState.getActiveViewMode();

            documentRegistry.saveCurrentEditorContentToCache({
                currentFile: targetPath,
                activeViewMode,
                editor,
                codeEditor,
            });

            const modifiedTime = await documentRegistry.refreshModifiedTime?.(targetPath);
            await onFileSaved?.(targetPath, modifiedTime);
            if (normalizeFsPath(currentFile) === normalizeFsPath(targetPath)) {
                documentManager?.markDirty?.(targetPath, false);
                appState.setHasUnsavedChanges(false);
                await updateWindowTitle();
            }
            scheduleDocumentSnapshotSync();
        },
        onAutoSaveError: (error) => {
            console.error('自动保存失败:', error);
        },
    };
}

/**
 * 初始化所有编辑器和查看器
 * @param {Object} params - 参数对象
 */
export function setupEditors({
    constructors,
    appState,
    editorRegistry,
    editorCallbacks,
    documentSessions,
    setContentZoom,
}) {
    const {
        MarkdownEditor,
        CodeEditor,
        ImageViewer,
        MediaViewer,
        SpreadsheetViewer,
        PdfViewer,
        UnsupportedViewer,
    } = constructors;

    // 初始化 Markdown 编辑器
    const editor = new MarkdownEditor(appState.getPaneElement('markdown'), editorCallbacks, {
        documentSessions,
        getCurrentFile: () => appState.getCurrentFile(),
    });
    editorRegistry.register('markdown', editor);

    // 初始化代码编辑器
    const codeEditor = new CodeEditor(appState.getPaneElement('code'), editorCallbacks, {
        documentSessions,
    });
    editorRegistry.register('code', codeEditor);
    codeEditor.applyPreferences?.(appState.getEditorSettings());
    codeEditor.hide();

    // 初始化图片查看器
    const imageViewer = new ImageViewer(appState.getPaneElement('image'));
    editorRegistry.register('image', imageViewer);
    imageViewer.hide();

    // 初始化媒体查看器
    const mediaViewer = new MediaViewer(appState.getPaneElement('media'));
    editorRegistry.register('media', mediaViewer);
    mediaViewer.hide();

    // 初始化电子表格查看器
    const spreadsheetViewer = new SpreadsheetViewer(appState.getPaneElement('spreadsheet'));
    editorRegistry.register('spreadsheet', spreadsheetViewer);
    spreadsheetViewer.hide();

    // 初始化 PDF 查看器
    const pdfViewer = new PdfViewer(appState.getPaneElement('pdf'), {
        onPageInfoChange: (text) => appState.getStatusBarController()?.setPageInfo?.(text || ''),
        onZoomChange: (state) => {
            if (!state) {
                return;
            }
            appState.setPdfZoomState(state);
            if (appState.getActiveViewMode() === 'pdf') {
                appState.getStatusBarController()?.updateZoomDisplay?.(state);
            }
        },
    });
    editorRegistry.register('pdf', pdfViewer);
    pdfViewer.hide();

    // 初始化不支持的文件查看器
    const unsupportedViewer = new UnsupportedViewer(appState.getPaneElement('unsupported'));
    editorRegistry.register('unsupported', unsupportedViewer);
    unsupportedViewer.hide();

    // 设置默认视图模式
    appState.setActiveViewMode('markdown');

    // 应用缩放设置
    const contentZoom = appState.getContentZoom();
    codeEditor?.setZoomScale?.(contentZoom);
    imageViewer?.setZoomScale?.(contentZoom);
    mediaViewer?.setZoomScale?.(contentZoom);
    setContentZoom(contentZoom, { silent: true });

    // 将代码编辑器引用传递给 Markdown 编辑器的搜索管理器
    editor.setCodeEditor(codeEditor);

    return {
        editor,
        codeEditor,
        imageViewer,
        mediaViewer,
        spreadsheetViewer,
        pdfViewer,
        unsupportedViewer,
    };
}
