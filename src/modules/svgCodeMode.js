import { isSvgFilePath } from '../utils/fileTypeUtils.js';

export function createSvgCodeMode({
    view,
}) {
    if (!view || typeof view.activate !== 'function') {
        throw new Error('createSvgCodeMode needs view protocol');
    }

    let toggleState = null;

    async function toggle({
        currentFile,
        activeViewMode,
        imageViewer,
        codeEditor,
        fileService,
        loadFile,
    }) {
        if (!currentFile || !imageViewer || !codeEditor || !fileService || !loadFile) {
            return { changed: false, nextViewMode: activeViewMode, hasUnsavedChanges: false };
        }
        if (!isSvgFilePath(currentFile)) {
            return { changed: false, nextViewMode: activeViewMode, hasUnsavedChanges: false };
        }

        // From image view to code view
        if (activeViewMode === 'image') {
            toggleState = {
                originalViewMode: activeViewMode,
            };

            view.activate('code');
            
            // Read the SVG file as text
            const svgContent = await fileService.readText(currentFile);
            
            // Set up the code editor with SVG content
            const language = 'xml'; // SVG is XML-based
            await codeEditor.show(currentFile, svgContent, language, null, { tabId: currentFile });
            
            return {
                changed: true,
                nextViewMode: 'code',
                hasUnsavedChanges: false, // Initially not dirty
            };
        }

        // From code view back to image view
        if (activeViewMode === 'code') {
            codeEditor?.saveViewStateForTab?.(currentFile);
            const hadUnsavedChanges = codeEditor.hasUnsavedChanges?.() || false;
            
            // If there are unsaved changes, save them before switching back
            if (hadUnsavedChanges) {
                try {
                    const content = typeof codeEditor.getValueForSave === 'function'
                        ? codeEditor.getValueForSave()
                        : codeEditor.getValue();
                    await fileService.writeText(currentFile, content);
                    codeEditor.markSaved();
                } catch (error) {
                    console.error('Failed to save SVG changes:', error);
                    // Still continue with view switch even if save fails
                }
            }
            
            view.activate('image');
            
            // Reload the image to show updates
            await imageViewer.loadImage(currentFile);
            
            toggleState = null;

            return {
                changed: true,
                nextViewMode: 'image',
                hasUnsavedChanges: false,
            };
        }

        return { changed: false, nextViewMode: activeViewMode, hasUnsavedChanges: false };
    }

    function reset() {
        toggleState = null;
    }

    return {
        toggle,
        reset,
    };
}
