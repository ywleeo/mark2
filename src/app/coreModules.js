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
                spreadsheetViewerModule,
                pdfViewerModule,
                unsupportedViewerModule,
                fileTreeModule,
                tabManagerModule,
                settingsModule,
            ] = await Promise.all([
                import('../components/MarkdownEditor.js'),
                import('../components/CodeEditor.js'),
                import('../components/ImageViewer.js'),
                import('../components/SpreadsheetViewer.js'),
                import('../components/PdfViewer.js'),
                import('../components/UnsupportedViewer.js'),
                import('../components/FileTree.js'),
                import('../components/TabManager.js'),
                import('../components/SettingsDialog.js'),
            ]);

            cachedConstructors = {
                MarkdownEditor: editorModule.MarkdownEditor,
                CodeEditor: codeEditorModule.CodeEditor,
                ImageViewer: imageViewerModule.ImageViewer,
                SpreadsheetViewer: spreadsheetViewerModule.SpreadsheetViewer,
                PdfViewer: pdfViewerModule.PdfViewer,
                UnsupportedViewer: unsupportedViewerModule.UnsupportedViewer,
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
