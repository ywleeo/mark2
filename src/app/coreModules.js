let constructorsPromise = null;
let cachedConstructors = null;

async function loadCoreModuleConstructors() {
    if (!constructorsPromise) {
        constructorsPromise = (async () => {
            const [
                editorModule,
                codeEditorModule,
                imageViewerModule,
                mediaViewerModule,
                spreadsheetViewerModule,
                pdfViewerModule,
                unsupportedViewerModule,
                fileTreeModule,
                tabManagerModule,
                settingsModule,
            ] = await Promise.all([
                import('../components/markdown-editor/index.js'),
                import('../components/code-editor/index.js'),
                import('../components/ImageViewer.js'),
                import('../components/MediaViewer.js'),
                import('../components/SpreadsheetViewer.js'),
                import('../components/PdfViewer.js'),
                import('../components/UnsupportedViewer.js'),
                import('../components/file-tree/index.js'),
                import('../components/TabManager.js'),
                import('../components/SettingsDialog.js'),
            ]);

            cachedConstructors = {
                MarkdownEditor: editorModule.MarkdownEditor,
                CodeEditor: codeEditorModule.CodeEditor,
                ImageViewer: imageViewerModule.ImageViewer,
                MediaViewer: mediaViewerModule.MediaViewer,
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
