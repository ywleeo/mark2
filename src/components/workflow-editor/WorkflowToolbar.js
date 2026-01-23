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
                </div>
                <div class="workflow-toolbar-right">
                    <button class="workflow-btn" data-action="add-layer">
                        <span>+ 添加层</span>
                    </button>
                    <button class="workflow-btn" data-action="execute-all">
                        <span>▶ 执行全部</span>
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

        this.container.querySelector('[data-action="export-md"]')?.addEventListener('click', () => {
            this.callbacks.onExportMarkdown?.();
        });
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}
