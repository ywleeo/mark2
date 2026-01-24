import { isWorkflowFilePath } from '../utils/fileTypeUtils.js';

export function createWorkflowCodeMode({
    activateCodeView,
    activateWorkflowView,
}) {
    if (typeof activateCodeView !== 'function' || typeof activateWorkflowView !== 'function') {
        throw new Error('createWorkflowCodeMode needs view activation methods');
    }

    let toggleState = null;

    async function toggle({
        currentFile,
        activeViewMode,
        workflowEditor,
        codeEditor,
    }) {
        if (!currentFile || !workflowEditor || !codeEditor) {
            return { changed: false, nextViewMode: activeViewMode, hasUnsavedChanges: false };
        }
        if (!isWorkflowFilePath(currentFile)) {
            return { changed: false, nextViewMode: activeViewMode, hasUnsavedChanges: false };
        }

        // From workflow view to code view
        if (activeViewMode === 'workflow') {
            const jsonContent = workflowEditor.getContent() || '{}';
            const hadUnsavedChanges = workflowEditor.hasUnsavedChanges?.() || false;
            toggleState = {
                originalViewMode: activeViewMode,
            };

            activateCodeView();
            await codeEditor.show(currentFile, jsonContent, 'json', null, { tabId: currentFile });

            if (hadUnsavedChanges) {
                codeEditor.isDirty = true;
                codeEditor.callbacks?.onContentChange?.();
            } else {
                codeEditor.markSaved();
            }

            return {
                changed: true,
                nextViewMode: 'code',
                hasUnsavedChanges: hadUnsavedChanges,
            };
        }

        // From code view back to workflow view
        if (activeViewMode === 'code') {
            codeEditor?.saveViewStateForTab?.(currentFile);
            const codeContent = typeof codeEditor.getValueForSave === 'function'
                ? codeEditor.getValueForSave()
                : codeEditor.getValue();
            const hadUnsavedChanges = codeEditor.hasUnsavedChanges?.() || false;

            activateWorkflowView();
            await workflowEditor.loadFile(currentFile, codeContent);

            if (hadUnsavedChanges) {
                workflowEditor.markDirty?.();
            } else {
                workflowEditor.markSaved?.();
            }

            codeEditor.markSaved();
            toggleState = null;

            return {
                changed: true,
                nextViewMode: 'workflow',
                hasUnsavedChanges: hadUnsavedChanges,
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
