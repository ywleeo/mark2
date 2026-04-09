import { addClickHandler } from '../utils/PointerHelper.js';
import { t, getLocale, setLocale } from '../i18n/index.js';
import { KeybindingsSettings } from './KeybindingsSettings.js';
import { saveCustomKeybindings } from '../utils/keybindingsStorage.js';

// 动态导入 aiService（避免循环依赖）
let aiService = null;
const getAiService = async () => {
    if (!aiService) {
        const module = await import('../modules/ai-assistant/aiService.js');
        aiService = module.aiService;
    }
    return aiService;
};

export class SettingsDialog {
    constructor(options = {}) {
        this.onSubmit = typeof options.onSubmit === 'function' ? options.onSubmit : null;
        this.onCancel = typeof options.onCancel === 'function' ? options.onCancel : null;
        this.isOpen = false;
        this.cleanupFunctions = [];

        this.recommendedFonts = [
            {
                label: 'SF Pro / System Sans',
                value: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif",
            },
            {
                label: 'Inter',
                value: "Inter, 'Helvetica Neue', 'Segoe UI', sans-serif",
            },
            {
                label: 'Source Sans Pro',
                value: "'Source Sans Pro', 'Helvetica Neue', 'PingFang SC', sans-serif",
            },
            {
                label: 'JetBrains Mono',
                value: "'JetBrains Mono', 'Fira Code', 'Menlo', monospace",
            },
        ];

        this.codeModeFonts = [
            { label: 'JetBrains Mono', value: "'JetBrains Mono', monospace" },
            { label: 'Fira Code', value: "'Fira Code', monospace" },
            { label: 'Source Code Pro', value: "'Source Code Pro', monospace" },
            { label: 'Monaco', value: "'Monaco', monospace" },
            { label: 'Menlo', value: "'Menlo', monospace" },
            { label: 'Consolas', value: "'Consolas', monospace" },
            { label: 'Courier New', value: "'Courier New', monospace" },
        ];

        this.currentTab = 'general'; // 'general', 'editor', 'code', or 'ai'

        this.root = document.createElement('div');
        this.root.className = 'settings-modal hidden';
        this.root.innerHTML = `
            <div class="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settingsDialogTitle">
                <form class="settings-form">
                    <header class="settings-header">
                        <h2 id="settingsDialogTitle">${t('settings.title')}</h2>
                        <nav class="settings-tabs">
                            <button type="button" class="settings-tab active" data-tab="general">${t('settings.tabGeneral')}</button>
                            <button type="button" class="settings-tab" data-tab="editor">${t('settings.tabMarkdown')}</button>
                            <button type="button" class="settings-tab" data-tab="code">${t('settings.tabCode')}</button>
                            <button type="button" class="settings-tab" data-tab="ai">${t('settings.tabAi')}</button>
                            <button type="button" class="settings-tab" data-tab="keybindings">${t('settings.tabKeybindings')}</button>
                        </nav>
                    </header>

                    <!-- General 设置 -->
                    <section class="settings-body" data-tab-content="general">
                        <div class="settings-rows">
                            <label class="settings-row">
                                <span class="settings-row__label">${t('settings.appearance')}</span>
                                <select name="appearance" class="settings-row__control">
                                    <option value="system">${t('settings.appearanceSystem')}</option>
                                    <option value="light">${t('settings.appearanceLight')}</option>
                                    <option value="dark">${t('settings.appearanceDark')}</option>
                                </select>
                            </label>
                            <label class="settings-row">
                                <span class="settings-row__label">${t('settings.language')}</span>
                                <select name="language" class="settings-row__control">
                                    <option value="en">English</option>
                                    <option value="zh-CN">中文</option>
                                </select>
                            </label>
                        </div>
                    </section>

                    <!-- 快捷键设置 -->
                    <section class="settings-body hidden" data-tab-content="keybindings">
                        <div data-ref="keybindingsContainer" class="keybindings-container"></div>
                    </section>

                    <!-- 编辑器设置 -->
                    <section class="settings-body hidden" data-tab-content="editor">
                        <div class="settings-rows">
                            <label class="settings-row">
                                <span class="settings-row__label">${t('settings.theme')}</span>
                                <select name="theme" class="settings-row__control">
                                    <option value="default">GitHub</option>
                                    <option value="emerald">Emerald</option>
                                    <option value="notion">Notion</option>
                                </select>
                            </label>
                            <label class="settings-row">
                                <span class="settings-row__label">${t('settings.font')}</span>
                                <select name="fontFamily" class="settings-row__control"></select>
                            </label>
                            <label class="settings-row">
                                <span class="settings-row__label">${t('settings.fontSize')}</span>
                                <input type="number" name="fontSize" min="10" max="48" step="1" class="settings-row__control" />
                            </label>
                            <label class="settings-row">
                                <span class="settings-row__label">${t('settings.lineHeight')}</span>
                                <input type="number" name="lineHeight" min="1.0" max="3.0" step="0.1" class="settings-row__control" />
                            </label>
                            <label class="settings-row">
                                <span class="settings-row__label">${t('settings.fontWeight')}</span>
                                <select name="fontWeight" class="settings-row__control">
                                    <option value="100">${t('settings.weightThin')}</option>
                                    <option value="200">${t('settings.weightExtraLight')}</option>
                                    <option value="300">${t('settings.weightLight')}</option>
                                    <option value="400">${t('settings.weightRegular')}</option>
                                    <option value="500">${t('settings.weightMedium')}</option>
                                    <option value="600">${t('settings.weightSemibold')}</option>
                                    <option value="700">${t('settings.weightBold')}</option>
                                    <option value="800">${t('settings.weightExtraBold')}</option>
                                    <option value="900">${t('settings.weightBlack')}</option>
                                </select>
                            </label>
                        </div>
                    </section>

                    <!-- Code 模式设置 -->
                    <section class="settings-body hidden" data-tab-content="code">
                        <div class="settings-rows">
                            <label class="settings-row">
                                <span class="settings-row__label">${t('settings.colorScheme')}</span>
                                <select name="codeTheme" class="settings-row__control">
                                    <option value="auto">Auto</option>
                                    <option value="vs">VS Code</option>
                                    <option value="monokai">Monokai</option>
                                    <option value="dracula">Dracula</option>
                                    <option value="one-dark-pro">One Dark Pro</option>
                                    <option value="github">GitHub</option>
                                    <option value="night-owl">Night Owl</option>
                                    <option value="solarized">Solarized</option>
                                </select>
                            </label>
                            <label class="settings-row">
                                <span class="settings-row__label">${t('settings.font')}</span>
                                <select name="codeFontFamily" class="settings-row__control"></select>
                            </label>
                            <label class="settings-row">
                                <span class="settings-row__label">${t('settings.fontSize')}</span>
                                <input type="number" name="codeFontSize" min="10" max="48" step="1" class="settings-row__control" />
                            </label>
                            <label class="settings-row">
                                <span class="settings-row__label">${t('settings.lineHeight')}</span>
                                <input type="number" name="codeLineHeight" min="1.0" max="3.0" step="0.1" class="settings-row__control" />
                            </label>
                            <label class="settings-row">
                                <span class="settings-row__label">${t('settings.fontWeight')}</span>
                                <select name="codeFontWeight" class="settings-row__control">
                                    <option value="100">${t('settings.weightThin')}</option>
                                    <option value="200">${t('settings.weightExtraLight')}</option>
                                    <option value="300">${t('settings.weightLight')}</option>
                                    <option value="400">${t('settings.weightRegular')}</option>
                                    <option value="500">${t('settings.weightMedium')}</option>
                                    <option value="600">${t('settings.weightSemibold')}</option>
                                    <option value="700">${t('settings.weightBold')}</option>
                                    <option value="800">${t('settings.weightExtraBold')}</option>
                                    <option value="900">${t('settings.weightBlack')}</option>
                                </select>
                            </label>
                        </div>
                    </section>

                    <!-- AI 助手设置 -->
                    <section class="settings-body hidden" data-tab-content="ai">
                        <div class="ai-providers-layout">
                            <!-- 左侧 Provider 列表 -->
                            <div class="ai-providers-list">
                                <div class="ai-providers-list__header">
                                    <span class="settings-label">${t('settings.providers')}</span>
                                    <button type="button" class="ai-provider-btn ai-provider-btn--add" data-action="add-provider" title="Add provider">＋</button>
                                </div>
                                <div class="ai-providers-list__items" data-ref="providerList"></div>
                            </div>

                            <!-- 右侧编辑区 -->
                            <div class="ai-provider-editor" data-ref="providerEditor">
                                <div class="ai-provider-editor__empty">
                                    <span>${t('settings.addProviderHint')}</span>
                                </div>
                            </div>
                        </div>

                        <div class="settings-rows">
                            <label class="settings-row">
                                <span class="settings-row__label">${t('settings.creativity')}</span>
                                <select name="aiCreativity" class="settings-row__control">
                                    <option value="low">${t('settings.creativityLow')}</option>
                                    <option value="medium">${t('settings.creativityMedium')}</option>
                                    <option value="high">${t('settings.creativityHigh')}</option>
                                </select>
                            </label>
                        </div>
                    </section>

                    <footer class="settings-footer">
                        <button type="button" class="btn secondary" data-action="cancel">${t('settings.cancel')}</button>
                        <button type="submit" class="btn primary">${t('settings.save')}</button>
                    </footer>
                </form>
            </div>
        `;

        document.body.appendChild(this.root);

        this.form = this.root.querySelector('.settings-form');

        // Tab 元素
        this.tabButtons = this.root.querySelectorAll('.settings-tab');
        this.tabContents = this.root.querySelectorAll('[data-tab-content]');

        // 编辑器设置字段
        this.themeSelect = this.form.querySelector('select[name="theme"]');
        this.appearanceSelect = this.form.querySelector('select[name="appearance"]');
        this.fontFamilySelect = this.form.querySelector('select[name="fontFamily"]');
        this.fontSizeInput = this.form.querySelector('input[name="fontSize"]');
        this.lineHeightInput = this.form.querySelector('input[name="lineHeight"]');
        this.fontWeightSelect = this.form.querySelector('select[name="fontWeight"]');

        // Language
        this.languageSelect = this.form.querySelector('select[name="language"]');

        // Code 模式设置字段
        this.codeThemeSelect = this.form.querySelector('select[name="codeTheme"]');
        this.codeFontFamilySelect = this.form.querySelector('select[name="codeFontFamily"]');
        this.codeFontSizeInput = this.form.querySelector('input[name="codeFontSize"]');
        this.codeLineHeightInput = this.form.querySelector('input[name="codeLineHeight"]');
        this.codeFontWeightSelect = this.form.querySelector('select[name="codeFontWeight"]');
        // AI 助手设置字段
        this.aiCreativitySelect = this.form.querySelector('select[name="aiCreativity"]');
        this.providerListEl = this.root.querySelector('[data-ref="providerList"]');
        this.providerEditorEl = this.root.querySelector('[data-ref="providerEditor"]');
        this.aiProviders = []; // 运行时 provider 数据
        this.selectedProviderId = null;
        this.selectedActiveModel = ''; // 当前选中的活跃模型

        // 快捷键设置
        this.keybindingsContainerEl = this.root.querySelector('[data-ref="keybindingsContainer"]');
        this.keybindingsSettings = null;

        // 添加 provider 按钮
        const addProviderBtn = this.root.querySelector('[data-action="add-provider"]');
        if (addProviderBtn) {
            const cleanup = addClickHandler(addProviderBtn, () => this.addProvider());
            this.cleanupFunctions.push(cleanup);
        }

        // 按钮
        this.cancelButton = this.form.querySelector('[data-action="cancel"]');
        this.saveButton = this.form.querySelector('button[type="submit"]');

        this.handleSubmit = this.handleSubmit.bind(this);
        this.handleKeydown = this.handleKeydown.bind(this);

        this.form.addEventListener('submit', this.handleSubmit);

        // Tab 切换事件
        this.tabButtons.forEach(tab => {
            const cleanup = addClickHandler(tab, () => {
                this.switchTab(tab.dataset.tab);
            });
            this.cleanupFunctions.push(cleanup);
        });

        // 使用统一的点击处理函数
        if (this.cancelButton) {
            const cleanup1 = addClickHandler(this.cancelButton, () => {
                this.close(true);
            });
            this.cleanupFunctions.push(cleanup1);
        }

        if (this.saveButton) {
            const cleanup2 = addClickHandler(this.saveButton, () => {
                this.form.requestSubmit();
            });
            this.cleanupFunctions.push(cleanup2);
        }

        this.availableFonts = [];
        this.setAvailableFonts([]);
        this.initCodeFontOptions();
    }

    switchTab(tabName) {
        this.currentTab = tabName;

        // 更新 tab 按钮状态
        this.tabButtons.forEach(tab => {
            if (tab.dataset.tab === tabName) {
                tab.classList.add('active');
            } else {
                tab.classList.remove('active');
            }
        });

        // 更新内容显示
        this.tabContents.forEach(content => {
            if (content.dataset.tabContent === tabName) {
                content.classList.remove('hidden');
            } else {
                content.classList.add('hidden');
            }
        });

    }

    initCodeFontOptions() {
        this.codeFontFamilySelect.innerHTML = '';

        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = t('settings.systemDefault');
        this.codeFontFamilySelect.appendChild(defaultOption);

        this.codeModeFonts.forEach(font => {
            const option = document.createElement('option');
            option.value = font.value;
            option.textContent = font.label;
            this.codeFontFamilySelect.appendChild(option);
        });
    }

    async open(settings) {
        const editorPrefs = settings || {};
        this.initialSettings = { ...editorPrefs };

        // 编辑器设置
        this.themeSelect.value = editorPrefs.theme || 'default';
        if (this.appearanceSelect) {
            this.appearanceSelect.value = editorPrefs.appearance || 'system';
        }
        if (this.languageSelect) {
            this.languageSelect.value = getLocale();
        }
        this.syncFontSelection(editorPrefs.fontFamily || '');
        this.fontSizeInput.value = Number(editorPrefs.fontSize) || 16;
        this.lineHeightInput.value = Number(editorPrefs.lineHeight) || 1.6;
        this.syncFontWeight(editorPrefs.fontWeight);

        // Code 模式设置
        this.codeThemeSelect.value = editorPrefs.codeTheme || 'auto';
        this.codeFontFamilySelect.value = editorPrefs.codeFontFamily || '';
        this.codeFontSizeInput.value = Number(editorPrefs.codeFontSize) || 14;
        this.codeLineHeightInput.value = Number(editorPrefs.codeLineHeight) || 1.5;
        this.codeFontWeightSelect.value = String(editorPrefs.codeFontWeight || 400);
        // AI 助手设置 - 从 aiService 读取
        const aiConfig = await this.loadAiConfig();
        this.aiProviders = (aiConfig.providers || []).map(p => ({ ...p }));
        this.selectedActiveModel = aiConfig.activeModel || '';
        this.aiCreativitySelect.value = aiConfig.preferences?.creativity || 'medium';
        this.renderProviderList();
        // 优先回显当前生效的 provider，避免保存后打开设置仍然跳回第一个 provider。
        if (this.aiProviders.length > 0) {
            const initialProviderId = this.resolveActiveProviderId(aiConfig.activeProviderId);
            this.selectProvider(initialProviderId);
        } else {
            this.renderProviderEditor(null);
        }

        // 快捷键设置
        if (this.keybindingsSettings) {
            this.keybindingsSettings.destroy();
        }
        this.keybindingsSettings = new KeybindingsSettings({
            container: this.keybindingsContainerEl,
        });

        // 重置到第一个 tab
        this.switchTab('general');

        if (!this.isOpen) {
            document.addEventListener('keydown', this.handleKeydown);
        }

        this.root.classList.remove('hidden');
        this.isOpen = true;
    }

    async loadAiConfig() {
        try {
            const service = await getAiService();
            return service.getConfig();
        } catch (error) {
            console.warn('[SettingsDialog] 无法获取 AI 配置:', error);
            return { providers: [], activeProviderId: '', activeModel: '', preferences: { creativity: 'medium' } };
        }
    }

    close(triggerCancel = false) {
        if (!this.isOpen) {
            return;
        }

        if (this.keybindingsSettings) {
            this.keybindingsSettings.destroy();
            this.keybindingsSettings = null;
        }

        this.root.classList.add('hidden');
        document.removeEventListener('keydown', this.handleKeydown);
        this.isOpen = false;

        if (triggerCancel && this.onCancel) {
            this.onCancel();
        }
    }

    async handleSubmit(event) {
        event.preventDefault();

        // 编辑器设置
        const theme = this.themeSelect.value || 'default';
        const appearance = (this.appearanceSelect?.value || 'system').toLowerCase();
        const fontSize = Number(this.fontSizeInput.value);
        const lineHeight = Number(this.lineHeightInput.value);
        const fontFamily = (this.fontFamilySelect.value || '').trim();
        const fontWeight = Number(this.fontWeightSelect.value);

        const normalizedSize = Number.isFinite(fontSize) ? this.clamp(fontSize, 10, 48) : 16;
        const normalizedLineHeight = Number.isFinite(lineHeight) ? this.clamp(lineHeight, 1.0, 3.0) : 1.6;

        // Code 模式设置
        const codeTheme = (this.codeThemeSelect.value || '').trim();
        const codeFontSize = Number(this.codeFontSizeInput.value);
        const codeLineHeight = Number(this.codeLineHeightInput.value);
        const codeFontFamily = (this.codeFontFamilySelect.value || '').trim();
        const codeFontWeight = Number(this.codeFontWeightSelect.value);
        const normalizedCodeSize = Number.isFinite(codeFontSize) ? this.clamp(codeFontSize, 10, 48) : 14;
        const normalizedCodeLineHeight = Number.isFinite(codeLineHeight) ? this.clamp(codeLineHeight, 1.0, 3.0) : 1.5;

        const sanitized = {
            theme: theme,
            appearance: ['light', 'dark', 'system'].includes(appearance) ? appearance : 'system',
            fontSize: normalizedSize,
            lineHeight: Number(normalizedLineHeight.toFixed(2)),
            fontFamily: fontFamily || '',
            fontWeight: Number.isFinite(fontWeight) ? fontWeight : 400,
            codeTheme: codeTheme || 'auto',
            codeFontSize: normalizedCodeSize,
            codeLineHeight: Number(normalizedCodeLineHeight.toFixed(2)),
            codeFontFamily: codeFontFamily || '',
            codeFontWeight: Number.isFinite(codeFontWeight) ? codeFontWeight : 400,
            terminalFontSize: Number(this.initialSettings?.terminalFontSize) || 13,
            terminalFontFamily: (this.initialSettings?.terminalFontFamily || '').trim(),
        };

        // AI 助手设置 - 同步当前编辑器中的值到 provider 数据
        this.syncCurrentProviderFromEditor();
        const activeProviderId = this.resolveActiveProviderId(this.selectedProviderId);
        const activeProvider = this.aiProviders.find(provider => provider.id === activeProviderId) || null;
        const activeModel = this.resolveActiveModel(activeProvider);
        const aiConfig = {
            providers: this.aiProviders,
            activeProviderId,
            activeModel,
            preferences: {
                creativity: this.aiCreativitySelect.value || 'medium',
            }
        };
        await this.saveAiConfig(aiConfig);

        // 保存自定义快捷键
        if (this.keybindingsSettings) {
            saveCustomKeybindings(this.keybindingsSettings.getCustomBindings());
        }

        if (this.onSubmit) {
            this.onSubmit(sanitized);
        }

        // Language change triggers reload — must be after other settings are saved
        const newLocale = this.languageSelect?.value;
        if (newLocale && newLocale !== getLocale()) {
            this.close(false);
            setLocale(newLocale);
            return;
        }

        this.close(false);
    }

    async saveAiConfig(config) {
        try {
            const service = await getAiService();
            service.saveConfig(config);
            console.log('[SettingsDialog] AI 配置已保存');
        } catch (error) {
            console.error('[SettingsDialog] 保存 AI 配置失败:', error);
        }
    }

    handleKeydown(event) {
        if (event.key === 'Escape') {
            this.close(true);
        }
    }

    syncFontSelection(fontFamily) {
        const value = typeof fontFamily === 'string' ? fontFamily.trim() : '';

        if (!value) {
            this.removeDynamicFontOption();
            this.fontFamilySelect.value = '';
            return;
        }

        const options = Array.from(this.fontFamilySelect.options);
        const existing = options.find(option => option.value === value);

        if (existing) {
            this.fontFamilySelect.value = value;
            if (existing.dataset.dynamic === 'true') {
                existing.textContent = `Custom: ${value}`;
            }
            return;
        }

        this.removeDynamicFontOption();
        const customOption = document.createElement('option');
        customOption.value = value;
        customOption.textContent = `Custom: ${value}`;
        customOption.dataset.dynamic = 'true';
        this.fontFamilySelect.appendChild(customOption);
        this.fontFamilySelect.value = value;
    }

    removeDynamicFontOption() {
        const options = Array.from(this.fontFamilySelect.options);
        const custom = options.find(option => option.dataset.dynamic === 'true');
        if (custom) {
            custom.remove();
        }
    }

    syncFontWeight(weight) {
        const allowed = ['100', '200', '300', '400', '500', '600', '700', '800', '900'];
        const value = Number.isFinite(Number(weight)) ? String(weight) : '400';
        if (allowed.includes(value)) {
            this.fontWeightSelect.value = value;
            return;
        }
        this.fontWeightSelect.value = '400';
    }

    setAvailableFonts(fonts = []) {
        const previousValue = this.fontFamilySelect.value;
        const normalized = Array.isArray(fonts)
            ? Array.from(
                  new Set(
                      fonts
                          .map(name => (typeof name === 'string' ? name.trim() : ''))
                          .filter(Boolean)
                  )
              )
            : [];

        normalized.sort((a, b) => a.localeCompare(b, 'zh-Hans-CN', { sensitivity: 'accent' }));
        this.availableFonts = normalized;

        this.fontFamilySelect.innerHTML = '';

        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = t('settings.systemDefault');
        this.fontFamilySelect.appendChild(defaultOption);

        if (this.recommendedFonts.length > 0) {
            const recommendedGroup = document.createElement('optgroup');
            recommendedGroup.label = t('settings.recommended');
            this.recommendedFonts.forEach(font => {
                const option = document.createElement('option');
                option.value = font.value;
                option.textContent = font.label;
                recommendedGroup.appendChild(option);
            });
            this.fontFamilySelect.appendChild(recommendedGroup);
        }

        if (this.availableFonts.length > 0) {
            const systemGroup = document.createElement('optgroup');
            systemGroup.label = t('settings.systemFonts');
            this.availableFonts.forEach(name => {
                const option = document.createElement('option');
                const cssValue = this.toCssFontValue(name);
                option.value = cssValue;
                option.textContent = name;
                option.dataset.displayName = name;
                systemGroup.appendChild(option);
            });
            this.fontFamilySelect.appendChild(systemGroup);
        }

        this.syncFontSelection(previousValue || '');
    }

    toCssFontValue(name) {
        if (typeof name !== 'string') {
            return '';
        }

        const trimmed = name.trim();
        if (trimmed.length === 0) {
            return '';
        }

        const needsQuote = /[\s,]/.test(trimmed);
        const escaped = trimmed.replace(/'/g, "\\'");
        return needsQuote ? `'${escaped}'` : escaped;
    }

    clamp(value, min, max) {
        if (!Number.isFinite(value)) {
            return min;
        }
        return Math.min(Math.max(value, min), max);
    }

    /**
     * 解析当前真正生效的 provider，优先使用显式选择，其次回退到第一个 provider。
     */
    resolveActiveProviderId(preferredProviderId) {
        if (preferredProviderId && this.aiProviders.some(provider => provider.id === preferredProviderId)) {
            return preferredProviderId;
        }
        return this.aiProviders[0]?.id || '';
    }

    /**
     * 确保保存的 activeModel 属于当前 provider，避免被 aiService 归一化回第一个模型。
     */
    resolveActiveModel(provider) {
        if (!provider) {
            return '';
        }
        if (this.selectedActiveModel && provider.models.includes(this.selectedActiveModel)) {
            return this.selectedActiveModel;
        }
        return provider.models[0] || '';
    }

    // ── Provider 管理 ────────────────────────────────────

    addProvider() {
        const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        const provider = {
            id,
            name: '',
            apiKey: '',
            baseUrl: 'https://api.openai.com/v1',
            models: [],
        };
        this.aiProviders.push(provider);
        this.renderProviderList();
        this.selectProvider(id);
        // 聚焦到名称输入框
        setTimeout(() => {
            const nameInput = this.providerEditorEl.querySelector('input[data-field="name"]');
            nameInput?.focus();
        }, 50);
    }

    deleteProvider(id) {
        this.aiProviders = this.aiProviders.filter(p => p.id !== id);
        this.renderProviderList();
        if (this.selectedProviderId === id) {
            const first = this.aiProviders[0];
            this.selectProvider(first?.id || null);
        }
    }

    selectProvider(id) {
        // 先保存当前正在编辑的 provider
        if (this.selectedProviderId && this.selectedProviderId !== id) {
            this.syncCurrentProviderFromEditor();
        }
        this.selectedProviderId = id;
        this.renderProviderList();
        const provider = this.aiProviders.find(p => p.id === id) || null;
        this.renderProviderEditor(provider);
    }

    syncCurrentProviderFromEditor() {
        if (!this.selectedProviderId) return;
        const provider = this.aiProviders.find(p => p.id === this.selectedProviderId);
        if (!provider) return;

        const nameInput = this.providerEditorEl.querySelector('input[data-field="name"]');
        const apiKeyInput = this.providerEditorEl.querySelector('input[data-field="apiKey"]');
        const baseUrlInput = this.providerEditorEl.querySelector('input[data-field="baseUrl"]');

        if (nameInput) provider.name = nameInput.value.trim();
        if (apiKeyInput) provider.apiKey = apiKeyInput.value.trim();
        if (baseUrlInput) provider.baseUrl = baseUrlInput.value.trim() || 'https://api.openai.com/v1';
    }

    renderProviderList() {
        if (!this.providerListEl) return;
        this.providerListEl.innerHTML = '';

        this.aiProviders.forEach(p => {
            const item = document.createElement('div');
            item.className = 'ai-provider-item' + (p.id === this.selectedProviderId ? ' is-selected' : '');
            item.dataset.id = p.id;

            const label = document.createElement('span');
            label.className = 'ai-provider-item__name';
            label.textContent = p.name || t('settings.untitled');
            item.appendChild(label);

            const delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.className = 'ai-provider-item__delete';
            delBtn.textContent = '×';
            delBtn.title = t('settings.delete');
            item.appendChild(delBtn);

            const selectCleanup = addClickHandler(item, (e) => {
                if (e.target === delBtn || delBtn.contains(e.target)) return;
                this.selectProvider(p.id);
            });
            const deleteCleanup = addClickHandler(delBtn, () => this.deleteProvider(p.id));
            this.cleanupFunctions.push(selectCleanup, deleteCleanup);

            this.providerListEl.appendChild(item);
        });
    }

    renderProviderEditor(provider) {
        if (!this.providerEditorEl) return;

        if (!provider) {
            this.providerEditorEl.innerHTML = `<div class="ai-provider-editor__empty"><span>${t('settings.addProviderHint')}</span></div>`;
            return;
        }

        this.providerEditorEl.innerHTML = `
            <label class="settings-field">
                <span class="settings-label">${t('settings.providerName')}</span>
                <input type="text" data-field="name" value="${this.escAttr(provider.name)}" placeholder="${t('settings.providerNamePlaceholder')}">
            </label>
            <label class="settings-field">
                <span class="settings-label">${t('settings.apiKey')}</span>
                <input type="password" data-field="apiKey" value="${this.escAttr(provider.apiKey)}" placeholder="sk-...">
            </label>
            <label class="settings-field">
                <span class="settings-label">${t('settings.baseUrl')}</span>
                <input type="text" data-field="baseUrl" value="${this.escAttr(provider.baseUrl)}" placeholder="https://api.openai.com/v1">
            </label>
            <div class="settings-field">
                <div class="ai-models-header">
                    <span class="settings-label">${t('settings.models')}</span>
                    <div class="ai-models-actions">
                        <button type="button" class="ai-provider-btn" data-action="fetch-models">${t('settings.fetchList')}</button>
                        <button type="button" class="ai-provider-btn" data-action="add-model">${t('settings.add')}</button>
                    </div>
                </div>
                <div class="ai-models-list" data-ref="modelsList"></div>
                <div class="ai-model-add-row" data-ref="modelAddRow" style="display:none">
                    <input type="text" class="ai-model-add-input" data-ref="modelAddInput" placeholder="${t('settings.modelPlaceholder')}">
                    <button type="button" class="ai-provider-btn" data-action="confirm-add-model">${t('settings.ok')}</button>
                </div>
                <span class="ai-models-status" data-ref="modelsStatus"></span>
            </div>
            <div class="ai-provider-test">
                <button type="button" class="ai-provider-btn ai-provider-btn--test" data-action="test-connection">${t('settings.testConnection')}</button>
                <span class="ai-provider-test__result" data-ref="testResult"></span>
            </div>
        `;

        // 渲染模型列表
        this.renderModelsList(provider);

        // 绑定事件
        const fetchBtn = this.providerEditorEl.querySelector('[data-action="fetch-models"]');
        const addModelBtn = this.providerEditorEl.querySelector('[data-action="add-model"]');
        const testBtn = this.providerEditorEl.querySelector('[data-action="test-connection"]');

        if (fetchBtn) {
            const cleanup = addClickHandler(fetchBtn, () => this.handleFetchModels(provider));
            this.cleanupFunctions.push(cleanup);
        }
        if (addModelBtn) {
            const cleanup = addClickHandler(addModelBtn, () => this.handleAddModel(provider));
            this.cleanupFunctions.push(cleanup);
        }
        const confirmAddBtn = this.providerEditorEl.querySelector('[data-action="confirm-add-model"]');
        const modelAddInput = this.providerEditorEl.querySelector('[data-ref="modelAddInput"]');
        if (confirmAddBtn) {
            const cleanup = addClickHandler(confirmAddBtn, () => this.confirmAddModel(provider));
            this.cleanupFunctions.push(cleanup);
        }
        if (modelAddInput) {
            const onKeydown = (e) => {
                if (e.key === 'Enter') this.confirmAddModel(provider);
                if (e.key === 'Escape') this.closeModelAddRow();
            };
            modelAddInput.addEventListener('keydown', onKeydown);
            this.cleanupFunctions.push(() => modelAddInput.removeEventListener('keydown', onKeydown));
        }
        if (testBtn) {
            const cleanup = addClickHandler(testBtn, () => this.handleTestConnection(provider));
            this.cleanupFunctions.push(cleanup);
        }

        // 名称输入变化时同步到左侧列表
        const nameInput = this.providerEditorEl.querySelector('input[data-field="name"]');
        if (nameInput) {
            nameInput.addEventListener('input', () => {
                provider.name = nameInput.value.trim();
                const listItem = this.providerListEl?.querySelector(`[data-id="${provider.id}"] .ai-provider-item__name`);
                if (listItem) listItem.textContent = provider.name || t('settings.untitled');
            });
        }
    }

    renderModelsList(provider) {
        const container = this.providerEditorEl.querySelector('[data-ref="modelsList"]');
        if (!container) return;
        container.innerHTML = '';

        if (provider.models.length === 0) {
            container.innerHTML = `<span class="ai-models-empty">${t('settings.noModels')}</span>`;
            return;
        }

        provider.models.forEach((model, index) => {
            const tag = document.createElement('span');
            tag.className = 'ai-model-tag' + (model === this.selectedActiveModel ? ' is-active' : '');
            tag.dataset.model = model;
            tag.title = t('settings.activeModelTooltip');

            const label = document.createElement('span');
            label.className = 'ai-model-tag__name';
            label.textContent = model;
            tag.appendChild(label);

            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'ai-model-tag__remove';
            removeBtn.textContent = '×';
            tag.appendChild(removeBtn);

            const selectCleanup = addClickHandler(tag, (e) => {
                if (e.target === removeBtn || removeBtn.contains(e.target)) return;
                this.selectedActiveModel = model;
                this.renderModelsList(provider);
            });
            const removeCleanup = addClickHandler(removeBtn, () => {
                provider.models.splice(index, 1);
                if (this.selectedActiveModel === model) {
                    this.selectedActiveModel = provider.models[0] || '';
                }
                this.renderModelsList(provider);
            });
            this.cleanupFunctions.push(selectCleanup, removeCleanup);

            container.appendChild(tag);
        });
    }

    handleAddModel(provider) {
        const row = this.providerEditorEl?.querySelector('[data-ref="modelAddRow"]');
        const input = this.providerEditorEl?.querySelector('[data-ref="modelAddInput"]');
        if (!row) return;
        row.style.display = 'flex';
        input?.focus();
    }

    confirmAddModel(provider) {
        const input = this.providerEditorEl?.querySelector('[data-ref="modelAddInput"]');
        const name = input?.value?.trim();
        if (!name) return;
        if (!provider.models.includes(name)) {
            provider.models.push(name);
        }
        if (!this.selectedActiveModel) {
            this.selectedActiveModel = name;
        }
        input.value = '';
        this.closeModelAddRow();
        this.renderModelsList(provider);
    }

    closeModelAddRow() {
        const row = this.providerEditorEl?.querySelector('[data-ref="modelAddRow"]');
        if (row) row.style.display = 'none';
    }

    async handleFetchModels(provider) {
        this.syncCurrentProviderFromEditor();
        const statusEl = this.providerEditorEl.querySelector('[data-ref="modelsStatus"]');

        try {
            if (statusEl) {
                statusEl.textContent = t('settings.fetching');
                statusEl.className = 'ai-models-status';
            }
            const service = await getAiService();
            const models = await service.fetchModels(provider);
            if (models.length === 0) {
                if (statusEl) {
                    statusEl.textContent = t('settings.noModelsReturned');
                    statusEl.className = 'ai-models-status is-warning';
                }
                return;
            }
            // 合并到现有列表（去重）
            const existing = new Set(provider.models);
            models.forEach(m => existing.add(m));
            provider.models = [...existing];
            if (!this.selectedActiveModel && provider.models.length > 0) {
                this.selectedActiveModel = provider.models[0];
            }
            this.renderModelsList(provider);
            if (statusEl) {
                statusEl.textContent = t('settings.modelsFetched', { count: models.length });
                statusEl.className = 'ai-models-status is-success';
            }
        } catch (error) {
            if (statusEl) {
                statusEl.textContent = error.message || 'Fetch failed';
                statusEl.className = 'ai-models-status is-error';
            }
        }
    }

    async handleTestConnection(provider) {
        this.syncCurrentProviderFromEditor();
        const resultEl = this.providerEditorEl.querySelector('[data-ref="testResult"]');
        const testBtn = this.providerEditorEl.querySelector('[data-action="test-connection"]');
        const modelsContainer = this.providerEditorEl.querySelector('[data-ref="modelsList"]');

        const models = provider.models?.length > 0 ? provider.models : [];
        if (models.length === 0) {
            if (resultEl) {
                resultEl.textContent = t('settings.addModelFirst');
                resultEl.className = 'ai-provider-test__result is-error';
            }
            return;
        }

        // 重置所有模型状态
        if (modelsContainer) {
            for (const tag of modelsContainer.querySelectorAll('.ai-model-tag')) {
                tag.classList.remove('is-success', 'is-error', 'is-testing');
                const status = tag.querySelector('.ai-model-tag__status');
                if (status) status.textContent = '';
            }
        }

        if (testBtn) testBtn.disabled = true;
        if (resultEl) {
            resultEl.textContent = '';
            resultEl.className = 'ai-provider-test__result';
        }

        const service = await getAiService();
        let successCount = 0;

        for (const model of models) {
            const tag = modelsContainer?.querySelector(`.ai-model-tag[data-model="${CSS.escape(model)}"]`);
            const status = tag?.querySelector('.ai-model-tag__status');
            if (tag) tag.classList.add('is-testing');
            if (status) status.textContent = 'Testing…';

            const result = await service.testModel(provider, model);

            if (tag) tag.classList.remove('is-testing');
            if (result.success) {
                successCount++;
                if (tag) tag.classList.add('is-success');
                if (status) status.textContent = `${result.duration}ms`;
            } else {
                if (tag) tag.classList.add('is-error');
                if (status) status.textContent = result.error;
            }
        }

        if (resultEl) {
            resultEl.textContent = t('settings.modelsAvailable', { success: successCount, total: models.length });
            resultEl.className = `ai-provider-test__result ${successCount === models.length ? 'is-success' : 'is-error'}`;
        }
        if (testBtn) testBtn.disabled = false;
    }

    escAttr(str) {
        return (str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    dispose() {
        // 清理所有事件监听器
        this.cleanupFunctions.forEach(cleanup => {
            if (typeof cleanup === 'function') {
                cleanup();
            }
        });
        this.cleanupFunctions = [];

        // 移除 DOM 元素
        if (this.root && this.root.parentElement) {
            this.root.parentElement.removeChild(this.root);
        }
    }
}
