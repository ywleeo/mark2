import { aiService } from '../aiService.js';

function resolvePendingMessage(sidebar, messageId) {
    if (messageId) {
        sidebar.resolvePendingConversation(messageId);
    }
}

export function createAiTaskController(sidebar) {
    if (!sidebar) {
        throw new Error('createAiTaskController 需要 sidebar 实例');
    }

    const unsubscribe = aiService.subscribe(event => {
        switch (event.type) {
            case 'task-started': {
                const pending = sidebar.pendingTaskQueue.shift() || null;
                const fallbackPrompt = pending?.requestOptions?.prompt || '';
                const taskContext = pending?.context || {
                    originalPrompt: fallbackPrompt,
                    runCount: 0,
                    displayPrompt: false,
                };

                taskContext.currentTaskId = event.id;
                taskContext.lastRequestOptions = pending?.requestOptions || event.payload || {};
                taskContext.displayPrompt = pending?.displayPrompt === true;
                taskContext.displayMessage = pending?.displayMessage ?? null;
                taskContext.runCount = (taskContext.runCount || 0) + 1;
                taskContext.userMessageId = pending?.userMessageId || null;
                sidebar.taskContexts.set(event.id, taskContext);

                sidebar.setBusy(true);
                sidebar.updateStatusMessage('AI 正在生成回答…');
                break;
            }

            case 'task-stream-start':
                sidebar.streamStates.set(event.id, { streaming: true });
                break;

            case 'task-stream-think':
                sidebar.thinkBlockManager.updateStream(
                    event.id,
                    typeof event.buffer === 'string' ? event.buffer : (event.delta || '')
                );
                break;

            case 'task-stream-chunk': {
                if (event.buffer && event.buffer.trim()) {
                    sidebar.appendMessage({
                        id: `${event.id}-assistant`,
                        role: 'assistant',
                        content: event.buffer,
                        isStreaming: true,
                    });
                    sidebar.scrollMessagesToBottom();
                }
                break;
            }

            case 'task-stream-end': {
                const taskContext = sidebar.taskContexts.get(event.id);
                sidebar.appendMessage({
                    id: `${event.id}-assistant`,
                    role: 'assistant',
                    content: event.buffer || '',
                    isStreaming: false,
                });
                sidebar.streamStates.delete(event.id);
                resolvePendingMessage(sidebar, taskContext?.userMessageId);
                sidebar.cleanupTaskContext(event.id);
                sidebar.thinkBlockManager.finalize(event.id, event.thinkBuffer || '');
                sidebar.setBusy(false);
                sidebar.updateStatusMessage('');
                break;
            }

            case 'task-failed': {
                const taskContext = sidebar.taskContexts.get(event.id);
                sidebar.appendMessage({
                    id: `${event.id}-assistant`,
                    role: 'assistant',
                    content: `错误: ${event.error}`,
                    isError: true,
                });
                sidebar.streamStates.delete(event.id);
                resolvePendingMessage(sidebar, taskContext?.userMessageId);
                sidebar.cleanupTaskContext(event.id);
                sidebar.thinkBlockManager.finalize(event.id);
                sidebar.setBusy(false);
                sidebar.updateStatusMessage(event.error || '请求失败');
                break;
            }

            case 'task-cancelled': {
                const taskContext = sidebar.taskContexts.get(event.id);
                sidebar.appendMessage({
                    id: `${event.id}-cancelled`,
                    role: 'assistant',
                    content: '已取消',
                    isError: true,
                });
                resolvePendingMessage(sidebar, taskContext?.userMessageId);
                sidebar.cleanupTaskContext(event.id);
                sidebar.thinkBlockManager.finalize(event.id);
                sidebar.setBusy(false);
                sidebar.updateStatusMessage('已取消');
                break;
            }

            case 'config':
                sidebar.applyConfig(event.data);
                break;

            default:
                break;
        }
    });

    sidebar.applyConfig(aiService.getConfig());

    return () => {
        if (typeof unsubscribe === 'function') {
            unsubscribe();
        }
    };
}
