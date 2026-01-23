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
        this.readFile = options.readFile;
        this.getWorkflowDir = options.getWorkflowDir;
        this.runningCommands = new Map();
    }

    /**
     * 执行单个卡片
     */
    async executeCard(cardId) {
        const data = this.getWorkflowData?.();
        if (!data) return;

        const card = this.findCard(data, cardId);
        if (!card) return;

        // 标记为执行中
        this.onCardStateChange?.(cardId, { status: 'running' });

        try {
            // 解析输入
            const inputContent = await this.resolveInputs(data, card.inputs);

            // 根据类型执行
            let result = '';

            if (card.type === 'input') {
                result = card.config?.content || '';
            } else if (card.type === 'generate') {
                result = await this.executeGenerate(card, inputContent);
            } else if (card.type === 'execute') {
                result = await this.executeCommand(card, inputContent);
            }

            // 标记完成
            this.onCardStateChange?.(cardId, {
                status: 'done',
                result,
            });

            return result;
        } catch (error) {
            console.error('[ExecutionEngine] 执行失败:', error);
            this.onCardStateChange?.(cardId, {
                status: error?.name === 'CommandCancelled'
                    ? 'cancelled'
                    : 'error',
                error: error?.name === 'CommandCancelled'
                    ? '已终止'
                    : (error.message || '执行失败'),
            });
            throw error;
        } finally {
            this.runningCommands.delete(cardId);
        }
    }

    /**
     * 执行全部卡片
     */
    async executeAll() {
        const data = this.getWorkflowData?.();
        if (!data) return;

        for (const layer of data.layers) {
            for (const card of layer.cards) {
                // 只执行 pending 状态的卡片
                if (card.status === 'pending' || !card._state?.result) {
                    try {
                        await this.executeCard(card.id);
                    } catch (error) {
                        // 继续执行其他卡片
                        console.error(`[ExecutionEngine] 卡片 ${card.id} 执行失败:`, error);
                    }
                }
            }
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

        const tasks = layer.cards.map((card) => {
            if (card._state?.status === 'running') {
                return Promise.resolve();
            }
            return this.executeCard(card.id).catch((error) => {
                console.error(`[ExecutionEngine] 卡片 ${card.id} 执行失败:`, error);
            });
        });

        await Promise.all(tasks);
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
    async executeGenerate(card, inputContent) {
        const promptTemplate = card.config?.prompt || '';
        const prompt = promptTemplate.replace(/\{\{input\}\}/g, inputContent);

        const messages = [{ role: 'user', content: prompt }];

        const response = await aiService.chat({ messages });
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
        const resolvedWorkingDir = workingDir || this.getWorkflowDir?.();

        const ptyService = createPtyService();
        const commandEntry = {
            ptyService,
            cancelled: false,
        };
        this.runningCommands.set(card.id, commandEntry);

        let stdout = '';
        const stream = [];

        const updateStreamingState = () => {
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
                const code = payload?.code;
                if (commandEntry.cancelled) {
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
        const entry = this.runningCommands.get(cardId);
        if (!entry) {
            return false;
        }
        entry.cancelled = true;
        try {
            if (entry.ptyService) {
                await entry.ptyService.kill();
            } else if (entry.child) {
                await entry.child.kill();
            }
            return true;
        } catch (error) {
            console.warn('[ExecutionEngine] 终止命令失败:', error);
            return false;
        }
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
