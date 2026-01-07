/**
 * 编辑器上下文提取服务
 * 负责获取选中文本、文档内容等
 */

/**
 * 创建上下文服务
 */
export function createContextService({ getEditor }) {
    /**
     * 获取选中文本
     */
    function getSelectedText() {
        const selection = window.getSelection();
        const text = selection?.toString().trim() || '';
        return text;
    }

    /**
     * 获取文档全文内容
     */
    function getDocumentContent() {
        const editor = getEditor();
        if (!editor) {
            return '';
        }

        // 获取 Markdown 内容
        if (typeof editor.getMarkdown === 'function') {
            return editor.getMarkdown();
        }

        // 获取纯文本
        if (typeof editor.getText === 'function') {
            return editor.getText();
        }

        // 尝试从 TipTap 编辑器获取
        const tiptapEditor = editor.getTipTapEditor?.() || editor.editor;
        if (tiptapEditor) {
            if (typeof tiptapEditor.getText === 'function') {
                return tiptapEditor.getText();
            }
            if (tiptapEditor.state?.doc) {
                return tiptapEditor.state.doc.textContent;
            }
        }

        return '';
    }

    /**
     * 获取完整上下文
     */
    function getContext() {
        const selectedText = getSelectedText();
        const documentContent = getDocumentContent();

        return {
            selectedText,
            documentContent,
            hasSelection: selectedText.length > 0,
        };
    }

    return {
        getSelectedText,
        getDocumentContent,
        getContext,
    };
}
