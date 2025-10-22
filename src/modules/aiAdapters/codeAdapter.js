export function createCodeAdapter() {
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

        finalizeSession(taskId, content) {
            if (!editor) {
                return;
            }
            if (typeof content === 'string') {
                editor.finalizeAiStreamSession?.(taskId, content);
            } else {
                editor.abortAiStreamSession?.(taskId);
            }
        },

        abortSession(taskId) {
            editor?.abortAiStreamSession?.(taskId);
        },

        insertContent(text) {
            if (!editor || typeof text !== 'string' || text.trim().length === 0) {
                return;
            }
            editor.insertTextAtCursor(text);
        },
    };
}
