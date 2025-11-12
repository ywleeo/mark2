import { addClickHandler } from '../utils/PointerHelper.js';

export class SettingsDialog {
    constructor(options = {}) {
        this.onSubmit = typeof options.onSubmit === 'function' ? options.onSubmit : null;
        this.onCancel = typeof options.onCancel === 'function' ? options.onCancel : null;
        this.isOpen = false;
        this.cleanupFunctions = [];

        this.recommendedFonts = [
            {
                label: 'SF Pro / 系统无衬线',
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

        this.currentTab = 'editor'; // 'editor' or 'code'

        this.root = document.createElement('div');
        this.root.className = 'settings-modal hidden';
        this.root.innerHTML = `
            <div class="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settingsDialogTitle">
                <form class="settings-form">
                    <header class="settings-header">
                        <h2 id="settingsDialogTitle">应用设置</h2>
                        <nav class="settings-tabs">
                            <button type="button" class="settings-tab active" data-tab="editor">普通模式</button>
                            <button type="button" class="settings-tab" data-tab="code">代码模式</button>
                        </nav>
                    </header>

                    <!-- 编辑器设置 -->
                    <section class="settings-body" data-tab-content="editor">
                        <p class="settings-subtitle">设置默认的字号、行距、字重和字体</p>
                        <label class="settings-field">
                            <span class="settings-label">主题</span>
                            <select name="theme">
                                <option value="default">GitHub</option>
                                <option value="emerald">竹林清风</option>
                                <option value="notion">Notion</option>
                            </select>
                        </label>
                        <label class="settings-field">
                            <span class="settings-label">颜色模式</span>
                            <select name="appearance">
                                <option value="system">跟随系统 (默认)</option>
                                <option value="light">浅色</option>
                                <option value="dark">深色</option>
                            </select>
                        </label>
                        <label class="settings-field">
                            <span class="settings-label">字体</span>
                            <select name="fontFamily"></select>
                        </label>
                        <div class="settings-grid">
                            <label class="settings-field">
                                <span class="settings-label">字号 (px)</span>
                                <input type="number" name="fontSize" min="10" max="48" step="1" />
                            </label>
                            <label class="settings-field">
                                <span class="settings-label">行距</span>
                                <input type="number" name="lineHeight" min="1.0" max="3.0" step="0.1" />
                            </label>
                            <label class="settings-field">
                                <span class="settings-label">字重</span>
                                <select name="fontWeight">
                                    <option value="100">Thin 100</option>
                                    <option value="200">Extra Light 200</option>
                                    <option value="300">Light 300</option>
                                    <option value="400">Regular 400</option>
                                    <option value="500">Medium 500</option>
                                    <option value="600">Semibold 600</option>
                                    <option value="700">Bold 700</option>
                                    <option value="800">Extra Bold 800</option>
                                    <option value="900">Black 900</option>
                                </select>
                            </label>
                        </div>
                    </section>

                    <!-- Code 模式设置 -->
                    <section class="settings-body hidden" data-tab-content="code">
                        <p class="settings-subtitle">设置代码模式的字体样式</p>
                        <label class="settings-field">
                            <span class="settings-label">字体</span>
                            <select name="codeFontFamily"></select>
                        </label>
                        <div class="settings-grid">
                            <label class="settings-field">
                                <span class="settings-label">字号 (px)</span>
                                <input type="number" name="codeFontSize" min="10" max="48" step="1" />
                            </label>
                            <label class="settings-field">
                                <span class="settings-label">行距</span>
                                <input type="number" name="codeLineHeight" min="1.0" max="3.0" step="0.1" />
                            </label>
                            <label class="settings-field">
                                <span class="settings-label">字重</span>
                                <select name="codeFontWeight">
                                    <option value="100">Thin 100</option>
                                    <option value="200">Extra Light 200</option>
                                    <option value="300">Light 300</option>
                                    <option value="400">Regular 400</option>
                                    <option value="500">Medium 500</option>
                                    <option value="600">Semibold 600</option>
                                    <option value="700">Bold 700</option>
                                    <option value="800">Extra Bold 800</option>
                                    <option value="900">Black 900</option>
                                </select>
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

        // Code 模式设置字段
        this.codeFontFamilySelect = this.form.querySelector('select[name="codeFontFamily"]');
        this.codeFontSizeInput = this.form.querySelector('input[name="codeFontSize"]');
        this.codeLineHeightInput = this.form.querySelector('input[name="codeLineHeight"]');
        this.codeFontWeightSelect = this.form.querySelector('select[name="codeFontWeight"]');

        // AI 设置字段
        this.cancelButton = this.form.querySelector('[data-action="cancel"]');
        this.saveButton = this.form.querySelector('button[type="submit"]');

        this.handleSubmit = this.handleSubmit.bind(this);
        this.handleKeydown = this.handleKeydown.bind(this);
        this.handleBackdropClick = this.handleBackdropClick.bind(this);

        this.form.addEventListener('submit', this.handleSubmit);
        this.root.addEventListener('mousedown', this.handleBackdropClick);

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
        defaultOption.textContent = '跟随系统 (默认)';
        this.codeFontFamilySelect.appendChild(defaultOption);

        this.codeModeFonts.forEach(font => {
            const option = document.createElement('option');
            option.value = font.value;
            option.textContent = font.label;
            this.codeFontFamilySelect.appendChild(option);
        });
    }

    open(settings) {
        const editorPrefs = settings || {};

        // 编辑器设置
        this.themeSelect.value = editorPrefs.theme || 'default';
        if (this.appearanceSelect) {
            this.appearanceSelect.value = editorPrefs.appearance || 'system';
        }
        this.syncFontSelection(editorPrefs.fontFamily || '');
        this.fontSizeInput.value = Number(editorPrefs.fontSize) || 16;
        this.lineHeightInput.value = Number(editorPrefs.lineHeight) || 1.6;
        this.syncFontWeight(editorPrefs.fontWeight);

        // Code 模式设置
        this.codeFontFamilySelect.value = editorPrefs.codeFontFamily || '';
        this.codeFontSizeInput.value = Number(editorPrefs.codeFontSize) || 14;
        this.codeLineHeightInput.value = Number(editorPrefs.codeLineHeight) || 1.5;
        this.codeFontWeightSelect.value = String(editorPrefs.codeFontWeight || 400);

        // 重置到第一个 tab
        this.switchTab('editor');

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

        if (triggerCancel && this.onCancel) {
            this.onCancel();
        }
    }

    handleSubmit(event) {
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
            codeFontSize: normalizedCodeSize,
            codeLineHeight: Number(normalizedCodeLineHeight.toFixed(2)),
            codeFontFamily: codeFontFamily || '',
            codeFontWeight: Number.isFinite(codeFontWeight) ? codeFontWeight : 400,
        };

        if (this.onSubmit) {
            this.onSubmit(sanitized);
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
                existing.textContent = `自定义：${value}`;
            }
            return;
        }

        this.removeDynamicFontOption();
        const customOption = document.createElement('option');
        customOption.value = value;
        customOption.textContent = `自定义：${value}`;
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
        defaultOption.textContent = '跟随系统 (默认)';
        this.fontFamilySelect.appendChild(defaultOption);

        if (this.recommendedFonts.length > 0) {
            const recommendedGroup = document.createElement('optgroup');
            recommendedGroup.label = '推荐字体';
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
            systemGroup.label = '系统字体';
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
