import { aiService } from '../../modules/ai-assistant/aiService.js';
import { createPtyService } from '../../modules/terminal-sidebar/services/ptyService.js';

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
                result = await this.executeCommand(card, inputContent, abortController.signal);
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

        this.cancelledLayers.delete(layerId);
        const startTime = Date.now();
        this.onLayerStateChange?.(layerId, { status: 'running', startTime });

        const tasks = layer.cards.map((card) => {
            if (card._state?.status === 'running') {
                return Promise.resolve();
            }
            return this.executeCard(card.id).catch((error) => {
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
    async executeCommand(card, inputContent, signal) {
        const commandTemplate = card.config?.command || '';

        if (!commandTemplate) {
            throw new Error('未配置执行命令');
        }

        // 替换 {{input}} 占位符
        const command = commandTemplate.replace(/\{\{input\}\}/g, inputContent);
        const workingDir = (card.config?.workingDir || '').trim();
        const resolvedWorkingDir = workingDir || this.getWorkflowDir?.();

        const ptyService = createPtyService();
        const taskEntry = this.runningTasks.get(card.id) || {};
        taskEntry.ptyService = ptyService;
        taskEntry.cancelled = false;
        taskEntry.exited = false;
        this.runningTasks.set(card.id, taskEntry);

        let stdout = '';
        const stream = [];

        const updateStreamingState = () => {
            // 如果进程已退出，不再更新为 running 状态
            if (taskEntry.exited) return;
            const result = stream.map((item) => item.text).join('');
            this.onCardStateChange?.(card.id, {
                status: 'running',
                result,
                stdout,
                stderr: '',
                stream,
            });
        };

        return await new Promise((resolve, reject) => {
            ptyService.onData((data) => {
                const raw = typeof data === 'string' ? data : String(data);
                const text = stripAnsiSequences(raw);
                if (!text) return; // 跳过纯控制序列
                stdout += text;
                stream.push({ type: 'stdout', text });
                updateStreamingState();
            });

            ptyService.onExit((payload) => {
                taskEntry.exited = true; // 标记已退出
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
                        typeof code === 'number' ? `退出码: ${code}` : null,
                    ]
                        .filter(Boolean)
                        .join('\n');
                    reject(new Error(errorInfo || '执行失败'));
                    return;
                }
                resolve(stdout);
            });

            ptyService
                .spawn({
                    cols: 120,
                    rows: 30,
                    cwd: resolvedWorkingDir || null,
                    command, // 直接传命令，避免回显和 prompt
                })
                .catch((error) => {
                    reject(error instanceof Error ? error : new Error(String(error)));
                });
        });
    }

    async cancelCard(cardId) {
        console.log('[cancelCard] 尝试取消卡片:', cardId);
        const entry = this.runningTasks.get(cardId);
        if (!entry) {
            console.warn('[cancelCard] 卡片不在 runningTasks 中:', cardId);
            return false;
        }
        entry.cancelled = true;
        try {
            // 触发 AbortController（用于 generate 类型）
            if (entry.abortController) {
                console.log('[cancelCard] 触发 AbortController');
                entry.abortController.abort();
            }
            // 终止 PTY 进程（用于 execute 类型）
            if (entry.ptyService) {
                console.log('[cancelCard] 终止 PTY 进程');
                await entry.ptyService.kill();
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
        if (!data) {
            console.warn('[cancelLayer] 无法获取 workflow 数据');
            return;
        }

        const layer = data.layers.find((l) => l.id === layerId);
        if (!layer) {
            console.warn('[cancelLayer] 找不到 layer:', layerId);
            return;
        }

        this.cancelledLayers.add(layerId);
        console.log('[cancelLayer] runningTasks keys:', [...this.runningTasks.keys()]);
        console.log('[cancelLayer] layer.cards ids:', layer.cards.map((c) => c.id));

        const cancelPromises = [];
        for (const card of layer.cards) {
            if (this.runningTasks.has(card.id)) {
                console.log('[cancelLayer] 取消卡片:', card.id);
                cancelPromises.push(this.cancelCard(card.id));
            }
        }

        if (cancelPromises.length === 0) {
            console.warn('[cancelLayer] 没有找到正在运行的卡片');
        }

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
}
