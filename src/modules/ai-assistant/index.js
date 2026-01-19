/**
 * AI 助手模块
 * 提供 Sidebar 式对话交互
 */

import { SelectionToolbar } from './components/SelectionToolbar.js';
import { AISidebar } from './components/AISidebar.js';
import { createMessageService } from './services/messageService.js';
import { createContextService } from './services/contextService.js';
import { createLayoutService } from './services/layoutService.js';
import { aiService } from './aiService.js';
import { buildAiRequest } from './prompts/promptComposer.js';

/**
 * 初始化 AI 助手
 */
export async function initAIAssistant({ eventBus, getEditor }) {
    console.log('[AI Assistant] 正在初始化...');

    // 创建服务
    const messageService = await createMessageService();
    const contextService = createContextService({ getEditor });
    const layoutService = await createLayoutService();

    let markdownEditorInstance = null;
    let currentTaskId = null;

    // 创建 Sidebar
    const sidebar = new AISidebar({
        messageService,
        layoutService,
        onSendMessage: handleSendMessage,
        onInsertText: handleInsertText,
        onReplaceText: handleReplaceText,
        onCancelTask: handleCancelTask,
    });

    // 渲染 sidebar 到 body
    document.body.appendChild(sidebar.render());

    // 创建选择工具栏（保留，用于快速触发）
    const selectionToolbar = new SelectionToolbar();

    /**
     * 处理发送消息（chat 输入）
     */
    async function handleSendMessage({ message }) {
        console.log('[AI Assistant] 发送消息:', message);

        // 检查配置
        const config = aiService.getConfig();
        if (!config.apiKey) {
            sidebar.onAIError({ message: '请先在设置中配置 API Key' });
            return;
        }

        // 获取当前上下文
        const context = contextService.getContext();

        // 构建对话历史
        const messages = messageService.getAll();
        const history = messages.map(msg => ({
            role: msg.role,
            content: msg.content,
        }));

        // 添加一个空的 AI 消息占位
        const assistantMessageIndex = messageService.getCount();
        messageService.addMessage({
            role: 'assistant',
            content: '',
            thinking: '',
        });

        // 调用 AI（流式模式）
        try {
            currentTaskId = aiService.generateTaskId();

            const systemPrompt = buildSystemPrompt(context);
            const apiMessages = [
                {
                    role: 'system',
                    content: systemPrompt,
                },
                ...history,
            ];

            // 订阅流式事件
            const streamUnsubscribe = aiService.subscribe((event) => {
                if (!event || event.id !== currentTaskId) {
                    return;
                }

                switch (event.type) {
                    case 'task-stream-start':
                        break;

                    case 'task-stream-chunk':
                        sidebar.updateStreamMessage(assistantMessageIndex, {
                            content: event.buffer || '',
                        });
                        break;

                    case 'task-stream-think':
                        sidebar.updateStreamMessage(assistantMessageIndex, {
                            thinking: event.buffer || '',
                        });
                        break;

                    case 'task-stream-end':
                        // 更新 UI
                        sidebar.updateStreamMessage(assistantMessageIndex, {
                            content: event.buffer || '',
                            thinking: event.thinkBuffer || '',
                        });
                        // 保存到存储
                        messageService.updateMessage(assistantMessageIndex, {
                            content: event.buffer || '',
                            thinking: event.thinkBuffer || '',
                        });
                        sidebar.onAIComplete();
                        streamUnsubscribe();
                        currentTaskId = null;
                        break;

                    case 'task-failed':
                        sidebar.onAIError({ message: event.error || 'AI 处理失败' });
                        streamUnsubscribe();
                        currentTaskId = null;
                        break;

                    case 'task-cancelled':
                        sidebar.onAIComplete();
                        messageService.addMessage({
                            role: 'system',
                            content: '已取消操作',
                        });
                        streamUnsubscribe();
                        currentTaskId = null;
                        break;
                }
            });

            // 开始任务
            await aiService.runTask({
                messages: apiMessages,
                temperature: 0.7,
                taskId: currentTaskId,
            });
        } catch (error) {
            // 取消操作不记录错误
            if (error.message !== '请求已取消') {
                console.error('[AI Assistant] AI 处理失败:', error);
                sidebar.onAIError(error);
            }
            currentTaskId = null;
        }
    }

    /**
     * 构建系统提示词
     */
    function buildSystemPrompt(context) {
        let prompt = '你是一个专业的写作助手。';

        if (context.hasSelection) {
            prompt += `\n\n用户当前选中的文本：\n${context.selectedText}`;
        }

        if (context.documentContent) {
            prompt += `\n\n文档上下文（前500字）：\n${context.documentContent.substring(0, 500)}`;
        }

        return prompt;
    }

    /**
     * 插入文本到编辑器
     */
    function handleInsertText(content) {
        const editor = markdownEditorInstance || getEditor();
        if (!editor) {
            console.warn('[AI Assistant] 没有可用的编辑器');
            return;
        }

        if (editor.insertAfterSelectionWithAIContent) {
            editor.insertAfterSelectionWithAIContent(content);
        } else if (editor.replaceSelectionWithAIContent) {
            editor.replaceSelectionWithAIContent(content);
        } else {
            console.warn('[AI Assistant] 编辑器不支持插入内容');
        }
    }

    /**
     * 替换选中文本
     */
    function handleReplaceText(content) {
        const editor = markdownEditorInstance || getEditor();
        if (!editor) {
            console.warn('[AI Assistant] 没有可用的编辑器');
            return;
        }

        if (editor.replaceSelectionWithAIContent) {
            editor.replaceSelectionWithAIContent(content);
        } else {
            console.warn('[AI Assistant] 编辑器不支持替换内容');
        }
    }

    /**
     * 取消当前任务
     */
    function handleCancelTask() {
        if (currentTaskId) {
            aiService.cancelTask(currentTaskId);
            currentTaskId = null;
        }
    }

    /**
     * 处理 AI 操作（从工具栏或右键菜单触发）
     * @param {string} action - 操作类型
     * @param {string} style - 输出风格（可选）
     */
    const handleAIAction = async (action, style) => {
        console.log('[AI Assistant] 工具栏触发:', action, '风格:', style);

        // 隐藏工具栏
        selectionToolbar.hide();

        // 检查配置
        const config = aiService.getConfig();
        if (!config.apiKey) {
            alert('请先在「Mark2 > Settings > AI 助手」中配置 API Key');
            return;
        }

        // 获取选中文本和文档内容
        const context = contextService.getContext();
        if (!context.hasSelection) {
            console.warn('[AI Assistant] 没有选中文本');
            return;
        }

        // 打开 sidebar
        sidebar.show();

        // 添加用户消息（显示友好的提示，包含风格信息）
        const actionLabels = {
            polish: '帮我润色这段文字',
            continue: '继续写这段内容',
            expand: '扩写这段内容',
            compress: '精简这段内容',
            simplify: '精简这段内容',
            summarize: '总结这段内容',
            translate: '翻译这段内容',
            brainstorm: '对这个主题进行脑暴',
            podcast_solo: '转换为播客单人独白',
            podcast_duo: '转换为播客双人对话',
        };
        const styleLabels = {
            balanced: '平衡', rational: '理性', humorous: '幽默', cute: '可爱',
            business_style: '商务', literary: '文艺',
            novel_romance: '言情', novel_mystery: '悬疑', novel_costume: '古偶',
            novel_wuxia: '武侠', novel_xianxia: '修仙', novel_history: '历史',
            xiaohongshu: '小红书', zhihu: '知乎', weibo: '微博', bilibili: 'B站',
            wechat: '公众号', toutiao: '头条', douyin: '抖音', shipinhao: '视频号', taobao: '淘宝',
            novel_master: '大师', standup_comedy: '脱口秀',
            ghibli: '吉卜力', shinkai: '新海诚', kyoani: '京都动画', pixar: '皮克斯',
        };
        const baseMessage = actionLabels[action] || '处理这段文字';
        const styleLabel = style ? styleLabels[style] || style : null;
        const userMessage = styleLabel ? `${baseMessage}（${styleLabel}风格）` : baseMessage;
        messageService.addMessage({
            role: 'user',
            content: userMessage,
        });

        // 显示处理状态
        const actionStatusLabels = {
            polish: '正在润色',
            continue: '正在续写',
            expand: '正在扩写',
            compress: '正在精简',
            simplify: '正在精简',
            summarize: '正在总结',
            translate: '正在翻译',
            brainstorm: '正在脑暴',
            podcast_solo: '正在生成播客独白',
            podcast_duo: '正在生成播客对话',
        };
        const statusText = actionStatusLabels[action] || '正在处理';
        sidebar.onAIStart(statusText);

        // 添加 AI 消息占位
        const assistantMessageIndex = messageService.getCount();
        messageService.addMessage({
            role: 'assistant',
            content: '',
            thinking: '',
        });

        try {
            // 使用和 PreviewPanel 相同的方式构建请求
            // 如果传入了风格参数，覆盖 preferences 中的 outputStyle
            const preferences = {
                ...config.preferences,
                ...(style && { outputStyle: style })
            };
            const request = await buildAiRequest(
                action,
                context.selectedText,
                context.documentContent,
                preferences
            );

            const taskId = aiService.generateTaskId();
            currentTaskId = taskId;

            // 订阅流式事件
            const streamUnsubscribe = aiService.subscribe((event) => {
                if (!event || event.id !== taskId) {
                    return;
                }

                switch (event.type) {
                    case 'task-stream-start':
                        break;

                    case 'task-stream-chunk':
                        sidebar.updateStreamMessage(assistantMessageIndex, {
                            content: event.buffer || '',
                        });
                        break;

                    case 'task-stream-think':
                        sidebar.updateStreamMessage(assistantMessageIndex, {
                            thinking: event.buffer || '',
                        });
                        break;

                    case 'task-stream-end':
                        // 更新 UI
                        sidebar.updateStreamMessage(assistantMessageIndex, {
                            content: event.buffer || '',
                            thinking: event.thinkBuffer || '',
                        });
                        // 保存到存储
                        messageService.updateMessage(assistantMessageIndex, {
                            content: event.buffer || '',
                            thinking: event.thinkBuffer || '',
                        });
                        sidebar.onAIComplete();
                        streamUnsubscribe();
                        currentTaskId = null;
                        break;

                    case 'task-failed':
                        sidebar.onAIError({ message: event.error || 'AI 处理失败' });
                        streamUnsubscribe();
                        currentTaskId = null;
                        break;

                    case 'task-cancelled':
                        sidebar.onAIComplete();
                        messageService.addMessage({
                            role: 'system',
                            content: '已取消操作',
                        });
                        streamUnsubscribe();
                        currentTaskId = null;
                        break;
                }
            });

            // 运行任务
            await aiService.runTask({
                messages: request.messages,
                temperature: request.temperature,
                taskId,
            });
        } catch (error) {
            // 取消操作不记录错误
            if (error.message !== '请求已取消') {
                console.error('[AI Assistant] AI 处理失败:', error);
                sidebar.onAIError(error);
            }
            currentTaskId = null;
        }
    };

    /**
     * 绑定 Markdown 编辑器
     */
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

        // 仍然保留工具栏，用于快速操作
        if (selectionToolbar) {
            selectionToolbar.init(editorInstance, handleAIAction);
        }
    };

    // 监听编辑器就绪事件
    if (eventBus) {
        eventBus.on('editor:ready', (payload = {}) => {
            console.log('[AI Assistant] 收到 editor:ready 事件');
            if (payload?.markdownEditor) {
                bindMarkdownEditor(payload.markdownEditor);
            }
        });

        // 监听 tab 切换事件，隐藏选择工具栏
        eventBus.on('tab:switch', () => {
            selectionToolbar?.hide();
        });

        // 监听 Terminal Sidebar 显示事件，隐藏 AI Sidebar（互斥）
        eventBus.on('terminal-sidebar:show', () => {
            sidebar.hide();
        });
    }

    // 尝试立即绑定已存在的编辑器
    const editor = getEditor();
    if (editor) {
        bindMarkdownEditor(editor);
    }

    // 导出 API
    return {
        sidebar,
        selectionToolbar,
        messageService,
        contextService,
        layoutService,
        aiService,
        toggleSidebar() {
            if (sidebar.isVisible?.() || layoutService.getState().visible) {
                sidebar.hide();
            } else {
                eventBus?.emit('ai-sidebar:show');
                sidebar.show();
            }
        },
        showSidebar() {
            eventBus?.emit('ai-sidebar:show');
            sidebar.show();
        },
        hideSidebar() {
            sidebar.hide();
        },
        destroy() {
            selectionToolbar?.destroy?.();
            sidebar?.destroy?.();
            markdownEditorInstance = null;
        }
    };
}
