import { addClickHandler } from '../../../src/utils/PointerHelper.js';
import {
    normalizeRoles,
    cloneRole,
    createRoleId,
    DEFAULT_ROLE_ID,
} from './utils/roleUtils.js';

export class AiConfigManager {
    constructor(options = {}) {
        this.onSubmit = typeof options.onSubmit === 'function' ? options.onSubmit : null;
        this.onCancel = typeof options.onCancel === 'function' ? options.onCancel : null;
        this.isOpen = false;
        this.cleanupFunctions = [];

        this.currentConfig = null;

        this.root = document.createElement('div');
        this.root.className = 'settings-modal ai-config-modal hidden';
        this.root.innerHTML = `
            <div class="settings-dialog ai-config-dialog" role="dialog" aria-modal="true" aria-labelledby="aiConfigDialogTitle">
                <form class="settings-form">
                    <header class="settings-header">
                        <h2 id="aiConfigDialogTitle">AI 设置</h2>
                        <p class="settings-subtitle">配置 OpenAI API 和角色提示词</p>
                    </header>

                    <div class="settings-tabs">
                        <button type="button" class="tab-button active" data-tab="basic">基本设置</button>
                        <button type="button" class="tab-button" data-tab="role">角色设置</button>
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
                            <div class="ai-role-layout">
                                <aside class="ai-role-sidebar">
                                    <div class="ai-role-sidebar__header">
                                        <span class="settings-label">角色列表</span>
                                        <div class="ai-role-sidebar__controls">
                                            <button type="button" class="ai-role-manager__btn" data-action="add-role">新增</button>
                                            <button type="button" class="ai-role-manager__btn danger" data-action="remove-role">删除</button>
                                        </div>
                                    </div>
                                    <div class="ai-role-list">
                                        <select name="roleId" size="8"></select>
                                    </div>
                                    <p class="ai-role-sidebar__hint">默认角色无法删除</p>
                                </aside>

                                <div class="ai-role-detail">
                                    <label class="settings-field">
                                        <span class="settings-label">角色名称</span>
                                        <input type="text" name="roleName" placeholder="例如：市场分析助手" />
                                    </label>

                                    <label class="settings-field">
                                        <span class="settings-label" data-role="role-prompt-label">角色提示词</span>
                                        <textarea name="rolePrompt" rows="12" placeholder="例如：你是一个专业的广告策划，擅长创意文案和营销策略。

你的核心能力：
1. 创意文案撰写
2. 品牌定位分析
3. 营销策略规划

工作风格：
- 注重用户洞察
- 追求创意突破
- 数据驱动决策"></textarea>
                                        <span class="settings-hint">定义当前角色的背景、能力与工作方式</span>
                                    </label>

                                    <label class="settings-field">
                                        <span class="settings-label" data-role="role-style-label">输出风格</span>
                                        <textarea name="outputStyle" rows="7" placeholder="例如：口语化，极简单的输出，不要形容，直接说事。

具体要求：
1. 用简单直白的语言
2. 避免冗长的形容词
3. 直接给出结论和建议
4. 分点列举，条理清晰
5. 不要废话，直奔主题"></textarea>
                                        <span class="settings-hint">定义当前角色的回答风格和格式要求</span>
                                    </label>
                                </div>
                            </div>
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
        this.dialogElement = this.root.querySelector('.ai-config-dialog');
        this.apiKeyInput = this.form.querySelector('input[name="apiKey"]');
        this.modelInput = this.form.querySelector('input[name="model"]');
        this.baseUrlInput = this.form.querySelector('input[name="baseUrl"]');
        this.roleSelect = this.form.querySelector('select[name="roleId"]');
        this.roleNameInput = this.form.querySelector('input[name="roleName"]');
        this.rolePromptInput = this.form.querySelector('textarea[name="rolePrompt"]');
        this.outputStyleInput = this.form.querySelector('textarea[name="outputStyle"]');
        this.rolePromptLabel = this.form.querySelector('[data-role="role-prompt-label"]');
        this.outputStyleLabel = this.form.querySelector('[data-role="role-style-label"]');
        this.addRoleButton = this.form.querySelector('[data-action="add-role"]');
        this.removeRoleButton = this.form.querySelector('[data-action="remove-role"]');

        this.cancelButton = this.form.querySelector('[data-action="cancel"]');
        this.saveButton = this.form.querySelector('button[type="submit"]');

        // Tab 按钮和内容
        this.tabButtons = this.root.querySelectorAll('.tab-button');
        this.tabContents = this.root.querySelectorAll('.tab-content');

        this.roles = [];
        this.selectedRoleId = null;

        this.handleSubmit = this.handleSubmit.bind(this);
        this.handleKeydown = this.handleKeydown.bind(this);
        this.handleBackdropClick = this.handleBackdropClick.bind(this);
        this.handleTabClick = this.handleTabClick.bind(this);
        this.handleRoleChange = this.handleRoleChange.bind(this);
        this.handleRoleNameInput = this.handleRoleNameInput.bind(this);
        this.handleRolePromptInput = this.handleRolePromptInput.bind(this);
        this.handleOutputStyleInput = this.handleOutputStyleInput.bind(this);
        this.handleAddRole = this.handleAddRole.bind(this);
        this.handleRemoveRole = this.handleRemoveRole.bind(this);

        this.form.addEventListener('submit', this.handleSubmit);
        this.root.addEventListener('mousedown', this.handleBackdropClick);
        if (this.dialogElement) {
            const stopDialogMouseDown = (event) => {
                event.stopPropagation();
            };
            this.dialogElement.addEventListener('mousedown', stopDialogMouseDown);
            this.cleanupFunctions.push(() => {
                this.dialogElement.removeEventListener('mousedown', stopDialogMouseDown);
            });
        }

        // 绑定 tab 切换事件
        this.tabButtons.forEach(button => {
            const cleanup = addClickHandler(button, () => this.handleTabClick(button.dataset.tab));
            this.cleanupFunctions.push(cleanup);
        });

        if (this.cancelButton) {
            const cleanup = addClickHandler(this.cancelButton, () => this.close(true));
            this.cleanupFunctions.push(cleanup);
        }

        if (this.saveButton) {
            const cleanup = addClickHandler(this.saveButton, () => {
                this.form.requestSubmit();
            });
            this.cleanupFunctions.push(cleanup);
        }

        if (this.roleSelect) {
            this.roleSelect.addEventListener('change', this.handleRoleChange);
        }
        if (this.roleNameInput) {
            this.roleNameInput.addEventListener('input', this.handleRoleNameInput);
        }
        if (this.rolePromptInput) {
            this.rolePromptInput.addEventListener('input', this.handleRolePromptInput);
        }
        if (this.outputStyleInput) {
            this.outputStyleInput.addEventListener('input', this.handleOutputStyleInput);
        }
        if (this.addRoleButton) {
            const cleanup = addClickHandler(this.addRoleButton, this.handleAddRole);
            this.cleanupFunctions.push(cleanup);
        }
        if (this.removeRoleButton) {
            const cleanup = addClickHandler(this.removeRoleButton, this.handleRemoveRole);
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
        if (this.roleSelect) {
            this.roleSelect.removeEventListener('change', this.handleRoleChange);
        }
        if (this.roleNameInput) {
            this.roleNameInput.removeEventListener('input', this.handleRoleNameInput);
        }
        if (this.rolePromptInput) {
            this.rolePromptInput.removeEventListener('input', this.handleRolePromptInput);
        }
        if (this.outputStyleInput) {
            this.outputStyleInput.removeEventListener('input', this.handleOutputStyleInput);
        }
        if (this.root.parentNode) {
            this.root.parentNode.removeChild(this.root);
        }
    }

    setConfig(config = null) {
        this.currentConfig = config;
    }

    getSelectedRole() {
        if (!this.selectedRoleId) {
            return null;
        }
        return this.roles.find(role => role.id === this.selectedRoleId) || null;
    }

    loadRolesFromConfig(config = {}) {
        const normalized = normalizeRoles(config.roles, {
            legacyPrompt: config.rolePrompt,
            legacyStyle: config.outputStyle,
        });
        this.roles = normalized.map(role => cloneRole(role)).map(role => ({
            ...role,
            isDefault: role.id === DEFAULT_ROLE_ID || role.isDefault === true,
        }));

        const preferredId = config.activeRoleId;
        const fallbackId = this.roles[0]?.id || null;
        this.selectedRoleId = preferredId && this.roles.some(role => role.id === preferredId)
            ? preferredId
            : fallbackId;

        this.refreshRoleSelect(this.selectedRoleId);
        this.syncRoleFields();
    }

    refreshRoleSelect(preferredId = null) {
        if (!this.roleSelect) {
            return;
        }
        const fragment = document.createDocumentFragment();
        this.roles.forEach(role => {
            const option = document.createElement('option');
            option.value = role.id;
            option.textContent = role.name || '未命名角色';
            if (role.isDefault) {
                option.textContent = `${option.textContent}（默认）`;
            }
            fragment.appendChild(option);
        });
        this.roleSelect.innerHTML = '';
        this.roleSelect.appendChild(fragment);

        const nextId = preferredId && this.roles.some(role => role.id === preferredId)
            ? preferredId
            : (this.roles[0]?.id || '');

        if (nextId) {
            this.roleSelect.value = nextId;
            this.selectedRoleId = nextId;
        } else {
            this.selectedRoleId = null;
        }

        this.roleSelect.disabled = this.roles.length === 0;
        this.updateRoleButtonsState();
    }

    syncRoleFields() {
        const role = this.getSelectedRole();
        const hasRole = !!role;

        if (this.roleNameInput) {
            this.roleNameInput.value = role?.name || '';
            this.roleNameInput.disabled = !hasRole;
        }
        if (this.rolePromptInput) {
            this.rolePromptInput.value = role?.rolePrompt || '';
            this.rolePromptInput.disabled = !hasRole;
        }
        if (this.outputStyleInput) {
            this.outputStyleInput.value = role?.outputStyle || '';
            this.outputStyleInput.disabled = !hasRole;
        }

        this.updateRoleLabels(role);
        this.updateRoleButtonsState();
    }

    updateRoleLabels(role) {
        const roleName = role?.name || '未命名角色';
        if (this.rolePromptLabel) {
            this.rolePromptLabel.textContent = `角色提示词（${roleName}）`;
        }
        if (this.outputStyleLabel) {
            this.outputStyleLabel.textContent = `输出风格（${roleName}）`;
        }
    }

    updateRoleButtonsState() {
        const role = this.getSelectedRole();
        const disableRemove = !role || role.isDefault || this.roles.length <= 1;
        if (this.removeRoleButton) {
            this.removeRoleButton.disabled = disableRemove;
        }
    }

    updateRoleOptionLabel(roleId, name, { isDefault = false } = {}) {
        if (!this.roleSelect) {
            return;
        }
        const option = this.roleSelect.querySelector(`option[value="${roleId}"]`);
        if (option) {
            const label = name || '未命名角色';
            option.textContent = isDefault ? `${label}` : label;
        }
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

        this.loadRolesFromConfig(effective);

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

        const activeRole = this.getSelectedRole() || this.roles[0] || null;
        const activeRoleId = activeRole?.id || null;
        const rolesPayload = this.roles.map(role => cloneRole(role)).map(role => ({
            ...role,
            isDefault: role.id === DEFAULT_ROLE_ID || role.isDefault === true,
        }));

        const payload = {
            apiKey,
            model,
            baseUrl,
            roles: rolesPayload,
            activeRoleId,
            rolePrompt: activeRole?.rolePrompt || '',
            outputStyle: activeRole?.outputStyle || '',
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
        if (!this.dialogElement || !this.dialogElement.contains(event.target)) {
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

    handleRoleChange(event) {
        const nextId = event?.target?.value || null;
        if (!nextId || !this.roles.some(role => role.id === nextId)) {
            return;
        }
        this.selectedRoleId = nextId;
        this.syncRoleFields();
    }

    handleRoleNameInput(event) {
        const role = this.getSelectedRole();
        if (!role) {
            return;
        }
        const value = (event?.target?.value || '').trim();
        role.name = value;
        this.updateRoleOptionLabel(role.id, role.name, { isDefault: role.isDefault });
        this.updateRoleLabels(role);
    }

    handleRolePromptInput(event) {
        const role = this.getSelectedRole();
        if (!role) {
            return;
        }
        role.rolePrompt = event?.target?.value || '';
    }

    handleOutputStyleInput(event) {
        const role = this.getSelectedRole();
        if (!role) {
            return;
        }
        role.outputStyle = event?.target?.value || '';
    }

    handleAddRole() {
        const newRole = {
            id: createRoleId(),
            name: `新角色 ${this.roles.length + 1}`,
            rolePrompt: '',
            outputStyle: '',
            isDefault: false,
        };
        this.roles.push(newRole);
        this.selectedRoleId = newRole.id;
        this.refreshRoleSelect(newRole.id);
        this.syncRoleFields();
    }

    handleRemoveRole() {
        const role = this.getSelectedRole();
        if (!role) {
            return;
        }
        if (role.isDefault || role.id === DEFAULT_ROLE_ID) {
            alert('默认角色无法删除');
            return;
        }
        if (this.roles.length <= 1) {
            alert('至少保留一个角色');
            return;
        }
        this.roles = this.roles.filter(item => item.id !== role.id);
        const fallbackId = this.roles[0]?.id || null;
        this.selectedRoleId = fallbackId;
        this.refreshRoleSelect(this.selectedRoleId);
        this.syncRoleFields();
    }
}
