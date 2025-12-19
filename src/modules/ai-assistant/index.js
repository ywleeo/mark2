/**
 * AI 助手模块
 * 提供选中文本的 AI 辅助功能
 */
import { SelectionToolbar } from './components/SelectionToolbar.js';
import { PreviewPanel } from './components/PreviewPanel.js';
import { aiService } from './aiService.js';

/**
 * 初始化 AI 助手
 */
export function initAIAssistant({ eventBus, getEditor }) {
    console.log('[AI Assistant] 正在初始化...');

    const selectionToolbar = new SelectionToolbar();
    const previewPanel = new PreviewPanel();
    let markdownEditorInstance = null;

    // 处理 AI 操作
    const handleAIAction = async (action) => {
        console.log('[AI Assistant] handleAIAction 被调用', { action });

        // 隐藏工具栏菜单
        selectionToolbar.hide();

        const editor = markdownEditorInstance || getEditor();
        if (!editor) {
            console.warn('[AI Assistant] 没有可用的编辑器实例');
            return;
        }

        // 检查配置
        const config = aiService.getConfig();
        if (!config.apiKey) {
            alert('请先在「Mark2 > Settings > AI 助手」中配置 API Key');
            return;
        }

        // 获取选中文本
        let selectedText = editor?.getSelectedMarkdown?.();
        if (!selectedText || selectedText.trim().length === 0) {
            console.warn('[AI Assistant] 没有选中文本');
            return;
        }

        // 获取完整文档
        let documentContent = editor?.getMarkdown?.() || '';

        // 获取工具栏选择的风格（优先级高于设置中的默认风格）
        const currentStyle = selectionToolbar.getCurrentStyle();

        // 显示预览面板并处理
        await previewPanel.show(action, selectedText, documentContent, {
            outputStyle: currentStyle, // 传入当前选择的风格
            onApply: (resultText, mode = 'replace') => {
                if (mode === 'replace') {
                    // 替换选中内容
                    if (editor?.replaceSelectionWithAIContent) {
                        editor.replaceSelectionWithAIContent(resultText);
                    } else {
                        console.warn('[AI Assistant] 编辑器不支持替换内容');
                    }
                    console.log('[AI Assistant] 已替换 AI 结果');
                } else if (mode === 'append') {
                    // 在选中内容后增加
                    if (editor?.insertAfterSelectionWithAIContent) {
                        editor.insertAfterSelectionWithAIContent(resultText);
                        console.log('[AI Assistant] 已增加 AI 结果');
                    } else {
                        console.warn('[AI Assistant] 编辑器不支持插入内容');
                    }
                }
            },
            onCancel: () => {
                console.log('[AI Assistant] 用户取消');
            },
        });
    };

    // 绑定编辑器
    const bindMarkdownEditor = (editorInstance) => {
        if (!editorInstance) {
            console.warn('[AI Assistant] bindMarkdownEditor 调用时没有可用的编辑器实例');
            return;
        }

        if (markdownEditorInstance === editorInstance) {
            console.log('[AI Assistant] Markdown 编辑器已绑定，跳过重复绑定');
            return;
        }

        markdownEditorInstance = editorInstance;
        console.log('[AI Assistant] Markdown 编辑器已绑定');

        if (selectionToolbar) {
            selectionToolbar.init(editorInstance, handleAIAction);
        }
    };

    // 监听编辑器就绪事件
    if (eventBus) {
        const unsubscribe = eventBus.on('editor:ready', (payload = {}) => {
            console.log('[AI Assistant] 收到 editor:ready 事件');
            if (payload?.markdownEditor) {
                bindMarkdownEditor(payload.markdownEditor);
            }
        });
    }

    // 尝试立即绑定已存在的编辑器
    const editor = getEditor();
    if (editor) {
        bindMarkdownEditor(editor);
    }

    // 导出 API
    return {
        selectionToolbar,
        previewPanel,
        aiService,
        destroy() {
            selectionToolbar?.destroy?.();
            previewPanel?.destroy?.();
            markdownEditorInstance = null;
        }
    };
}
