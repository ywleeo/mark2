import { Dropdown } from './Dropdown.js';
import { addClickHandler } from '../utils/PointerHelper.js';
import { t, getLocale, setLocale } from '../i18n/index.js';
import { KeybindingsSettings } from './KeybindingsSettings.js';
import { saveCustomKeybindings } from '../utils/keybindingsStorage.js';
import { PROVIDER_PRESETS } from '../modules/ai-assistant/providerPresets.js';
import { invoke } from '@tauri-apps/api/core';
import { isMac } from '../utils/platform.js';

const DEFAULT_APP_EXTENSIONS = ['md', 'markdown', 'mkd', 'txt', 'json'];

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
                            ${isMac ? `
                            <div class="settings-row settings-row--default-app" data-ref="defaultAppRow">
                                <span class="settings-row__label">${t('settings.defaultApp')}</span>
                                <div class="settings-default-app-actions">
                                    <div class="settings-default-app-exts" data-ref="defaultAppExts"></div>
                                    <button type="button" class="settings-default-app-btn" data-ref="defaultAppBtn">…</button>
                                </div>
                            </div>
                            ` : ''}
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
                        <div class="settings-section-label">${t('settings.apiKeys')}</div>
                        <div class="ai-keys-list" data-ref="aiKeysList"></div>

                        <div class="settings-rows">
                            <label class="settings-row">
                                <span class="settings-row__label">${t('settings.assistantModel')}</span>
                                <select data-ref="assistantModelSelect" class="settings-row__control"></select>
                            </label>
                            <label class="settings-row settings-row--sub">
                                <span class="settings-row__label">${t('settings.creativity')}</span>
                                <select name="aiCreativity" class="settings-row__control">
                                    <option value="low">${t('settings.creativityLow')}</option>
                                    <option value="medium">${t('settings.creativityMedium')}</option>
                                    <option value="high">${t('settings.creativityHigh')}</option>
                                </select>
                            </label>
                            <label class="settings-row">
                                <span class="settings-row__label">${t('settings.fastModel')}</span>
                                <select data-ref="fastModelSelect" class="settings-row__control"></select>
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
        this.aiKeysListEl = this.root.querySelector('[data-ref="aiKeysList"]');
        this.assistantModelSelectEl = this.root.querySelector('[data-ref="assistantModelSelect"]');
        this.fastModelSelectEl = this.root.querySelector('[data-ref="fastModelSelect"]');
        this.aiConfiguredProviders = []; // [{ id, apiKey, isCustom?, name?, baseUrl?, models? }]

        // 快捷键设置
        this.keybindingsContainerEl = this.root.querySelector('[data-ref="keybindingsContainer"]');
        this.keybindingsSettings = null;

        // 默认应用按钮（仅 macOS 渲染）
        this.defaultAppBtn = this.root.querySelector('[data-ref="defaultAppBtn"]');
        this.defaultAppExtsEl = this.root.querySelector('[data-ref="defaultAppExts"]');
        if (this.defaultAppBtn) {
            const cleanup = addClickHandler(this.defaultAppBtn, () => this._onDefaultAppClick());
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

        this._dropdownMap = new Map();
        this.availableFonts = [];
        this.setAvailableFonts([]);
        this.initCodeFontOptions();
        this._wrapSettingsSelects();
    }

    _settingsSelectElements() {
        return [
            this.themeSelect,
            this.appearanceSelect,
            this.languageSelect,
            this.fontFamilySelect,
            this.fontWeightSelect,
            this.codeThemeSelect,
            this.codeFontFamilySelect,
            this.codeFontWeightSelect,
            this.aiCreativitySelect,
        ].filter(Boolean);
    }

    _wrapSettingsSelects() {
        for (const el of this._settingsSelectElements()) {
            if (!this._dropdownMap.has(el)) {
                this._dropdownMap.set(el, new Dropdown(el));
            }
        }
    }

    _destroySettingsSelects() {
        for (const dd of this._dropdownMap.values()) {
            try { dd.destroy(); } catch (_) { /* ignore */ }
        }
        this._dropdownMap.clear();
    }

    _refreshDropdown(el) {
        const dd = this._dropdownMap.get(el);
        if (dd) dd.refresh();
    }

    _setSelectValue(el, value) {
        const v = value == null ? '' : String(value);
        const dd = this._dropdownMap.get(el);
        if (dd) {
            dd.setValue(v);
        } else if (el) {
            el.value = v;
        }
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
        this._setSelectValue(this.themeSelect, editorPrefs.theme || 'default');
        if (this.appearanceSelect) {
            this._setSelectValue(this.appearanceSelect, editorPrefs.appearance || 'system');
        }
        if (this.languageSelect) {
            this._setSelectValue(this.languageSelect, getLocale());
        }
        this.syncFontSelection(editorPrefs.fontFamily || '');
        this.fontSizeInput.value = Number(editorPrefs.fontSize) || 16;
        this.lineHeightInput.value = Number(editorPrefs.lineHeight) || 1.6;
        this.syncFontWeight(editorPrefs.fontWeight);

        // Code 模式设置
        this._setSelectValue(this.codeThemeSelect, editorPrefs.codeTheme || 'auto');
        this._setSelectValue(this.codeFontFamilySelect, editorPrefs.codeFontFamily || '');
        this.codeFontSizeInput.value = Number(editorPrefs.codeFontSize) || 14;
        this.codeLineHeightInput.value = Number(editorPrefs.codeLineHeight) || 1.5;
        this._setSelectValue(this.codeFontWeightSelect, String(editorPrefs.codeFontWeight || 400));
        // AI 助手设置 - 从 aiService 读取
        const aiConfig = await this.loadAiConfig();
        this.aiConfiguredProviders = (aiConfig.providers || []).map(p => ({ ...p }));
        this._setSelectValue(this.aiCreativitySelect, aiConfig.preferences?.creativity || 'medium');
        this._renderAiKeysList();
        this._renderModelSelects(aiConfig.assistantModel, aiConfig.fastModel);

        // 快捷键设置
        if (this.keybindingsSettings) {
            this.keybindingsSettings.destroy();
        }
        this.keybindingsSettings = new KeybindingsSettings({
            container: this.keybindingsContainerEl,
        });

        // 默认打开方式状态查询（异步，不阻塞 open）
        this._refreshDefaultAppStatus();

        // 重置到第一个 tab
        this.switchTab('general');

        if (!this.isOpen) {
            document.addEventListener('keydown', this.handleKeydown);
        }

        this.root.classList.remove('hidden');
        this.isOpen = true;
    }

    async _refreshDefaultAppStatus() {
        if (!this.defaultAppBtn) return;
        try {
            const status = await invoke('get_default_app_status', { extensions: DEFAULT_APP_EXTENSIONS });
            this._renderDefaultAppExts(status);
            const allSet = status.length > 0 && status.every(s => s.isSelf);
            if (allSet) {
                this.defaultAppBtn.textContent = t('settings.defaultAppAllSet');
                this.defaultAppBtn.dataset.state = 'done';
                this.defaultAppBtn.disabled = true;
            } else {
                this.defaultAppBtn.textContent = t('settings.defaultAppSet');
                this.defaultAppBtn.dataset.state = 'pending';
                this.defaultAppBtn.disabled = false;
            }
        } catch (error) {
            console.warn('[Settings] get_default_app_status failed:', error);
            this._renderDefaultAppExts(DEFAULT_APP_EXTENSIONS.map(ext => ({ extension: ext, isSelf: false })));
            this.defaultAppBtn.textContent = t('settings.defaultAppSet');
            this.defaultAppBtn.dataset.state = 'pending';
            this.defaultAppBtn.disabled = false;
        }
    }

    _renderDefaultAppExts(status) {
        if (!this.defaultAppExtsEl) return;
        this.defaultAppExtsEl.innerHTML = '';
        status.forEach(s => {
            const chip = document.createElement('span');
            chip.className = s.isSelf
                ? 'settings-default-app-ext settings-default-app-ext--on'
                : 'settings-default-app-ext settings-default-app-ext--off';
            chip.textContent = `.${s.extension}`;
            this.defaultAppExtsEl.appendChild(chip);
        });
    }

    async _onDefaultAppClick() {
        if (!this.defaultAppBtn || this.defaultAppBtn.disabled) return;
        this.defaultAppBtn.disabled = true;
        try {
            const results = await invoke('set_as_default_app', { extensions: DEFAULT_APP_EXTENSIONS });
            const failed = Array.isArray(results) ? results.filter(r => !r.success) : [];
            if (failed.length > 0) {
                console.warn('[Settings] some extensions failed to set default:', failed);
            }
        } catch (error) {
            console.warn('[Settings] set_as_default_app failed:', error);
        }
        await this._refreshDefaultAppStatus();
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

        // AI 助手设置
        const providers = this.aiConfiguredProviders
            .filter(p => p.apiKey?.trim())
            .map(p => {
                if (p.isCustom) return { id: p.id, name: p.name, baseUrl: p.baseUrl, apiKey: p.apiKey.trim(), models: p.models, isCustom: true };
                const entry = { id: p.id, apiKey: p.apiKey.trim() };
                if (p.fetchedModels?.length) entry.fetchedModels = p.fetchedModels;
                return entry;
            });
        const parseModelSlot = (val) => {
            const [providerId, ...rest] = (val || '').split('::');
            const model = rest.join('::');
            return providerId && model ? { providerId, model } : null;
        };
        const aiConfig = {
            providers,
            assistantModel: parseModelSlot(this.assistantModelSelectEl?.value),
            fastModel: parseModelSlot(this.fastModelSelectEl?.value),
            preferences: { creativity: this.aiCreativitySelect.value || 'medium' },
        };
        await this.saveAiConfig(aiConfig);

        // 保存自定义快捷键
        if (this.keybindingsSettings) {
            await saveCustomKeybindings(this.keybindingsSettings.getCustomBindings());
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
            const removed = this.removeDynamicFontOption();
            if (removed) this._refreshDropdown(this.fontFamilySelect);
            this._setSelectValue(this.fontFamilySelect, '');
            return;
        }

        const options = Array.from(this.fontFamilySelect.options);
        const existing = options.find(option => option.value === value);

        if (existing) {
            if (existing.dataset.dynamic === 'true' && existing.textContent !== `Custom: ${value}`) {
                existing.textContent = `Custom: ${value}`;
                this._refreshDropdown(this.fontFamilySelect);
            }
            this._setSelectValue(this.fontFamilySelect, value);
            return;
        }

        this.removeDynamicFontOption();
        const customOption = document.createElement('option');
        customOption.value = value;
        customOption.textContent = `Custom: ${value}`;
        customOption.dataset.dynamic = 'true';
        this.fontFamilySelect.appendChild(customOption);
        this._refreshDropdown(this.fontFamilySelect);
        this._setSelectValue(this.fontFamilySelect, value);
    }

    removeDynamicFontOption() {
        const options = Array.from(this.fontFamilySelect.options);
        const custom = options.find(option => option.dataset.dynamic === 'true');
        if (custom) {
            custom.remove();
            return true;
        }
        return false;
    }

    syncFontWeight(weight) {
        const allowed = ['100', '200', '300', '400', '500', '600', '700', '800', '900'];
        const value = Number.isFinite(Number(weight)) ? String(weight) : '400';
        this._setSelectValue(this.fontWeightSelect, allowed.includes(value) ? value : '400');
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

        this._refreshDropdown(this.fontFamilySelect);
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

    // ── AI 设置 UI ───────────────────────────────────────

    _renderAiKeysList() {
        if (!this.aiKeysListEl) return;
        this.aiKeysListEl.innerHTML = '';

        this.aiConfiguredProviders.forEach((provider, index) => {
            this.aiKeysListEl.appendChild(this._buildProviderRow(provider, index));
        });

        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'ai-add-provider-btn';
        addBtn.textContent = t('settings.addProvider');
        const cleanup = addClickHandler(addBtn, () => this._showAddProviderForm(addBtn));
        this.cleanupFunctions.push(cleanup);
        this.aiKeysListEl.appendChild(addBtn);
    }

    _buildProviderRow(provider, index) {
        const preset = PROVIDER_PRESETS.find(p => p.id === provider.id);

        if (provider.isCustom) {
            const card = document.createElement('div');
            card.className = 'ai-provider-card ai-provider-card--custom';

            const header = document.createElement('div');
            header.className = 'ai-provider-card__header';

            const nameInput = document.createElement('input');
            nameInput.type = 'text';
            nameInput.className = 'ai-provider-card__name-input';
            nameInput.value = provider.name || '';
            nameInput.placeholder = t('settings.providerNamePlaceholder');
            nameInput.addEventListener('input', () => { this.aiConfiguredProviders[index].name = nameInput.value; });

            const badge = document.createElement('span');
            badge.className = 'ai-provider-card__badge';
            badge.textContent = t('settings.customProvider');

            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'ai-provider-card__remove';
            removeBtn.textContent = '✕';
            const c = addClickHandler(removeBtn, () => {
                this.aiConfiguredProviders.splice(index, 1);
                this._renderAiKeysList();
                this._refreshModelSelects();
            });
            this.cleanupFunctions.push(c);

            header.appendChild(nameInput);
            header.appendChild(badge);
            header.appendChild(removeBtn);
            card.appendChild(header);

            const urlInput = document.createElement('input');
            urlInput.type = 'text';
            urlInput.className = 'ai-provider-card__input';
            urlInput.value = provider.baseUrl || '';
            urlInput.placeholder = t('settings.baseUrlPlaceholder');
            urlInput.addEventListener('input', () => { this.aiConfiguredProviders[index].baseUrl = urlInput.value.trim(); });
            card.appendChild(urlInput);

            const keyInput = document.createElement('input');
            keyInput.type = 'password';
            keyInput.className = 'ai-provider-card__input';
            keyInput.value = provider.apiKey || '';
            keyInput.placeholder = t('settings.apiKey');
            keyInput.autocomplete = 'off';
            keyInput.addEventListener('input', () => {
                this.aiConfiguredProviders[index].apiKey = keyInput.value.trim();
                this._refreshModelSelects();
            });
            card.appendChild(keyInput);

            const modelsInput = document.createElement('input');
            modelsInput.type = 'text';
            modelsInput.className = 'ai-provider-card__input';
            modelsInput.value = (provider.models || []).join(', ');
            modelsInput.placeholder = t('settings.modelsPlaceholder');
            modelsInput.addEventListener('input', () => {
                this.aiConfiguredProviders[index].models = modelsInput.value.split(',').map(m => m.trim()).filter(Boolean);
                this._refreshModelSelects();
            });
            card.appendChild(modelsInput);

            return card;
        }

        // Preset provider row
        const row = document.createElement('div');
        row.className = 'ai-key-row';

        const label = document.createElement('span');
        label.className = 'ai-key-row__name';
        label.textContent = preset?.name || provider.id;
        row.appendChild(label);

        const input = document.createElement('input');
        input.type = 'password';
        input.className = 'ai-key-row__input';
        input.placeholder = 'API Key';
        input.value = provider.apiKey || '';
        input.autocomplete = 'off';
        input.addEventListener('input', () => {
            this.aiConfiguredProviders[index].apiKey = input.value.trim();
            this._refreshModelSelects();
        });
        row.appendChild(input);

        const fetchBtn = document.createElement('button');
        fetchBtn.type = 'button';
        fetchBtn.className = 'ai-key-row__fetch';
        fetchBtn.title = t('settings.fetchList');
        fetchBtn.textContent = '↻';
        fetchBtn.dataset.fetchIndex = String(index);
        const cf = addClickHandler(fetchBtn, () => this._fetchProviderModels(index));
        this.cleanupFunctions.push(cf);
        row.appendChild(fetchBtn);

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'ai-provider-card__remove';
        removeBtn.textContent = '✕';
        const c = addClickHandler(removeBtn, () => {
            this.aiConfiguredProviders.splice(index, 1);
            this._renderAiKeysList();
            this._refreshModelSelects();
        });
        this.cleanupFunctions.push(c);
        row.appendChild(removeBtn);

        return row;
    }

    _showAddProviderForm(addBtn) {
        const existing = this.aiKeysListEl.querySelector('.ai-add-form');
        if (existing) { existing.remove(); return; }

        const addedIds = new Set(this.aiConfiguredProviders.map(p => p.id));
        const availablePresets = PROVIDER_PRESETS.filter(p => !addedIds.has(p.id));

        const form = document.createElement('div');
        form.className = 'ai-add-form';

        const providerSelect = document.createElement('select');
        providerSelect.className = 'ai-add-form__select';

        const blankOpt = document.createElement('option');
        blankOpt.value = '';
        blankOpt.textContent = t('settings.selectProvider');
        providerSelect.appendChild(blankOpt);

        availablePresets.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.name;
            providerSelect.appendChild(opt);
        });

        const customOpt = document.createElement('option');
        customOpt.value = '__custom__';
        customOpt.textContent = t('settings.customProvider');
        providerSelect.appendChild(customOpt);

        form.appendChild(providerSelect);

        const fieldsEl = document.createElement('div');
        fieldsEl.className = 'ai-add-form__fields';
        form.appendChild(fieldsEl);

        const actions = document.createElement('div');
        actions.className = 'ai-add-form__actions';

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'ai-add-form__btn ai-add-form__btn--secondary';
        cancelBtn.textContent = t('settings.cancel');
        const c1 = addClickHandler(cancelBtn, () => form.remove());
        this.cleanupFunctions.push(c1);

        const confirmBtn = document.createElement('button');
        confirmBtn.type = 'button';
        confirmBtn.className = 'ai-add-form__btn ai-add-form__btn--primary';
        confirmBtn.textContent = t('settings.add');

        actions.appendChild(cancelBtn);
        actions.appendChild(confirmBtn);
        form.appendChild(actions);

        const renderFields = (selectedId) => {
            fieldsEl.innerHTML = '';
            if (!selectedId) return;

            if (selectedId === '__custom__') {
                const nameInput = document.createElement('input');
                nameInput.type = 'text';
                nameInput.className = 'ai-add-form__input';
                nameInput.placeholder = t('settings.providerNamePlaceholder');
                nameInput.dataset.field = 'name';
                fieldsEl.appendChild(nameInput);

                const urlInput = document.createElement('input');
                urlInput.type = 'text';
                urlInput.className = 'ai-add-form__input';
                urlInput.placeholder = t('settings.baseUrlPlaceholder');
                urlInput.dataset.field = 'baseUrl';
                fieldsEl.appendChild(urlInput);
            }

            const keyInput = document.createElement('input');
            keyInput.type = 'password';
            keyInput.className = 'ai-add-form__input';
            keyInput.placeholder = t('settings.apiKey');
            keyInput.autocomplete = 'off';
            keyInput.dataset.field = 'apiKey';
            fieldsEl.appendChild(keyInput);

            if (selectedId === '__custom__') {
                const modelsInput = document.createElement('input');
                modelsInput.type = 'text';
                modelsInput.className = 'ai-add-form__input';
                modelsInput.placeholder = t('settings.modelsPlaceholder');
                modelsInput.dataset.field = 'models';
                fieldsEl.appendChild(modelsInput);
            }
        };

        providerSelect.addEventListener('change', () => renderFields(providerSelect.value));

        const c2 = addClickHandler(confirmBtn, () => {
            const selectedId = providerSelect.value;
            if (!selectedId) return;

            const getField = (name) => fieldsEl.querySelector(`[data-field="${name}"]`)?.value?.trim() || '';

            if (selectedId === '__custom__') {
                const name = getField('name');
                const baseUrl = getField('baseUrl');
                if (!name || !baseUrl) return;
                this.aiConfiguredProviders.push({
                    id: `custom_${Date.now().toString(36)}`,
                    name,
                    baseUrl,
                    apiKey: getField('apiKey'),
                    models: getField('models').split(',').map(m => m.trim()).filter(Boolean),
                    isCustom: true,
                });
            } else {
                const apiKey = getField('apiKey');
                this.aiConfiguredProviders.push({ id: selectedId, apiKey });
                this._renderAiKeysList();
                this._refreshModelSelects();
                if (apiKey) this._fetchProviderModels(this.aiConfiguredProviders.length - 1);
                return;
            }

            this._renderAiKeysList();
            this._refreshModelSelects();
        });
        this.cleanupFunctions.push(c2);

        addBtn.parentNode.insertBefore(form, addBtn);
    }

    _renderModelSelects(assistantModel, fastModel) {
        if (!this.assistantModelSelectEl || !this.fastModelSelectEl) return;

        const buildOptions = (currentVal) => {
            const fragment = document.createDocumentFragment();
            const blank = document.createElement('option');
            blank.value = '';
            blank.textContent = '— ' + t('settings.selectModel') + ' —';
            fragment.appendChild(blank);

            this.aiConfiguredProviders.forEach(provider => {
                if (!provider.apiKey) return;
                const preset = PROVIDER_PRESETS.find(p => p.id === provider.id);
                const models = provider.isCustom
                    ? (provider.models || [])
                    : (provider.fetchedModels?.length ? provider.fetchedModels : (preset?.models || []));
                const name = provider.isCustom ? provider.name : (preset?.name || provider.id);
                if (models.length === 0) return;

                const group = document.createElement('optgroup');
                group.label = name;
                models.forEach(model => {
                    const opt = document.createElement('option');
                    opt.value = `${provider.id}::${model}`;
                    opt.textContent = model;
                    if (opt.value === currentVal) opt.selected = true;
                    group.appendChild(opt);
                });
                fragment.appendChild(group);
            });
            return fragment;
        };

        const assistantVal = assistantModel ? `${assistantModel.providerId}::${assistantModel.model}` : '';
        const fastVal = fastModel ? `${fastModel.providerId}::${fastModel.model}` : '';

        this.assistantModelSelectEl.innerHTML = '';
        this.assistantModelSelectEl.appendChild(buildOptions(assistantVal));

        this.fastModelSelectEl.innerHTML = '';
        this.fastModelSelectEl.appendChild(buildOptions(fastVal));

        for (const el of [this.assistantModelSelectEl, this.fastModelSelectEl]) {
            if (this._dropdownMap.has(el)) {
                try { this._dropdownMap.get(el).destroy(); } catch (_) {}
                this._dropdownMap.delete(el);
            }
            this._dropdownMap.set(el, new Dropdown(el));
        }
    }

    _refreshModelSelects() {
        const parseVal = (val) => {
            const [providerId, ...rest] = (val || '').split('::');
            const model = rest.join('::');
            return providerId && model ? { providerId, model } : null;
        };
        this._renderModelSelects(
            parseVal(this.assistantModelSelectEl?.value),
            parseVal(this.fastModelSelectEl?.value),
        );
    }

    async _fetchProviderModels(index) {
        const provider = this.aiConfiguredProviders[index];
        if (!provider || provider.isCustom || !provider.apiKey) return;

        const preset = PROVIDER_PRESETS.find(p => p.id === provider.id);
        if (!preset) return;

        const btn = this.aiKeysListEl?.querySelector(`[data-fetch-index="${index}"]`);
        if (btn) { btn.textContent = '…'; btn.disabled = true; }

        try {
            const service = await getAiService();
            const models = await service.fetchModels({ ...preset, apiKey: provider.apiKey });
            if (models.length > 0) {
                this.aiConfiguredProviders[index].fetchedModels = models;
                this._refreshModelSelects();
            }
        } catch (e) {
            console.warn('[Settings] 获取模型列表失败:', e.message);
        } finally {
            if (btn) { btn.textContent = '↻'; btn.disabled = false; }
        }
    }

    escAttr(str) {
        return (str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    dispose() {
        this._destroySettingsSelects();

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
