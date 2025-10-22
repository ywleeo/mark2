export function createMarkdownAdapter() {
    let editor = null;

    return {
        setEditor(instance) {
            editor = instance || null;
        },

        hasEditor() {
            return !!editor;
        },

        beginSession(taskId) {
            if (!editor?.beginAiStreamSession) {
                return false;
            }
            return editor.beginAiStreamSession(taskId);
        },

        appendChunk(taskId, delta) {
            if (!editor?.appendAiStreamContent || typeof delta !== 'string' || delta.length === 0) {
                return;
            }
            editor.appendAiStreamContent(taskId, delta);
        },

        finalizeSession(taskId, markdown) {
            if (!editor) {
                return;
            }
            if (typeof markdown === 'string') {
                editor.finalizeAiStreamSession?.(taskId, markdown);
            } else {
                editor.abortAiStreamSession?.(taskId);
            }
        },

        abortSession(taskId) {
            editor?.abortAiStreamSession?.(taskId);
        },

        insertContent(markdown) {
            if (!editor || typeof markdown !== 'string' || markdown.trim().length === 0) {
                return;
            }
            editor.insertAIContent(markdown, { replace: false });
        },
    };
}
