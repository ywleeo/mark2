import { addClickHandler } from '../utils/PointerHelper.js';

export class AiConfigManager {
    constructor(options = {}) {
        this.onSubmit = typeof options.onSubmit === 'function' ? options.onSubmit : null;
        this.onCancel = typeof options.onCancel === 'function' ? options.onCancel : null;
        this.isOpen = false;
        this.cleanupFunctions = [];

        this.currentConfig = null;

        this.root = document.createElement('div');
        this.root.className = 'settings-modal hidden';
        this.root.innerHTML = `
            <div class="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="aiConfigDialogTitle">
                <form class="settings-form">
                    <header class="settings-header">
                        <h2 id="aiConfigDialogTitle">AI 设置</h2>
                        <p class="settings-subtitle">配置 OpenAI API Key 和模型参数</p>
                    </header>

                    <section class="settings-body">
                        <label class="settings-field">
                            <span class="settings-label">API Key</span>
                            <input type="password" name="apiKey" autocomplete="off" placeholder="sk-..." />
                            <span class="settings-hint">输入你的 OpenAI API Key</span>
                        </label>
                        <label class="settings-field">
                            <span class="settings-label">模型名称</span>
                            <input type="text" name="model" placeholder="gpt-4o-mini" />
                        </label>
                        <label class="settings-field">
                            <span class="settings-label">Base URL</span>
                            <input type="text" name="baseUrl" placeholder="https://api.openai.com/v1" />
                            <span class="settings-hint">可选，默认使用 OpenAI 官方地址</span>
                        </label>
                    </section>

                    <footer class="settings-footer">
                        <button type="button" class="btn secondary" data-action="cancel">取消</button>
                        <button type="submit" class="btn primary">保存</button>
                    </footer>
                </form>
            </div>
        `;

        document.body.appendChild(this.root);

        this.form = this.root.querySelector('.settings-form');
        this.apiKeyInput = this.form.querySelector('input[name="apiKey"]');
        this.modelInput = this.form.querySelector('input[name="model"]');
        this.baseUrlInput = this.form.querySelector('input[name="baseUrl"]');

        this.cancelButton = this.form.querySelector('[data-action="cancel"]');
        this.saveButton = this.form.querySelector('button[type="submit"]');

        this.handleSubmit = this.handleSubmit.bind(this);
        this.handleKeydown = this.handleKeydown.bind(this);
        this.handleBackdropClick = this.handleBackdropClick.bind(this);

        this.form.addEventListener('submit', this.handleSubmit);
        this.root.addEventListener('mousedown', this.handleBackdropClick);

        if (this.cancelButton) {
            const cleanup = addClickHandler(this.cancelButton, () => this.close(true));
            this.cleanupFunctions.push(cleanup);
        }
    }

    destroy() {
        this.cleanupFunctions.forEach(fn => {
            if (typeof fn === 'function') {
                fn();
            }
        });
        this.cleanupFunctions = [];
        this.form.removeEventListener('submit', this.handleSubmit);
        this.root.removeEventListener('mousedown', this.handleBackdropClick);
        if (this.root.parentNode) {
            this.root.parentNode.removeChild(this.root);
        }
    }

    setConfig(config = null) {
        this.currentConfig = config;
    }

    open(config = null) {
        if (config) {
            this.currentConfig = config;
        }

        const effective = this.currentConfig || {};

        // 从 localStorage 格式读取
        if (this.apiKeyInput) {
            this.apiKeyInput.value = effective.apiKey || '';
        }
        if (this.modelInput) {
            this.modelInput.value = effective.model || 'gpt-4o-mini';
        }
        if (this.baseUrlInput) {
            this.baseUrlInput.value = effective.baseUrl || 'https://api.openai.com/v1';
        }

        if (!this.isOpen) {
            document.addEventListener('keydown', this.handleKeydown);
        }

        this.root.classList.remove('hidden');
        this.isOpen = true;
    }

    close(triggerCancel = false) {
        if (!this.isOpen) {
            return;
        }
        this.root.classList.add('hidden');
        document.removeEventListener('keydown', this.handleKeydown);
        this.isOpen = false;
        if (triggerCancel && typeof this.onCancel === 'function') {
            this.onCancel();
        }
    }

    handleSubmit(event) {
        event.preventDefault();

        const apiKey = (this.apiKeyInput?.value || '').trim();
        const model = (this.modelInput?.value || '').trim() || 'gpt-4o-mini';
        const baseUrl = (this.baseUrlInput?.value || '').trim() || 'https://api.openai.com/v1';

        const payload = {
            apiKey,
            model,
            baseUrl,
        };

        if (typeof this.onSubmit === 'function') {
            this.onSubmit(payload);
        }

        this.close(false);
    }

    handleKeydown(event) {
        if (event.key === 'Escape') {
            this.close(true);
        }
    }

    handleBackdropClick(event) {
        if (event.target === this.root) {
            this.close(true);
        }
    }
}
