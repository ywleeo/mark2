import { CoordinatorAgent } from './CoordinatorAgent.js';
import { ExecutorAgent } from './ExecutorAgent.js';
import { trimTextPreview } from '../utils/textPreview.js';
import { aiService } from '../aiService.js';

const DEFAULT_MAX_ITERATIONS = 6;
const DEFAULT_CHUNK_SIZE = 40;

/**
 * 双智能体编排器：负责在前端控制层执行调度与解答流程
 */
export class DualAgentOrchestrator {
    constructor(options = {}) {
        this.coordinator = options.coordinator || new CoordinatorAgent(options.coordinatorOptions);
        this.executor = options.executor || new ExecutorAgent(options.executorOptions);
        this.getDocumentContent = options.getDocumentContent;
        this.maxIterations = options.maxIterations || DEFAULT_MAX_ITERATIONS;
        this.chunkSize = options.chunkSize || DEFAULT_CHUNK_SIZE;
        this.executeWithStreaming = options.executeWithStreaming || null;
        this.onAction = typeof options.onAction === 'function' ? options.onAction : null;
    }

    async runSession(params) {
        const session = this.createInitialSession(params);

        for (let iteration = 0; iteration < this.maxIterations; iteration += 1) {
            const statePayload = this.buildCoordinatorState(session);
            const decision = await this.coordinator.planNextAction(statePayload);

            session.steps.push({
                type: 'coordinator',
                iteration,
                decision,
            });

            this.emitAction('coordinator_decision', { iteration, decision }, session);

            switch (decision.action) {
                case 'read_document':
                    await this.handleReadDocument(session, decision.payload);
                    break;
                case 'delegate_to_executor':
                    await this.handleDelegateToExecutor(session, decision.payload);
                    break;
                case 'finish':
                    session.status = 'finished';
                    session.finalAnswer = decision.payload?.answer || session.lastExecutorAnswer || '';
                    session.finishMetadata = {
                        notes: decision.payload?.notes,
                        metadata: decision.metadata || {},
                    };
                    return session;
                default:
                    throw new Error(`Unsupported action: ${decision.action}`);
            }
        }

        session.status = 'max_iterations';
        return session;
    }

    createInitialSession({ userPrompt, conversationHistory = [] }) {
        return {
            userPrompt,
            conversationHistory,
            contextPool: [],
            steps: [],
            documentState: null,
            lastExecutorAnswer: '',
            status: 'running',
        };
    }

    buildCoordinatorState(session) {
        return {
            goal: session.userPrompt,
            conversationHistory: session.conversationHistory,
            contextPool: session.contextPool.map(entry => ({
                id: entry.id,
                type: entry.type,
                range: entry.range,
                content: entry.content,
                summary: entry.summary,
            })),
            actions: session.steps.map(step => {
                if (step.type === 'read_document') {
                    return {
                        type: 'observation',
                        name: 'read_document',
                        input: step.input,
                        contextId: step.contextId,
                        preview: step.preview,
                    };
                }
                if (step.type === 'executor_result') {
                    return {
                        type: 'executor_result',
                        summary: trimTextPreview(step.answer, 160),
                    };
                }
                if (step.type === 'coordinator') {
                    return {
                        type: 'coordinator_decision',
                        action: step.decision?.action,
                        reasoning: step.decision?.metadata?.reasoning,
                        confidence: step.decision?.metadata?.confidence,
                    };
                }
                return step;
            }),
            constraints: {
                availableActions: ['read_document', 'delegate_to_executor', 'finish'],
                chunkSize: this.chunkSize,
                remainingIterations: Math.max(0, this.maxIterations - session.steps.filter(step => step.type === 'coordinator').length),
            },
            lastExecutorAnswer: session.lastExecutorAnswer,
        };
    }

    async ensureDocumentState(session) {
        if (session.documentState) {
            return session.documentState;
        }

        if (!this.getDocumentContent) {
            throw new Error('未提供读取文档的能力');
        }

        const documentContent = await this.getDocumentContent();
        const normalized = (documentContent || '').replace(/\r\n/g, '\n');
        const lines = normalized.split('\n');

        session.documentState = {
            fullText: normalized,
            lines,
            totalLines: lines.length,
            cursor: 0,
        };

        return session.documentState;
    }

    nextChunkRange(documentState, requestedRange) {
        const { totalLines, cursor } = documentState;

        if (requestedRange && typeof requestedRange.startLine === 'number' && typeof requestedRange.endLine === 'number') {
            const startLine = Math.max(1, Math.min(totalLines, requestedRange.startLine));
            const endLine = Math.max(startLine, Math.min(totalLines, requestedRange.endLine));
            return { startLine, endLine };
        }

        if (cursor >= totalLines) {
            return null;
        }

        const startLine = cursor + 1;
        const endLine = Math.min(totalLines, cursor + this.chunkSize);
        return { startLine, endLine };
    }

    sliceDocument(documentState, range) {
        const startIndex = Math.max(0, range.startLine - 1);
        const endIndex = Math.max(startIndex, range.endLine);
        const snippet = documentState.lines.slice(startIndex, endIndex).join('\n');
        return snippet;
    }

    async handleReadDocument(session, payload = {}) {
        const documentState = await this.ensureDocumentState(session);
        const range = this.nextChunkRange(documentState, payload.range || null);

        if (!range) {
            this.emitAction('read_document', { range: null, message: 'reached_end' }, session);
            session.steps.push({
                type: 'read_document',
                input: payload,
                contextId: null,
                preview: '已达到文档末尾，无更多内容。',
            });
            return;
        }

        const snippet = this.sliceDocument(documentState, range);

        // 更新游标（仅当使用默认 chunk 时推进）
        if (!payload.range) {
            documentState.cursor = range.endLine;
        }

        const contextId = `doc-${session.contextPool.length + 1}`;
        const contextEntry = {
            id: contextId,
            type: 'document',
            range,
            content: snippet,
            summary: trimTextPreview(snippet, 200),
        };

        session.contextPool.push(contextEntry);
        session.steps.push({
            type: 'read_document',
            input: payload,
            contextId,
            preview: contextEntry.summary,
        });

        this.emitAction('read_document', { range, contextId, preview: contextEntry.summary }, session);
    }

    async handleDelegateToExecutor(session, payload = {}) {
        const contextEntries = this.prepareExecutorContexts(session, payload);

        const requestOptions = {
            prompt: payload.prompt || session.userPrompt,
            context: contextEntries,
            expectedFormat: payload.expectedFormat || null,
            history: session.conversationHistory,
        };

        const request = this.executor.buildRequest(requestOptions);

        let result;
        if (this.executeWithStreaming) {
            result = await this.executeWithStreaming(request, requestOptions);
        } else {
            result = await aiService.runTask(request);
        }

        session.lastExecutorAnswer = result?.content || '';
        session.steps.push({
            type: 'executor_result',
            answer: session.lastExecutorAnswer,
            taskId: result?.id,
        });

        this.emitAction('delegate_to_executor', { requestOptions, taskId: result?.id }, session);
    }

    prepareExecutorContexts(session, payload) {
        const contexts = [];

        if (Array.isArray(payload.context)) {
            payload.context.forEach(entry => {
                if (typeof entry === 'string') {
                    const matched = session.contextPool.find(item => item.id === entry);
                    if (matched) {
                        contexts.push({ label: this.buildContextLabel(matched), content: matched.content });
                    }
                } else if (entry && typeof entry === 'object') {
                    if (entry.id) {
                        const matched = session.contextPool.find(item => item.id === entry.id);
                        if (matched) {
                            contexts.push({
                                label: entry.label || this.buildContextLabel(matched),
                                content: matched.content,
                            });
                        }
                    } else if (entry.content) {
                        contexts.push({
                            label: entry.label || '补充上下文',
                            content: entry.content,
                        });
                    }
                }
            });
        }

        // 如果未指定上下文，但已有读取内容，则默认使用最近一次
        if (contexts.length === 0 && session.contextPool.length > 0) {
            const latest = session.contextPool[session.contextPool.length - 1];
            contexts.push({
                label: this.buildContextLabel(latest),
                content: latest.content,
            });
        }

        return contexts;
    }

    buildContextLabel(contextEntry) {
        if (contextEntry.range) {
            return `文档片段 第 ${contextEntry.range.startLine}-${contextEntry.range.endLine} 行`;
        }
        return '文档片段';
    }

    emitAction(event, payload, session) {
        if (!this.onAction) {
            return;
        }
        try {
            this.onAction({
                event,
                payload,
                session,
            });
        } catch (error) {
            console.warn('[DualAgentOrchestrator] onAction 回调失败', error);
        }
    }
}
