/**
 * 工作流工具栏
 */
export class WorkflowToolbar {
    constructor(container, callbacks = {}) {
        this.container = container;
        this.callbacks = callbacks;
        this.meta = null;
    }

    render(meta) {
        this.meta = meta || {};

        this.container.innerHTML = `
            <div class="workflow-toolbar">
                <div class="workflow-toolbar-left">
                    <h2 class="workflow-title">${this.escapeHtml(this.meta.title || '工作流')}</h2>
                    <span class="workflow-status"></span>
                </div>
                <div class="workflow-toolbar-right">
                    <button class="workflow-btn" data-action="add-layer">
                        <span>+ 添加层</span>
                    </button>
                    <button class="workflow-btn" data-action="execute-all">
                        <span>▶ 执行全部</span>
                    </button>
                    <button class="workflow-btn" data-action="resume" style="display: none;">
                        <span>▶ 继续执行</span>
                    </button>
                    <button class="workflow-btn workflow-btn-danger" data-action="stop-all" style="display: none;">
                        <span>⏹ 停止</span>
                    </button>
                    <button class="workflow-btn" data-action="export-md">
                        <span>📄 导出 MD</span>
                    </button>
                </div>
            </div>
        `;

        this.bindEvents();
    }

    bindEvents() {
        this.container.querySelector('[data-action="add-layer"]')?.addEventListener('click', () => {
            this.callbacks.onAddLayer?.();
        });

        this.container.querySelector('[data-action="execute-all"]')?.addEventListener('click', () => {
            this.callbacks.onExecuteAll?.();
        });

        this.container.querySelector('[data-action="stop-all"]')?.addEventListener('click', () => {
            this.callbacks.onStopAll?.();
        });

        this.container.querySelector('[data-action="export-md"]')?.addEventListener('click', () => {
            this.callbacks.onExportMarkdown?.();
        });

        this.container.querySelector('[data-action="resume"]')?.addEventListener('click', () => {
            this.callbacks.onResume?.();
        });
    }

    updateWorkflowState(state) {
        const statusEl = this.container.querySelector('.workflow-status');
        const executeBtn = this.container.querySelector('[data-action="execute-all"]');
        const resumeBtn = this.container.querySelector('[data-action="resume"]');
        const stopBtn = this.container.querySelector('[data-action="stop-all"]');

        if (statusEl) {
            statusEl.className = 'workflow-status';

            if (state.status === 'running') {
                statusEl.classList.add('running');
                statusEl.textContent = '执行中...';
            } else if (state.status === 'done' && state.duration !== undefined) {
                statusEl.classList.add('done');
                statusEl.textContent = `总耗时: ${this.formatDuration(state.duration)}`;
            } else if (state.status === 'cancelled' && state.duration !== undefined) {
                statusEl.classList.add('cancelled');
                statusEl.textContent = `已停止 (${this.formatDuration(state.duration)})`;
            } else if (state.status === 'error') {
                statusEl.classList.add('error');
                statusEl.textContent = `执行出错 (${this.formatDuration(state.duration)})`;
            }
        }

        // 切换执行/停止/继续按钮显示
        const isRunning = state.status === 'running';
        const canResume = state.status === 'cancelled' || state.status === 'error';
        if (executeBtn) executeBtn.style.display = isRunning ? 'none' : '';
        if (resumeBtn) resumeBtn.style.display = canResume && !isRunning ? '' : 'none';
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

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}
