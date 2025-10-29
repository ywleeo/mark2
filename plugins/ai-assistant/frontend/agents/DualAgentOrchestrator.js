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
        this.document = options.document || null;
        this.fallbackReadDocument = options.fallbackReadDocument || null;
        this.maxIterations = options.maxIterations || DEFAULT_MAX_ITERATIONS;
        this.chunkSize = options.chunkSize || DEFAULT_CHUNK_SIZE;
        this.executeWithStreaming = options.executeWithStreaming || null;
        this.onAction = typeof options.onAction === 'function' ? options.onAction : null;
        this.availableActions = ['read_document', 'delegate_to_executor', 'finish'];

        if (this.document) {
            if (typeof this.document.insertAfter === 'function') {
                this.availableActions.push('insert_after_range');
            }
            if (typeof this.document.replaceRange === 'function') {
                this.availableActions.push('replace_range');
            }
            if (typeof this.document.append === 'function') {
                this.availableActions.push('append_to_document');
            }
        }
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
                case 'insert_after_range':
                    await this.handleInsertAfterRange(session, decision.payload);
                    break;
                case 'replace_range':
                    await this.handleReplaceRange(session, decision.payload);
                    break;
                case 'append_to_document':
                    await this.handleAppendToDocument(session, decision.payload);
                    break;
                case 'finish': {
                    if (!decision.payload) {
                        decision.payload = {};
                    }

                    const hasExecutorAnswer =
                        typeof session.lastExecutorAnswer === 'string' && session.lastExecutorAnswer.trim().length > 0;
                    const alreadyDelegated = session.steps.some(step => step.type === 'executor_result');

                    if (!alreadyDelegated || !hasExecutorAnswer) {
                        const fallbackPayload = {
                            ...decision.payload,
                            prompt: decision.payload.prompt || session.userPrompt,
                        };
                        await this.handleDelegateToExecutor(session, fallbackPayload);
                    }


                    if (!decision.payload.answer || !decision.payload.answer.trim?.()) {
                        decision.payload.answer = session.lastExecutorAnswer || '';
                    }

                    session.status = 'finished';
                    const finishAnswer = decision.payload?.answer;
                    const metadataReasoning = decision.metadata?.reasoning;
                    session.finalAnswer = typeof finishAnswer === 'string' && finishAnswer.trim()
                        ? finishAnswer.trim()
                        : (
                            session.lastExecutorAnswer?.trim
                                ? session.lastExecutorAnswer.trim()
                                : (typeof metadataReasoning === 'string' ? metadataReasoning.trim() : '')
                        );
                    session.finishMetadata = {
                        notes: decision.payload?.notes,
                        metadata: decision.metadata || {},
                    };
                    return session;
                }
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
                if (step.type === 'document_mutation') {
                    return {
                        type: 'document_mutation',
                        action: step.action,
                        range: step.result?.appliedRange || step.payload?.range || null,
                        preview: trimTextPreview(step.content || step.result?.preview || '', 160),
                    };
                }
                return step;
            }),
            constraints: {
                availableActions: this.availableActions.slice(),
                chunkSize: this.chunkSize,
                remainingIterations: Math.max(0, this.maxIterations - session.steps.filter(step => step.type === 'coordinator').length),
                documentState: {
                    cursor: session.documentState?.cursor ?? 0,
                    totalLines: session.documentState?.totalLines ?? null,
                },
                documentCapabilities: {
                    canWrite: !!this.document,
                    supportedMutations: this.availableActions.filter(action => (
                        action === 'insert_after_range'
                        || action === 'replace_range'
                        || action === 'append_to_document'
                    )),
                },
            },
            lastExecutorAnswer: session.lastExecutorAnswer,
        };
    }

    async ensureFallbackDocumentState(session) {
        if (session.documentState) {
            return session.documentState;
        }

        if (!this.fallbackReadDocument) {
            throw new Error('未提供读取文档的能力');
        }

        const documentContent = await this.fallbackReadDocument();
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
        if (this.document && typeof this.document.readRange === 'function') {
            await this.handleReadDocumentViaDocumentIO(session, payload);
            return;
        }
        await this.handleReadDocumentViaFallback(session, payload);
    }

    async handleReadDocumentViaFallback(session, payload = {}) {
        const documentState = await this.ensureFallbackDocumentState(session);
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

    async handleReadDocumentViaDocumentIO(session, payload = {}) {
        const state = session.documentState || { cursor: 0, totalLines: null };
        session.documentState = state;

        let requestedRange = null;
        if (payload?.range && typeof payload.range.startLine === 'number') {
            const specifiedEnd = typeof payload.range.endLine === 'number'
                ? payload.range.endLine
                : payload.range.startLine + this.chunkSize - 1;
            requestedRange = {
                startLine: Math.max(1, Math.floor(payload.range.startLine)),
                endLine: Math.max(Math.floor(payload.range.startLine), Math.floor(specifiedEnd)),
            };
        } else {
            const startLine = Math.max(1, (state.cursor || 0) + 1);
            const endLine = startLine + this.chunkSize - 1;
            requestedRange = { startLine, endLine };
        }

        let result;
        try {
            result = await this.document.readRange({ range: requestedRange });
        } catch (error) {
            if (this.fallbackReadDocument) {
                console.warn('[DualAgentOrchestrator] DocumentIO 读取失败，回退到本地实现:', error);
                await this.handleReadDocumentViaFallback(session, payload);
                return;
            }
            throw error;
        }

        const effectiveRange = result?.range || requestedRange;
        const snippet = result?.content || '';
        const totalLines = typeof result?.totalLines === 'number' ? result.totalLines : state.totalLines;

        if ((!snippet || !snippet.trim()) && totalLines) {
            if (!payload.range && effectiveRange?.endLine) {
                state.cursor = effectiveRange.endLine;
            }
            session.steps.push({
                type: 'read_document',
                input: payload,
                contextId: null,
                preview: '没有新的内容可读取。',
            });
            this.emitAction('read_document', { range: effectiveRange, message: 'empty' }, session);
            return;
        }

        const contextId = `doc-${session.contextPool.length + 1}`;
        const summary = trimTextPreview(snippet, 200);

        session.contextPool.push({
            id: contextId,
            type: 'document',
            range: effectiveRange,
            content: snippet,
            summary,
        });
        session.steps.push({
            type: 'read_document',
            input: payload,
            contextId,
            preview: summary,
        });

        if (!payload.range && effectiveRange?.endLine) {
            state.cursor = effectiveRange.endLine;
        }
        if (typeof totalLines === 'number') {
            state.totalLines = totalLines;
        }

        this.emitAction('read_document', { range: effectiveRange, contextId, preview: summary }, session);
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

    resolveContentForMutation(session, payload = {}) {
        if (Object.prototype.hasOwnProperty.call(payload || {}, 'content') && typeof payload.content === 'string') {
            return payload.content;
        }

        const collected = [];

        if (typeof payload?.contextId === 'string') {
            collected.push(payload.contextId);
        }

        if (Array.isArray(payload?.contextIds)) {
            collected.push(...payload.contextIds.filter(id => typeof id === 'string'));
        }

        if (Array.isArray(payload?.context)) {
            payload.context.forEach(entry => {
                if (typeof entry === 'string') {
                    collected.push(entry);
                } else if (entry && typeof entry === 'object' && typeof entry.id === 'string') {
                    collected.push(entry.id);
                }
            });
        }

        for (const contextId of collected) {
            const matched = session.contextPool.find(item => item.id === contextId);
            if (matched?.content) {
                return matched.content;
            }
        }

        const useLastAnswer = payload?.useLastExecutorAnswer !== false || payload?.source === 'last_executor_answer';
        if (useLastAnswer && session.lastExecutorAnswer && session.lastExecutorAnswer.trim()) {
            return session.lastExecutorAnswer;
        }

        return '';
    }

    updateDocumentStateAfterMutation(session, result) {
        if (!session.documentState) {
            session.documentState = { cursor: 0, totalLines: null };
        }

        if (result?.appliedRange?.endLine) {
            session.documentState.cursor = result.appliedRange.endLine;
        }

        if (typeof result?.totalLines === 'number') {
            session.documentState.totalLines = result.totalLines;
        }
    }

    async handleInsertAfterRange(session, payload = {}) {
        if (!this.document || typeof this.document.insertAfter !== 'function') {
            throw new Error('当前模式不支持 insert_after_range');
        }

        const content = this.resolveContentForMutation(session, payload);
        if (!content || !content.trim()) {
            throw new Error('insert_after_range 缺少可插入的内容');
        }

        const preview = trimTextPreview(content, 160);
        const result = await this.document.insertAfter({
            range: payload.range,
            content,
            justification: payload.justification,
            preview: payload.preview || preview,
        });

        session.steps.push({
            type: 'document_mutation',
            action: 'insert_after_range',
            payload,
            content,
            result,
        });
        this.updateDocumentStateAfterMutation(session, result);
        this.emitAction('insert_after_range', {
            range: payload.range || null,
            appliedRange: result?.appliedRange || null,
            preview,
        }, session);
    }

    async handleReplaceRange(session, payload = {}) {
        if (!this.document || typeof this.document.replaceRange !== 'function') {
            throw new Error('当前模式不支持 replace_range');
        }

        const content = this.resolveContentForMutation(session, payload);
        const preview = trimTextPreview(content || '(空)', 160);

        const result = await this.document.replaceRange({
            range: payload.range,
            content,
            justification: payload.justification,
            preview: payload.preview || preview,
        });

        session.steps.push({
            type: 'document_mutation',
            action: 'replace_range',
            payload,
            content,
            result,
        });
        this.updateDocumentStateAfterMutation(session, result);
        this.emitAction('replace_range', {
            range: payload.range || null,
            appliedRange: result?.appliedRange || null,
            preview,
        }, session);
    }

    async handleAppendToDocument(session, payload = {}) {
        if (!this.document || typeof this.document.append !== 'function') {
            throw new Error('当前模式不支持 append_to_document');
        }

        const content = this.resolveContentForMutation(session, payload);
        if (!content || !content.trim()) {
            throw new Error('append_to_document 缺少可写入的内容');
        }

        const preview = trimTextPreview(content, 160);
        const result = await this.document.append({
            content,
            justification: payload.justification,
            preview: payload.preview || preview,
        });

        session.steps.push({
            type: 'document_mutation',
            action: 'append_to_document',
            payload,
            content,
            result,
        });
        this.updateDocumentStateAfterMutation(session, result);
        this.emitAction('append_to_document', {
            appliedRange: result?.appliedRange || null,
            preview,
        }, session);
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
