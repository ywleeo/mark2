import { aiService } from '../../modules/ai-assistant/aiService.js';
import { createTaskRunner } from '../../modules/terminal-sidebar/services/ptyService.js';

/**
 * 过滤终端控制序列
 * 移除 ANSI 转义序列、OSC 序列（包括 iTerm2 专有序列）等
 */
function stripAnsiSequences(text) {
    return text
        // OSC 序列: \x1b]...\x07 或 \x1b]...\x1b\\
        .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
        // CSI 序列: \x1b[?...h/l 和 \x1b[...m 等
        .replace(/\x1b\[\??[0-9;]*[A-Za-z]/g, '')
        // 其他转义序列
        .replace(/\x1b[=>]/g, '')
        // 控制字符（保留换行和回车）
        .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
}

/**
 * 执行引擎 - 负责执行工作流卡片
 */
export class ExecutionEngine {
    constructor(options = {}) {
        this.getWorkflowData = options.getWorkflowData;
        this.onCardStateChange = options.onCardStateChange;
        this.onLayerStateChange = options.onLayerStateChange;
        this.onWorkflowStateChange = options.onWorkflowStateChange;
        this.readFile = options.readFile;
        this.getWorkflowDir = options.getWorkflowDir;
        this.runningTasks = new Map(); // 存储所有正在运行的卡片 { abortController, ptyService? }
        this.aborted = false; // 用于中止执行流程
        this.cancelledLayers = new Set();
    }

    /**
     * 执行单个卡片
     */
    async executeCard(cardId) {
        const data = this.getWorkflowData?.();
        if (!data) return;

        const card = this.findCard(data, cardId);
        if (!card) return;

        const startTime = Date.now();
        const abortController = new AbortController();
        this.runningTasks.set(cardId, { abortController });

        // 标记为执行中
        this.onCardStateChange?.(cardId, { status: 'running', startTime });

        try {
            // 解析输入
            const inputContent = await this.resolveInputs(data, card.inputs);

            // 根据类型执行
            let result = '';

            if (card.type === 'input') {
                result = card.config?.content || '';
            } else if (card.type === 'generate') {
                result = await this.executeGenerate(card, inputContent, abortController.signal);
            } else if (card.type === 'execute') {
                result = await this.executeCommand(card, inputContent);
            }

            const duration = Date.now() - startTime;

            // 标记完成
            this.onCardStateChange?.(cardId, {
                status: 'done',
                result,
                duration,
            });

            return result;
        } catch (error) {
            const duration = Date.now() - startTime;
            console.error('[ExecutionEngine] 执行失败:', error);
            this.onCardStateChange?.(cardId, {
                status: error?.name === 'CommandCancelled'
                    ? 'cancelled'
                    : 'error',
                error: error?.name === 'CommandCancelled'
                    ? '已终止'
                    : (error.message || '执行失败'),
                duration,
            });
            throw error;
        } finally {
            this.runningTasks.delete(cardId);
        }
    }

    /**
     * 执行全部卡片
     */
    async executeAll() {
        const data = this.getWorkflowData?.();
        if (!data) return;

        this.aborted = false;

        // 重置所有卡片状态
        for (const layer of data.layers) {
            for (const card of layer.cards) {
                this.onCardStateChange?.(card.id, { status: 'idle' });
            }
        }

        const workflowStartTime = Date.now();
        this.onWorkflowStateChange?.({ status: 'running', startTime: workflowStartTime });

        try {
            for (const layer of data.layers) {
                if (this.aborted) break;
                await this.executeLayer(layer.id);
            }

            const workflowDuration = Date.now() - workflowStartTime;
            this.onWorkflowStateChange?.({
                status: this.aborted ? 'cancelled' : 'done',
                duration: workflowDuration,
            });
        } catch (error) {
            const workflowDuration = Date.now() - workflowStartTime;
            this.onWorkflowStateChange?.({ status: 'error', duration: workflowDuration, error: error.message });
            throw error;
        }
    }

    /**
     * 并行执行指定层内所有卡片
     */
    async executeLayer(layerId) {
        const data = this.getWorkflowData?.();
        if (!data) return;

        const layer = data.layers.find((l) => l.id === layerId);
        if (!layer) return;

        // 如果没有卡片，直接返回
        if (layer.cards.length === 0) {
            return;
        }

        this.cancelledLayers.delete(layerId);
        const startTime = Date.now();
        this.onLayerStateChange?.(layerId, { status: 'running', startTime });

        // 重置该层所有卡片状态为 idle，避免残留状态影响
        for (const card of layer.cards) {
            this.onCardStateChange?.(card.id, { status: 'idle' });
        }

        // 并行执行所有卡片
        const tasks = layer.cards.map((card) => {
            return this.executeCard(card.id).catch((error) => {
                // 记录错误但不阻止其他卡片执行
                console.error(`[ExecutionEngine] 卡片 ${card.id} 执行失败:`, error);
            });
        });

        await Promise.all(tasks);

        const duration = Date.now() - startTime;
        const cancelled = this.cancelledLayers.has(layerId);
        this.onLayerStateChange?.(layerId, {
            status: cancelled ? 'cancelled' : 'done',
            duration,
        });
        this.cancelledLayers.delete(layerId);
    }

    /**
     * 解析输入来源
     */
    async resolveInputs(data, inputs) {
        if (!inputs || inputs.length === 0) {
            return '';
        }

        const parts = [];

        for (const input of inputs) {
            if (input.type === 'card') {
                const card = this.findCard(data, input.cardId);
                if (card) {
                    const content = card._state?.result || card.config?.content || '';
                    parts.push(content);
                }
            } else if (input.type === 'layer') {
                const layer = data.layers.find((l) => l.id === input.layerId);
                if (layer) {
                    for (const card of layer.cards) {
                        const content = card._state?.result || card.config?.content || '';
                        if (content) {
                            parts.push(`【${card.title}】\n${content}`);
                        }
                    }
                }
            } else if (input.type === 'file') {
                try {
                    const content = await this.readFile?.(input.path);
                    if (content) {
                        parts.push(content);
                    }
                } catch (error) {
                    console.warn(`[ExecutionEngine] 读取文件失败: ${input.path}`, error);
                }
            }
        }

        return parts.join('\n\n');
    }

    /**
     * 执行 AI 生成
     */
    async executeGenerate(card, inputContent, signal) {
        const promptTemplate = card.config?.prompt || '';
        const prompt = promptTemplate.replace(/\{\{input\}\}/g, inputContent);

        const messages = [{ role: 'user', content: prompt }];

        // 使用 Promise.race 实现可取消的请求
        const abortPromise = new Promise((_, reject) => {
            signal?.addEventListener('abort', () => {
                const error = new Error('已终止');
                error.name = 'CommandCancelled';
                reject(error);
            });
        });

        const response = await Promise.race([
            aiService.chat({ messages }),
            abortPromise,
        ]);
        return response.content || '';
    }

    /**
     * 执行命令
     */
    async executeCommand(card, inputContent) {
        const commandTemplate = card.config?.command || '';

        if (!commandTemplate) {
            throw new Error('未配置执行命令');
        }

        // 替换 {{input}} 占位符
        const command = commandTemplate.replace(/\{\{input\}\}/g, inputContent);
        const workingDir = (card.config?.workingDir || '').trim();
        const cwd = workingDir || this.getWorkflowDir?.() || null;

        let stdout = '';
        const stream = [];
        let taskRunner = null;

        const taskEntry = this.runningTasks.get(card.id) || {};
        taskEntry.cancelled = false;
        this.runningTasks.set(card.id, taskEntry);

        return await new Promise(async (resolve, reject) => {
            try {
                // 使用 createTaskRunner：先设置 listener，再启动进程
                taskRunner = await createTaskRunner({
                    command,
                    cwd,
                    cols: 120,
                    rows: 30,
                    onData: (data) => {
                        const raw = typeof data === 'string' ? data : String(data);
                        const text = stripAnsiSequences(raw);
                        if (!text) return; // 跳过纯控制序列
                        stdout += text;
                        stream.push({ type: 'stdout', text });

                        // 更新流式输出状态
                        if (!taskRunner?.isExited?.()) {
                            this.onCardStateChange?.(card.id, {
                                status: 'running',
                                result: stream.map((item) => item.text).join(''),
                                stdout,
                                stderr: '',
                                stream,
                            });
                        }
                    },
                    onExit: (payload) => {
                        const code = payload?.code;

                        if (taskEntry.cancelled) {
                            const cancelled = new Error('已终止');
                            cancelled.name = 'CommandCancelled';
                            reject(cancelled);
                            return;
                        }

                        if (typeof code === 'number' && code !== 0) {
                            const errorInfo = [
                                stdout,
                                `退出码: ${code}`,
                            ].filter(Boolean).join('\n');
                            reject(new Error(errorInfo || '执行失败'));
                            return;
                        }

                        resolve(stdout);
                    },
                });

                // 保存 taskRunner 的 kill 方法，用于取消
                taskEntry.kill = taskRunner.kill;
                this.runningTasks.set(card.id, taskEntry);

            } catch (error) {
                reject(error instanceof Error ? error : new Error(String(error)));
            }
        });
    }

    async cancelCard(cardId) {
        const entry = this.runningTasks.get(cardId);
        if (!entry) {
            return false;
        }
        entry.cancelled = true;
        try {
            // 触发 AbortController（用于 generate 类型）
            if (entry.abortController) {
                entry.abortController.abort();
            }
            // 终止进程（用于 execute 类型）
            if (entry.kill) {
                await entry.kill();
            }
            return true;
        } catch (error) {
            console.warn('[ExecutionEngine] 终止命令失败:', error);
            return false;
        }
    }

    /**
     * 取消所有正在执行的卡片
     */
    async cancelAll() {
        this.aborted = true;
        const cancelPromises = [];
        for (const cardId of this.runningTasks.keys()) {
            cancelPromises.push(this.cancelCard(cardId));
        }
        await Promise.all(cancelPromises);
    }

    /**
     * 取消指定层内所有正在执行的卡片
     */
    async cancelLayer(layerId) {
        const data = this.getWorkflowData?.();
        if (!data) return;

        const layer = data.layers.find((l) => l.id === layerId);
        if (!layer) return;

        this.cancelledLayers.add(layerId);

        const cancelPromises = layer.cards
            .filter((card) => this.runningTasks.has(card.id))
            .map((card) => this.cancelCard(card.id));

        await Promise.all(cancelPromises);
    }

    /**
     * 查找卡片
     */
    findCard(data, cardId) {
        for (const layer of data.layers) {
            const card = layer.cards.find((c) => c.id === cardId);
            if (card) return card;
        }
        return null;
    }

    /**
     * 检查是否有任务正在执行
     */
    isExecuting() {
        return this.runningTasks.size > 0;
    }
}
