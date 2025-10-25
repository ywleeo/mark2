import { addClickHandler } from '../../../src/utils/PointerHelper.js';

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
                        <p class="settings-subtitle">配置 OpenAI API 和提示词</p>
                    </header>

                    <div class="settings-tabs">
                        <button type="button" class="tab-button active" data-tab="basic">基本设置</button>
                        <button type="button" class="tab-button" data-tab="role">角色提示词</button>
                        <button type="button" class="tab-button" data-tab="style">输出风格</button>
                    </div>

                    <section class="settings-body">
                        <div class="tab-content active" data-tab-content="basic">
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
                        </div>

                        <div class="tab-content" data-tab-content="role">
                            <label class="settings-field">
                                <span class="settings-label">角色提示词</span>
                                <textarea name="rolePrompt" rows="15" placeholder="例如：你是一个专业的广告策划，擅长创意文案和营销策略。

你的核心能力：
1. 创意文案撰写
2. 品牌定位分析
3. 营销策略规划

工作风格：
- 注重用户洞察
- 追求创意突破
- 数据驱动决策"></textarea>
                                <span class="settings-hint">定义 AI 的角色、专长和能力</span>
                            </label>
                        </div>

                        <div class="tab-content" data-tab-content="style">
                            <label class="settings-field">
                                <span class="settings-label">输出风格</span>
                                <textarea name="outputStyle" rows="15" placeholder="例如：口语化，极简单的输出，不要形容，直接说事。

具体要求：
1. 用简单直白的语言
2. 避免冗长的形容词
3. 直接给出结论和建议
4. 分点列举，条理清晰
5. 不要废话，直奔主题"></textarea>
                                <span class="settings-hint">定义 AI 的回答风格和格式要求</span>
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
        this.apiKeyInput = this.form.querySelector('input[name="apiKey"]');
        this.modelInput = this.form.querySelector('input[name="model"]');
        this.baseUrlInput = this.form.querySelector('input[name="baseUrl"]');
        this.rolePromptInput = this.form.querySelector('textarea[name="rolePrompt"]');
        this.outputStyleInput = this.form.querySelector('textarea[name="outputStyle"]');

        this.cancelButton = this.form.querySelector('[data-action="cancel"]');
        this.saveButton = this.form.querySelector('button[type="submit"]');

        // Tab 按钮和内容
        this.tabButtons = this.root.querySelectorAll('.tab-button');
        this.tabContents = this.root.querySelectorAll('.tab-content');

        this.handleSubmit = this.handleSubmit.bind(this);
        this.handleKeydown = this.handleKeydown.bind(this);
        this.handleBackdropClick = this.handleBackdropClick.bind(this);
        this.handleTabClick = this.handleTabClick.bind(this);

        this.form.addEventListener('submit', this.handleSubmit);
        this.root.addEventListener('mousedown', this.handleBackdropClick);

        // 绑定 tab 切换事件
        this.tabButtons.forEach(button => {
            const cleanup = addClickHandler(button, () => this.handleTabClick(button.dataset.tab));
            this.cleanupFunctions.push(cleanup);
        });

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
        if (this.rolePromptInput) {
            this.rolePromptInput.value = effective.rolePrompt || '';
        }
        if (this.outputStyleInput) {
            this.outputStyleInput.value = effective.outputStyle || '';
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
        const rolePrompt = (this.rolePromptInput?.value || '').trim();
        const outputStyle = (this.outputStyleInput?.value || '').trim();

        const payload = {
            apiKey,
            model,
            baseUrl,
            rolePrompt,
            outputStyle,
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

    handleTabClick(tabName) {
        // 移除所有 active 状态
        this.tabButtons.forEach(btn => btn.classList.remove('active'));
        this.tabContents.forEach(content => content.classList.remove('active'));

        // 添加当前 tab 的 active 状态
        const activeButton = this.root.querySelector(`.tab-button[data-tab="${tabName}"]`);
        const activeContent = this.root.querySelector(`.tab-content[data-tab-content="${tabName}"]`);

        if (activeButton) activeButton.classList.add('active');
        if (activeContent) activeContent.classList.add('active');
    }
}
