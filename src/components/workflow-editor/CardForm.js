import { InputSelector } from './InputSelector.js';

/**
 * 卡片表单 - 负责卡片的编辑界面
 */
export class CardForm {
    constructor(container, options = {}) {
        this.container = container;
        this.card = { ...options.card };
        this.layers = options.layers || [];
        this.callbacks = {
            onSave: options.onSave,
            onDraftChange: options.onDraftChange,
            onCancel: options.onCancel,
        };
        this.inputSelector = null;
        this.draftTimer = null;
        this.draftDelayMs = Number.isFinite(options.draftDelayMs)
            ? Math.max(200, options.draftDelayMs)
            : 300;
    }

    render() {
        this.container.innerHTML = `
            <div class="workflow-card-form">
                <div class="workflow-card-form-header">
                    <span class="icon">⚙️</span>
                    节点配置
                </div>

                <div class="workflow-form-group">
                    <label>卡片标题</label>
                    <input type="text" class="workflow-input" data-field="title"
                        placeholder="输入节点名称..." value="${this.escapeAttr(this.card.title || '')}">
                </div>

                <div class="workflow-form-group">
                    <label>卡片类型</label>
                    <div class="workflow-type-selector">
                        <button type="button" class="workflow-type-option ${this.card.type === 'input' ? 'active' : ''}" data-type="input">
                            <span class="icon">📝</span>
                            用户输入
                        </button>
                        <button type="button" class="workflow-type-option ${this.card.type === 'generate' ? 'active' : ''}" data-type="generate">
                            <span class="icon">🤖</span>
                            AI 生成
                        </button>
                        <button type="button" class="workflow-type-option ${this.card.type === 'execute' ? 'active' : ''}" data-type="execute">
                            <span class="icon">⚙️</span>
                            执行程序
                        </button>
                    </div>
                </div>

                <div class="workflow-form-group">
                    <div class="workflow-input-selector-header">
                        <label>输入来源</label>
                        <button type="button" class="workflow-btn-text" data-action="add-input">+ 添加输入</button>
                    </div>
                    <div class="workflow-input-selector-container"></div>
                </div>

                <div class="workflow-form-group workflow-config-section">
                    ${this.renderConfigSection()}
                </div>

                <div class="workflow-form-group">
                    <label>输出方式</label>
                    <div class="workflow-radio-group">
                        <label class="workflow-radio">
                            <input type="radio" name="outputMode" value="content" ${this.card.output?.mode !== 'file' ? 'checked' : ''}>
                            <span>仅内容（传给下一个卡片）</span>
                        </label>
                        <label class="workflow-radio">
                            <input type="radio" name="outputMode" value="file" ${this.card.output?.mode === 'file' ? 'checked' : ''}>
                            <span>保存到文件</span>
                        </label>
                    </div>
                    <div class="workflow-output-file-path ${this.card.output?.mode !== 'file' ? 'hidden' : ''}">
                        <input type="text" class="workflow-input" data-field="outputFilePath"
                            placeholder="输出文件路径" value="${this.escapeAttr(this.card.output?.filePath || '')}">
                    </div>
                </div>

                <div class="workflow-form-actions">
                    <button class="workflow-btn" data-action="cancel">取消</button>
                    <button class="workflow-btn workflow-btn-primary" data-action="save">完成</button>
                </div>
            </div>
        `;

        // 初始化输入选择器
        const selectorContainer = this.container.querySelector('.workflow-input-selector-container');
        this.inputSelector = new InputSelector(selectorContainer, {
            inputs: this.card.inputs || [],
            layers: this.layers,
            currentCardId: this.card.id,
            onChange: (inputs) => {
                this.card.inputs = inputs;
                this.scheduleDraftChange();
            },
        });
        this.inputSelector.render();

        this.bindEvents();
    }

    renderConfigSection() {
        if (this.card.type === 'input') {
            return `
                <label>内容</label>
                <textarea class="workflow-textarea" data-field="content" placeholder="输入内容...">${this.escapeHtml(this.card.config?.content || '')}</textarea>
            `;
        }

        if (this.card.type === 'generate') {
            return `
                <label>Prompt 模板 <small>(使用 {{input}} 引用输入内容)</small></label>
                <textarea class="workflow-textarea workflow-textarea-lg" data-field="prompt" placeholder="请输入 Prompt...">${this.escapeHtml(this.card.config?.prompt || '')}</textarea>
            `;
        }

        if (this.card.type === 'execute') {
            return `
                <label>执行命令</label>
                <div class="workflow-input-with-icon">
                    <span class="icon">💻</span>
                    <input type="text" class="workflow-input" data-field="command" placeholder="例如: node script.js" value="${this.escapeAttr(this.card.config?.command || '')}">
                </div>
                <label style="margin-top: 16px;">工作目录（可选）</label>
                <div class="workflow-input-with-icon">
                    <span class="icon">📁</span>
                    <input type="text" class="workflow-input" data-field="workingDir" placeholder="留空使用工作流文件所在目录" value="${this.escapeAttr(this.card.config?.workingDir || '')}">
                </div>
            `;
        }

        return '';
    }

    bindEvents() {
        // 类型切换（segmented control 按钮方式）
        this.container.querySelectorAll('.workflow-type-option').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                const newType = btn.dataset.type;
                if (newType === this.card.type) return;

                // 先保存当前表单中的内容
                this.saveCurrentConfig();

                // 更新活动状态
                this.container.querySelectorAll('.workflow-type-option').forEach((b) => b.classList.remove('active'));
                btn.classList.add('active');

                // 更新卡片类型，保留已有配置，只填充缺失字段
                this.card.type = newType;
                this.card.config = { ...this.getDefaultConfig(newType), ...this.card.config };
                const configSection = this.container.querySelector('.workflow-config-section');
                configSection.innerHTML = this.renderConfigSection();
                this.scheduleDraftChange();
            });
        });

        // 输出模式切换
        this.container.querySelectorAll('input[name="outputMode"]').forEach((radio) => {
            radio.addEventListener('change', (e) => {
                const filePathSection = this.container.querySelector('.workflow-output-file-path');
                if (e.target.value === 'file') {
                    filePathSection.classList.remove('hidden');
                } else {
                    filePathSection.classList.add('hidden');
                }
                this.scheduleDraftChange();
            });
        });

        // 表单输入变化（标题/内容/命令等）
        this.container.addEventListener('input', (event) => {
            if (this.shouldHandleDraftChange(event.target)) {
                this.scheduleDraftChange();
            }
        });
        this.container.addEventListener('change', (event) => {
            if (this.shouldHandleDraftChange(event.target)) {
                this.scheduleDraftChange();
            }
        });

        // 保存
        this.container.querySelector('[data-action="save"]').addEventListener('click', () => {
            this.save();
        });

        // 取消
        this.container.querySelector('[data-action="cancel"]').addEventListener('click', () => {
            this.clearDraftTimer();
            this.callbacks.onCancel?.();
        });
    }

    save() {
        this.clearDraftTimer();
        const title = this.container.querySelector('[data-field="title"]')?.value?.trim();
        const type = this.card.type; // 从已更新的 card 对象获取
        const outputMode = this.container.querySelector('input[name="outputMode"]:checked')?.value || 'content';
        const outputFilePath = this.container.querySelector('[data-field="outputFilePath"]')?.value?.trim();

        // 收集配置
        let config = {};
        if (type === 'input') {
            config.content = this.container.querySelector('[data-field="content"]')?.value || '';
        } else if (type === 'generate') {
            config.prompt = this.container.querySelector('[data-field="prompt"]')?.value || '';
        } else if (type === 'execute') {
            config.command = this.container.querySelector('[data-field="command"]')?.value || '';
            config.workingDir = this.container.querySelector('[data-field="workingDir"]')?.value || '';
        }

        const updates = this.buildUpdatesFromForm({
            titleFallback: title || '未命名卡片',
            outputMode,
            outputFilePath,
            config,
        });

        this.callbacks.onSave?.(updates);
    }

    buildUpdatesFromForm({ titleFallback, outputMode, outputFilePath, config }) {
        const title = typeof titleFallback === 'string' ? titleFallback : this.card.title;
        return {
            title,
            type: this.card.type,
            config,
            inputs: this.card.inputs,
            output: {
                mode: outputMode || 'content',
                ...(outputMode === 'file' && outputFilePath ? { filePath: outputFilePath } : {}),
            },
        };
    }

    scheduleDraftChange() {
        if (!this.callbacks.onDraftChange) {
            return;
        }
        if (this.draftTimer) {
            clearTimeout(this.draftTimer);
        }
        this.draftTimer = setTimeout(() => {
            this.draftTimer = null;
            const updates = this.collectDraftUpdates();
            if (updates) {
                this.applyDraftUpdates(updates);
                this.callbacks.onDraftChange?.(updates);
            }
        }, this.draftDelayMs);
    }

    clearDraftTimer() {
        if (this.draftTimer) {
            clearTimeout(this.draftTimer);
            this.draftTimer = null;
        }
    }

    collectDraftUpdates() {
        const rawTitle = this.container.querySelector('[data-field="title"]')?.value;
        const title = rawTitle?.trim() ? rawTitle.trim() : this.card.title;
        const type = this.card.type;
        const outputMode = this.container.querySelector('input[name="outputMode"]:checked')?.value || this.card.output?.mode || 'content';
        const outputFilePath = this.container.querySelector('[data-field="outputFilePath"]')?.value?.trim();
        let config = { ...this.card.config };
        if (type === 'input') {
            const content = this.container.querySelector('[data-field="content"]')?.value;
            if (content !== undefined) config.content = content;
        } else if (type === 'generate') {
            const prompt = this.container.querySelector('[data-field="prompt"]')?.value;
            if (prompt !== undefined) config.prompt = prompt;
        } else if (type === 'execute') {
            const command = this.container.querySelector('[data-field="command"]')?.value;
            const workingDir = this.container.querySelector('[data-field="workingDir"]')?.value;
            if (command !== undefined) config.command = command;
            if (workingDir !== undefined) config.workingDir = workingDir;
        }

        return {
            title,
            type,
            config,
            inputs: this.card.inputs,
            output: {
                mode: outputMode,
                ...(outputMode === 'file' && outputFilePath ? { filePath: outputFilePath } : {}),
            },
        };
    }

    applyDraftUpdates(updates) {
        if (!updates) return;
        this.card.title = updates.title;
        this.card.type = updates.type;
        this.card.config = updates.config || {};
        this.card.inputs = updates.inputs || [];
        this.card.output = updates.output || { mode: 'content' };
    }

    shouldHandleDraftChange(target) {
        if (!target) return false;
        if (target.matches('input, textarea, select')) {
            return true;
        }
        return Boolean(target.closest?.('[data-field]'));
    }

    /**
     * 保存当前表单中的配置到 this.card.config
     */
    saveCurrentConfig() {
        const type = this.card.type;
        if (type === 'input') {
            const content = this.container.querySelector('[data-field="content"]')?.value;
            if (content !== undefined) this.card.config.content = content;
        } else if (type === 'generate') {
            const prompt = this.container.querySelector('[data-field="prompt"]')?.value;
            if (prompt !== undefined) this.card.config.prompt = prompt;
        } else if (type === 'execute') {
            const command = this.container.querySelector('[data-field="command"]')?.value;
            const workingDir = this.container.querySelector('[data-field="workingDir"]')?.value;
            if (command !== undefined) this.card.config.command = command;
            if (workingDir !== undefined) this.card.config.workingDir = workingDir;
        }
    }

    getDefaultConfig(type) {
        if (type === 'input') {
            return { content: '' };
        }
        if (type === 'generate') {
            return { prompt: '' };
        }
        if (type === 'execute') {
            return { command: '', workingDir: '' };
        }
        return {};
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    escapeAttr(text) {
        if (!text) return '';
        return text.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
}
