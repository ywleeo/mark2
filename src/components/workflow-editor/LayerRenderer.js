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
                <button class="workflow-btn workflow-btn-sm" data-action="add-card">+ 卡片</button>
                <button class="workflow-btn workflow-btn-sm workflow-btn-danger" data-action="delete-layer">删除层</button>
            </div>
        `;

        header.querySelector('[data-action="execute-layer"]').addEventListener('click', () => {
            this.callbacks.onExecuteLayer?.(layer.id);
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

    createCardElement(card, layer) {
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
        this.editingCardId = cardId;
        this.render(this.layers);
    }

    updateCardState(cardId, state) {
        const renderer = this.cardRenderers.get(cardId);
        if (renderer) {
            renderer.updateState(state);
        }
    }

    clear() {
        this.layers = [];
        this.editingCardId = null;
        this.cardRenderers.clear();
        this.container.innerHTML = '';
    }
}
