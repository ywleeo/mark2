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

const MODEL_SCHEME = 'inmemory';

let monacoLoader = null;
let monacoEnvironmentReady = false;

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
    constructor(containerElement) {
        this.container = containerElement;
        this.container.classList.add('code-editor-pane');

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

        this.handleResize = () => this.requestLayout();
        this.tapGuardState = null;
        this.tapGuardCleanup = null;
    }

    async ensureEditor(defaultLanguage = 'plaintext') {
        if (this.editor) {
            return;
        }

        const monacoModule = await ensureMonaco();
        const monaco = monacoModule;
        this.monaco = monaco;
        this.editor = monaco.editor.create(this.editorHost, {
            value: '',
            language: defaultLanguage,
            theme: 'vs',
            minimap: { enabled: false },
            automaticLayout: false,
            scrollBeyondLastLine: false,
            smoothScrolling: true,
            fontSize: 14,
            lineNumbers: 'on',
            renderWhitespace: 'selection',
            tabSize: 4,
            insertSpaces: true,
            detectIndentation: false,
            readOnly: true,
            scrollbar: {
                verticalScrollbarSize: 8,
                horizontalScrollbarSize: 8,
                useShadows: false,
            },
        });

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

    async show(filePath, content, language = null) {
        await this.ensureEditor();

        if (!this.monaco || !this.editor) {
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

        model.updateOptions({
            tabSize: 4,
            indentSize: 4,
            insertSpaces: true,
        });

        if (this.currentModel && this.currentModel !== model) {
            this.currentModel.dispose();
        }

        this.attachModel(model, targetLanguage);

        this.currentFile = filePath;
        this.currentLanguage = targetLanguage;
        this.editor.updateOptions({ readOnly: false });
        this.showContainer();
        this.requestLayout();
        this.editor.focus();
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
        });
    }

    hide() {
        this.container.classList.remove('is-active');
        this.isVisible = false;
    }

    clear() {
        this.currentFile = null;
        this.currentLanguage = null;
        this.isDirty = false;
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
            if (event.buttons & 1) {
                this.tapGuardState.canceled = true;
            }
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

    // 搜索相关方法
    findMatches(searchTerm) {
        if (!this.editor || !this.currentModel) return [];

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
        if (!this.editor) return;

        const matches = this.findMatches(searchTerm);
        this.searchMatches = matches;
        this.currentMatchIndex = matches.length > 0 ? 0 : -1;

        // 高亮所有匹配项
        if (matches.length > 0) {
            this.highlightMatches(matches, 0);
            this.scrollToMatch(0);
        }

        return { total: matches.length, current: this.currentMatchIndex };
    }

    highlightMatches(matches, currentIndex) {
        if (!this.editor || !this.monaco) return;

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

    clearSearch() {
        if (!this.editor) return;

        if (this.searchDecorations) {
            this.editor.deltaDecorations(this.searchDecorations, []);
            this.searchDecorations = null;
        }
        this.searchMatches = null;
        this.currentMatchIndex = -1;
    }
}
