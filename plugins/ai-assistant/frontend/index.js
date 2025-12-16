/**
 * AI 助手插件 - 重构版
 * 浮动窗口式的专业写作助手
 */
import { ConfigDialog } from './components/ConfigDialog.js';
import { SelectionToolbar } from './components/SelectionToolbar.js';
import { PreviewPanel } from './components/PreviewPanel.js';
import { aiService } from './aiService.js';

export const metadata = {
    id: 'ai-assistant',
    name: 'AI 助手',
    version: '2.0.0',
    description: '专业的 AI 写作助手',
};

/**
 * 插件激活入口
 */
export async function activate(context) {
    console.log('[AI Plugin] ========== 正在激活 v2.0 ==========');
    console.log('[AI Plugin] context keys:', Object.keys(context));
    console.log('[AI Plugin] context:', context);

    const { app } = context;

    console.log('[AI Plugin] app keys:', app ? Object.keys(app) : 'null');
    console.log('[AI Plugin] app:', app);

    let configDialog = null;
    let selectionToolbar = new SelectionToolbar();
    let previewPanel = new PreviewPanel();
    let markdownEditorInstance = null;
    let handleAIAction = null;

    console.log('[AI Plugin] 组件已创建', {
        hasSelectionToolbar: !!selectionToolbar,
        hasPreviewPanel: !!previewPanel
    });

    const handleToolbarAction = (action) => {
        console.log('[AI Plugin] 工具栏回调被触发', { action });
        if (handleAIAction) {
            handleAIAction(action);
        }
    };

    // 立即设置工具栏的回调（在 handleAIAction 定义之前）
    selectionToolbar.onActionClick = handleToolbarAction;

    console.log('[AI Plugin] 回调已设置', {
        hasCallback: typeof selectionToolbar.onActionClick === 'function'
    });

    const bindMarkdownEditor = (editorInstance) => {
        if (!editorInstance) {
            console.warn('[AI Plugin] bindMarkdownEditor 调用时没有可用的编辑器实例');
            return;
        }

        if (markdownEditorInstance === editorInstance) {
            console.log('[AI Plugin] Markdown 编辑器已绑定，跳过重复绑定');
            return;
        }

        markdownEditorInstance = editorInstance;
        console.log('[AI Plugin] Markdown 编辑器已绑定', {
            editorType: markdownEditorInstance?.constructor?.name
        });

        if (selectionToolbar) {
            selectionToolbar.init(editorInstance, handleToolbarAction);
        }
    };

    // 获取 MarkdownEditor 实例
    const getMarkdownEditor = () => {
        if (markdownEditorInstance) {
            return markdownEditorInstance;
        }

        if (typeof window !== 'undefined' && window.markdownEditor) {
            bindMarkdownEditor(window.markdownEditor);
            return markdownEditorInstance;
        }

        if (typeof window !== 'undefined' && window.editor) {
            bindMarkdownEditor(window.editor);
            return markdownEditorInstance;
        }

        console.warn('[AI Plugin] 当前没有可用的 Markdown 编辑器实例');
        return null;
    };

    // 监听编辑器就绪事件
    const unsubscribeEditorReady = context.eventBus?.on?.('editor:ready', (payload = {}) => {
        console.log('[AI Plugin] 收到 editor:ready 事件', {
            hasMarkdownEditor: !!payload?.markdownEditor,
            hasMonacoEditor: !!payload?.monacoEditor
        });
        if (payload?.markdownEditor) {
            bindMarkdownEditor(payload.markdownEditor);
        }
    });

    if (typeof unsubscribeEditorReady === 'function') {
        context.onCleanup(() => {
            unsubscribeEditorReady();
        });
    }

    if (typeof window !== 'undefined') {
        if (window.markdownEditor) {
            bindMarkdownEditor(window.markdownEditor);
        } else if (window.editor) {
            bindMarkdownEditor(window.editor);
        }
    }

    // 处理 AI 操作（实现）
    handleAIAction = async (action) => {
        console.log('[AI Plugin] ========== handleAIAction 被调用 ==========', {
            action,
            toolbarHasEditor: !!selectionToolbar.editor,
            toolbarHasCallback: !!selectionToolbar.onActionClick
        });

        const editor = getMarkdownEditor();
        if (!editor) {
            console.warn('[AI Plugin] 尚未绑定 Markdown 编辑器，将回退到 AppBridge 能力');
        } else {
            console.log('[AI Plugin] 编辑器已获取', {
                hasEditor: !!editor,
                editorType: editor.constructor.name
            });
        }

        // 检查配置
        const config = aiService.getConfig();
        if (!config.apiKey) {
            alert('请先配置 API Key');
            if (!configDialog) {
                configDialog = new ConfigDialog();
            }
            configDialog.open(config);
            return;
        }

        // 获取选中文本和完整文档
        let selectedText = editor?.getSelectedMarkdown?.();
        if (!selectedText || selectedText.trim().length === 0) {
            if (typeof app?.getSelectedText === 'function') {
                try {
                    selectedText = await app.getSelectedText();
                } catch (error) {
                    console.error('[AI Plugin] 通过 AppBridge 获取选中文本失败', error);
                }
            }
        }
        if (!selectedText || selectedText.trim().length === 0) {
            console.warn('[AI Plugin] 没有选中文本');
            return;
        }

        let documentContent = editor?.getMarkdown?.();
        if (!documentContent && typeof app?.getDocumentContent === 'function') {
            try {
                documentContent = await app.getDocumentContent();
            } catch (error) {
                console.error('[AI Plugin] 通过 AppBridge 获取完整文档失败', error);
            }
        }
        documentContent = documentContent || '';

        // 显示预览面板并处理
        await previewPanel.show(action, selectedText, documentContent, {
            onApply: (resultText) => {
                // 应用结果到编辑器
                if (editor?.replaceSelectionWithAIContent) {
                    editor.replaceSelectionWithAIContent(resultText);
                } else if (typeof app?.replaceSelection === 'function') {
                    void app.replaceSelection(resultText);
                } else {
                    console.warn('[AI Plugin] 缺少应用 AI 结果的能力');
                }
                console.log('[AI Plugin] 已应用 AI 结果');
            },
            onCancel: () => {
                console.log('[AI Plugin] 用户取消');
            },
        });
    };

    // 导出插件 API
    const api = {
        /**
         * 打开配置对话框
         */
        async openSettings() {
            if (!configDialog) {
                configDialog = new ConfigDialog();
            }
            configDialog.open(aiService.getConfig());
        },

        /**
         * 获取 AI 服务实例
         */
        getService() {
            return aiService;
        },

        /**
         * 手动触发 AI 操作（供外部调用）
         */
        async triggerAction(action) {
            await handleAIAction(action);
        },
    };

    // 注册清理函数
    context.onCleanup(() => {
        configDialog?.destroy?.();
        selectionToolbar?.destroy?.();
        previewPanel?.destroy?.();
        markdownEditorInstance = null;
    });

    console.log('[AI Plugin] 激活完成');
    return api;
}

/**
 * 插件停用
 */
export async function deactivate() {
    console.log('[AI Plugin] 已停用');
}
