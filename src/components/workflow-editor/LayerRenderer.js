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
        this.layers = Array.isArray(layers) ? [...layers] : [];
        this.container.innerHTML = '';
        this.cardRenderers.clear();

        for (let i = 0; i < this.layers.length; i++) {
            const layer = this.layers[i];
            const layerEl = this.createLayerElement(layer, i + 1);
            this.container.appendChild(layerEl);
        }

        // 恢复 layer 执行状态
        // 优先使用运行时状态（layerStates），其次使用持久化状态（layer._state）
        for (const layer of this.layers) {
            const runtimeState = this.layerStates.get(layer.id);
            const persistedState = layer._state;
            const state = runtimeState || persistedState;
            if (state) {
                // 同步到 layerStates（确保后续更新能正确工作）
                if (!runtimeState && persistedState) {
                    this.layerStates.set(layer.id, persistedState);
                }
                this.applyLayerStateToDOM(layer.id, state);
            }
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
                <div class="workflow-layer-move-dropdown">
                    <button class="workflow-btn workflow-btn-sm" data-action="move-layer">移动</button>
                    <div class="workflow-layer-move-menu"></div>
                </div>
                <button class="workflow-btn workflow-btn-sm" data-action="execute-layer">▶ 执行</button>
                <button class="workflow-btn workflow-btn-sm workflow-btn-danger" data-action="stop-layer" style="display: none;">⏹ 停止</button>
                <button class="workflow-btn workflow-btn-sm" data-action="add-card">+ 卡片</button>
                <button class="workflow-btn workflow-btn-sm workflow-btn-danger" data-action="delete-layer">删除层</button>
            </div>
        `;

        // 移动按钮下拉菜单
        const moveDropdown = header.querySelector('.workflow-layer-move-dropdown');
        const moveBtn = header.querySelector('[data-action="move-layer"]');
        const moveMenu = header.querySelector('.workflow-layer-move-menu');

        moveBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            // 关闭其他已打开的菜单
            document.querySelectorAll('.workflow-layer-move-menu.show').forEach(menu => {
                if (menu !== moveMenu) menu.classList.remove('show');
            });
            // 生成菜单选项
            this.populateMoveMenu(moveMenu, layer.id);

            // 计算菜单位置（使用 fixed 定位）
            const btnRect = moveBtn.getBoundingClientRect();
            moveMenu.style.top = `${btnRect.bottom + 4}px`;
            moveMenu.style.left = `${btnRect.left}px`;

            moveMenu.classList.toggle('show');
        });

        // 点击外部关闭菜单
        document.addEventListener('click', (e) => {
            if (!moveDropdown.contains(e.target)) {
                moveMenu.classList.remove('show');
            }
        });

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
                    this.rerenderCard(card.id);
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

    /**
     * 删除层级（局部更新）
     */
    removeLayer(layerId) {
        const layerEl = this.container.querySelector(`[data-layer-id="${layerId}"]`);
        if (!layerEl) return;

        // 先清理该层内所有卡片的 renderer
        const layer = this.layers.find(l => l.id === layerId);
        if (layer) {
            for (const card of layer.cards) {
                this.cardRenderers.delete(card.id);
            }
        }

        // 从 layers 数组中移除
        const index = this.layers.findIndex(l => l.id === layerId);
        if (index !== -1) {
            this.layers.splice(index, 1);
        }

        // 清理 layer 状态
        this.layerStates.delete(layerId);

        // 移除 DOM 元素
        layerEl.remove();

        // 更新剩余层的标题序号
        this.updateLayerIndices();
    }

    /**
     * 更新所有层的序号显示
     */
    updateLayerIndices() {
        const layerEls = this.container.querySelectorAll('.workflow-layer');
        layerEls.forEach((el, i) => {
            const titleEl = el.querySelector('.workflow-layer-title');
            if (titleEl) {
                titleEl.textContent = `Layer ${i + 1}`;
            }
        });
    }

    /**
     * 生成移动菜单选项
     */
    populateMoveMenu(menuEl, layerId) {
        menuEl.innerHTML = '';
        const currentIndex = this.layers.findIndex(l => l.id === layerId);
        if (currentIndex === -1) return;

        for (let i = 0; i < this.layers.length; i++) {
            if (i === currentIndex) continue; // 跳过当前位置

            const item = document.createElement('div');
            item.className = 'workflow-layer-move-item';
            item.textContent = `移到位置 ${i + 1}`;
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                menuEl.classList.remove('show');
                this.callbacks.onMoveLayer?.(layerId, i);
            });
            menuEl.appendChild(item);
        }

        // 如果只有一个 layer，显示提示
        if (this.layers.length <= 1) {
            const item = document.createElement('div');
            item.className = 'workflow-layer-move-item disabled';
            item.textContent = '没有其他位置';
            menuEl.appendChild(item);
        }
    }

    /**
     * 移动层级到指定位置（局部更新）
     * @param {string} layerId - 要移动的层 ID
     * @param {number} fromIndex - 原位置索引
     * @param {number} toIndex - 目标位置索引
     */
    moveLayer(layerId, fromIndex, toIndex) {
        if (fromIndex === toIndex) return;

        const layerEl = this.container.querySelector(`[data-layer-id="${layerId}"]`);
        if (!layerEl) return;

        const allLayerEls = Array.from(this.container.querySelectorAll('.workflow-layer'));

        if (toIndex === 0) {
            this.container.insertBefore(layerEl, this.container.firstChild);
        } else if (toIndex >= allLayerEls.length - 1) {
            this.container.appendChild(layerEl);
        } else {
            // 找到目标位置的参考元素
            const refEl = fromIndex < toIndex
                ? allLayerEls[toIndex + 1]
                : allLayerEls[toIndex];
            this.container.insertBefore(layerEl, refEl);
        }

        const movedLayer = this.layers.splice(fromIndex, 1)[0];
        if (movedLayer) {
            this.layers.splice(toIndex, 0, movedLayer);
        }

        // 更新所有层的序号
        this.updateLayerIndices();
    }

    /**
     * 追加新层级（局部更新）
     */
    appendLayer(layer) {
        this.layers.push(layer);
        const index = this.layers.length;
        const layerEl = this.createLayerElement(layer, index);
        this.container.appendChild(layerEl);

        // 新层内的第一个卡片直接进入编辑模式
        if (layer.cards?.length > 0) {
            const firstCard = layer.cards[0];
            this.editingCardId = firstCard.id;
            this.rerenderCard(firstCard.id);
        }

        return layerEl;
    }

    updateCardState(cardId, state) {
        const renderer = this.cardRenderers.get(cardId);
        if (renderer) {
            renderer.updateState(state);
        }
    }

    updateLayerState(layerId, state) {
        this.layerStates.set(layerId, state);
        this.applyLayerStateToDOM(layerId, state);
    }

    /**
     * 将 layer 状态应用到 DOM（不修改 layerStates）
     */
    applyLayerStateToDOM(layerId, state) {
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
