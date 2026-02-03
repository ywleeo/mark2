import { isFeatureEnabled, getMASLimitationMessage } from '../../config/features.js';

export function createWorkflowRenderer() {
    return {
        id: 'workflow',
        extensions: ['mflow'],
        getViewMode() {
            return 'workflow';
        },
        async load(ctx) {
            const {
                filePath,
                fileData,
                session,
                editorRegistry,
                workflowEditor,
                imageViewer,
                mediaViewer,
                spreadsheetViewer,
                pdfViewer,
                unsupportedViewer,
                activateWorkflowView,
                forceReload,
            } = ctx;

            // MAS 版本禁用 workflow 功能
            if (!isFeatureEnabled('workflow')) {
                editorRegistry?.getMarkdownEditor?.()?.clear?.();
                editorRegistry?.getCodeEditor?.()?.hide?.();
                imageViewer?.hide?.();
                mediaViewer?.hide?.();
                spreadsheetViewer?.hide?.();
                pdfViewer?.hide?.();
                unsupportedViewer?.show?.(filePath, getMASLimitationMessage('workflow'));
                return true;
            }

            activateWorkflowView?.();
            editorRegistry?.getMarkdownEditor?.()?.clear?.();
            editorRegistry?.getCodeEditor?.()?.hide?.();
            imageViewer?.hide?.();
            mediaViewer?.hide?.();
            spreadsheetViewer?.hide?.();
            pdfViewer?.hide?.();
            unsupportedViewer?.hide?.();
            await workflowEditor?.loadFile?.(session, filePath, fileData.content, { forceReload });
            return true;
        },
    };
}
