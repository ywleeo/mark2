import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, rectangularSelection, highlightSpecialChars, Decoration } from '@codemirror/view';
import { EditorState, EditorSelection, Compartment, StateField, StateEffect } from '@codemirror/state';
import { defaultKeymap, indentWithTab, history, historyKeymap, undo, redo, isolateHistory } from '@codemirror/commands';
import { syntaxHighlighting, defaultHighlightStyle, indentOnInput, indentUnit, bracketMatching, foldGutter, foldKeymap, HighlightStyle, ensureSyntaxTree } from '@codemirror/language';
import { getAppServices } from '../../services/appServices.js';
import { normalizeFsPath } from '../../utils/pathUtils.js';
import {
    ensureMarkdownTrailingEmptyLine,
    shouldEnforceMarkdownTrailingEmptyLine,
} from '../../utils/markdownFormatting.js';
import { resolveLanguageSupport } from './LanguageSupport.js';
import { buildTheme, buildHighlightStyle } from './ThemeSupport.js';
import {
    DEFAULT_CODE_FONT_SIZE,
    DEFAULT_LINE_HEIGHT_RATIO,
    MIN_ZOOM_SCALE,
    MAX_ZOOM_SCALE,
} from './constants.js';
import { formatCode, isFormattable } from './CodeFormatter.js';

/**
 * 规范化表格中 <br> + 空行的模式，防止 markdown 表格断裂。
 * 例如: | cell <br>\n\n<br>more |  →  | cell <br>more |
 */
function normalizeTableBreaks(text) {
    const lines = text.split('\n');
    const result = [];
    let i = 0;

    while (i < lines.length) {
        let line = lines[i];

        if (/^\s*\|/.test(line) && /<br\s*\/?\s*>\s*$/.test(line)) {
            i++;
            while (i < lines.length) {
                if (lines[i].trim() === '') { i++; continue; }
                if (/^\s*<br\s*\/?\s*>/.test(lines[i])) {
                    line += lines[i].replace(/^\s*<br\s*\/?\s*>\s*/, '');
                    i++;
                    if (!/<br\s*\/?\s*>\s*$/.test(line)) break;
                } else {
                    break;
                }
            }
            result.push(line);
        } else {
            result.push(line);
            i++;
        }
    }

    return result.join('\n');
}

// Sublime 风格 undo 切分：插入了换行/空格/标点的 transaction 强制开启新 history group，
// 让 "abc⏎123⏎" / "hello world" / "a, b" 这类输入按词边界逐段撤回。
// IME（拼音输入法）合成的 transaction（userEvent='input.type.compose'）不切分。
const SPLIT_CHAR = /[\s\p{P}]/u;
const isolateHistoryOnSplit = EditorState.transactionExtender.of((tr) => {
    if (!tr.docChanged) return null;
    if (tr.isUserEvent('input.type.compose')) return null;
    let shouldSplit = false;
    tr.changes.iterChanges((_fromA, _toA, _fromB, _toB, inserted) => {
        if (shouldSplit) return;
        if (inserted.length === 0) return;
        if (SPLIT_CHAR.test(inserted.toString())) shouldSplit = true;
    });
    return shouldSplit ? { annotations: isolateHistory.of('after') } : null;
});

// Search decoration infrastructure
const setSearchDecorations = StateEffect.define();
const searchDecorationField = StateField.define({
    create() { return Decoration.none; },
    update(decos, tr) {
        for (const e of tr.effects) {
            if (e.is(setSearchDecorations)) return e.value;
        }
        return decos.map(tr.changes);
    },
    provide: f => EditorView.decorations.from(f),
});

export class CodeEditor {
    constructor(containerElement, callbacks = {}, options = {}) {
        this.container = containerElement;
        this.container.classList.add('code-editor-pane');
        this.callbacks = callbacks;

        this.editorHost = document.createElement('div');
        this.editorHost.className = 'code-editor__instance';
        this.container.appendChild(this.editorHost);

        this.editor = null; // EditorView instance
        this.isVisible = false;
        this.currentFile = null;
        this.currentLanguage = null;
        this.baseContent = '';
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
        this.pasteHandler = null;
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

        this._currentDocument = null;
        this._docUnsub = null;

        // 保存时自动格式化
        this.formatOnSave = options.formatOnSave ?? true;

        // CodeMirror Compartments for dynamic reconfiguration
        this._langCompartment = new Compartment();
        this._themeCompartment = new Compartment();
        this._highlightCompartment = new Compartment();
        this._fontCompartment = new Compartment();
        this._tabSizeCompartment = new Compartment();
        this._indentUnitCompartment = new Compartment();
        this._readOnlyCompartment = new Compartment();
    }

    isSessionActive(sessionId) {
        if (!sessionId) return true;
        if (!this.documentSessions || typeof this.documentSessions.isSessionActive !== 'function') return true;
        return this.documentSessions.isSessionActive(sessionId);
    }

    prepareForDocument(session, filePath, tabId = null) {
        const previousTabId = this.currentTabId;
        if (previousTabId) {
            this.saveViewStateForTab(previousTabId);
        }
        const sessionId = session?.id ?? this.currentSessionId ?? null;
        const previousFile = this.currentFile;
        const isFileSwitching = previousFile !== filePath;
        const nextTabId = typeof tabId === 'string' && tabId.length > 0 ? tabId : null;
        this.currentSessionId = sessionId;
        this.loadingSessionId = sessionId;
        this.currentFile = filePath;
        this.currentTabId = nextTabId;
        this.isDirty = false;
        if (!this.editor) return;
        if (isFileSwitching) {
            this.suppressChange = true;
            this.editor.dispatch({
                changes: { from: 0, to: this.editor.state.doc.length, insert: '' }
            });
            this.suppressChange = false;
        }
    }

    /**
     * 构建给定语言对应的编辑器状态，作为 tab 首次加载时的基础状态。
     */
    createEditorState(doc = '', language = 'plaintext') {
        const targetLanguage = this.resolveLanguage(language);
        const langSupport = resolveLanguageSupport(targetLanguage);
        const tabSize = targetLanguage === 'markdown' ? 2 : 4;
        const indent = ' '.repeat(tabSize);
        const isDark = document?.documentElement?.dataset?.themeAppearance === 'dark';
        const userTheme = this.preferences?.theme || 'auto';
        let themeName = userTheme;
        if (userTheme === 'auto') {
            if (targetLanguage === 'markdown' || targetLanguage === 'sql' || targetLanguage === 'mysql' || targetLanguage === 'pgsql') {
                themeName = 'markdown-sql';
            } else if (targetLanguage === 'csv' && !isDark) {
                themeName = 'csv';
            }
        }
        const themeExt = buildTheme(themeName, isDark);
        const hlStyle = buildHighlightStyle(themeName, isDark);
        const fontTheme = this._buildFontTheme();

        return EditorState.create({
            doc,
            extensions: [
                lineNumbers(),
                highlightActiveLine(),
                highlightActiveLineGutter(),
                highlightSpecialChars(),
                rectangularSelection(),
                indentOnInput(),
                bracketMatching(),
                foldGutter(),
                // 字符切分（isolateHistoryOnSplit）+ 时间切分（newGroupDelay）双重兜底，
                // 避免一长串无标点输入变成单一 group。值取默认 500ms
                history({ newGroupDelay: 500 }),
                isolateHistoryOnSplit,
                keymap.of([
                    ...historyKeymap,
                    ...defaultKeymap,
                    ...foldKeymap,
                    indentWithTab,
                ]),
                this._langCompartment.of(langSupport ? [langSupport] : []),
                this._themeCompartment.of(themeExt),
                this._highlightCompartment.of(hlStyle),
                this._fontCompartment.of(fontTheme),
                this._tabSizeCompartment.of(EditorState.tabSize.of(tabSize)),
                this._indentUnitCompartment.of(indentUnit.of(indent)),
                this._readOnlyCompartment.of(EditorState.readOnly.of(false)),
                searchDecorationField,
                this._updateListener,
                EditorView.lineWrapping,
            ],
        });
    }

    /**
     * 恢复指定 tab 的完整 CodeMirror 状态，包含撤销栈。
     */
    restoreTabState(tabId, content, language) {
        if (!tabId || !this.editor) return false;
        this.clearSearchDecorations();
        const snapshot = this.tabViewStates.get(tabId);
        if (!snapshot?.editorState) return false;
        if (snapshot.content !== content || snapshot.language !== language) return false;

        try {
            this.editor.setState(snapshot.editorState);
            this.currentLanguage = snapshot.language;
            this.baseContent = snapshot.baseContent;
            this.isDirty = Boolean(snapshot.isDirty);
            this.applyPreferencesToEditor();
            if (typeof snapshot.scrollTop === 'number') {
                this.editor.scrollDOM.scrollTop = snapshot.scrollTop;
            }
            snapshot.lastActive = Date.now();
            ensureSyntaxTree(this.editor.state, this.editor.state.doc.length, 500);
            return true;
        } catch (error) {
            console.warn('[CodeEditor] 恢复标签页状态失败', error);
            return false;
        }
    }

    async ensureEditor() {
        if (this.editor) return;

        this._updateListener = EditorView.updateListener.of((update) => {
            if (update.docChanged && !this.suppressChange) {
                const currentContent = update.state.doc.toString();
                this.isDirty = currentContent !== this.baseContent;
                this.callbacks.onContentChange?.();
                this.notifyContentMutation();
                this.scheduleAutoSave();
            }
        });

        const state = this.createEditorState('', 'plaintext');

        this.editor = new EditorView({
            state,
            parent: this.editorHost,
        });

        if (this.editorHost) {
            this.editorHost.style.touchAction = 'none';
            this.editorHost.style.webkitUserDrag = 'none';
        }
        this.applyPreferencesToEditor();

        window.addEventListener('resize', this.handleResize, { passive: true });
        this.requestLayout();
        this.setupPasteHandler();
    }

    setupPasteHandler() {
        this.pasteHandler = (e) => {
            const text = e.clipboardData?.getData('text/plain');
            if (!text) return;

            let processed = text;
            let needsIntercept = false;

            // 修复表格中 <br> + 空行导致表格断裂的问题
            if (processed.includes('<br') && processed.includes('|')) {
                const normalized = normalizeTableBreaks(processed);
                if (normalized !== processed) {
                    processed = normalized;
                    needsIntercept = true;
                }
            }

            // 处理转义的换行/制表符（已有逻辑）
            if (text.length >= 50) {
                const literalCount = (text.match(/\\n/g) || []).length;
                if (literalCount >= 3) {
                    const actualCount = (text.match(/\n/g) || []).length;
                    if (literalCount > actualCount * 3) {
                        processed = processed
                            .replace(/\\n/g, '\n')
                            .replace(/\\t/g, '\t');
                        needsIntercept = true;
                    }
                }
            }

            if (!needsIntercept) return;

            e.preventDefault();
            e.stopPropagation();

            if (this.editor) {
                const { from, to } = this.editor.state.selection.main;
                this.editor.dispatch({
                    changes: { from, to, insert: processed },
                });
            }
        };
        this.editorHost.addEventListener('paste', this.pasteHandler, true);
    }

    requestLayout() {
        if (!this.editor) return;
        if (this.pendingLayoutFrame !== null) {
            cancelAnimationFrame(this.pendingLayoutFrame);
        }
        this.pendingLayoutFrame = window.requestAnimationFrame(() => {
            this.pendingLayoutFrame = null;
            this.editor?.requestMeasure();
        });
    }

    async show(filePath, content, language = null, session = null, options = {}) {
        const { autoFocus = true, tabId = null } = options;
        const sessionId = session?.id ?? this.currentSessionId ?? null;
        if (session && !this.isSessionActive(sessionId)) return;

        if (tabId && tabId !== this.currentTabId) {
            this.currentTabId = tabId;
        }
        this.currentSessionId = sessionId;
        this.loadingSessionId = sessionId;
        await this.ensureEditor();

        if (!this.editor) {
            if (this.loadingSessionId === sessionId) this.loadingSessionId = null;
            return;
        }
        if (sessionId && !this.isSessionActive(sessionId)) {
            if (this.loadingSessionId === sessionId) this.loadingSessionId = null;
            return;
        }

        const targetLanguage = this.resolveLanguage(language);
        const baseContent = typeof content === 'string' ? content : '';
        const shouldNormalizeMarkdown = shouldEnforceMarkdownTrailingEmptyLine(filePath, targetLanguage);
        const normalizedContent = shouldNormalizeMarkdown
            ? ensureMarkdownTrailingEmptyLine(baseContent)
            : baseContent;

        // Create fresh state with content + language + theme all at once
        this.baseContent = normalizedContent;
        this.currentFile = filePath;
        this.currentLanguage = targetLanguage;
        this.isDirty = false;
        const restored = this.restoreTabState(this.currentTabId, normalizedContent, targetLanguage);
        if (!restored) {
            this.editor.setState(this.createEditorState(normalizedContent, targetLanguage));
        }

        // Force synchronous parsing so highlighting appears immediately
        ensureSyntaxTree(this.editor.state, this.editor.state.doc.length, 500);

        if (sessionId && !this.isSessionActive(sessionId)) {
            if (this.loadingSessionId === sessionId) this.loadingSessionId = null;
            return;
        }

        this.showContainer();
        this.requestLayout();

        if (autoFocus === true) {
            this.editor.focus();
        }

        if (this.loadingSessionId === sessionId) {
            this.loadingSessionId = null;
        }
    }

    /**
     * 统一视图入口:基于 DocumentModel 绑定当前编辑器。
     * 内部复用 prepareForDocument + show,补齐 dirty 基线恢复和订阅。
     */
    async attachDocument(doc, options = {}) {
        if (!doc) return false;
        const { session = null, tabId = null, autoFocus = true, language = null } = options;
        const filePath = doc.uri;
        const content = doc.getContent();

        this.prepareForDocument(session, filePath, tabId);
        await this.show(filePath, content, language, session, { autoFocus, tabId });

        // 跨 tab 保留的 dirty:恢复 baseContent 为磁盘原文，并同步到 DM
        if (doc.dirty) {
            const origFromDoc = doc.getOriginalContent();
            if (typeof origFromDoc === 'string') {
                this.baseContent = origFromDoc;
            }
            this.isDirty = true;
            this.callbacks?.onContentChange?.();
        }

        this._bindDocument(doc);
        return true;
    }

    detachDocument() {
        this._docUnsub?.();
        this._docUnsub = null;
        this._currentDocument = null;
    }

    _bindDocument(doc) {
        if (this._docUnsub) this._docUnsub();
        this._currentDocument = doc;
        this._docUnsub = doc.subscribe((event) => this._handleDocumentEvent(event));
    }

    _handleDocumentEvent(event) {
        if (!event || !this._currentDocument) return;
        if (event.type === 'reload' && this.editor) {
            const nextContent = this._currentDocument.getContent();
            if (typeof nextContent !== 'string') return;
            this.suppressChange = true;
            this.editor.dispatch({
                changes: { from: 0, to: this.editor.state.doc.length, insert: nextContent }
            });
            this.suppressChange = false;
            this.baseContent = nextContent;
            this.isDirty = false;
        } else if (event.type === 'rename') {
            if (this.currentFile === event.oldUri) {
                this.currentFile = event.newUri;
            }
        }
    }

    _applyThemeForLanguage(language) {
        if (!this.editor) return;
        const isDark = document?.documentElement?.dataset?.themeAppearance === 'dark';
        const userTheme = this.preferences?.theme || 'auto';

        let themeName = userTheme;
        if (userTheme === 'auto') {
            if (language === 'markdown' || language === 'sql' || language === 'mysql' || language === 'pgsql') {
                themeName = 'markdown-sql';
            } else if (language === 'csv' && !isDark) {
                themeName = 'csv';
            }
        }

        const themeExt = buildTheme(themeName, isDark);
        const hlStyle = buildHighlightStyle(themeName, isDark);
        this.editor.dispatch({
            effects: [
                this._themeCompartment.reconfigure(themeExt),
                this._highlightCompartment.reconfigure(hlStyle),
            ]
        });
    }

    applyPreferences(prefs = null) {
        if (!prefs || typeof prefs !== 'object') {
            this.preferences = null;
            this.applyPreferencesToEditor();
            return;
        }

        const { codeTheme, codeFontSize, codeLineHeight, codeFontFamily, codeFontWeight } = prefs;
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
        if (!this.editor) return;

        const prefs = this.preferences || {};
        const fontSize = Number.isFinite(prefs.fontSize) ? prefs.fontSize : DEFAULT_CODE_FONT_SIZE;
        const lineHeightRatio = Number.isFinite(prefs.lineHeight) ? prefs.lineHeight : DEFAULT_LINE_HEIGHT_RATIO;
        const computedLineHeight = Math.max(Math.round(fontSize * lineHeightRatio), fontSize);

        this.baseFontSize = fontSize;
        this.baseLineHeightRatio = lineHeightRatio;
        this.baseLineHeight = computedLineHeight;
        this.applyZoomOptions();

        // Apply theme
        this._applyThemeForLanguage(this.currentLanguage || 'plaintext');
    }

    _buildFontTheme() {
        const baseFontSize = this.baseFontSize || DEFAULT_CODE_FONT_SIZE;
        const baseLineHeight = this.baseLineHeight
            || Math.max(Math.round(baseFontSize * this.baseLineHeightRatio), baseFontSize);
        const zoomedFontSize = Math.max(8, Math.round(baseFontSize * this.zoomScale * 100) / 100);
        const zoomedLineHeight = Math.max(
            Math.round(baseLineHeight * this.zoomScale),
            Math.ceil(zoomedFontSize)
        );
        const prefs = this.preferences || {};
        const fontFamily = prefs.fontFamily || "'Menlo', 'Monaco', 'Courier New', monospace";
        const fontWeight = (prefs.fontWeight || 400).toString();

        return EditorView.theme({
            '&': {
                fontSize: `${zoomedFontSize}px`,
            },
            '.cm-content': {
                fontFamily,
                fontWeight,
                lineHeight: `${zoomedLineHeight}px`,
            },
            '.cm-gutters': {
                fontFamily,
                fontSize: `${zoomedFontSize}px`,
            },
        });
    }

    applyZoomOptions() {
        if (!this.editor) return;
        const fontTheme = this._buildFontTheme();
        this.editor.dispatch({
            effects: this._fontCompartment.reconfigure(fontTheme)
        });
        this.requestLayout();
    }

    setZoomScale(scale) {
        const clamped = this.clampZoomScale(scale);
        if (Math.abs(clamped - this.zoomScale) < 0.01) return;
        this.zoomScale = clamped;
        this.applyZoomOptions();
    }

    clampZoomScale(value) {
        if (!Number.isFinite(value)) return 1;
        return Math.min(MAX_ZOOM_SCALE, Math.max(MIN_ZOOM_SCALE, value));
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
        if (this.editor) {
            this.suppressChange = true;
            this.editor.dispatch({
                changes: { from: 0, to: this.editor.state.doc.length, insert: '' }
            });
            this.suppressChange = false;
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
        return this.editor ? this.editor.state.doc.toString() : '';
    }

    /**
     * 同步版本：保存前预处理（JSON 格式化、Markdown 尾部空行）
     * 外部调用方（DocumentIO、fileOperations 等）依赖此方法
     */
    getValueForSave() {
        const raw = this.getValue();

        if (this.currentFile?.toLowerCase().endsWith('.json')) {
            try {
                const parsed = JSON.parse(raw);
                return JSON.stringify(parsed, null, 2);
            } catch (e) {
                return raw;
            }
        }

        if (!shouldEnforceMarkdownTrailingEmptyLine(this.currentFile, this.currentLanguage)) {
            return raw;
        }
        return ensureMarkdownTrailingEmptyLine(raw);
    }

    hasUnsavedChanges() {
        return !!this.isDirty;
    }

    getCurrentLineNumber() {
        if (!this.editor) return null;
        const pos = this.editor.state.selection.main.head;
        return this.editor.state.doc.lineAt(pos).number;
    }

    getCurrentPosition() {
        if (!this.editor) return null;
        const pos = this.editor.state.selection.main.head;
        const line = this.editor.state.doc.lineAt(pos);
        return { lineNumber: line.number, column: pos - line.from + 1 };
    }

    revealLine(lineNumber) {
        if (!this.editor || !Number.isFinite(lineNumber) || lineNumber < 1) return;
        const line = this._safeGetLine(lineNumber);
        if (!line) return;
        this.editor.dispatch({
            selection: { anchor: line.from },
            effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
        });
    }

    revealPosition(lineNumber, column = 1) {
        if (!this.editor || !Number.isFinite(lineNumber) || lineNumber < 1) return;
        const line = this._safeGetLine(lineNumber);
        if (!line) return;
        const safeColumn = Number.isFinite(column) && column >= 1 ? column : 1;
        const pos = Math.min(line.from + safeColumn - 1, line.to);
        this.editor.dispatch({
            selection: { anchor: pos },
            effects: EditorView.scrollIntoView(pos, { y: 'center' }),
        });
    }

    setPositionOnly(lineNumber, column = 1) {
        if (!this.editor || !Number.isFinite(lineNumber) || lineNumber < 1) return;
        const line = this._safeGetLine(lineNumber);
        if (!line) return;
        const safeColumn = Number.isFinite(column) && column >= 1 ? column : 1;
        const pos = Math.min(line.from + safeColumn - 1, line.to);
        this.editor.dispatch({ selection: { anchor: pos } });
    }

    _safeGetLine(lineNumber) {
        if (!this.editor) return null;
        const doc = this.editor.state.doc;
        if (lineNumber < 1 || lineNumber > doc.lines) return null;
        return doc.line(lineNumber);
    }

    getVisibleCenterLine() {
        if (!this.editor) return null;
        const { from, to } = this.editor.viewport;
        const startLine = this.editor.state.doc.lineAt(from).number;
        const endLine = this.editor.state.doc.lineAt(to).number;
        return Math.floor((startLine + endLine) / 2);
    }

    scrollToLineInCenter(lineNumber) {
        if (!this.editor || !Number.isFinite(lineNumber) || lineNumber < 1) return;
        const line = this._safeGetLine(lineNumber);
        if (!line) return;
        this.editor.dispatch({
            effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
        });
    }

    markSaved() {
        this.baseContent = this.getValue();
        this.isDirty = false;
        this.callbacks.onContentChange?.();
    }

    scheduleAutoSave() {
        if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
        if (!this.isDirty || !this.currentFile) return;
        const sessionId = this.currentSessionId;
        this.autoSavePlannedSessionId = sessionId;
        this.autoSaveTimer = setTimeout(() => {
            this.autoSaveTimer = null;
            if (this.autoSavePlannedSessionId !== sessionId) return;
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
        if (!this.isDirty || !this.currentFile) return;
        if (sessionId && !this.isSessionActive(sessionId)) return;
        if (this.isSaving) {
            this.scheduleAutoSave();
            return;
        }

        // 立即锁定，防止 await 期间重入
        this.isSaving = true;

        const filePath = this.currentFile;
        const raw = this.getValue();
        // 同步预处理（JSON 格式化、Markdown 尾部空行）
        let content = this.getValueForSave();

        // 异步格式化（Worker 中执行，不阻塞主线程）
        if (this.formatOnSave && isFormattable(this.currentLanguage)) {
            try {
                const formatted = await formatCode(raw, this.currentLanguage);
                if (formatted && formatted !== raw) {
                    // Markdown 文件还需要确保尾部空行
                    if (shouldEnforceMarkdownTrailingEmptyLine(this.currentFile, this.currentLanguage)) {
                        content = ensureMarkdownTrailingEmptyLine(formatted);
                    } else {
                        content = formatted;
                    }
                }
            } catch (error) {
                console.warn('[CodeEditor] 格式化异常，使用预处理内容:', error);
            }
        }

        const localWriteKey = normalizeFsPath(filePath) || filePath;
        const hadFocusBeforeSave = this.editor?.hasFocus ?? false;

        // 检查 await 期间文件/会话是否已切换
        if (filePath !== this.currentFile) {
            this.isSaving = false;
            return;
        }

        // 检查 await 期间用户是否继续编辑了内容
        const currentRaw = this.getValue();
        const userEditedDuringFormat = currentRaw !== raw;
        const contentChanged = content !== currentRaw;

        const savePromise = (async () => {
            try {
                const services = getAppServices();
                if (localWriteKey && this.documentSessions?.markLocalWrite) {
                    this.documentSessions.markLocalWrite(localWriteKey);
                }
                await services.file.writeText(filePath, content);
                if (!sessionId || sessionId === this.currentSessionId) {
                    if (userEditedDuringFormat) {
                        // 用户在格式化期间继续编辑了，不刷新编辑器，重新触发保存
                        this.isDirty = true;
                        this.scheduleAutoSave();
                    } else if (contentChanged && this.editor) {
                        const pos = this.editor.state.selection.main.head;
                        this.suppressChange = true;
                        this.editor.dispatch({
                            changes: { from: 0, to: this.editor.state.doc.length, insert: content }
                        });
                        this.suppressChange = false;
                        const safePos = Math.min(pos, this.editor.state.doc.length);
                        this.editor.dispatch({ selection: { anchor: safePos } });
                    }
                    this.markSaved();
                    if (hadFocusBeforeSave && this.isVisible && this.editor) {
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
        if (!this.editor) return;
        this.editor.focus();
    }

    resolveLanguage(language) {
        const candidate = typeof language === 'string' && language.length > 0 ? language : 'plaintext';
        return candidate;
    }

    dispose() {
        this.detachDocument();
        this.cancelAutoSave();
        if (this.pendingLayoutFrame !== null) {
            cancelAnimationFrame(this.pendingLayoutFrame);
            this.pendingLayoutFrame = null;
        }
        if (this.editor) {
            this.editor.destroy();
            this.editor = null;
        }
        if (this.pasteHandler) {
            this.editorHost?.removeEventListener('paste', this.pasteHandler, true);
            this.pasteHandler = null;
        }
        window.removeEventListener('resize', this.handleResize);
        this.currentTabId = null;
        this.tabViewStates.clear();
    }

    saveViewStateForTab(tabId) {
        if (!tabId || !this.editor) return;
        try {
            const scrollTop = this.editor.scrollDOM.scrollTop;
            this.tabViewStates.set(tabId, {
                editorState: this.editor.state,
                content: this.editor.state.doc.toString(),
                baseContent: this.baseContent,
                isDirty: this.isDirty,
                language: this.currentLanguage,
                scrollTop,
                lastActive: Date.now(),
            });
        } catch (error) {
            console.warn('[CodeEditor] 保存视图状态失败', error);
        }
    }

    restoreViewStateForTab(tabId, content = this.baseContent, language = this.currentLanguage) {
        return this.restoreTabState(tabId, content, language);
    }

    forgetViewStateForTab(tabId) {
        if (!tabId) return;
        this.tabViewStates.delete(tabId);
    }

    renameViewStateTab(oldTabId, newTabId) {
        if (!oldTabId || !newTabId || oldTabId === newTabId) return;
        if (!this.tabViewStates.has(oldTabId)) return;
        const state = this.tabViewStates.get(oldTabId);
        this.tabViewStates.delete(oldTabId);
        if (state) this.tabViewStates.set(newTabId, state);
    }

    trimStaleViewStates(maxAge) {
        const now = Date.now();
        for (const [tabId, snapshot] of this.tabViewStates) {
            if (tabId === this.currentTabId) continue;
            if (!snapshot?.editorState) continue;
            const lastActive = snapshot.lastActive ?? 0;
            if (now - lastActive < maxAge) continue;
            snapshot.editorState = null;
        }
    }

    getSelectionText() {
        if (!this.editor) return '';
        const { from, to } = this.editor.state.selection.main;
        if (from === to) return '';
        return this.editor.state.sliceDoc(from, to);
    }

    replaceSelectionWithText(text) {
        if (!this.editor) return;
        const { from, to } = this.editor.state.selection.main;
        const nextText = typeof text === 'string' ? text : '';
        this.editor.focus();
        this.editor.dispatch({
            changes: { from, to, insert: nextText },
        });
    }

    insertTextAtCursor(text) {
        if (!this.editor) return;
        const pos = this.editor.state.selection.main.head;
        const nextText = typeof text === 'string' ? text : '';
        this.editor.focus();
        this.editor.dispatch({
            changes: { from: pos, to: pos, insert: nextText },
        });
    }

    undo() {
        const view = this.editor;
        if (!view) return false;
        view.focus();
        return undo({ state: view.state, dispatch: (tr) => view.dispatch(tr) });
    }

    redo() {
        const view = this.editor;
        if (!view) return false;
        view.focus();
        return redo({ state: view.state, dispatch: (tr) => view.dispatch(tr) });
    }

    // --- AI Stream ---

    beginAiStreamSession(sessionId) {
        if (!this.editor || !sessionId) return null;
        const doc = this.editor.state.doc;
        const { from, to } = this.editor.state.selection.main;
        const hasSelection = from !== to;
        let anchorOffset = hasSelection ? from : this.editor.state.selection.main.head;

        if (hasSelection) {
            this.editor.dispatch({
                changes: { from, to, insert: '' },
            });
            anchorOffset = from;
        }

        const session = {
            id: sessionId,
            startOffset: anchorOffset,
            currentOffset: anchorOffset,
            buffer: '',
        };
        this.aiStreamSessions.set(sessionId, session);
        return session;
    }

    appendAiStreamContent(sessionId, delta) {
        if (!this.editor || !sessionId) return;
        const session = this.aiStreamSessions.get(sessionId);
        if (!session) return;
        const chunk = typeof delta === 'string' ? delta : '';
        if (!chunk) return;

        const pos = session.currentOffset;
        this.editor.focus();
        this.editor.dispatch({
            changes: { from: pos, to: pos, insert: chunk },
        });

        session.currentOffset += chunk.length;
        session.buffer += chunk;
    }

    finalizeAiStreamSession(sessionId, content) {
        if (!this.editor || !sessionId) return;
        const session = this.aiStreamSessions.get(sessionId);
        if (!session) return;

        const finalText = typeof content === 'string' ? content : session.buffer;
        if (finalText !== session.buffer) {
            this.editor.focus();
            this.editor.dispatch({
                changes: { from: session.startOffset, to: session.currentOffset, insert: finalText },
            });
        }

        this.aiStreamSessions.delete(sessionId);
    }

    abortAiStreamSession(sessionId) {
        if (!this.editor || !sessionId) return;
        const session = this.aiStreamSessions.get(sessionId);
        if (!session) return;

        this.editor.focus();
        this.editor.dispatch({
            changes: { from: session.startOffset, to: session.currentOffset, insert: '' },
        });

        this.aiStreamSessions.delete(sessionId);
    }

    hasAiStreamSession(sessionId) {
        return this.aiStreamSessions.has(sessionId);
    }

    // --- Search ---

    findMatches(searchTerm) {
        if (!this.editor || !searchTerm) return [];
        const doc = this.editor.state.doc;
        const text = doc.toString();
        const lowerSearch = searchTerm.toLowerCase();
        const lowerText = text.toLowerCase();
        const matches = [];
        let startIndex = 0;

        while (startIndex < lowerText.length) {
            const idx = lowerText.indexOf(lowerSearch, startIndex);
            if (idx === -1) break;
            const from = idx;
            const to = idx + searchTerm.length;
            const startLine = doc.lineAt(from);
            const endLine = doc.lineAt(to);
            matches.push({
                range: {
                    startLineNumber: startLine.number,
                    startColumn: from - startLine.from + 1,
                    endLineNumber: endLine.number,
                    endColumn: to - endLine.from + 1,
                },
                _from: from,
                _to: to,
            });
            startIndex = idx + 1;
        }
        return matches;
    }

    setSearchTerm(searchTerm) {
        if (!this.editor) return { total: 0, current: -1 };
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
            nextIndex = matches.findIndex(m =>
                m.range.startLineNumber === previousMatch.range.startLineNumber
                && m.range.startColumn === previousMatch.range.startColumn
                && m.range.endLineNumber === previousMatch.range.endLineNumber
                && m.range.endColumn === previousMatch.range.endColumn
            );
        }

        if (nextIndex === -1 && this.currentMatchIndex >= 0) {
            nextIndex = Math.min(this.currentMatchIndex, matches.length - 1);
        }
        if (nextIndex === -1) nextIndex = 0;

        this.currentMatchIndex = nextIndex;
        this.highlightMatches(matches, this.currentMatchIndex);

        return { total: matches.length, current: this.currentMatchIndex };
    }

    highlightMatches(matches, currentIndex) {
        if (!this.editor) return;
        if (!matches || matches.length === 0) {
            this.clearSearchDecorations();
            return;
        }

        const decorations = matches.map((match, index) => {
            const cls = index === currentIndex ? 'search-result-current' : 'search-result';
            return Decoration.mark({ class: cls }).range(match._from, match._to);
        });

        this.editor.dispatch({
            effects: setSearchDecorations.of(Decoration.set(decorations, true))
        });
    }

    scrollToMatch(index) {
        if (!this.editor || !this.searchMatches || index < 0 || index >= this.searchMatches.length) return;
        const match = this.searchMatches[index];
        this.editor.dispatch({
            selection: { anchor: match._from },
            effects: EditorView.scrollIntoView(match._from, { y: 'center' }),
        });
    }

    nextSearchResult() {
        if (!this.searchMatches || this.searchMatches.length === 0) return null;
        this.currentMatchIndex = (this.currentMatchIndex + 1) % this.searchMatches.length;
        this.highlightMatches(this.searchMatches, this.currentMatchIndex);
        this.scrollToMatch(this.currentMatchIndex);
        return { total: this.searchMatches.length, current: this.currentMatchIndex };
    }

    prevSearchResult() {
        if (!this.searchMatches || this.searchMatches.length === 0) return null;
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

        const total = this.searchMatches.length;
        const selections = this.searchMatches.map(m =>
            EditorSelection.range(m._from, m._to)
        );

        // Single dispatch: set multi-cursor + clear decorations + scroll
        const effects = [setSearchDecorations.of(Decoration.none)];
        if (this.searchMatches[0]) {
            effects.push(EditorView.scrollIntoView(this.searchMatches[0]._from, { y: 'center' }));
        }

        this.editor.dispatch({
            selection: EditorSelection.create(selections, 0),
            effects,
        });

        // Clear search state so refreshSearchMatches won't re-dispatch during typing
        this.searchTerm = '';
        this.searchMatches = null;
        this.currentMatchIndex = -1;

        this.editor.focus();
        return { applied: true, total };
    }

    replaceCurrentSearchMatch(replacementText) {
        if (!this.editor || !this.searchMatches || this.searchMatches.length === 0 || this.currentMatchIndex < 0) {
            return { replaced: 0, total: this.searchMatches?.length || 0, current: this.currentMatchIndex };
        }

        const replacement = typeof replacementText === 'string' ? replacementText : '';
        const match = this.searchMatches[this.currentMatchIndex];

        this.editor.focus();
        this.editor.dispatch({
            changes: { from: match._from, to: match._to, insert: replacement }
        });

        // dispatch 同步触发 onDidChangeContent → SearchBoxManager.handleContentMutated → refreshSearchMatches
        // 此时 this.searchMatches 已基于新内容刷新，原 index 自然落到下一个匹配
        if (this.searchMatches && this.searchMatches.length > 0 && this.currentMatchIndex >= 0) {
            this.scrollToMatch(this.currentMatchIndex);
        }

        return {
            replaced: 1,
            total: this.searchMatches?.length || 0,
            current: this.currentMatchIndex
        };
    }

    replaceAllSearchMatches(replacementText) {
        if (!this.editor || !this.searchMatches || this.searchMatches.length === 0) {
            return { replaced: 0 };
        }

        const replacement = typeof replacementText === 'string' ? replacementText : '';
        // Build changes in reverse order to preserve offsets
        const changes = [...this.searchMatches]
            .sort((a, b) => b._from - a._from)
            .map(match => ({
                from: match._from,
                to: match._to,
                insert: replacement,
            }));

        this.editor.focus();
        this.editor.dispatch({ changes });

        const replacedCount = this.searchMatches.length;
        this.clearSearch();
        return { replaced: replacedCount };
    }

    clearSearchDecorations() {
        if (this.editor) {
            this.editor.dispatch({
                effects: setSearchDecorations.of(Decoration.none)
            });
        }
    }

    clearSearch() {
        this.clearSearchDecorations();
        this.searchTerm = '';
        this.searchMatches = null;
        this.currentMatchIndex = -1;
    }

    // --- Scroll API (for viewController.js compatibility) ---

    getScrollTop() {
        return this.editor?.scrollDOM?.scrollTop ?? 0;
    }

    setScrollTop(value) {
        if (this.editor?.scrollDOM) {
            this.editor.scrollDOM.scrollTop = value;
        }
    }

    getScrollHeight() {
        return this.editor?.scrollDOM?.scrollHeight ?? 0;
    }

    getClientHeight() {
        return this.editor?.scrollDOM?.clientHeight ?? 0;
    }

    onDidChangeContent(handler) {
        if (typeof handler !== 'function') return () => {};
        this.contentChangeListeners.add(handler);
        return () => { this.contentChangeListeners.delete(handler); };
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
}
