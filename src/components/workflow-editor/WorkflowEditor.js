import { getAppServices } from '../../services/appServices.js';
import { LayerRenderer } from './LayerRenderer.js';
import { WorkflowToolbar } from './WorkflowToolbar.js';
import { ExecutionEngine } from './ExecutionEngine.js';

/**
 * Workflow 编辑器 - 卡片式工作流编辑器
 */
export class WorkflowEditor {
    constructor(containerElement, callbacks = {}, options = {}) {
        this.container = containerElement;
        this.callbacks = callbacks;
        this.options = options;
        this.documentSessions = options?.documentSessions || null;

        this.currentFile = null;
        this.workflowData = null;
        this.isDirty = false;
        this.isSaving = false;
        this.autoSaveTimer = null;
        this.autoSaveDelayMs = Number.isFinite(options.autoSaveDelayMs)
            ? Math.max(500, options.autoSaveDelayMs)
            : 1000;

        // 子组件
        this.toolbar = null;
        this.layerRenderer = null;
        this.executionEngine = null;
        this.layerStates = new Map();
        this.workflowState = null;

        // 编辑状态
        this.editingCardId = null;

        this.init();
    }

    isSessionActive(sessionId) {
        if (!sessionId) {
            return true;
        }
        if (!this.documentSessions || typeof this.documentSessions.isSessionActive !== 'function') {
            return true;
        }
        return this.documentSessions.isSessionActive(sessionId);
    }

    init() {
        this.container.classList.add('workflow-editor');
        this.container.innerHTML = `
            <div class="workflow-toolbar-container"></div>
            <div class="workflow-layers-container"></div>
        `;

        const toolbarContainer = this.container.querySelector('.workflow-toolbar-container');
        const layersContainer = this.container.querySelector('.workflow-layers-container');

        // 初始化工具栏
        this.toolbar = new WorkflowToolbar(toolbarContainer, {
            onAddLayer: () => this.addLayer(),
            onExecuteAll: () => this.executeAll(),
            onStopAll: () => this.cancelAll(),
            onExportMarkdown: () => this.exportMarkdown(),
            onSave: () => this.save(),
        });

        // 初始化层级渲染器
        this.layerRenderer = new LayerRenderer(layersContainer, {
            onCardEdit: (cardId) => this.startEditCard(cardId),
            onCardDelete: (cardId) => this.deleteCard(cardId),
            onCardExecute: (cardId) => this.executeCard(cardId),
            onCardCancel: (cardId) => this.cancelCard(cardId),
            onCardUpdate: (cardId, updates) => this.updateCard(cardId, updates),
            onCardDraftChange: (cardId, updates) => this.updateCardDraft(cardId, updates),
            onAddCard: (layerId) => this.addCard(layerId),
            onDeleteLayer: (layerId) => this.deleteLayer(layerId),
            onExecuteLayer: (layerId) => this.executeLayer(layerId),
            onCancelLayer: (layerId) => this.cancelLayer(layerId),
        });

        // 初始化执行引擎
        this.executionEngine = new ExecutionEngine({
            getWorkflowData: () => this.workflowData,
            onCardStateChange: (cardId, state) => this.updateCardState(cardId, state),
            onLayerStateChange: (layerId, state) => this.updateLayerState(layerId, state),
            onWorkflowStateChange: (state) => this.updateWorkflowState(state),
            readFile: (path) => this.readRelativeFile(path),
            getWorkflowDir: () => this.getWorkflowDir(),
        });
    }

    /**
     * 创建空的工作流数据
     */
    createEmptyWorkflow() {
        return {
            version: '1.0',
            meta: {
                title: '新建工作流',
                created: new Date().toISOString(),
                updated: new Date().toISOString(),
            },
            layers: [
                {
                    id: this.generateId('layer'),
                    cards: [
                        {
                            id: this.generateId('card'),
                            title: '任务目标',
                            type: 'input',
                            inputs: [],
                            config: { content: '' },
                            output: { mode: 'content' },
                        },
                    ],
                },
            ],
        };
    }

    /**
     * 加载工作流文件
     */
    async loadFile(session, filePath, content, options = {}) {
        this.currentFile = filePath;
        this.clearAutoSaveTimer();

        try {
            if (content && content.trim()) {
                this.workflowData = JSON.parse(content);
            } else {
                this.workflowData = this.createEmptyWorkflow();
            }
        } catch (error) {
            console.error('[WorkflowEditor] 解析工作流文件失败:', error);
            this.workflowData = this.createEmptyWorkflow();
        }

        // 重置所有 running 状态的卡片（进程已不存在）
        this.resetStaleRunningCards();

        this.isDirty = false;
        this.render();
    }

    /**
     * 重置加载时处于 running 状态的卡片
     * 因为进程在 app 关闭时已终止，需要清除过期的运行状态
     */
    resetStaleRunningCards() {
        if (!this.workflowData?.layers) return;

        for (const layer of this.workflowData.layers) {
            for (const card of layer.cards) {
                if (card._state?.status === 'running') {
                    card._state = {
                        ...card._state,
                        status: 'cancelled',
                        error: '执行被中断（应用已关闭）',
                    };
                }
            }
        }
    }

    /**
     * 渲染工作流
     */
    render() {
        if (!this.workflowData) {
            return;
        }
        const displayTitle = this.getDisplayTitle();
        this.toolbar.render({
            ...this.workflowData.meta,
            title: displayTitle || this.workflowData.meta?.title || '工作流',
        });
        this.layerRenderer.render(this.workflowData.layers);
    }

    /**
     * 保存工作流
     */
    async save(options = {}) {
        const { reason = 'manual', sessionId: explicitSessionId = null } = options;
        if (!this.currentFile || !this.workflowData) {
            return false;
        }
        if (this.currentFile.startsWith('untitled://')) {
            return false;
        }
        const targetSessionId = explicitSessionId ?? null;
        if (targetSessionId && !this.isSessionActive(targetSessionId)) {
            return false;
        }

        this.isSaving = true;
        try {
            const localWriteKey = this.currentFile;
            if (localWriteKey && this.documentSessions?.markLocalWrite) {
                this.documentSessions.markLocalWrite(localWriteKey);
            }
            this.workflowData.meta.updated = new Date().toISOString();
            const content = JSON.stringify(this.workflowData, null, 2);
            await getAppServices().file.writeText(this.currentFile, content);
            this.isDirty = false;
            this.callbacks.onContentChange?.();
            if (reason === 'auto') {
                Promise.resolve(this.callbacks.onAutoSaveSuccess?.({ filePath: this.currentFile })).catch(error => {
                    console.warn('[WorkflowEditor] 自动保存回调失败', error);
                });
            }
            return true;
        } catch (error) {
            if (this.documentSessions?.clearLocalWriteSuppression) {
                this.documentSessions.clearLocalWriteSuppression(this.currentFile);
            }
            console.error('[WorkflowEditor] 保存失败:', error);
            if (reason === 'auto') {
                Promise.resolve(this.callbacks.onAutoSaveError?.(error)).catch(err => {
                    console.warn('[WorkflowEditor] 自动保存失败回调异常', err);
                });
            }
            return false;
        } finally {
            this.isSaving = false;
        }
    }

    /**
     * 获取工作流 JSON
     */
    getContent() {
        if (!this.workflowData) {
            return '';
        }
        return JSON.stringify(this.workflowData, null, 2);
    }

    /**
     * 标记内容已修改
     */
    markDirty() {
        this.isDirty = true;
        this.callbacks.onContentChange?.();
        this.scheduleAutoSave();
    }

    /**
     * 检查是否有未保存的更改
     */
    hasUnsavedChanges() {
        return this.isDirty;
    }

    clearAutoSaveTimer() {
        if (this.autoSaveTimer) {
            clearTimeout(this.autoSaveTimer);
            this.autoSaveTimer = null;
        }
    }

    scheduleAutoSave() {
        if (!this.autoSaveDelayMs || this.autoSaveDelayMs < 0) {
            return;
        }
        this.clearAutoSaveTimer();
        const sessionId = this.documentSessions?.getActiveSession?.()?.id ?? null;
        this.autoSaveTimer = setTimeout(() => {
            this.autoSaveTimer = null;
            void this.handleAutoSaveTrigger(sessionId);
        }, this.autoSaveDelayMs);
    }

    async handleAutoSaveTrigger(targetSessionId = null) {
        if (targetSessionId && !this.isSessionActive(targetSessionId)) {
            return;
        }
        if (this.isSaving) {
            this.scheduleAutoSave();
            return;
        }
        if (!this.isDirty || !this.currentFile) {
            return;
        }
        if (this.currentFile.startsWith('untitled://')) {
            return;
        }
        const result = await this.save({ reason: 'auto', sessionId: targetSessionId });
        if (!result && this.isDirty) {
            this.scheduleAutoSave();
        }
    }

    // ========== 层级操作 ==========

    addLayer() {
        if (!this.workflowData) return;

        const newLayer = {
            id: this.generateId('layer'),
            cards: [
                {
                    id: this.generateId('card'),
                    title: '新卡片',
                    type: 'input',
                    inputs: [],
                    config: { content: '' },
                    output: { mode: 'content' },
                },
            ],
        };

        this.workflowData.layers.push(newLayer);
        this.markDirty();
        this.render();

        // 滚动到新添加的层
        const layersContainer = this.container.querySelector('.workflow-layers-container');
        const newLayerEl = layersContainer?.querySelector(`[data-layer-id="${newLayer.id}"]`);
        newLayerEl?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    deleteLayer(layerId) {
        if (!this.workflowData) return;

        const index = this.workflowData.layers.findIndex((l) => l.id === layerId);
        if (index !== -1) {
            this.workflowData.layers.splice(index, 1);
            this.markDirty();
            this.render();
        }
    }

    // ========== 卡片操作 ==========

    findCard(cardId) {
        if (!this.workflowData) return null;
        for (const layer of this.workflowData.layers) {
            const card = layer.cards.find((c) => c.id === cardId);
            if (card) {
                return { card, layer };
            }
        }
        return null;
    }

    addCard(layerId) {
        if (!this.workflowData) return;

        const layer = this.workflowData.layers.find((l) => l.id === layerId);
        if (!layer) return;

        const newCard = {
            id: this.generateId('card'),
            title: '新卡片',
            type: 'input',
            inputs: [],
            config: { content: '' },
            output: { mode: 'content' },
        };

        layer.cards.push(newCard);
        this.markDirty();
        this.render();
    }

    deleteCard(cardId) {
        if (!this.workflowData) return;

        for (const layer of this.workflowData.layers) {
            const index = layer.cards.findIndex((c) => c.id === cardId);
            if (index !== -1) {
                layer.cards.splice(index, 1);
                this.markDirty();
                this.render();
                return;
            }
        }
    }

    startEditCard(cardId) {
        this.editingCardId = cardId;
        this.layerRenderer.setEditingCard(cardId);
    }

    updateCard(cardId, updates) {
        const found = this.findCard(cardId);
        if (!found) return;

        this.applyCardUpdates(found.card, updates);
        this.markDirty();
        this.render();
    }

    updateCardDraft(cardId, updates) {
        const found = this.findCard(cardId);
        if (!found) return;

        this.applyCardUpdates(found.card, updates);
        this.markDirty();
    }

    updateCardState(cardId, state) {
        const found = this.findCard(cardId);
        if (!found) return;

        found.card._state = state;
        this.layerRenderer.updateCardState(cardId, state);

        // 执行开始时滚动到该卡片所在的层
        if (state.status === 'running') {
            const layersContainer = this.container.querySelector('.workflow-layers-container');
            const layerEl = layersContainer?.querySelector(`[data-layer-id="${found.layer.id}"]`);
            layerEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }

    updateLayerState(layerId, state) {
        this.layerStates.set(layerId, state);
        this.layerRenderer.updateLayerState(layerId, state);
    }

    updateWorkflowState(state) {
        this.workflowState = state;
        this.toolbar.updateWorkflowState(state);
    }

    // ========== 执行操作 ==========

    async executeCard(cardId) {
        await this.executionEngine.executeCard(cardId);
    }

    async cancelCard(cardId) {
        const cancelled = await this.executionEngine.cancelCard(cardId);
        // 无论是否成功终止进程，都更新 card 状态
        // 处理场景：app 关闭后重新打开，PTY 进程已不存在但 card 仍显示 running
        const found = this.findCard(cardId);
        if (found?.card?._state?.status === 'running') {
            this.updateCardState(cardId, {
                status: 'cancelled',
                error: cancelled ? '已终止' : '执行被中断',
            });
        }
    }

    async executeAll() {
        await this.executionEngine.executeAll();
    }

    async cancelAll() {
        await this.executionEngine.cancelAll();
        const runningLayerId = this.getRunningLayerId();
        if (runningLayerId) {
            const layer = this.workflowData?.layers?.find((l) => l.id === runningLayerId) || null;
            if (layer) {
                for (const card of layer.cards) {
                    if (card._state?.status === 'running') {
                        this.updateCardState(card.id, {
                            status: 'cancelled',
                            error: '已终止',
                        });
                    }
                }
                const priorState = this.layerStates.get(runningLayerId);
                const startTime = priorState?.startTime;
                const duration = typeof startTime === 'number' ? (Date.now() - startTime) : undefined;
                this.updateLayerState(runningLayerId, {
                    status: 'cancelled',
                    ...(duration !== undefined ? { duration } : {}),
                });
            }
        }
        const workflowStartTime = this.workflowState?.startTime;
        const workflowDuration = typeof workflowStartTime === 'number'
            ? (Date.now() - workflowStartTime)
            : undefined;
        this.updateWorkflowState({
            status: 'cancelled',
            ...(workflowDuration !== undefined ? { duration: workflowDuration } : {}),
        });
    }

    async executeLayer(layerId) {
        await this.executionEngine.executeLayer(layerId);
    }

    async cancelLayer(layerId) {
        const layer = this.workflowData?.layers?.find((l) => l.id === layerId) || null;
        if (layer) {
            for (const card of layer.cards) {
                if (card._state?.status === 'running') {
                    this.updateCardState(card.id, {
                        status: 'cancelled',
                        error: '已终止',
                    });
                }
            }
            const priorState = this.layerStates.get(layerId);
            const startTime = priorState?.startTime;
            const duration = typeof startTime === 'number' ? (Date.now() - startTime) : undefined;
            this.updateLayerState(layerId, {
                status: 'cancelled',
                ...(duration !== undefined ? { duration } : {}),
            });
        }
        await this.executionEngine.cancelLayer(layerId);
    }

    getRunningLayerId() {
        for (const [layerId, state] of this.layerStates.entries()) {
            if (state?.status === 'running') {
                return layerId;
            }
        }
        if (!this.workflowData?.layers) {
            return null;
        }
        for (const layer of this.workflowData.layers) {
            if (layer.cards.some((card) => card._state?.status === 'running')) {
                return layer.id;
            }
        }
        return null;
    }

    // ========== 导出 ==========

    async exportMarkdown() {
        if (!this.workflowData) return;

        let md = `# ${this.workflowData.meta.title || '工作流'}\n\n`;

        for (const layer of this.workflowData.layers) {
            for (const card of layer.cards) {
                md += `## ${card.title}\n\n`;
                const content = card._state?.result || card.config?.content || '';
                if (content) {
                    md += `${content}\n\n`;
                }
            }
        }

        // 复制到剪贴板
        try {
            await navigator.clipboard.writeText(md);
            alert('已复制到剪贴板');
        } catch (error) {
            console.error('[WorkflowEditor] 复制失败:', error);
        }
    }

    // ========== 工具方法 ==========

    getDisplayTitle() {
        if (!this.currentFile || this.currentFile.startsWith('untitled://')) {
            return '';
        }
        const normalized = typeof this.currentFile === 'string' ? this.currentFile : '';
        const parts = normalized.split(/[/\\]/);
        const fileName = parts[parts.length - 1] || '';
        if (!fileName) {
            return '';
        }
        const lower = fileName.toLowerCase();
        if (lower.endsWith('.mflow')) {
            return fileName.slice(0, -'.mflow'.length) || fileName;
        }
        const dotIndex = fileName.lastIndexOf('.');
        if (dotIndex > 0) {
            return fileName.slice(0, dotIndex);
        }
        return fileName;
    }

    getWorkflowDir() {
        if (!this.currentFile || this.currentFile.startsWith('untitled://')) {
            return null;
        }
        const normalized = typeof this.currentFile === 'string' ? this.currentFile : '';
        const lastSlash = normalized.lastIndexOf('/');
        if (lastSlash === -1) {
            return null;
        }
        return normalized.slice(0, lastSlash);
    }

    applyCardUpdates(card, updates = {}) {
        if (!card || !updates) {
            return;
        }
        if (Object.prototype.hasOwnProperty.call(updates, 'title')) {
            card.title = updates.title;
        }
        if (Object.prototype.hasOwnProperty.call(updates, 'type')) {
            card.type = updates.type;
        }
        if (Object.prototype.hasOwnProperty.call(updates, 'config')) {
            card.config = updates.config || {};
        }
        if (Object.prototype.hasOwnProperty.call(updates, 'inputs')) {
            card.inputs = updates.inputs || [];
        }
        if (Object.prototype.hasOwnProperty.call(updates, 'output')) {
            card.output = updates.output || { mode: 'content' };
        }
    }

    generateId(prefix) {
        return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    }

    async readRelativeFile(relativePath) {
        if (!this.currentFile) return '';

        const dir = this.currentFile.substring(0, this.currentFile.lastIndexOf('/'));
        const fullPath = `${dir}/${relativePath.replace(/^\.\//, '')}`;

        try {
            return await getAppServices().file.readText(fullPath);
        } catch (error) {
            console.error('[WorkflowEditor] 读取文件失败:', error);
            return '';
        }
    }

    // ========== 生命周期 ==========

    clear() {
        this.currentFile = null;
        this.workflowData = null;
        this.isDirty = false;
        this.editingCardId = null;
        this.clearAutoSaveTimer();
        this.layerRenderer?.clear();
    }

    hide() {
        this.container.style.display = 'none';
    }

    show() {
        this.container.style.display = 'flex';
    }

    destroy() {
        this.clear();
        this.container.innerHTML = '';
    }
}
