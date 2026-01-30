import { pickPaths } from '../../api/filesystem.js';

/**
 * 输入选择器 - 用于选择卡片的输入来源
 */
export class InputSelector {
    constructor(container, options = {}) {
        this.container = container;
        this.inputs = [...(options.inputs || [])];
        this.layers = options.layers || [];
        this.currentCardId = options.currentCardId;
        this.onChange = options.onChange;
    }

    render() {
        this.container.innerHTML = `
            <div class="workflow-input-selector">
                <div class="workflow-input-list"></div>
                <div class="workflow-input-dropdown hidden">
                    <div class="workflow-input-dropdown-content"></div>
                </div>
            </div>
        `;

        this.renderInputList();
        this.bindEvents();
    }

    renderInputList() {
        const listEl = this.container.querySelector('.workflow-input-list');
        if (!listEl) return;

        if (this.inputs.length === 0) {
            listEl.innerHTML = '<span class="workflow-input-empty">点击上方按钮添加输入源</span>';
            return;
        }

        listEl.innerHTML = this.inputs
            .map((input, index) => {
                const display = this.formatInputLabel(input);
                return `
                    <div class="workflow-input-item" data-index="${index}">
                        <span class="workflow-input-index">${index + 1}</span>
                        <span class="workflow-input-item-text">${display}</span>
                        <button class="remove-btn" data-action="remove" data-index="${index}">×</button>
                    </div>
                `;
            })
            .join('');

        // 绑定删除按钮
        listEl.querySelectorAll('[data-action="remove"]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const index = parseInt(e.target.dataset.index, 10);
                this.removeInput(index);
            });
        });
    }

    bindEvents() {
        const dropdown = this.container.querySelector('.workflow-input-dropdown');
        const dropdownContent = this.container.querySelector('.workflow-input-dropdown-content');

        // 从父容器中找到添加按钮（在 CardForm 的 header 中）
        const formContainer = this.container.closest('.workflow-card-form');
        const addBtn = formContainer?.querySelector('[data-action="add-input"]');

        addBtn?.addEventListener('click', () => {
            // 渲染下拉选项
            dropdownContent.innerHTML = this.renderDropdownOptions();
            dropdown.classList.toggle('hidden');

            // 绑定选项点击
            dropdownContent.querySelectorAll('.workflow-input-option').forEach((opt) => {
                opt.addEventListener('click', () => {
                    const type = opt.dataset.type;
                    const id = opt.dataset.id;

                    if (type === 'card') {
                        this.addInput({ type: 'card', cardId: id });
                    } else if (type === 'layer') {
                        this.addInput({ type: 'layer', layerId: id });
                    } else if (type === 'file') {
                        this.showFileInput();
                        return;
                    }

                    dropdown.classList.add('hidden');
                });
            });
        });

        // 点击外部关闭下拉框
        document.addEventListener('click', (e) => {
            if (!this.container.contains(e.target) && e.target !== addBtn) {
                dropdown?.classList.add('hidden');
            }
        });
    }

    renderDropdownOptions() {
        let html = '';

        // 层级选项
        html += '<div class="workflow-input-group-title">层级</div>';
        for (const layer of this.layers) {
            const layerIndex = this.layers.indexOf(layer) + 1;
            html += `
                <div class="workflow-input-option" data-type="layer" data-id="${layer.id}">
                    🔗 Layer ${layerIndex}
                </div>
            `;
        }

        // 卡片选项
        html += '<div class="workflow-input-group-title">卡片</div>';
        for (const layer of this.layers) {
            for (const card of layer.cards) {
                if (card.id === this.currentCardId) continue;
                html += `
                    <div class="workflow-input-option" data-type="card" data-id="${card.id}">
                        📄 ${this.escapeHtml(card.title)}
                    </div>
                `;
            }
        }

        // 文件选项
        html += '<div class="workflow-input-group-title">文件</div>';
        html += `
            <div class="workflow-input-option" data-type="file">
                📁 添加文件路径...
            </div>
        `;

        return html;
    }

    async showFileInput() {
        try {
            const selections = await pickPaths({
                multiple: false,
                allowFiles: true,
                allowDirectories: false,
            });
            const selectedPath = selections?.[0]?.path;
            if (selectedPath) {
                this.addInput({ type: 'file', path: selectedPath });
            }
        } catch (error) {
            console.warn('[InputSelector] 文件选择失败，回退到手动输入', error);
            const path = prompt('请输入文件绝对路径:');
            if (path && path.trim()) {
                this.addInput({ type: 'file', path: path.trim() });
            }
        } finally {
            this.container.querySelector('.workflow-input-dropdown')?.classList.add('hidden');
        }
    }

    addInput(input) {
        // 检查是否已存在
        const exists = this.inputs.some((i) => {
            if (i.type !== input.type) return false;
            if (i.type === 'card') return i.cardId === input.cardId;
            if (i.type === 'layer') return i.layerId === input.layerId;
            if (i.type === 'file') return i.path === input.path;
            return false;
        });

        if (!exists) {
            this.inputs.push(input);
            this.renderInputList();
            this.onChange?.(this.inputs);
        }
    }

    removeInput(index) {
        this.inputs.splice(index, 1);
        this.renderInputList();
        this.onChange?.(this.inputs);
    }

    formatInput(input) {
        if (input.type === 'card') {
            // 查找卡片标题
            for (const layer of this.layers) {
                const card = layer.cards.find((c) => c.id === input.cardId);
                if (card) {
                    return `🔗 卡片: ${this.escapeHtml(card.title)}`;
                }
            }
            return `🔗 卡片: ${input.cardId}`;
        }
        if (input.type === 'layer') {
            const index = this.layers.findIndex((l) => l.id === input.layerId);
            return `🔗 Layer ${index + 1}`;
        }
        if (input.type === 'file') {
            return `📁 ${input.path}`;
        }
        return '未知输入';
    }

    formatInputLabel(input) {
        if (input.type === 'card') {
            for (const layer of this.layers) {
                const card = layer.cards.find((c) => c.id === input.cardId);
                if (card) {
                    return this.escapeHtml(card.title);
                }
            }
            return input.cardId;
        }
        if (input.type === 'layer') {
            const index = this.layers.findIndex((l) => l.id === input.layerId);
            return `Layer ${index + 1}`;
        }
        if (input.type === 'file') {
            // 只显示文件名
            const parts = input.path.split('/');
            return parts[parts.length - 1] || input.path;
        }
        return '未知';
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}
