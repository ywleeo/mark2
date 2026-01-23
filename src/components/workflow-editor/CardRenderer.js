import { confirm } from '@tauri-apps/plugin-dialog';

/**
 * 卡片渲染器 - 负责渲染单个卡片（展示模式）
 */
export class CardRenderer {
    constructor(container, options = {}) {
        this.container = container;
        this.card = options.card;
        this.callbacks = {
            onEdit: options.onEdit,
            onDelete: options.onDelete,
            onExecute: options.onExecute,
            onCancel: options.onCancel,
        };
    }

    render() {
        const card = this.card;
        const typeIcon = this.getTypeIcon(card.type);
        const statusBadge = this.getStatusBadge(card._state);
        const inputsDisplay = this.formatInputs(card.inputs);
        const isTerminalContent = this.isTerminalContent(card);
        const content = this.getCardContent(card);

        this.container.innerHTML = `
            <div class="workflow-card ${card._state?.status === 'running' ? 'is-running' : ''} ${card._state?.status === 'error' ? 'is-error' : ''}">
                <div class="workflow-card-header">
                    <span class="workflow-card-icon">${typeIcon}</span>
                    <span class="workflow-card-title">${this.escapeHtml(card.title)}</span>
                    <div class="workflow-card-actions">
                        <button class="workflow-btn workflow-btn-icon" data-action="edit" title="编辑">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                            </svg>
                        </button>
                        <button class="workflow-btn workflow-btn-icon workflow-btn-danger" data-action="delete" title="删除">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="3,6 5,6 21,6"/>
                                <path d="M19,6v14a2,2,0,0,1-2,2H7a2,2,0,0,1-2-2V6m3,0V4a2,2,0,0,1,2-2h4a2,2,0,0,1,2,2v2"/>
                            </svg>
                        </button>
                    </div>
                </div>
                ${inputsDisplay ? `<div class="workflow-card-inputs">${inputsDisplay}</div>` : ''}
                <div class="workflow-card-content ${isTerminalContent ? 'is-terminal' : ''}">
                    ${content}
                </div>
                <div class="workflow-card-footer">
                    ${statusBadge ? `<span class="workflow-card-status">${statusBadge}</span>` : ''}
                    <div class="workflow-card-footer-actions">
                        ${card._state?.result || card._state?.error ? `
                            <button class="workflow-btn workflow-btn-sm workflow-btn-ghost" data-action="copy" title="复制输出">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                                </svg>
                            </button>
                        ` : ''}
                        ${card.type === 'execute' && card._state?.status === 'running' ? `
                            <button class="workflow-btn workflow-btn-sm workflow-btn-danger" data-action="cancel">终止</button>
                        ` : ''}
                        ${card.type !== 'input' && card._state?.status !== 'running' ? `
                            <button class="workflow-btn workflow-btn-sm" data-action="execute">▶ 执行</button>
                        ` : ''}
                    </div>
                </div>
            </div>
        `;

        this.bindEvents();
        this.scrollToBottom();
    }

    scrollToBottom() {
        const content = this.container.querySelector('.workflow-card-content');
        if (content) {
            content.scrollTop = content.scrollHeight;
        }
    }

    bindEvents() {
        this.container.querySelector('[data-action="edit"]')?.addEventListener('click', () => {
            this.callbacks.onEdit?.();
        });

        this.container.querySelector('[data-action="delete"]')?.addEventListener('click', async () => {
            const confirmed = await confirm('确定要删除这个卡片吗？', {
                title: '删除卡片',
                kind: 'warning',
            });
            if (confirmed) {
                this.callbacks.onDelete?.();
            }
        });

        this.container.querySelector('[data-action="execute"]')?.addEventListener('click', () => {
            this.callbacks.onExecute?.();
        });

        this.container.querySelector('[data-action="cancel"]')?.addEventListener('click', () => {
            this.callbacks.onCancel?.();
        });

        this.container.querySelector('[data-action="copy"]')?.addEventListener('click', async (e) => {
            const content = this.card._state?.result || this.card._state?.error;
            if (!content) return;

            try {
                await navigator.clipboard.writeText(content);
                // 显示复制成功提示
                const btn = e.currentTarget;
                const originalTitle = btn.title;
                btn.title = '已复制!';
                btn.classList.add('copied');
                setTimeout(() => {
                    btn.title = originalTitle;
                    btn.classList.remove('copied');
                }, 1500);
            } catch (err) {
                console.error('复制失败:', err);
            }
        });
    }

    getTypeIcon(type) {
        const icons = {
            input: '📝',
            generate: '🤖',
            execute: '⚙️',
        };
        return icons[type] || '📄';
    }

    getStatusBadge(runtimeState) {
        if (runtimeState?.status === 'running') {
            return '<span class="status-badge status-running">🔄 执行中</span>';
        }
        if (runtimeState?.status === 'cancelled') {
            return '<span class="status-badge status-cancelled">⛔ 已终止</span>';
        }
        if (runtimeState?.status === 'error') {
            return '<span class="status-badge status-error">❌ 错误</span>';
        }
        if (runtimeState?.status === 'done') {
            return '<span class="status-badge status-done">✅ 完成</span>';
        }
        return '';
    }

    formatInputs(inputs) {
        if (!inputs || inputs.length === 0) {
            return '';
        }

        const formatted = inputs.map((input) => {
            if (input.type === 'card') {
                return `🔗 卡片: ${input.cardId}`;
            }
            if (input.type === 'layer') {
                return `🔗 层级: ${input.layerId}`;
            }
            if (input.type === 'file') {
                return `📁 文件: ${input.path}`;
            }
            return '未知输入';
        });

        return `输入: ${formatted.join(', ')}`;
    }

    getCardContent(card) {
        if (card.type === 'execute' && card._state?.status === 'running') {
            const hasStream = Array.isArray(card._state?.stream) && card._state.stream.length > 0;
            const hasOutput = Boolean(card._state?.stdout || card._state?.stderr);
            if (hasStream || hasOutput) {
                return this.renderTerminalOutput(card._state);
            }
        }

        // 如果有执行结果，显示结果
        if (card._state?.result) {
            // execute 类型用 terminal 风格
            if (card.type === 'execute') {
                return this.renderTerminalOutput(card._state);
            }
            return `<div class="workflow-card-result">${this.escapeHtml(card._state.result)}</div>`;
        }

        // 如果有错误，显示错误
        if (card._state?.error) {
            if (card.type === 'execute') {
                return `<div class="workflow-card-terminal workflow-card-terminal-error">${this.escapeHtml(card._state.error)}</div>`;
            }
            return `<div class="workflow-card-error">${this.escapeHtml(card._state.error)}</div>`;
        }

        // 根据类型显示配置内容
        if (card.type === 'input') {
            const content = card.config?.content || '';
            return content
                ? `<div class="workflow-card-text">${this.escapeHtml(content)}</div>`
                : '<div class="workflow-card-placeholder">点击编辑填写内容</div>';
        }

        if (card.type === 'generate') {
            const prompt = card.config?.prompt || '';
            return prompt
                ? `<div class="workflow-card-prompt"><strong>Prompt:</strong> ${this.escapeHtml(prompt.substring(0, 200))}${prompt.length > 200 ? '...' : ''}</div>`
                : '<div class="workflow-card-placeholder">点击编辑配置 Prompt</div>';
        }

        if (card.type === 'execute') {
            const command = card.config?.command || '';
            return command
                ? `<div class="workflow-card-command"><code>${this.escapeHtml(command)}</code></div>`
                : '<div class="workflow-card-placeholder">点击编辑配置命令</div>';
        }

        return '';
    }

    isTerminalContent(card) {
        if (card.type !== 'execute') {
            return false;
        }
        if (card._state?.error || card._state?.result) {
            return true;
        }
        const hasStream = Array.isArray(card._state?.stream) && card._state.stream.length > 0;
        const hasOutput = Boolean(card._state?.stdout || card._state?.stderr);
        return card._state?.status === 'running' && (hasStream || hasOutput);
    }

    renderTerminalOutput(state) {
        const stream = Array.isArray(state?.stream) ? state.stream : null;
        if (stream && stream.length > 0) {
            const content = stream
                .map((item) => {
                    const safeText = this.escapeHtml(item.text);
                    const cls = item.type === 'stderr'
                        ? 'workflow-card-terminal-stderr'
                        : 'workflow-card-terminal-stdout';
                    return `<span class="${cls}">${safeText}</span>`;
                })
                .join('');
            return `<div class="workflow-card-terminal">${content}</div>`;
        }
        const fallback = (state?.stdout || state?.stderr || state?.result || '').toString();
        return `<div class="workflow-card-terminal">${this.escapeHtml(fallback)}</div>`;
    }

    updateState(state) {
        this.card._state = state;
        this.render();
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}
