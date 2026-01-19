import 'monaco-editor/min/vs/editor/editor.main.css';
import 'monaco-editor/esm/vs/language/json/monaco.contribution';
import 'monaco-editor/esm/vs/language/css/monaco.contribution';
import 'monaco-editor/esm/vs/language/html/monaco.contribution';
import 'monaco-editor/esm/vs/language/typescript/monaco.contribution';
import 'monaco-editor/esm/vs/basic-languages/monaco.contribution';
import 'monaco-editor/esm/vs/editor/contrib/comment/browser/comment.js';
import { getAppServices } from '../../services/appServices.js';
import { normalizeFsPath } from '../../utils/pathUtils.js';
import {
    ensureMarkdownTrailingEmptyLine,
    shouldEnforceMarkdownTrailingEmptyLine,
} from '../../utils/markdownFormatting.js';
import { ensureMonaco, buildModelUri } from './MonacoEnvironment.js';
import {
    ensurePythonLanguage,
    ensureCsvLanguage,
    ensureBashAlias,
    ensureMarkdownSqlThemes,
    ensureYamlLanguage,
    ensureCodeThemes,
} from './LanguageSupport.js';
import { getThemeVariant } from '../../config/code-themes.js';
import {
    DEFAULT_CODE_FONT_SIZE,
    DEFAULT_LINE_HEIGHT_RATIO,
    MIN_ZOOM_SCALE,
    MAX_ZOOM_SCALE,
} from './constants.js';

export class CodeEditor {
    constructor(containerElement, callbacks = {}, options = {}) {
        this.container = containerElement;
        this.container.classList.add('code-editor-pane');
        this.callbacks = callbacks;

        this.editorHost = document.createElement('div');
        this.editorHost.className = 'code-editor__instance';
        this.container.appendChild(this.editorHost);

        this.monaco = null;
        this.editor = null;
        this.currentModel = null;
        this.modelDisposer = null;
        this.isVisible = false;
        this.currentFile = null;
        this.currentLanguage = null;
        this.baseVersion = 0;
        this.isDirty = false;
        this.suppressChange = false;
        this.pendingLayoutFrame = null;
        this.preferences = null;
        this.documentSessions = options?.documentSessions || null;
        this.currentSessionId = null;
        this.loadingSessionId = null;
        this.currentTabId = null;
        this.tabViewStates = new Map();

        // 自动保存相关
        this.autoSaveDelayMs = Number.isFinite(options.autoSaveDelayMs)
            ? Math.max(500, options.autoSaveDelayMs)
            : 3000;
        this.autoSaveTimer = null;
        this.isSaving = false;
        this.activeSavePromise = null;
        this.autoSavePlannedSessionId = null;

        this.handleResize = () => this.requestLayout();
        this.tapGuardState = null;
        this.tapGuardCleanup = null;
        this.aiStreamSessions = new Map();
        this.searchTerm = '';
        this.searchMatches = null;
        this.searchDecorations = null;
        this.currentMatchIndex = -1;
        this.contentChangeListeners = new Set();
        this.zoomScale = 1;
        this.baseFontSize = DEFAULT_CODE_FONT_SIZE;
        this.baseLineHeightRatio = DEFAULT_LINE_HEIGHT_RATIO;
        this.baseLineHeight = Math.max(
            Math.round(this.baseFontSize * this.baseLineHeightRatio),
            this.baseFontSize
        );
    }

    isSessionActive(sessionId) {
        if (!sessionId) {
            return true;
        }
        if (!this.documentSessions || typeof this.documentSessions.isSessionActive !== 'function') {
            return true;
        }
        return this.documentSessions.isSessionActive(sessionId);
    }

    prepareForDocument(session, filePath, tabId = null) {
        const previousSessionId = this.currentSessionId;
        const sessionId = session?.id ?? this.currentSessionId ?? null;
        const previousFile = this.currentFile;
        const isFileSwitching = previousFile !== filePath;
        const previousTabId = this.currentTabId;
        if (previousTabId) {
            this.saveViewStateForTab(previousTabId);
        }
        const nextTabId = typeof tabId === 'string' && tabId.length > 0 ? tabId : null;
        this.currentSessionId = sessionId;
        this.loadingSessionId = sessionId;
        this.currentFile = filePath;
        this.currentTabId = nextTabId;
        this.isDirty = false;
        if (!this.editor) {
            return;
        }
        this.suppressChange = true;
        try {
            // 只在切换文件时清空内容
            // 重载当前文件时不清空，直接更新内容即可，避免失焦
            if (isFileSwitching) {
                if (this.currentModel) {
                    this.currentModel.setValue('');
                } else if (typeof this.editor.setValue === 'function') {
                    this.editor.setValue('');
                }
            }
        } finally {
            this.suppressChange = false;
        }
    }

    async ensureEditor(defaultLanguage = 'plaintext') {
        if (this.editor) {
            return;
        }

        const monacoModule = await ensureMonaco();
        const monaco = monacoModule;
        ensurePythonLanguage(monaco);
        ensureCsvLanguage(monaco);
        ensureBashAlias(monaco);
        ensureYamlLanguage(monaco);
        ensureMarkdownSqlThemes(monaco);
        ensureCodeThemes(monaco);
        this.monaco = monaco;
        this.editor = monaco.editor.create(this.editorHost, {
            value: '',
            language: defaultLanguage,
            theme: 'vs',
            minimap: { enabled: false },
            automaticLayout: false,
            scrollBeyondLastLine: false,
            dragAndDrop: false,
            smoothScrolling: true,
            fontSize: 14,
            lineNumbers: 'on',
            renderWhitespace: 'selection',
            tabSize: 4,
            insertSpaces: true,
            detectIndentation: false,
            wordWrap: 'on',
            padding: { top: 5, bottom: 5},
            scrollbar: {
                verticalScrollbarSize: 8,
                horizontalScrollbarSize: 8,
                useShadows: false,
            },
        });
        if (this.editorHost) {
            this.editorHost.style.touchAction = 'none';
            this.editorHost.style.webkitUserDrag = 'none';
        }
        this.applyPreferencesToEditor();

        // 添加 Cmd+/ 快捷键用于切换注释
        // Monaco Editor 内置的注释功能会自动处理
        this.editor.addCommand(
            monaco.KeyMod.CtrlCmd | monaco.KeyCode.Slash,
            () => {
                this.editor.trigger('keyboard', 'editor.action.commentLine', null);
            }
        );

        window.addEventListener('resize', this.handleResize, { passive: true });
        this.requestLayout();
        this.setupTapSelectionGuard();
    }

    requestLayout() {
        if (!this.editor) {
            return;
        }
        if (this.pendingLayoutFrame !== null) {
            cancelAnimationFrame(this.pendingLayoutFrame);
        }
        this.pendingLayoutFrame = window.requestAnimationFrame(() => {
            this.pendingLayoutFrame = null;
            this.editor.layout();
        });
    }

    async show(filePath, content, language = null, session = null, options = {}) {
        const {
            autoFocus = true,
            tabId = null,
        } = options;
        const sessionId = session?.id ?? this.currentSessionId ?? null;
        if (session && !this.isSessionActive(sessionId)) {
            return;
        }

        if (tabId && tabId !== this.currentTabId) {
            this.currentTabId = tabId;
        }
        this.currentSessionId = sessionId;
        this.loadingSessionId = sessionId;
        await this.ensureEditor();

        if (!this.monaco || !this.editor) {
            if (this.loadingSessionId === sessionId) {
                this.loadingSessionId = null;
            }
            return;
        }
        if (sessionId && !this.isSessionActive(sessionId)) {
            if (this.loadingSessionId === sessionId) {
                this.loadingSessionId = null;
            }
            return;
        }

        const monaco = this.monaco;
        const targetLanguage = this.resolveLanguage(language);
        const baseContent = typeof content === 'string' ? content : '';
        const shouldNormalizeMarkdown = shouldEnforceMarkdownTrailingEmptyLine(filePath, targetLanguage);
        const normalizedContent = shouldNormalizeMarkdown
            ? ensureMarkdownTrailingEmptyLine(baseContent)
            : baseContent;

        const uri = buildModelUri(monaco, filePath);
        let model = monaco.editor.getModel(uri);
        if (!model) {
            model = monaco.editor.createModel(normalizedContent, targetLanguage, uri);
        } else {
            this.suppressChange = true;
            model.setValue(normalizedContent);
            this.suppressChange = false;
            monaco.editor.setModelLanguage(model, targetLanguage);
        }

        const tabSize = targetLanguage === 'markdown' ? 2 : 4;
        model.updateOptions({
            tabSize: tabSize,
            indentSize: tabSize,
            insertSpaces: true,
            detectIndentation: false,
        });

        if (this.currentModel && this.currentModel !== model) {
            this.currentModel.dispose();
        }

        if (sessionId && !this.isSessionActive(sessionId)) {
            if (this.loadingSessionId === sessionId) {
                this.loadingSessionId = null;
            }
            return;
        }

        this.attachModel(model, targetLanguage);

        this.currentFile = filePath;
        this.currentLanguage = targetLanguage;

        this.editor.updateOptions({
            tabSize: targetLanguage === 'markdown' ? 2 : 4,
            insertSpaces: true,
            detectIndentation: false,
        });
        this.restoreViewStateForTab(this.currentTabId);
        this.showContainer();
        this.requestLayout();

        // autoFocus 控制是否立即聚焦编辑器
        // 从文件树点击时传入 false，保持焦点在文件树节点上
        if (autoFocus === true) {
            this.editor.focus();
        }

        if (this.loadingSessionId === sessionId) {
            this.loadingSessionId = null;
        }
    }

    applyPreferences(prefs = null) {
        if (!prefs || typeof prefs !== 'object') {
            this.preferences = null;
            this.applyPreferencesToEditor();
            return;
        }

        const {
            codeTheme,
            codeFontSize,
            codeLineHeight,
            codeFontFamily,
            codeFontWeight,
        } = prefs;

        const parsedFontSize = Number(codeFontSize);
        const parsedLineHeight = Number(codeLineHeight);
        const parsedFontWeight = Number(codeFontWeight);

        this.preferences = {
            theme: typeof codeTheme === 'string' ? codeTheme.trim() : 'auto',
            fontSize: Number.isFinite(parsedFontSize) ? parsedFontSize : null,
            lineHeight: Number.isFinite(parsedLineHeight) ? parsedLineHeight : null,
            fontFamily: typeof codeFontFamily === 'string' ? codeFontFamily.trim() : '',
            fontWeight: Number.isFinite(parsedFontWeight) ? parsedFontWeight : null,
        };

        this.applyPreferencesToEditor();
    }

    applyPreferencesToEditor() {
        if (!this.editor) {
            return;
        }

        const prefs = this.preferences || {};
        const fallbackFontSize = DEFAULT_CODE_FONT_SIZE;
        const fallbackLineHeightRatio = DEFAULT_LINE_HEIGHT_RATIO;

        const fontSize = Number.isFinite(prefs.fontSize) ? prefs.fontSize : fallbackFontSize;
        const lineHeightRatio = Number.isFinite(prefs.lineHeight)
            ? prefs.lineHeight
            : fallbackLineHeightRatio;
        const computedLineHeight = Math.max(Math.round(fontSize * lineHeightRatio), fontSize);

        const nextOptions = {
            fontWeight: (prefs.fontWeight || 400).toString(),
        };

        if (prefs.fontFamily) {
            nextOptions.fontFamily = prefs.fontFamily;
        }

        this.editor.updateOptions(nextOptions);
        this.baseFontSize = fontSize;
        this.baseLineHeightRatio = lineHeightRatio;
        this.baseLineHeight = computedLineHeight;
        this.applyZoomOptions();

        if (this.monaco?.editor) {
            const language = this.currentLanguage || 'plaintext';
            const monacoTheme = this.resolveThemeForLanguage(language);
            this.monaco.editor.setTheme(monacoTheme);
        }
    }

    attachModel(model, language) {
        if (!this.monaco || !this.editor) {
            return;
        }

        if (this.modelDisposer) {
            this.modelDisposer.dispose();
            this.modelDisposer = null;
        }

        const resolvedLanguage = this.resolveLanguage(language);
        this.editor.setModel(model);
        this.monaco.editor.setModelLanguage(model, resolvedLanguage);

        const nextTheme = this.resolveThemeForLanguage(resolvedLanguage);
        this.monaco.editor.setTheme(nextTheme);

        const tabSize = resolvedLanguage === 'markdown' ? 2 : 4;
        model.updateOptions({
            tabSize: tabSize,
            indentSize: tabSize,
            insertSpaces: true,
            detectIndentation: false,
        });

        this.currentModel = model;
        this.currentLanguage = resolvedLanguage;
        this.baseVersion = model.getAlternativeVersionId();
        this.isDirty = false;
        this.suppressChange = false;

        this.modelDisposer = model.onDidChangeContent(() => {
            if (this.suppressChange) {
                return;
            }
            const currentVersion = model.getAlternativeVersionId();
            this.isDirty = currentVersion !== this.baseVersion;
            this.callbacks.onContentChange?.();
            this.notifyContentMutation();
            this.scheduleAutoSave();
        });
    }

    resolveThemeForLanguage(language) {
        const appearance = document?.documentElement?.dataset?.themeAppearance;
        const isDarkMode = appearance === 'dark';

        // 获取用户选择的主题
        const userTheme = this.preferences?.theme || 'auto';

        // auto 模式：对特殊语言使用专用主题
        if (userTheme === 'auto') {
            if (language === 'markdown') {
                return isDarkMode ? 'markdown-sql-dark' : 'markdown-sql-light';
            }
            if (language === 'sql' || language === 'mysql' || language === 'pgsql') {
                return isDarkMode ? 'markdown-sql-dark' : 'markdown-sql-light';
            }
            if (language === 'csv' && !isDarkMode) {
                return 'csv-theme';
            }
            // 默认使用 VS Code 主题
            return isDarkMode ? 'vs-dark' : 'vs';
        }

        // 用户选择了具体主题：根据当前颜色模式获取对应的 light/dark 版本
        return getThemeVariant(userTheme, isDarkMode);
    }

    onDidChangeContent(handler) {
        if (typeof handler !== 'function') {
            return () => {};
        }
        this.contentChangeListeners.add(handler);
        return () => {
            this.contentChangeListeners.delete(handler);
        };
    }

    notifyContentMutation() {
        this.contentChangeListeners.forEach(handler => {
            try {
                handler();
            } catch (error) {
                console.error('[CodeEditor] 内容变更通知失败', error);
            }
        });
    }

    clampZoomScale(value) {
        if (!Number.isFinite(value)) {
            return 1;
        }
        return Math.min(MAX_ZOOM_SCALE, Math.max(MIN_ZOOM_SCALE, value));
    }

    applyZoomOptions() {
        if (!this.editor) {
            return;
        }
        const baseFontSize = this.baseFontSize || DEFAULT_CODE_FONT_SIZE;
        const baseLineHeight = this.baseLineHeight
            || Math.max(Math.round(baseFontSize * this.baseLineHeightRatio), baseFontSize);
        const zoomedFontSize = Math.max(
            8,
            Math.round(baseFontSize * this.zoomScale * 100) / 100
        );
        const zoomedLineHeight = Math.max(
            Math.round(baseLineHeight * this.zoomScale),
            Math.ceil(zoomedFontSize)
        );
        this.editor.updateOptions({
            fontSize: zoomedFontSize,
            lineHeight: zoomedLineHeight,
        });
        this.requestLayout();
    }

    setZoomScale(scale) {
        const clamped = this.clampZoomScale(scale);
        if (Math.abs(clamped - this.zoomScale) < 0.01) {
            return;
        }
        this.zoomScale = clamped;
        this.applyZoomOptions();
    }

    hide() {
        this.container.classList.remove('is-active');
        this.isVisible = false;
    }

    clear() {
        this.cancelAutoSave();
        this.currentFile = null;
        this.currentLanguage = null;
        this.currentSessionId = null;
        this.loadingSessionId = null;
        this.isDirty = false;
        this.clearSearch();
        if (this.modelDisposer) {
            this.modelDisposer.dispose();
            this.modelDisposer = null;
        }
        if (this.editor) {
            this.editor.setModel(null);
        }
        if (this.currentModel) {
            this.currentModel.dispose();
            this.currentModel = null;
        }
        this.hide();
        this.callbacks.onContentChange?.();
    }

    showContainer() {
        if (!this.isVisible) {
            this.container.classList.add('is-active');
            this.isVisible = true;
        }
    }

    getValue() {
        return this.editor ? this.editor.getValue() : '';
    }

    getValueForSave() {
        const raw = this.getValue();
        if (!shouldEnforceMarkdownTrailingEmptyLine(this.currentFile, this.currentLanguage)) {
            return raw;
        }
        return ensureMarkdownTrailingEmptyLine(raw);
    }

    hasUnsavedChanges() {
        return !!this.isDirty;
    }

    markSaved() {
        if (!this.currentModel) {
            return;
        }
        this.baseVersion = this.currentModel.getAlternativeVersionId();
        this.isDirty = false;
        this.callbacks.onContentChange?.();
    }

    scheduleAutoSave() {
        if (this.autoSaveTimer) {
            clearTimeout(this.autoSaveTimer);
        }
        if (!this.isDirty || !this.currentFile) {
            return;
        }
        const sessionId = this.currentSessionId;
        this.autoSavePlannedSessionId = sessionId;
        this.autoSaveTimer = setTimeout(() => {
            this.autoSaveTimer = null;
            if (this.autoSavePlannedSessionId !== sessionId) {
                return;
            }
            this.autoSavePlannedSessionId = null;
            this.performAutoSave(sessionId);
        }, this.autoSaveDelayMs);
    }

    cancelAutoSave() {
        if (this.autoSaveTimer) {
            clearTimeout(this.autoSaveTimer);
            this.autoSaveTimer = null;
        }
        this.autoSavePlannedSessionId = null;
    }

    async performAutoSave(sessionId = null) {
        if (!this.isDirty || !this.currentFile) {
            return;
        }
        if (sessionId && !this.isSessionActive(sessionId)) {
            return;
        }
        if (this.isSaving) {
            this.scheduleAutoSave();
            return;
        }

        const filePath = this.currentFile;
        const content = this.getValueForSave();
        const localWriteKey = normalizeFsPath(filePath) || filePath;

        this.isSaving = true;
        const savePromise = (async () => {
            try {
                const services = getAppServices();
                if (localWriteKey && this.documentSessions?.markLocalWrite) {
                    this.documentSessions.markLocalWrite(localWriteKey);
                }
                await services.file.writeText(filePath, content);
                if (!sessionId || sessionId === this.currentSessionId) {
                    this.markSaved();
                    // 自动保存后恢复焦点，防止输入中断
                    if (this.isVisible && this.editor) {
                        this.editor.focus();
                    }
                }
                console.log('[CodeEditor] 自动保存成功');
                return true;
            } catch (error) {
                if (localWriteKey && this.documentSessions?.clearLocalWriteSuppression) {
                    this.documentSessions.clearLocalWriteSuppression(localWriteKey);
                }
                console.error('[CodeEditor] 自动保存失败:', error);
                return false;
            } finally {
                this.isSaving = false;
                this.activeSavePromise = null;
            }
        })();

        this.activeSavePromise = savePromise;
        const result = await savePromise;

        if (result) {
            Promise.resolve(
                this.callbacks.onAutoSaveSuccess?.({ skipped: false, filePath })
            ).catch(error => {
                console.warn('[CodeEditor] 自动保存回调失败', error);
            });
        } else {
            Promise.resolve(this.callbacks.onAutoSaveError?.(new Error('保存失败'))).catch(error => {
                console.warn('[CodeEditor] 自动保存错误回调失败', error);
            });
        }
    }

    focus() {
        if (!this.editor) {
            return;
        }
        this.editor.focus();
    }

    resolveLanguage(language) {
        const candidate = typeof language === 'string' && language.length > 0
            ? language
            : 'plaintext';

        if (!this.monaco) {
            return candidate;
        }

        try {
            const encoded = this.monaco.languages.getEncodedLanguageId(candidate);
            if (encoded) {
                return candidate;
            }
        } catch (error) {
            console.warn('无法识别语言，使用纯文本显示', { language: candidate, error });
        }

        return 'plaintext';
    }

    dispose() {
        this.cancelAutoSave();
        if (this.pendingLayoutFrame !== null) {
            cancelAnimationFrame(this.pendingLayoutFrame);
            this.pendingLayoutFrame = null;
        }
        if (this.tapGuardCleanup) {
            this.tapGuardCleanup();
            this.tapGuardCleanup = null;
            this.tapGuardState = null;
        }
        if (this.modelDisposer) {
            this.modelDisposer.dispose();
            this.modelDisposer = null;
        }
        if (this.editor) {
            this.editor.dispose();
            this.editor = null;
        }
        if (this.currentModel) {
            this.currentModel.dispose();
            this.currentModel = null;
        }
        if (this.monaco) {
            this.monaco = null;
        }
        window.removeEventListener('resize', this.handleResize);
        this.currentTabId = null;
        this.tabViewStates.clear();
    }

    saveViewStateForTab(tabId) {
        if (!tabId || !this.editor) {
            return;
        }
        try {
            const viewState = this.editor.saveViewState();
            if (viewState) {
                this.tabViewStates.set(tabId, viewState);
            }
        } catch (error) {
            console.warn('[CodeEditor] 保存视图状态失败', error);
        }
    }

    restoreViewStateForTab(tabId) {
        if (!tabId || !this.editor) {
            return false;
        }
        const viewState = this.tabViewStates.get(tabId);
        if (!viewState) {
            return false;
        }
        try {
            this.editor.restoreViewState(viewState);
            return true;
        } catch (error) {
            console.warn('[CodeEditor] 恢复视图状态失败', error);
            return false;
        }
    }

    forgetViewStateForTab(tabId) {
        if (!tabId) {
            return;
        }
        this.tabViewStates.delete(tabId);
    }

    renameViewStateTab(oldTabId, newTabId) {
        if (!oldTabId || !newTabId || oldTabId === newTabId) {
            return;
        }
        if (!this.tabViewStates.has(oldTabId)) {
            return;
        }
        const state = this.tabViewStates.get(oldTabId);
        this.tabViewStates.delete(oldTabId);
        if (state) {
            this.tabViewStates.set(newTabId, state);
        }
    }

    setupTapSelectionGuard() {
        if (!this.editorHost) {
            return;
        }
        if (this.tapGuardCleanup) {
            this.tapGuardCleanup();
            this.tapGuardCleanup = null;
        }
        this.tapGuardState = null;

        const pointerEventTarget = typeof window !== 'undefined' ? window : this.editorHost;

        const normalizedPointerType = (event) => {
            const pointerType = typeof event.pointerType === 'string'
                ? event.pointerType.toLowerCase()
                : '';
            if (!pointerType) {
                return 'mouse';
            }
            return pointerType;
        };

        const shouldGuardPointer = (event) => {
            const pointerType = normalizedPointerType(event);
            if (pointerType === 'touch' || pointerType === 'pen') {
                return true;
            }
            if (pointerType === 'mouse') {
                if (typeof event.buttons === 'number' && event.buttons === 0) {
                    return true;
                }
                if (typeof event.pressure === 'number') {
                    return event.pressure === 0;
                }
            }
            return false;
        };

        const capturePointerIfPossible = (pointerId) => {
            if (!this.editorHost || typeof this.editorHost.setPointerCapture !== 'function') {
                return false;
            }
            try {
                this.editorHost.setPointerCapture(pointerId);
                return true;
            } catch (error) {
                console.debug('[CodeEditor] 捕获指针失败:', error);
                return false;
            }
        };

        const releasePointerIfNeeded = (pointerId) => {
            if (!this.editorHost || typeof this.editorHost.releasePointerCapture !== 'function') {
                return;
            }
            try {
                this.editorHost.releasePointerCapture(pointerId);
            } catch (error) {
                console.debug('[CodeEditor] 释放指针捕获失败:', error);
            }
        };

        const stopEventForTap = (event) => {
            if (!event) {
                return;
            }
            if (typeof event.stopImmediatePropagation === 'function') {
                event.stopImmediatePropagation();
            } else if (typeof event.stopPropagation === 'function') {
                event.stopPropagation();
            }
            if (event.cancelable) {
                event.preventDefault();
            }
        };

        const collapseToPosition = (position) => {
            if (!position || !this.editor || !this.monaco) {
                return;
            }
            const { lineNumber, column } = position;
            const collapsed = new this.monaco.Selection(lineNumber, column, lineNumber, column);
            this.editor.setPosition(position);
            this.editor.setSelection(collapsed);
        };

        const pointerDown = (event) => {
            if (event.button !== 0 || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) {
                this.tapGuardState = null;
                return;
            }
            if (!shouldGuardPointer(event)) {
                this.tapGuardState = null;
                return;
            }

            let initialPosition = null;
            if (this.editor) {
                const target = this.editor.getTargetAtClientPoint(event.clientX, event.clientY);
                initialPosition = target?.position || this.editor.getPosition() || null;
            }

            const pointerType = normalizedPointerType(event);
            const blockTapDrag = pointerType === 'touch'
                || pointerType === 'pen'
                || (pointerType === 'mouse' && (typeof event.buttons !== 'number' || event.buttons === 0));
            this.tapGuardState = {
                pointerId: event.pointerId,
                hasPointerCapture: false,
                guardActive: blockTapDrag,
                blockTapDrag,
                startClientX: event.clientX,
                startClientY: event.clientY,
                lastPosition: initialPosition,
                pointerType,
            };
            if (blockTapDrag) {
                stopEventForTap(event);
                this.tapGuardState.hasPointerCapture = capturePointerIfPossible(event.pointerId);
                if (initialPosition) {
                    collapseToPosition(initialPosition);
                }
            }
        };

        const pointerMove = (event) => {
            const state = this.tapGuardState;
            if (!state || event.pointerId !== state.pointerId) {
                return;
            }
            if (state.blockTapDrag) {
                if (!state.hasPointerCapture) {
                    state.hasPointerCapture = capturePointerIfPossible(event.pointerId);
                }
                stopEventForTap(event);
                if (state.lastPosition) {
                    collapseToPosition(state.lastPosition);
                }
                return;
            }
            if (typeof event.buttons === 'number' && event.buttons !== 0) {
                if (state.hasPointerCapture) {
                    releasePointerIfNeeded(event.pointerId);
                }
                this.tapGuardState = null;
                return;
            }

            const dx = Math.abs(event.clientX - (state.startClientX ?? event.clientX));
            const dy = Math.abs(event.clientY - (state.startClientY ?? event.clientY));
            const movementExceedsThreshold = dx > 1 || dy > 1;

            if (!state.guardActive) {
                if (!movementExceedsThreshold) {
                    return;
                }
                if (!shouldGuardPointer(event)) {
                    this.tapGuardState = null;
                    return;
                }
                state.guardActive = true;
                if (!state.hasPointerCapture) {
                    state.hasPointerCapture = capturePointerIfPossible(event.pointerId);
                }
                stopEventForTap(event);
                if (state.lastPosition) {
                    collapseToPosition(state.lastPosition);
                }
                return;
            }

            stopEventForTap(event);
        };

        const pointerUp = (event) => {
            const state = this.tapGuardState;
            if (!state || event.pointerId !== state.pointerId) {
                return;
            }
            if (state.guardActive) {
                stopEventForTap(event);
                if (state.hasPointerCapture) {
                    releasePointerIfNeeded(event.pointerId);
                }
                if (state.lastPosition) {
                    collapseToPosition(state.lastPosition);
                }
            }
            this.tapGuardState = null;
        };

        const pointerCancel = (event) => {
            const state = this.tapGuardState;
            if (!state) {
                return;
            }
            if (state.hasPointerCapture) {
                const pointerId = typeof event?.pointerId === 'number'
                    ? event.pointerId
                    : state.pointerId;
                if (typeof pointerId === 'number') {
                    releasePointerIfNeeded(pointerId);
                }
            }
            if (state.blockTapDrag || state.guardActive) {
                stopEventForTap(event);
                if (state.lastPosition) {
                    collapseToPosition(state.lastPosition);
                }
            }
            this.tapGuardState = null;
        };

        const pointerLeave = (event) => {
            const state = this.tapGuardState;
            if (!state) {
                return;
            }
            if (typeof event.pointerId === 'number' && event.pointerId !== state.pointerId) {
                return;
            }
            if (state.hasPointerCapture) {
                releasePointerIfNeeded(state.pointerId);
            }
            if (state.blockTapDrag || state.guardActive) {
                stopEventForTap(event);
                if (state.lastPosition) {
                    collapseToPosition(state.lastPosition);
                }
            }
            this.tapGuardState = null;
        };

        this.editorHost.addEventListener('pointerdown', pointerDown, true);
        pointerEventTarget.addEventListener('pointermove', pointerMove, true);
        pointerEventTarget.addEventListener('pointerup', pointerUp, true);
        pointerEventTarget.addEventListener('pointercancel', pointerCancel, true);
        pointerEventTarget.addEventListener('pointerleave', pointerLeave, true);

        this.tapGuardCleanup = () => {
            this.editorHost.removeEventListener('pointerdown', pointerDown, true);
            pointerEventTarget.removeEventListener('pointermove', pointerMove, true);
            pointerEventTarget.removeEventListener('pointerup', pointerUp, true);
            pointerEventTarget.removeEventListener('pointercancel', pointerCancel, true);
            pointerEventTarget.removeEventListener('pointerleave', pointerLeave, true);
            this.tapGuardState = null;
        };
    }

    getSelectionText() {
        if (!this.editor) {
            return '';
        }
        const model = this.editor.getModel();
        const selection = this.editor.getSelection();
        if (!model || !selection || selection.isEmpty()) {
            return '';
        }
        return model.getValueInRange(selection);
    }

    replaceSelectionWithText(text) {
        if (!this.editor || !this.monaco) {
            return;
        }
        const model = this.editor.getModel();
        const selection = this.editor.getSelection();
        if (!model || !selection) {
            return;
        }

        const nextText = typeof text === 'string' ? text : '';
        this.editor.focus();
        this.editor.pushUndoStop();
        this.editor.executeEdits('ai-assistant', [
            {
                range: selection,
                text: nextText,
                forceMoveMarkers: true,
            },
        ]);
        this.editor.pushUndoStop();
    }

    insertTextAtCursor(text) {
        if (!this.editor || !this.monaco) {
            return;
        }
        const position = this.editor.getPosition();
        if (!position) {
            return;
        }

        const nextText = typeof text === 'string' ? text : '';
        const range = new this.monaco.Range(
            position.lineNumber,
            position.column,
            position.lineNumber,
            position.column
        );

        this.editor.focus();
        this.editor.pushUndoStop();
        this.editor.executeEdits('ai-assistant', [
            {
                range,
                text: nextText,
                forceMoveMarkers: true,
            },
        ]);
        this.editor.pushUndoStop();
    }

    undo() {
        if (!this.editor || typeof this.editor.trigger !== 'function') {
            return false;
        }
        this.editor.trigger('keyboard', 'undo', null);
        return true;
    }

    redo() {
        if (!this.editor || typeof this.editor.trigger !== 'function') {
            return false;
        }
        this.editor.trigger('keyboard', 'redo', null);
        return true;
    }

    beginAiStreamSession(sessionId) {
        if (!this.editor || !this.monaco || !sessionId) {
            return null;
        }
        const model = this.editor.getModel();
        if (!model) {
            return null;
        }

        let selection = this.editor.getSelection();
        const hasSelection = selection && !selection.isEmpty();
        let anchorPosition = hasSelection
            ? selection.getStartPosition()
            : this.editor.getPosition();

        if (!anchorPosition) {
            anchorPosition = model.getPositionAt(0);
        }

        if (hasSelection) {
            this.editor.pushUndoStop();
            this.editor.executeEdits('ai-assistant', [
                {
                    range: selection,
                    text: '',
                    forceMoveMarkers: true,
                },
            ]);
            this.editor.pushUndoStop();
        }

        const startOffset = model.getOffsetAt(anchorPosition);
        const session = {
            id: sessionId,
            startOffset,
            currentOffset: startOffset,
            buffer: '',
        };
        this.aiStreamSessions.set(sessionId, session);
        return session;
    }

    appendAiStreamContent(sessionId, delta) {
        if (!this.editor || !this.monaco || !sessionId) {
            return;
        }
        const session = this.aiStreamSessions.get(sessionId);
        if (!session) {
            return;
        }
        const chunk = typeof delta === 'string' ? delta : '';
        if (!chunk) {
            return;
        }

        const model = this.editor.getModel();
        if (!model) {
            return;
        }

        const insertPosition = model.getPositionAt(session.currentOffset);
        const range = new this.monaco.Range(
            insertPosition.lineNumber,
            insertPosition.column,
            insertPosition.lineNumber,
            insertPosition.column
        );

        this.editor.focus();
        this.editor.executeEdits('ai-assistant', [
            {
                range,
                text: chunk,
                forceMoveMarkers: true,
            },
        ]);

        session.currentOffset += chunk.length;
        session.buffer += chunk;
    }

    finalizeAiStreamSession(sessionId, content) {
        if (!this.editor || !this.monaco || !sessionId) {
            return;
        }
        const session = this.aiStreamSessions.get(sessionId);
        if (!session) {
            return;
        }

        const model = this.editor.getModel();
        if (!model) {
            return;
        }

        const finalText = typeof content === 'string' ? content : session.buffer;
        const startPosition = model.getPositionAt(session.startOffset);
        const endPosition = model.getPositionAt(session.currentOffset);
        const range = new this.monaco.Range(
            startPosition.lineNumber,
            startPosition.column,
            endPosition.lineNumber,
            endPosition.column
        );

        if (finalText !== session.buffer) {
            this.editor.focus();
            this.editor.executeEdits('ai-assistant', [
                {
                    range,
                    text: finalText,
                    forceMoveMarkers: true,
                },
            ]);
        }

        this.aiStreamSessions.delete(sessionId);
    }

    abortAiStreamSession(sessionId) {
        if (!this.editor || !this.monaco || !sessionId) {
            return;
        }
        const session = this.aiStreamSessions.get(sessionId);
        if (!session) {
            return;
        }

        const model = this.editor.getModel();
        if (!model) {
            return;
        }

        const startPosition = model.getPositionAt(session.startOffset);
        const endPosition = model.getPositionAt(session.currentOffset);
        const range = new this.monaco.Range(
            startPosition.lineNumber,
            startPosition.column,
            endPosition.lineNumber,
            endPosition.column
        );

        this.editor.focus();
        this.editor.executeEdits('ai-assistant', [
            {
                range,
                text: '',
                forceMoveMarkers: true,
            },
        ]);

        this.aiStreamSessions.delete(sessionId);
    }

    hasAiStreamSession(sessionId) {
        return this.aiStreamSessions.has(sessionId);
    }

    // 搜索相关方法
    findMatches(searchTerm) {
        if (!this.editor || !this.currentModel || !searchTerm) {
            return [];
        }

        const matches = this.currentModel.findMatches(
            searchTerm,
            false, // searchOnlyEditableRange
            false, // isRegex
            false, // matchCase
            null,  // wordSeparators
            true   // captureMatches
        );

        return matches || [];
    }

    setSearchTerm(searchTerm) {
        if (!this.editor) {
            return { total: 0, current: -1 };
        }

        if (!searchTerm) {
            this.clearSearch();
            return { total: 0, current: -1 };
        }

        this.searchTerm = searchTerm;
        const matches = this.findMatches(searchTerm);
        this.searchMatches = matches;
        this.currentMatchIndex = matches.length > 0 ? 0 : -1;

        if (matches.length === 0) {
            this.clearSearchDecorations();
            return { total: 0, current: -1 };
        }

        this.highlightMatches(matches, this.currentMatchIndex);
        this.scrollToMatch(this.currentMatchIndex);

        return { total: matches.length, current: this.currentMatchIndex };
    }

    refreshSearchMatches() {
        if (!this.editor || !this.searchTerm) {
            this.clearSearch();
            return { total: 0, current: -1 };
        }

        const previousMatches = this.searchMatches || [];
        const previousMatch = this.currentMatchIndex >= 0 ? previousMatches[this.currentMatchIndex] : null;

        const matches = this.findMatches(this.searchTerm);
        this.searchMatches = matches;

        if (matches.length === 0) {
            this.currentMatchIndex = -1;
            this.clearSearchDecorations();
            return { total: 0, current: -1 };
        }

        let nextIndex = -1;
        if (previousMatch) {
            nextIndex = matches.findIndex(match => this.isSameRange(match.range, previousMatch.range));
        }

        if (nextIndex === -1 && this.currentMatchIndex >= 0) {
            nextIndex = Math.min(this.currentMatchIndex, matches.length - 1);
        }

        if (nextIndex === -1) {
            nextIndex = 0;
        }

        this.currentMatchIndex = nextIndex;
        this.highlightMatches(matches, this.currentMatchIndex);

        return { total: matches.length, current: this.currentMatchIndex };
    }

    isSameRange(rangeA, rangeB) {
        if (!rangeA || !rangeB) {
            return false;
        }
        return rangeA.startLineNumber === rangeB.startLineNumber
            && rangeA.endLineNumber === rangeB.endLineNumber
            && rangeA.startColumn === rangeB.startColumn
            && rangeA.endColumn === rangeB.endColumn;
    }

    highlightMatches(matches, currentIndex) {
        if (!this.editor || !this.monaco) {
            return;
        }

        if (!matches || matches.length === 0) {
            this.clearSearchDecorations();
            return;
        }

        const decorations = matches.map((match, index) => ({
            range: match.range,
            options: {
                className: index === currentIndex ? 'search-result-current' : 'search-result',
                isWholeLine: false,
            }
        }));

        this.searchDecorations = this.editor.deltaDecorations(
            this.searchDecorations || [],
            decorations
        );
    }

    scrollToMatch(index) {
        if (!this.editor || !this.searchMatches || index < 0 || index >= this.searchMatches.length) {
            return;
        }

        const match = this.searchMatches[index];
        this.editor.revealRangeInCenter(match.range);
        this.editor.setPosition({
            lineNumber: match.range.startLineNumber,
            column: match.range.startColumn
        });
    }

    nextSearchResult() {
        if (!this.searchMatches || this.searchMatches.length === 0) {
            return null;
        }

        this.currentMatchIndex = (this.currentMatchIndex + 1) % this.searchMatches.length;
        this.highlightMatches(this.searchMatches, this.currentMatchIndex);
        this.scrollToMatch(this.currentMatchIndex);

        return { total: this.searchMatches.length, current: this.currentMatchIndex };
    }

    prevSearchResult() {
        if (!this.searchMatches || this.searchMatches.length === 0) {
            return null;
        }

        this.currentMatchIndex = this.currentMatchIndex <= 0
            ? this.searchMatches.length - 1
            : this.currentMatchIndex - 1;
        this.highlightMatches(this.searchMatches, this.currentMatchIndex);
        this.scrollToMatch(this.currentMatchIndex);

        return { total: this.searchMatches.length, current: this.currentMatchIndex };
    }

    selectAllSearchMatches() {
        if (!this.editor || !this.searchMatches || this.searchMatches.length === 0) {
            return { applied: false, total: 0 };
        }

        const selections = this.searchMatches.map(match => {
            const { startLineNumber, startColumn, endLineNumber, endColumn } = match.range;
            return {
                selectionStartLineNumber: startLineNumber,
                selectionStartColumn: startColumn,
                positionLineNumber: endLineNumber,
                positionColumn: endColumn,
            };
        });

        this.editor.setSelections(selections);
        this.editor.focus();
        const firstRange = this.searchMatches[0]?.range;
        if (firstRange) {
            this.editor.revealRangeInCenter(firstRange);
        }

        return { applied: true, total: this.searchMatches.length };
    }

    clearSearchDecorations() {
        if (!this.editor) {
            return;
        }
        if (this.searchDecorations) {
            this.editor.deltaDecorations(this.searchDecorations, []);
            this.searchDecorations = null;
        }
    }

    clearSearch() {
        if (!this.editor) {
            this.searchTerm = '';
            this.searchMatches = null;
            this.currentMatchIndex = -1;
            return;
        }
        this.clearSearchDecorations();
        this.searchTerm = '';
        this.searchMatches = null;
        this.currentMatchIndex = -1;
    }
}
