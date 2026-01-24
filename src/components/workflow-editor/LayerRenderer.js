import { confirm } from '@tauri-apps/plugin-dialog';
import { CardRenderer } from './CardRenderer.js';
import { CardForm } from './CardForm.js';

/**
 * 层级渲染器 - 负责渲染工作流的层级结构
 */
export class LayerRenderer {
    constructor(container, callbacks = {}) {
        this.container = container;
        this.callbacks = callbacks;
        this.layers = [];
        this.editingCardId = null;
        this.cardRenderers = new Map();
        this.layerStates = new Map(); // 存储 layer 执行状态
    }

    render(layers) {
        this.layers = layers || [];
        this.container.innerHTML = '';
        this.cardRenderers.clear();

        for (let i = 0; i < this.layers.length; i++) {
            const layer = this.layers[i];
            const layerEl = this.createLayerElement(layer, i + 1);
            this.container.appendChild(layerEl);
        }

    }

    createLayerElement(layer, index) {
        const el = document.createElement('div');
        el.className = 'workflow-layer';
        el.dataset.layerId = layer.id;

        // 层级头部
        const header = document.createElement('div');
        header.className = 'workflow-layer-header';
        header.innerHTML = `
            <span class="workflow-layer-title">Layer ${index}</span>
            <div class="workflow-layer-actions">
                <button class="workflow-btn workflow-btn-sm" data-action="execute-layer">▶ 执行</button>
                <button class="workflow-btn workflow-btn-sm workflow-btn-danger" data-action="stop-layer" style="display: none;">⏹ 停止</button>
                <button class="workflow-btn workflow-btn-sm" data-action="add-card">+ 卡片</button>
                <button class="workflow-btn workflow-btn-sm workflow-btn-danger" data-action="delete-layer">删除层</button>
            </div>
        `;

        header.querySelector('[data-action="execute-layer"]').addEventListener('click', () => {
            this.callbacks.onExecuteLayer?.(layer.id);
        });

        header.querySelector('[data-action="stop-layer"]').addEventListener('click', () => {
            this.callbacks.onCancelLayer?.(layer.id);
        });

        header.querySelector('[data-action="add-card"]').addEventListener('click', () => {
            this.callbacks.onAddCard?.(layer.id);
        });

        header.querySelector('[data-action="delete-layer"]').addEventListener('click', async () => {
            const confirmed = await confirm('确定要删除这个层级吗？', {
                title: '删除层级',
                kind: 'warning',
            });
            if (confirmed) {
                this.callbacks.onDeleteLayer?.(layer.id);
            }
        });

        el.appendChild(header);

        // 卡片容器
        const cardsContainer = document.createElement('div');
        cardsContainer.className = 'workflow-cards-container';

        for (const card of layer.cards) {
            const cardEl = this.createCardElement(card, layer);
            cardsContainer.appendChild(cardEl);
        }

        el.appendChild(cardsContainer);

        return el;
    }

    createCardElement(card, _layer) {
        const wrapper = document.createElement('div');
        wrapper.className = 'workflow-card-wrapper';
        wrapper.dataset.cardId = card.id;

        if (this.editingCardId === card.id) {
            // 编辑模式
            const form = new CardForm(wrapper, {
                card,
                layers: this.layers,
                onSave: (updates) => {
                    this.editingCardId = null;
                    this.callbacks.onCardUpdate?.(card.id, updates);
                },
                onDraftChange: (updates) => {
                    this.callbacks.onCardDraftChange?.(card.id, updates);
                },
                onCancel: () => {
                    this.editingCardId = null;
                    this.render(this.layers);
                },
            });
            form.render();
        } else {
            // 展示模式
            const renderer = new CardRenderer(wrapper, {
                card,
                onEdit: () => this.callbacks.onCardEdit?.(card.id),
                onDelete: () => this.callbacks.onCardDelete?.(card.id),
                onExecute: () => this.callbacks.onCardExecute?.(card.id),
                onCancel: () => this.callbacks.onCardCancel?.(card.id),
            });
            renderer.render();
            this.cardRenderers.set(card.id, renderer);
        }

        return wrapper;
    }

    setEditingCard(cardId) {
        const prevEditingCardId = this.editingCardId;
        this.editingCardId = cardId;

        // 恢复之前编辑的卡片到展示模式
        if (prevEditingCardId && prevEditingCardId !== cardId) {
            this.rerenderCard(prevEditingCardId);
        }

        // 切换当前卡片到编辑模式
        if (cardId) {
            this.rerenderCard(cardId);
        }
    }

    /**
     * 局部重新渲染单个卡片
     */
    rerenderCard(cardId) {
        const wrapper = this.container.querySelector(`[data-card-id="${cardId}"]`);
        if (!wrapper) return;

        // 找到对应的 card 数据
        let cardData = null;
        for (const layer of this.layers) {
            const found = layer.cards.find(c => c.id === cardId);
            if (found) {
                cardData = found;
                break;
            }
        }
        if (!cardData) return;

        // 清空并重新渲染
        wrapper.innerHTML = '';
        this.cardRenderers.delete(cardId);

        if (this.editingCardId === cardId) {
            // 编辑模式
            const form = new CardForm(wrapper, {
                card: cardData,
                layers: this.layers,
                onSave: (updates) => {
                    this.editingCardId = null;
                    this.callbacks.onCardUpdate?.(cardId, updates);
                },
                onDraftChange: (updates) => {
                    this.callbacks.onCardDraftChange?.(cardId, updates);
                },
                onCancel: () => {
                    this.editingCardId = null;
                    this.rerenderCard(cardId);
                },
            });
            form.render();
        } else {
            // 展示模式
            const renderer = new CardRenderer(wrapper, {
                card: cardData,
                onEdit: () => this.callbacks.onCardEdit?.(cardId),
                onDelete: () => this.callbacks.onCardDelete?.(cardId),
                onExecute: () => this.callbacks.onCardExecute?.(cardId),
                onCancel: () => this.callbacks.onCardCancel?.(cardId),
            });
            renderer.render();
            this.cardRenderers.set(cardId, renderer);
        }
    }

    /**
     * 在指定 layer 追加新卡片（局部更新）
     */
    appendCard(layerId, card) {
        const layerEl = this.container.querySelector(`[data-layer-id="${layerId}"]`);
        if (!layerEl) return;

        const cardsContainer = layerEl.querySelector('.workflow-cards-container');
        if (!cardsContainer) return;

        // 找到 layer 数据
        const layer = this.layers.find(l => l.id === layerId);
        if (!layer) return;

        const wrapper = document.createElement('div');
        wrapper.className = 'workflow-card-wrapper';
        wrapper.dataset.cardId = card.id;

        // 直接进入编辑模式
        this.editingCardId = card.id;
        const form = new CardForm(wrapper, {
            card,
            layers: this.layers,
            onSave: (updates) => {
                this.editingCardId = null;
                this.callbacks.onCardUpdate?.(card.id, updates);
            },
            onDraftChange: (updates) => {
                this.callbacks.onCardDraftChange?.(card.id, updates);
            },
            onCancel: () => {
                this.editingCardId = null;
                this.rerenderCard(card.id);
            },
        });
        form.render();

        cardsContainer.appendChild(wrapper);
    }

    /**
     * 删除卡片（局部更新）
     */
    removeCard(cardId) {
        const wrapper = this.container.querySelector(`[data-card-id="${cardId}"]`);
        if (wrapper) {
            wrapper.remove();
            this.cardRenderers.delete(cardId);
        }
    }

    updateCardState(cardId, state) {
        const renderer = this.cardRenderers.get(cardId);
        if (renderer) {
            renderer.updateState(state);
        }
    }

    updateLayerState(layerId, state) {
        this.layerStates.set(layerId, state);
        const layerEl = this.container.querySelector(`[data-layer-id="${layerId}"]`);
        if (!layerEl) return;

        const header = layerEl.querySelector('.workflow-layer-header');
        if (!header) return;

        // 移除旧的状态显示
        const oldStatus = header.querySelector('.workflow-layer-status');
        if (oldStatus) {
            oldStatus.remove();
        }

        // 添加新的状态显示
        const statusEl = document.createElement('span');
        statusEl.className = 'workflow-layer-status';

        if (state.status === 'running') {
            statusEl.classList.add('running');
            statusEl.textContent = '执行中...';
        } else if (state.status === 'done' && state.duration !== undefined) {
            statusEl.classList.add('done');
            statusEl.textContent = this.formatDuration(state.duration);
        } else if (state.status === 'cancelled' && state.duration !== undefined) {
            statusEl.classList.add('cancelled');
            statusEl.textContent = `已停止 (${this.formatDuration(state.duration)})`;
        }

        const titleEl = header.querySelector('.workflow-layer-title');
        if (titleEl) {
            titleEl.after(statusEl);
        }

        // 切换执行/停止按钮显示
        const executeBtn = header.querySelector('[data-action="execute-layer"]');
        const stopBtn = header.querySelector('[data-action="stop-layer"]');
        const isRunning = state.status === 'running';
        if (executeBtn) executeBtn.style.display = isRunning ? 'none' : '';
        if (stopBtn) stopBtn.style.display = isRunning ? '' : 'none';
    }

    formatDuration(ms) {
        if (ms < 1000) {
            return `${ms}ms`;
        } else if (ms < 60000) {
            return `${(ms / 1000).toFixed(1)}s`;
        } else {
            const minutes = Math.floor(ms / 60000);
            const seconds = ((ms % 60000) / 1000).toFixed(0);
            return `${minutes}m ${seconds}s`;
        }
    }

    clear() {
        this.layers = [];
        this.editingCardId = null;
        this.cardRenderers.clear();
        this.layerStates.clear();
        this.container.innerHTML = '';
    }
}
