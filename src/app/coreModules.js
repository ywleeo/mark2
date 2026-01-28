let constructorsPromise = null;
let cachedConstructors = null;
let toPngRenderer = null;

async function loadCoreModuleConstructors() {
    if (!constructorsPromise) {
        constructorsPromise = (async () => {
            const [
                editorModule,
                codeEditorModule,
                imageViewerModule,
                mediaViewerModule,
                htmlViewerModule,
                spreadsheetViewerModule,
                pdfViewerModule,
                unsupportedViewerModule,
                workflowEditorModule,
                fileTreeModule,
                tabManagerModule,
                settingsModule,
            ] = await Promise.all([
                import('../components/markdown-editor/index.js'),
                import('../components/code-editor/index.js'),
                import('../components/ImageViewer.js'),
                import('../components/MediaViewer.js'),
                import('../components/HtmlViewer.js'),
                import('../components/SpreadsheetViewer.js'),
                import('../components/PdfViewer.js'),
                import('../components/UnsupportedViewer.js'),
                import('../components/workflow-editor/index.js'),
                import('../components/file-tree/index.js'),
                import('../components/TabManager.js'),
                import('../components/SettingsDialog.js'),
            ]);

            cachedConstructors = {
                MarkdownEditor: editorModule.MarkdownEditor,
                CodeEditor: codeEditorModule.CodeEditor,
                ImageViewer: imageViewerModule.ImageViewer,
                MediaViewer: mediaViewerModule.MediaViewer,
                HtmlViewer: htmlViewerModule.HtmlViewer,
                SpreadsheetViewer: spreadsheetViewerModule.SpreadsheetViewer,
                PdfViewer: pdfViewerModule.PdfViewer,
                UnsupportedViewer: unsupportedViewerModule.UnsupportedViewer,
                WorkflowEditor: workflowEditorModule.WorkflowEditor,
                FileTree: fileTreeModule.FileTree,
                TabManager: tabManagerModule.TabManager,
                SettingsDialog: settingsModule.SettingsDialog,
            };

            return cachedConstructors;
        })();
    }

    await constructorsPromise;
    return cachedConstructors;
}

export async function loadCoreModules() {
    return await loadCoreModuleConstructors();
}

export async function ensureToPng() {
    if (!toPngRenderer) {
        const module = await import('html-to-image');
        toPngRenderer = module.toPng;
    }
    return toPngRenderer;
}
