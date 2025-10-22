import { addClickHandler } from '../utils/PointerHelper.js';

export class AiConfigManager {
    constructor(options = {}) {
        this.onSubmit = typeof options.onSubmit === 'function' ? options.onSubmit : null;
        this.onCancel = typeof options.onCancel === 'function' ? options.onCancel : null;
        this.isOpen = false;
        this.cleanupFunctions = [];

        this.currentConfig = null;
        this.hasExistingKey = false;
        this.keyCleared = false;

        this.root = document.createElement('div');
        this.root.className = 'settings-modal hidden';
        this.root.innerHTML = `
            <div class="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="aiConfigDialogTitle">
                <form class="settings-form">
                    <header class="settings-header">
                        <h2 id="aiConfigDialogTitle">AI 设置</h2>
                        <p class="settings-subtitle">配置模型、API Key 以及请求参数。</p>
                    </header>

                    <section class="settings-body">
                        <label class="settings-field">
                            <span class="settings-label">模型名称</span>
                            <input type="text" name="aiModel" placeholder="例如 gpt-4o-mini" />
                        </label>
                        <label class="settings-field">
                            <span class="settings-label">API Key</span>
                            <div class="settings-input-with-action">
                                <input type="password" name="aiApiKey" autocomplete="off" placeholder="sk-..." />
                                <button type="button" class="btn tertiary" data-action="ai-clear-key">清除</button>
                            </div>
                            <span class="settings-hint" data-role="ai-key-hint"></span>
                        </label>
                        <label class="settings-field">
                            <span class="settings-label">Base URL</span>
                            <input type="text" name="aiBaseUrl" placeholder="默认：https://api.openai.com/v1/chat/completions" />
                        </label>
                        <div class="settings-grid">
                            <label class="settings-field">
                                <span class="settings-label">请求超时 (毫秒)</span>
                                <input type="number" name="aiTimeout" min="5000" max="180000" step="1000" />
                            </label>
                            <label class="settings-field">
                                <span class="settings-label">每分钟请求上限</span>
                                <input type="number" name="aiRateLimit" min="1" max="120" step="1" />
                            </label>
                            <label class="settings-field">
                                <span class="settings-label">并发请求数</span>
                                <input type="number" name="aiConcurrency" min="1" max="10" step="1" />
                            </label>
                            <label class="settings-field">
                                <span class="settings-label">温度 (0-2)</span>
                                <input type="number" name="aiTemperature" min="0" max="2" step="0.1" />
                            </label>
                        </div>
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
        this.modelInput = this.form.querySelector('input[name="aiModel"]');
        this.apiKeyInput = this.form.querySelector('input[name="aiApiKey"]');
        this.baseUrlInput = this.form.querySelector('input[name="aiBaseUrl"]');
        this.timeoutInput = this.form.querySelector('input[name="aiTimeout"]');
        this.rateLimitInput = this.form.querySelector('input[name="aiRateLimit"]');
        this.concurrencyInput = this.form.querySelector('input[name="aiConcurrency"]');
        this.temperatureInput = this.form.querySelector('input[name="aiTemperature"]');
        this.keyHintElement = this.form.querySelector('[data-role="ai-key-hint"]');

        this.cancelButton = this.form.querySelector('[data-action="cancel"]');
        this.clearKeyButton = this.form.querySelector('[data-action="ai-clear-key"]');
        this.saveButton = this.form.querySelector('button[type="submit"]');

        this.handleSubmit = this.handleSubmit.bind(this);
        this.handleKeydown = this.handleKeydown.bind(this);
        this.handleBackdropClick = this.handleBackdropClick.bind(this);
        this.handleClearKey = this.handleClearKey.bind(this);

        this.form.addEventListener('submit', this.handleSubmit);
        this.root.addEventListener('mousedown', this.handleBackdropClick);

        if (this.cancelButton) {
            const cleanup = addClickHandler(this.cancelButton, () => this.close(true));
            this.cleanupFunctions.push(cleanup);
        }
        if (this.saveButton) {
            const cleanup = addClickHandler(this.saveButton, () => this.form.requestSubmit());
            this.cleanupFunctions.push(cleanup);
        }
        if (this.clearKeyButton) {
            const cleanup = addClickHandler(this.clearKeyButton, this.handleClearKey);
            this.cleanupFunctions.push(cleanup);
        }

        if (this.apiKeyInput) {
            this.apiKeyInput.addEventListener('input', () => {
                if (this.apiKeyInput.value.trim().length > 0) {
                    this.keyCleared = false;
                    this.hasExistingKey = false;
                    this.updateKeyHint('保存后将更新密钥');
                } else if (!this.hasExistingKey) {
                    this.updateKeyHint('');
                }
            });
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

        const model = effective.model || 'gpt-4o-mini';
        const baseUrl = effective.base_url || '';
        const timeout = Number(effective.request_timeout_ms) || 60000;
        const rateLimit = Number(effective.max_requests_per_minute) || 20;
        const concurrency = Number(effective.max_concurrent_requests) || 2;
        const temperature = Number(effective.temperature);
        const hasKey = Boolean(effective.has_api_key);

        if (this.modelInput) this.modelInput.value = model;
        if (this.baseUrlInput) {
            this.baseUrlInput.value = baseUrl;
            this.baseUrlInput.placeholder = '默认：https://api.openai.com/v1/chat/completions';
        }
        if (this.timeoutInput) this.timeoutInput.value = timeout;
        if (this.rateLimitInput) this.rateLimitInput.value = rateLimit;
        if (this.concurrencyInput) this.concurrencyInput.value = concurrency;
        if (this.temperatureInput) {
            const validTemp = Number.isFinite(temperature) ? this.clamp(temperature, 0, 2) : 0.7;
            this.temperatureInput.value = validTemp;
        }

        if (this.apiKeyInput) {
            this.apiKeyInput.value = '';
            this.apiKeyInput.placeholder = hasKey ? '已配置，保存时可保留当前密钥' : 'sk-...';
        }

        this.hasExistingKey = hasKey;
        this.keyCleared = false;
        this.updateKeyHint();

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

    updateKeyHint(message = '') {
        if (!this.keyHintElement) {
            return;
        }
        if (this.keyCleared) {
            this.keyHintElement.textContent = message || '保存后将移除已保存的密钥';
            this.keyHintElement.classList.add('is-warning');
            return;
        }
        if (this.hasExistingKey) {
            this.keyHintElement.textContent = message || '当前密钥已保存，留空可保持不变';
            this.keyHintElement.classList.remove('is-warning');
            return;
        }
        this.keyHintElement.textContent = message;
        this.keyHintElement.classList.remove('is-warning');
    }

    handleClearKey() {
        this.hasExistingKey = false;
        this.keyCleared = true;
        if (this.apiKeyInput) {
            this.apiKeyInput.value = '';
            this.apiKeyInput.placeholder = 'sk-...';
            this.apiKeyInput.focus();
        }
        this.updateKeyHint();
    }

    clamp(value, min, max) {
        const number = Number(value);
        if (!Number.isFinite(number)) {
            return min;
        }
        return Math.min(Math.max(number, min), max);
    }

    handleSubmit(event) {
        event.preventDefault();

        const model = (this.modelInput?.value || '').trim() || 'gpt-4o-mini';
        const baseUrl = (this.baseUrlInput?.value || '').trim();
        const timeout = Number(this.timeoutInput?.value) || 60000;
        const rateLimit = Number(this.rateLimitInput?.value) || 20;
        const concurrency = Number(this.concurrencyInput?.value) || 2;
        const temperature = Number(this.temperatureInput?.value);
        const apiKeyInput = (this.apiKeyInput?.value || '').trim();

        const typedNewKey = apiKeyInput.length > 0;
        const clearedManually = this.keyCleared && !typedNewKey;

        let keepExistingKey = false;
        if (!typedNewKey && this.hasExistingKey && !clearedManually) {
            keepExistingKey = true;
        }

        const payload = {
            model,
            base_url: baseUrl || null,
            request_timeout_ms: this.clamp(timeout, 5000, 180000),
            max_requests_per_minute: this.clamp(rateLimit, 1, 120),
            max_concurrent_requests: this.clamp(concurrency, 1, 10),
            temperature: Number.isFinite(temperature) ? this.clamp(temperature, 0, 2) : 0.7,
            stream: true,
            keep_existing_api_key: keepExistingKey,
        };

        if (typedNewKey) {
            payload.api_key = apiKeyInput;
            payload.keep_existing_api_key = false;
        } else if (clearedManually) {
            payload.api_key = null;
            payload.keep_existing_api_key = false;
        }

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
