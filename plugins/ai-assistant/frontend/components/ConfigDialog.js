import { aiService } from '../aiService.js';

/**
 * AI 配置对话框 - 简化版
 * 使用系统设置的样式风格
 */
export class ConfigDialog {
    constructor() {
        this.element = null;
        this.config = null;
    }

    /**
     * 打开配置对话框
     */
    open(config) {
        this.config = config || aiService.getConfig();
        this.render();
        this.show();
    }

    /**
     * 渲染对话框
     */
    render() {
        // 创建遮罩层
        if (!this.element) {
            this.element = document.createElement('div');
            this.element.className = 'settings-modal hidden';
            document.body.appendChild(this.element);
        }

        this.element.innerHTML = `
            <div class="settings-dialog" role="dialog" aria-modal="true">
                <form class="settings-form">
                    <header class="settings-header">
                        <h2>AI 助手设置</h2>
                    </header>

                    <section class="settings-body">
                        <p class="settings-subtitle">配置 AI 服务和输出偏好</p>

                        <label class="settings-field">
                            <span class="settings-label">API Key</span>
                            <input
                                type="password"
                                name="apiKey"
                                value="${this.escapeHtml(this.config.apiKey || '')}"
                                placeholder="sk-..."
                                required
                            >
                        </label>

                        <label class="settings-field">
                            <span class="settings-label">Base URL</span>
                            <input
                                type="text"
                                name="baseUrl"
                                value="${this.escapeHtml(this.config.baseUrl || 'https://api.openai.com/v1')}"
                                placeholder="https://api.openai.com/v1"
                            >
                            <span class="settings-hint">支持 OpenAI 兼容接口</span>
                        </label>

                        <label class="settings-field">
                            <span class="settings-label">Model</span>
                            <input
                                type="text"
                                name="model"
                                value="${this.escapeHtml(this.config.model || 'gpt-4o')}"
                                placeholder="gpt-4o"
                            >
                            <span class="settings-hint">如：gpt-4o, claude-3-5-sonnet-20241022</span>
                        </label>

                        <div class="settings-grid">
                            <label class="settings-field">
                                <span class="settings-label">输出风格</span>
                                <select name="outputStyle">
                                    <option value="balanced" ${this.config.preferences?.outputStyle === 'balanced' ? 'selected' : ''}>平衡</option>
                                    <option value="formal" ${this.config.preferences?.outputStyle === 'formal' ? 'selected' : ''}>正式书面</option>
                                    <option value="casual" ${this.config.preferences?.outputStyle === 'casual' ? 'selected' : ''}>轻松口语</option>
                                </select>
                            </label>

                            <label class="settings-field">
                                <span class="settings-label">创造性</span>
                                <select name="creativity">
                                    <option value="low" ${this.config.preferences?.creativity === 'low' ? 'selected' : ''}>保守</option>
                                    <option value="medium" ${this.config.preferences?.creativity === 'medium' ? 'selected' : ''}>适中</option>
                                    <option value="high" ${this.config.preferences?.creativity === 'high' ? 'selected' : ''}>大胆</option>
                                </select>
                            </label>
                        </div>
                    </section>

                    <footer class="settings-footer">
                        <button type="button" class="btn secondary">取消</button>
                        <button type="submit" class="btn primary">保存</button>
                    </footer>
                </form>
            </div>
        `;

        this.bindEvents();
    }

    /**
     * 绑定事件
     */
    bindEvents() {
        const form = this.element.querySelector('.settings-form');
        const cancelBtn = this.element.querySelector('.btn.secondary');

        // 提交表单
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleSubmit(e);
        });

        // 取消按钮
        cancelBtn.addEventListener('click', () => this.close());

        // 点击遮罩层关闭
        this.element.addEventListener('click', (e) => {
            if (e.target === this.element) {
                this.close();
            }
        });

        // ESC 键关闭
        this.handleKeydown = (e) => {
            if (e.key === 'Escape') {
                this.close();
            }
        };
        document.addEventListener('keydown', this.handleKeydown);
    }

    /**
     * 处理表单提交
     */
    handleSubmit(e) {
        const formData = new FormData(e.target);
        const config = {
            apiKey: formData.get('apiKey')?.trim() || '',
            baseUrl: formData.get('baseUrl')?.trim() || 'https://api.openai.com/v1',
            model: formData.get('model')?.trim() || 'gpt-4o',
            preferences: {
                outputStyle: formData.get('outputStyle') || 'balanced',
                creativity: formData.get('creativity') || 'medium',
            }
        };

        // 验证
        if (!config.apiKey) {
            alert('请输入 API Key');
            return;
        }

        // 保存配置
        try {
            aiService.saveConfig(config);
            this.close();
        } catch (error) {
            console.error('[ConfigDialog] 保存配置失败:', error);
            alert('保存失败: ' + error.message);
        }
    }

    /**
     * 显示对话框
     */
    show() {
        if (this.element) {
            this.element.classList.remove('hidden');
            // 聚焦到第一个输入框
            const firstInput = this.element.querySelector('input[name="apiKey"]');
            if (firstInput) {
                setTimeout(() => firstInput.focus(), 100);
            }
        }
    }

    /**
     * 关闭对话框
     */
    close() {
        if (this.element) {
            this.element.classList.add('hidden');
            document.removeEventListener('keydown', this.handleKeydown);
        }
    }

    /**
     * 销毁对话框
     */
    destroy() {
        this.close();
        if (this.element && this.element.parentNode) {
            this.element.parentNode.removeChild(this.element);
            this.element = null;
        }
    }

    /**
     * HTML 转义
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}
