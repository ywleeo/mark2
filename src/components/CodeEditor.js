import 'monaco-editor/min/vs/editor/editor.main.css';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import 'monaco-editor/esm/vs/language/json/monaco.contribution';
import 'monaco-editor/esm/vs/language/css/monaco.contribution';
import 'monaco-editor/esm/vs/language/html/monaco.contribution';
import 'monaco-editor/esm/vs/language/typescript/monaco.contribution';
import 'monaco-editor/esm/vs/basic-languages/monaco.contribution';
import { conf as pythonLanguageConfiguration, language as pythonLanguage } from '../config/monaco-python.js';
import { conf as csvLanguageConfiguration, language as csvLanguage, themeRules as csvThemeRules } from '../config/monaco-csv.js';
import { getAppServices } from '../services/appServices.js';
import { normalizeFsPath } from '../utils/pathUtils.js';

const MODEL_SCHEME = 'inmemory';
const DEFAULT_CODE_FONT_SIZE = 14;
const DEFAULT_LINE_HEIGHT_RATIO = 1.5;
const MIN_ZOOM_SCALE = 0.6;
const MAX_ZOOM_SCALE = 2.4;

let monacoLoader = null;
let monacoEnvironmentReady = false;
let pythonLanguageReady = false;
let csvLanguageReady = false;

function ensureMonacoEnvironment() {
    if (monacoEnvironmentReady || typeof self === 'undefined') {
        return;
    }

    self.MonacoEnvironment = {
        getWorker(_workerId, label) {
            switch (label) {
                case 'json':
                    return new jsonWorker();
                case 'css':
                case 'scss':
                case 'less':
                    return new cssWorker();
                case 'html':
                case 'handlebars':
                case 'razor':
                case 'xml':
                    return new htmlWorker();
                case 'typescript':
                case 'javascript':
                    return new tsWorker();
                default:
                    return new editorWorker();
            }
        },
    };

    monacoEnvironmentReady = true;
}

async function ensureMonaco() {
    ensureMonacoEnvironment();
    if (!monacoLoader) {
        monacoLoader = import('monaco-editor/esm/vs/editor/editor.api');
    }
    return monacoLoader;
}

function ensurePythonLanguage(monaco) {
    if (pythonLanguageReady || !pythonLanguage?.tokenizer) {
        return;
    }

    monaco.languages.setMonarchTokensProvider('python', pythonLanguage);
    if (pythonLanguageConfiguration) {
        monaco.languages.setLanguageConfiguration('python', pythonLanguageConfiguration);
    }
    pythonLanguageReady = true;
}

function ensureCsvLanguage(monaco) {
    if (csvLanguageReady || !csvLanguage?.tokenizer) {
        return;
    }

    monaco.languages.register({ id: 'csv' });
    monaco.languages.setMonarchTokensProvider('csv', csvLanguage);
    if (csvLanguageConfiguration) {
        monaco.languages.setLanguageConfiguration('csv', csvLanguageConfiguration);
    }

    // 定义 CSV 专用主题
    monaco.editor.defineTheme('csv-theme', {
        base: 'vs',
        inherit: true,
        rules: csvThemeRules || [],
        colors: {},
    });

    csvLanguageReady = true;
}

const buildModelUri = (monaco, filePath) => {
    if (!filePath) {
        return monaco.Uri.parse(`${MODEL_SCHEME}://model/untitled`);
    }

    try {
        return monaco.Uri.file(filePath);
    } catch (_error) {
        const sanitized = encodeURIComponent(filePath);
        return monaco.Uri.parse(`${MODEL_SCHEME}://model/${sanitized}`);
    }
};

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

    prepareForDocument(session, filePath) {
        const sessionId = session?.id ?? this.currentSessionId ?? null;
        this.currentSessionId = sessionId;
        this.loadingSessionId = sessionId;
        this.currentFile = filePath;
        this.isDirty = false;
        if (!this.editor) {
            return;
        }
        this.suppressChange = true;
        try {
            if (this.currentModel) {
                this.currentModel.setValue('');
            } else if (typeof this.editor.setValue === 'function') {
                this.editor.setValue('');
            }
            this.editor.updateOptions({ readOnly: true });
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
            readOnly: true,
            wordWrap: 'on',
            padding: { top: 5, bottom: 5},
            scrollbar: {
                verticalScrollbarSize: 8,
                horizontalScrollbarSize: 8,
                useShadows: false,
            },
        });
        this.applyPreferencesToEditor();

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
        const { autoFocus = true } = options;
        const sessionId = session?.id ?? this.currentSessionId ?? null;
        if (session && !this.isSessionActive(sessionId)) {
            return;
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

        const uri = buildModelUri(monaco, filePath);
        let model = monaco.editor.getModel(uri);
        if (!model) {
            model = monaco.editor.createModel(content, targetLanguage, uri);
        } else {
            this.suppressChange = true;
            model.setValue(content);
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
            readOnly: false,
            tabSize: targetLanguage === 'markdown' ? 2 : 4,
            insertSpaces: true,
            detectIndentation: false,
        });
        this.showContainer();
        this.requestLayout();
        if (autoFocus) {
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
            codeFontSize,
            codeLineHeight,
            codeFontFamily,
            codeFontWeight,
        } = prefs;

        const parsedFontSize = Number(codeFontSize);
        const parsedLineHeight = Number(codeLineHeight);
        const parsedFontWeight = Number(codeFontWeight);

        this.preferences = {
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

        const appearance = document?.documentElement?.dataset?.themeAppearance;
        let monacoTheme = appearance === 'dark' ? 'vs-dark' : 'vs';

        // CSV 文件使用专用主题（浅色模式）
        if (this.currentLanguage === 'csv' && appearance !== 'dark') {
            monacoTheme = 'csv-theme';
        }

        if (this.monaco?.editor) {
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

        // 根据语言切换主题
        if (resolvedLanguage === 'csv') {
            const appearance = document?.documentElement?.dataset?.themeAppearance;
            const csvThemeName = appearance === 'dark' ? 'vs-dark' : 'csv-theme';
            this.monaco.editor.setTheme(csvThemeName);
        }

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
            this.editor.updateOptions({ readOnly: true });
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
        const content = this.getValue();
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
        this.editor?.focus();
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
    }

    setupTapSelectionGuard() {
        if (!this.editorHost) {
            return;
        }

        const pointerDown = (event) => {
            if (event.button !== 0 || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) {
                this.tapGuardState = null;
                return;
            }
            this.tapGuardState = {
                pointerId: event.pointerId,
                canceled: false,
            };
        };

        const pointerMove = (event) => {
            if (!this.tapGuardState || event.pointerId !== this.tapGuardState.pointerId) {
                return;
            }

            const primaryDown = (event.buttons & 1) === 1;
            const tapLikeDrag = primaryDown && (event.pressure === 0 || event.pointerType === 'touch');
            if (primaryDown && !tapLikeDrag) {
                this.tapGuardState.canceled = true;
                return;
            }
            if (!this.editor || !this.monaco) {
                return;
            }

            const target = this.editor.getTargetAtClientPoint(event.clientX, event.clientY);
            const position = target?.position;
            if (!position) {
                return;
            }

            const { lineNumber, column } = position;
            const collapsed = new this.monaco.Selection(lineNumber, column, lineNumber, column);

            this.editor.setPosition(position);
            this.editor.setSelection(collapsed);
        };

        const pointerUp = (event) => {
            if (!this.tapGuardState || event.pointerId !== this.tapGuardState.pointerId) {
                return;
            }

            const isMultiClick = typeof event.detail === 'number' && event.detail >= 2;
            if (!this.tapGuardState.canceled && !isMultiClick) {
                this.collapseSelectionToCursor();
            }
            this.tapGuardState = null;
        };

        const pointerCancel = () => {
            this.tapGuardState = null;
        };

        this.editorHost.addEventListener('pointerdown', pointerDown, true);
        this.editorHost.addEventListener('pointermove', pointerMove, true);
        this.editorHost.addEventListener('pointerup', pointerUp, true);
        this.editorHost.addEventListener('pointercancel', pointerCancel, true);

        this.tapGuardCleanup = () => {
            this.editorHost.removeEventListener('pointerdown', pointerDown, true);
            this.editorHost.removeEventListener('pointermove', pointerMove, true);
            this.editorHost.removeEventListener('pointerup', pointerUp, true);
            this.editorHost.removeEventListener('pointercancel', pointerCancel, true);
        };
    }

    collapseSelectionToCursor() {
        if (!this.editor || !this.monaco) {
            return;
        }
        const position = this.editor.getPosition();
        if (!position) {
            return;
        }
        const { lineNumber, column } = position;
        const selection = new this.monaco.Selection(lineNumber, column, lineNumber, column);
        this.editor.setSelection(selection);
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
