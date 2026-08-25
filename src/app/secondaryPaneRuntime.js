import { EditorRegistry } from '../state/EditorRegistry.js';
import { createDocumentSessionManager } from '../modules/documentSessionManager.js';
import { PANE_IDS } from '../core/layout/PaneManager.js';

const SECONDARY_DOCUMENT_OWNER = 'pane:secondary';
const EDITABLE_VIEW_MODES = new Set(['markdown', 'code']);
const UNTITLED_PROTOCOL = 'untitled://';

/**
 * 在副栏容器中创建与主栏隔离的视图面板。
 * @param {HTMLElement} host - 副栏 view-content 容器。
 * @returns {Map<string, HTMLElement>} 视图模式到 DOM 的映射。
 */
function setupSecondaryViewPanes(host) {
    host.innerHTML = `
        <div class="view-pane markdown-pane" data-pane="markdown"></div>
        <div class="view-pane code-pane" data-pane="code"></div>
        <div class="view-pane image-pane" data-pane="image"></div>
        <div class="view-pane media-pane" data-pane="media"></div>
        <div class="view-pane spreadsheet-pane" data-pane="spreadsheet"></div>
        <div class="view-pane pdf-pane" data-pane="pdf"></div>
        <div class="view-pane embed-pane" data-pane="embed"></div>
        <div class="view-pane unsupported-pane" data-pane="unsupported"></div>
    `;
    return new Map(
        Array.from(host.querySelectorAll('[data-pane]'))
            .map(element => [element.dataset.pane, element]),
    );
}

/**
 * 创建一个只控制副栏 DOM 的 View 协议。
 * @param {Map<string, HTMLElement>} paneElements - 副栏视图面板。
 * @param {(mode:string)=>void} onActivate - 激活回调。
 * @returns {Object} renderer 可复用的 View 协议。
 */
function createSecondaryViewProtocol(paneElements, onActivate) {
    return {
        /**
         * 激活一个副栏视图。
         * @param {string} mode - 目标视图模式。
         */
        activate(mode) {
            if (!paneElements.has(mode)) {
                throw new Error(`副栏不支持视图模式: ${mode}`);
            }
            for (const [paneMode, element] of paneElements) {
                element.classList.toggle('is-active', paneMode === mode);
            }
            onActivate(mode);
        },
    };
}

/**
 * 副栏独立运行时。
 * 每个编辑器和查看器实例只注册在本 Runtime 的 EditorRegistry 中，不进入主栏全局注册表。
 */
export class SecondaryPaneRuntime {
    /**
     * @param {Object} options - Runtime 依赖。
     */
    constructor({
        constructors,
        paneManager,
        documentRegistry,
        rendererRegistry,
        fileService,
        detectLanguageForPath,
        getViewModeForPath,
        getEditorSettings,
        getContentZoom,
        onContentChange,
        onAutoSaveSuccess,
        onAutoSaveError,
        onLoaded,
        onReleased,
    }) {
        this.constructors = constructors;
        this.paneManager = paneManager;
        this.registry = documentRegistry;
        this.rendererRegistry = rendererRegistry;
        this.fileService = fileService;
        this.detectLanguageForPath = detectLanguageForPath;
        this.getViewModeForPath = getViewModeForPath;
        this.getEditorSettings = getEditorSettings;
        this.getContentZoom = getContentZoom;
        this.onContentChange = onContentChange;
        this.onAutoSaveSuccess = onAutoSaveSuccess;
        this.onAutoSaveError = onAutoSaveError;
        this.onLoaded = onLoaded;
        this.onReleased = onReleased;

        this.id = PANE_IDS.SECONDARY;
        this.editorRegistry = new EditorRegistry();
        this.documentSessions = createDocumentSessionManager();
        this.host = null;
        this.paneElements = null;
        this.view = null;
        this.activeViewMode = null;
        this.currentPath = null;
        this.currentDocument = null;
        this.loadingPath = null;
        this.loadingViewMode = null;
        this.loadRequestId = 0;
        this.loadQueue = Promise.resolve();
        this.registryUnsubscribe = null;
        this.paneUnsubscribe = this.paneManager.subscribe(event => {
            if (event?.type === 'document-rename' && this.currentPath === event.oldPath) {
                this.renameDocumentPath(event.newPath);
            }
        });
        this.initialized = false;
    }

    /**
     * 延迟创建副栏全部编辑器和查看器实例。
     */
    initialize() {
        if (this.initialized) {
            return;
        }
        this.host = document.getElementById('secondaryViewContent');
        if (!this.host) {
            throw new Error('SecondaryPaneRuntime 缺少 secondaryViewContent');
        }
        this.paneElements = setupSecondaryViewPanes(this.host);
        this.view = createSecondaryViewProtocol(this.paneElements, mode => {
            // 加载事务完成前只更新候选视图，避免 PaneManager 提前持久化半成品状态。
            if (this.loadingPath) {
                this.loadingViewMode = mode;
                return;
            }
            this.activeViewMode = mode;
            this.paneManager.setPaneViewMode(PANE_IDS.SECONDARY, mode);
        });

        const callbacks = {
            onContentChange: () => this.handleContentChange(),
            onAutoSaveSuccess: payload => this.handleAutoSaveSuccess(payload),
            onAutoSaveError: error => this.onAutoSaveError?.(error),
        };
        const {
            MarkdownEditor,
            CodeEditor,
            ImageViewer,
            MediaViewer,
            SpreadsheetViewer,
            PdfViewer,
            UnsupportedViewer,
        } = this.constructors;

        const markdownEditor = new MarkdownEditor(
            this.paneElements.get('markdown'),
            callbacks,
            {
                documentSessions: this.documentSessions,
                getCurrentFile: () => this.loadingPath || this.currentPath,
                documentChangeSource: 'pane:secondary:markdown',
            },
        );
        const codeEditor = new CodeEditor(
            this.paneElements.get('code'),
            callbacks,
            {
                documentSessions: this.documentSessions,
                documentChangeSource: 'pane:secondary:code',
            },
        );
        const imageViewer = new ImageViewer(this.paneElements.get('image'));
        const mediaViewer = new MediaViewer(this.paneElements.get('media'));
        const spreadsheetViewer = new SpreadsheetViewer(this.paneElements.get('spreadsheet'));
        const pdfViewer = new PdfViewer(this.paneElements.get('pdf'));
        const unsupportedViewer = new UnsupportedViewer(this.paneElements.get('unsupported'));

        this.editorRegistry.register('markdown', markdownEditor);
        this.editorRegistry.register('code', codeEditor);
        this.editorRegistry.register('image', imageViewer);
        this.editorRegistry.register('media', mediaViewer);
        this.editorRegistry.register('spreadsheet', spreadsheetViewer);
        this.editorRegistry.register('pdf', pdfViewer);
        this.editorRegistry.register('unsupported', unsupportedViewer);

        codeEditor.applyPreferences?.(this.getEditorSettings?.());
        codeEditor.setZoomScale?.(this.getContentZoom?.() ?? 1);
        imageViewer.setZoomScale?.(this.getContentZoom?.() ?? 1);
        mediaViewer.setZoomScale?.(this.getContentZoom?.() ?? 1);
        markdownEditor.setCodeEditor?.(codeEditor);
        for (const instance of this.editorRegistry.getAllInstances()) {
            instance?.hide?.();
        }

        this.registryUnsubscribe = this.registry.subscribe(({ path }) => {
            if (path === this.currentPath) {
                this.onContentChange?.({
                    paneId: this.id,
                    path,
                    dirty: this.registry.isDirty(path),
                });
            }
        });
        this.initialized = true;
    }

    /**
     * 返回副栏当前视图模式。
     * @returns {string|null} 当前视图模式。
     */
    getActiveViewMode() {
        return this.activeViewMode;
    }

    /**
     * 返回副栏当前文档路径。
     * @returns {string|null} 当前路径。
     */
    getDocumentPath() {
        return this.currentPath;
    }

    /**
     * 迁移副栏 Runtime 内的文档路径引用。
     * @param {string} newPath - 重命名后的路径。
     */
    renameDocumentPath(newPath) {
        if (!newPath || !this.currentPath || newPath === this.currentPath) {
            return;
        }
        const oldPath = this.currentPath;
        this.currentPath = newPath;
        this.documentSessions.updateSessionPath?.(oldPath, newPath);
        const codeEditor = this.editorRegistry.getCodeEditor();
        if (codeEditor?.currentFile === oldPath) codeEditor.currentFile = newPath;
        for (const type of ['image', 'media', 'spreadsheet', 'pdf', 'unsupported']) {
            const viewer = this.editorRegistry.get(type);
            if (viewer?.currentFile === oldPath) viewer.currentFile = newPath;
        }
    }

    /**
     * 返回副栏当前活动编辑器。
     * @returns {Object|null} MarkdownEditor 或 CodeEditor。
     */
    getActiveEditor() {
        if (!EDITABLE_VIEW_MODES.has(this.activeViewMode)) {
            return null;
        }
        return this.editorRegistry.get(this.activeViewMode);
    }

    /**
     * 查询副栏文档是否存在未保存修改。
     * @returns {boolean} dirty 状态。
     */
    isDirty() {
        return Boolean(this.currentPath && this.registry.isDirty(this.currentPath));
    }

    /**
     * 解析目标文件最终使用的 renderer。
     * @param {string} filePath - 文件路径。
     * @param {string} targetMode - 目标视图模式。
     * @returns {Object|null} renderer。
     */
    resolveRenderer(filePath, targetMode) {
        const preferred = this.rendererRegistry.getHandlerForPath(filePath);
        if (preferred?.getViewMode?.(filePath) === targetMode) {
            return preferred;
        }
        if (targetMode === 'code') {
            return this.rendererRegistry.defaultHandler || preferred;
        }
        return this.rendererRegistry.getHandlerById(targetMode);
    }

    /**
     * 判断指定加载事务是否仍是副栏最后一次请求。
     * @param {number} requestId - 加载请求序号。
     * @param {number|null} sessionId - 文档会话序号。
     * @returns {boolean} 是否仍允许提交。
     */
    isLoadActive(requestId, sessionId = null) {
        return requestId === this.loadRequestId
            && (!sessionId || this.documentSessions.isSessionActive(sessionId));
    }

    /**
     * 释放一次未提交加载取得的候选文档租约。
     * @param {string} filePath - 候选文档路径。
     * @param {boolean} acquiredLease - 本事务是否新取得租约。
     */
    releaseCandidateLease(filePath, acquiredLease) {
        if (acquiredLease) {
            this.registry.releaseDocument(filePath, SECONDARY_DOCUMENT_OWNER);
        }
    }

    /**
     * 让非活动文本编辑器解除旧 DocumentModel 订阅，避免隐藏实例继续持有已释放模型。
     * @param {string} targetViewMode - 已提交的视图模式。
     */
    detachInactiveEditors(targetViewMode) {
        if (targetViewMode !== 'markdown') {
            this.editorRegistry.getMarkdownEditor()?.detachDocument?.();
        }
        if (targetViewMode !== 'code') {
            this.editorRegistry.getCodeEditor()?.detachDocument?.();
        }
    }

    /**
     * 把已完成读取的文档渲染到副栏，调用方负责事务有效性检查。
     * @param {Object} options - 渲染上下文。
     * @returns {Promise<string>} 最终视图模式。
     */
    async renderLoadedDocument({
        filePath,
        session,
        fileData,
        doc,
        initialViewMode,
        focus,
        forceReload = false,
    }) {
        if (initialViewMode === 'image' || initialViewMode === 'media') {
            const renderer = this.resolveRenderer(filePath, initialViewMode);
            const rendered = await renderer?.load?.(this.createRendererContext({
                filePath,
                session,
                fileData: { content: null, viewMode: initialViewMode, hasChanges: false },
                doc: null,
                targetViewMode: initialViewMode,
                autoFocus: focus,
                forceReload,
            }));
            if (rendered === false || !renderer) {
                throw new Error(`副栏无法渲染 ${initialViewMode} 文档`);
            }
            return initialViewMode;
        }

        const targetViewMode = fileData.viewMode || initialViewMode;
        if (targetViewMode === 'spreadsheet') {
            this.view.activate('spreadsheet');
            await this.editorRegistry.getSpreadsheetViewer()?.loadWorkbook?.(
                filePath,
                fileData.content,
                { forceReload },
            );
        } else if (targetViewMode === 'docx' || targetViewMode === 'pptx') {
            this.view.activate('unsupported');
            this.editorRegistry.getUnsupportedViewer()?.show?.(
                filePath,
                '该导入型文件暂不支持在副栏直接预览',
            );
            return 'unsupported';
        } else if (targetViewMode === 'unsupported') {
            this.view.activate('unsupported');
            this.editorRegistry.getUnsupportedViewer()?.show?.(filePath, fileData.error);
        } else {
            const renderer = this.resolveRenderer(filePath, targetViewMode);
            if (!renderer) {
                throw new Error(`缺少副栏 ${targetViewMode} renderer`);
            }
            const rendered = await renderer.load(this.createRendererContext({
                filePath,
                session,
                fileData,
                doc,
                targetViewMode,
                autoFocus: focus,
                forceReload,
            }));
            if (rendered === false) {
                throw new Error(`副栏 ${targetViewMode} renderer 加载失败`);
            }
        }
        return targetViewMode;
    }

    /**
     * 重新渲染加载事务开始前的已提交文档，保证失败回滚后标题、模型与可见内容一致。
     * @param {{path:string|null,document:Object|null,viewMode:string|null}} previous - 事务前快照。
     * @param {number} requestId - 原加载请求序号。
     * @returns {Promise<boolean>} 是否恢复成功。
     */
    async restoreCommittedDocument(previous, requestId) {
        if (!previous.path || requestId !== this.loadRequestId) {
            return false;
        }

        const initialViewMode = this.getViewModeForPath(previous.path);
        const session = this.documentSessions.beginSession(previous.path);
        const sessionId = session?.id || null;
        this.loadingPath = previous.path;
        this.editorRegistry.getMarkdownEditor()?.prepareForDocument?.(
            session,
            previous.path,
            `secondary:${previous.path}`,
        );
        this.editorRegistry.getCodeEditor()?.prepareForDocument?.(
            session,
            previous.path,
            `secondary:${previous.path}`,
        );

        let restoredDocument = null;
        let acquiredLease = false;
        try {
            let fileData = null;
            if (initialViewMode !== 'image' && initialViewMode !== 'media') {
                fileData = await this.registry.getFileContent(previous.path);
                if (!this.isLoadActive(requestId, sessionId)) {
                    this.documentSessions.closeSession(sessionId);
                    return false;
                }
                const targetViewMode = fileData.viewMode || initialViewMode;
                if (EDITABLE_VIEW_MODES.has(targetViewMode)) {
                    const registeredDocument = this.registry.getDocument?.(previous.path) || null;
                    if (registeredDocument && registeredDocument === previous.document) {
                        restoredDocument = registeredDocument;
                    } else {
                        restoredDocument = await this.registry.acquireDocument(previous.path, {
                            ownerId: SECONDARY_DOCUMENT_OWNER,
                        });
                        acquiredLease = true;
                    }
                }
            }

            const targetViewMode = await this.renderLoadedDocument({
                filePath: previous.path,
                session,
                fileData,
                doc: restoredDocument,
                initialViewMode,
                focus: false,
            });
            if (!this.isLoadActive(requestId, sessionId)) {
                this.releaseCandidateLease(previous.path, acquiredLease);
                this.documentSessions.closeSession(sessionId);
                return false;
            }

            this.detachInactiveEditors(targetViewMode);
            this.currentPath = previous.path;
            this.currentDocument = restoredDocument;
            this.activeViewMode = targetViewMode;
            this.loadingPath = null;
            this.loadingViewMode = null;
            this.paneManager.openSecondary(previous.path, {
                viewMode: targetViewMode,
                focus: false,
            });
            this.documentSessions.markSessionReady(sessionId);
            this.handleContentChange();
            return true;
        } catch (restoreError) {
            this.releaseCandidateLease(previous.path, acquiredLease);
            console.error('[SecondaryPaneRuntime] 回滚文档渲染失败', restoreError);
            this.currentPath = previous.path;
            this.currentDocument = null;
            this.activeViewMode = 'unsupported';
            this.loadingPath = null;
            this.loadingViewMode = null;
            this.view.activate('unsupported');
            this.editorRegistry.getUnsupportedViewer()?.show?.(previous.path, restoreError);
            this.paneManager.openSecondary(previous.path, {
                viewMode: 'unsupported',
                focus: false,
            });
            return false;
        } finally {
            if (this.loadingPath === previous.path) {
                this.loadingPath = null;
                this.loadingViewMode = null;
            }
        }
    }

    /**
     * 在副栏加载文档，不修改标签和文件树选中态。
     * @param {string} filePath - 目标文档路径。
     * @param {{focus?:boolean,forceReload?:boolean}} options - 加载选项。
     * @returns {Promise<boolean>} 是否加载成功。
     */
    async loadDocument(filePath, options = {}) {
        if (!filePath || filePath.startsWith(UNTITLED_PROTOCOL)) {
            return false;
        }
        const requestId = ++this.loadRequestId;
        const execute = () => this.performLoadDocument(filePath, options, requestId);
        const operation = this.loadQueue.then(execute, execute);
        this.loadQueue = operation.catch(() => false);
        return operation;
    }

    /**
     * 串行执行一次副栏加载事务，只有最后一次请求可以提交运行时状态。
     * @param {string} filePath - 目标文档路径。
     * @param {{focus?:boolean,forceReload?:boolean}} options - 加载选项。
     * @param {number} requestId - 加载请求序号。
     * @returns {Promise<boolean>} 是否提交成功。
     */
    async performLoadDocument(filePath, options, requestId) {
        if (requestId !== this.loadRequestId) {
            return false;
        }
        this.initialize();

        const previous = {
            path: this.currentPath,
            document: this.currentDocument,
            viewMode: this.activeViewMode,
        };
        const forceReloadCurrent = previous.path === filePath && options.forceReload === true;
        if (forceReloadCurrent) {
            this.editorRegistry.getMarkdownEditor()?.detachDocument?.();
            this.editorRegistry.getCodeEditor()?.detachDocument?.();
            this.registry.releaseDocument(filePath, SECONDARY_DOCUMENT_OWNER);
            this.currentDocument = null;
        }

        const initialViewMode = this.getViewModeForPath(filePath);
        const session = this.documentSessions.beginSession(filePath);
        const sessionId = session?.id || null;
        this.loadingPath = filePath;
        this.loadingViewMode = null;

        const markdownEditor = this.editorRegistry.getMarkdownEditor();
        const codeEditor = this.editorRegistry.getCodeEditor();
        markdownEditor?.prepareForDocument?.(session, filePath, `secondary:${filePath}`);
        codeEditor?.prepareForDocument?.(session, filePath, `secondary:${filePath}`);
        markdownEditor?.clearAutoSaveTimer?.();
        codeEditor?.cancelAutoSave?.();

        let nextDocument = null;
        let acquiredLease = false;
        try {
            let fileData = null;
            if (initialViewMode !== 'image' && initialViewMode !== 'media') {
                fileData = await this.registry.getFileContent(filePath, {
                    skipCache: options.forceReload === true,
                });
                if (!this.isLoadActive(requestId, sessionId)) {
                    this.documentSessions.closeSession(sessionId);
                    this.loadingPath = null;
                    this.loadingViewMode = null;
                    return false;
                }
                const targetViewMode = fileData.viewMode || initialViewMode;
                if (EDITABLE_VIEW_MODES.has(targetViewMode)) {
                    if (previous.path === filePath && previous.document && !forceReloadCurrent) {
                        nextDocument = previous.document;
                    } else {
                        nextDocument = await this.registry.acquireDocument(filePath, {
                            ownerId: SECONDARY_DOCUMENT_OWNER,
                        });
                        acquiredLease = true;
                    }
                }
            }

            if (!this.isLoadActive(requestId, sessionId)) {
                this.releaseCandidateLease(filePath, acquiredLease);
                this.documentSessions.closeSession(sessionId);
                this.loadingPath = null;
                this.loadingViewMode = null;
                return false;
            }
            const targetViewMode = await this.renderLoadedDocument({
                filePath,
                session,
                fileData,
                doc: nextDocument,
                initialViewMode,
                focus: options.focus !== false,
                forceReload: options.forceReload === true,
            });
            if (!this.isLoadActive(requestId, sessionId)) {
                this.releaseCandidateLease(filePath, acquiredLease);
                this.documentSessions.closeSession(sessionId);
                this.loadingPath = null;
                this.loadingViewMode = null;
                return false;
            }
            this.detachInactiveEditors(targetViewMode);
            if (previous.path && previous.path !== filePath) {
                this.registry.releaseDocument(previous.path, SECONDARY_DOCUMENT_OWNER);
                this.onReleased?.({ paneId: this.id, path: previous.path });
            }
            this.currentPath = filePath;
            this.currentDocument = nextDocument;
            this.activeViewMode = targetViewMode;
            this.loadingPath = null;
            this.loadingViewMode = null;
            this.paneManager.openSecondary(filePath, {
                viewMode: targetViewMode,
                focus: options.focus !== false,
            });
            if (sessionId) {
                this.documentSessions.markSessionReady(sessionId);
            }
            this.onLoaded?.({
                paneId: this.id,
                path: filePath,
                viewMode: targetViewMode,
            });
            this.handleContentChange();
            return true;
        } catch (error) {
            this.releaseCandidateLease(filePath, acquiredLease);
            this.documentSessions.closeSession(sessionId);
            this.loadingPath = null;
            this.loadingViewMode = null;
            if (!this.isLoadActive(requestId)) {
                return false;
            }

            console.error('[SecondaryPaneRuntime] 加载失败，已回滚', error);
            this.currentPath = previous.path;
            this.currentDocument = forceReloadCurrent ? null : previous.document;
            this.activeViewMode = previous.viewMode;
            if (!previous.path) {
                this.paneManager.closeSecondary();
            } else {
                await this.restoreCommittedDocument(previous, requestId);
            }
            this.onAutoSaveError?.(error);
            return false;
        }
    }

    /**
     * 创建 renderer 所需的副栏作用域上下文。
     * @param {Object} options - 当前加载事务。
     * @returns {Object} renderer context。
     */
    createRendererContext({
        filePath,
        session,
        fileData,
        doc,
        autoFocus,
        forceReload = false,
    }) {
        return {
            filePath,
            session,
            fileData,
            doc,
            editorRegistry: this.editorRegistry,
            view: this.view,
            detectLanguageForPath: this.detectLanguageForPath,
            restoreMarkdownScrollPosition: () => {},
            restoreScrollPosition: () => {},
            updateWindowTitle: () => {},
            shouldAutoFocus: autoFocus,
            tabId: `secondary:${filePath}`,
            imageViewer: this.editorRegistry.getImageViewer(),
            mediaViewer: this.editorRegistry.getMediaViewer(),
            spreadsheetViewer: this.editorRegistry.getSpreadsheetViewer(),
            pdfViewer: this.editorRegistry.getPdfViewer(),
            unsupportedViewer: this.editorRegistry.getUnsupportedViewer(),
            embedHost: this.paneElements.get('embed'),
            fileService: this.fileService,
            forceReload,
        };
    }

    /**
     * 保存副栏当前文档。
     * @returns {Promise<boolean>} 是否保存成功。
     */
    async save() {
        if (!this.currentPath || !this.isDirty()) {
            return true;
        }
        if (this.currentPath.startsWith('untitled://')) {
            return false;
        }
        if (this.activeViewMode === 'markdown') {
            const saved = await this.editorRegistry.getMarkdownEditor()?.save?.({ force: true });
            if (saved) {
                await this.registry.refreshModifiedTime?.(this.currentPath);
                this.handleContentChange();
            }
            return Boolean(saved);
        }
        if (this.activeViewMode !== 'code') {
            return true;
        }
        return this.saveCodeEditor();
    }

    /**
     * 以与主栏相同的 revision token 语义保存副栏 CodeEditor。
     * @returns {Promise<boolean>} 是否保存成功。
     */
    async saveCodeEditor() {
        const editor = this.editorRegistry.getCodeEditor();
        if (!editor || editor.currentFile !== this.currentPath) {
            return false;
        }
        const filePath = this.currentPath;
        const raw = editor.getValue();
        const content = editor.getValueForSave?.() ?? raw;
        const token = editor.beginSave?.(content) || null;
        try {
            this.documentSessions.markLocalWrite?.(filePath);
            await this.fileService.writeText(filePath, content);
            this.documentSessions.markLocalWrite?.(filePath);
            editor.markSaved?.(content, token);
            await this.registry.refreshModifiedTime?.(filePath);
            this.handleContentChange();
            return true;
        } catch (error) {
            editor.failSave?.(token, error);
            this.documentSessions.clearLocalWriteSuppression?.(filePath);
            this.onAutoSaveError?.(error);
            return false;
        }
    }

    /**
     * 放弃副栏当前文档相对最近一次落盘内容的修改。
     * 通过 DocumentModel 广播 reload，确保可视编辑器与源码编辑器同时回到同一真源。
     * @returns {boolean} 是否完成回退。
     */
    discardChanges() {
        if (!this.currentDocument || !this.isDirty()) {
            return true;
        }
        this.currentDocument.reloadFromDisk(
            this.currentDocument.getOriginalContent(),
            this.currentDocument.getModifiedTime(),
        );
        this.handleContentChange();
        return true;
    }

    /**
     * 在副栏 Markdown 可视编辑与源码编辑之间切换。
     * 两种编辑器串行绑定同一个 DocumentModel，避免生成第二份内容真源。
     * @returns {Promise<boolean>} 是否完成切换。
     */
    async toggleSourceMode() {
        if (!this.currentDocument || this.currentDocument.uri !== this.currentPath) {
            return false;
        }
        const session = this.documentSessions.getActiveSession();
        const tabId = `secondary:${this.currentPath}`;
        if (this.activeViewMode === 'markdown') {
            this.editorRegistry.getMarkdownEditor()?.detachDocument?.();
            this.view.activate('code');
            await this.editorRegistry.getCodeEditor()?.attachDocument?.(this.currentDocument, {
                session,
                tabId,
                autoFocus: true,
                language: this.detectLanguageForPath(this.currentPath) || 'markdown',
            });
            return true;
        }
        if (this.activeViewMode === 'code') {
            this.editorRegistry.getCodeEditor()?.detachDocument?.();
            this.view.activate('markdown');
            await this.editorRegistry.getMarkdownEditor()?.attachDocument?.(this.currentDocument, {
                session,
                tabId,
                autoFocus: true,
                discardViewState: true,
            });
            return true;
        }
        return false;
    }

    /**
     * 处理编辑器内容变化并向布局层同步 dirty 状态。
     */
    handleContentChange() {
        this.onContentChange?.({
            paneId: this.id,
            path: this.currentPath,
            dirty: this.isDirty(),
        });
    }

    /**
     * 处理自动保存完成事件。
     * @param {Object} payload - 编辑器保存结果。
     */
    async handleAutoSaveSuccess(payload) {
        if (payload?.filePath) {
            await this.registry.refreshModifiedTime?.(payload.filePath);
        }
        this.handleContentChange();
        await this.onAutoSaveSuccess?.(payload);
    }

    /**
     * 释放当前文档并清空副栏实例状态。
     */
    close() {
        const previousPath = this.currentPath;
        // 让正在执行和排队中的加载事务全部失效，销毁后不得再提交 DOM 或租约。
        this.loadRequestId += 1;
        this.loadingPath = null;
        this.loadingViewMode = null;
        this.editorRegistry.getMarkdownEditor()?.clearAutoSaveTimer?.();
        this.editorRegistry.getCodeEditor()?.cancelAutoSave?.();
        this.editorRegistry.getMarkdownEditor()?.detachDocument?.();
        this.editorRegistry.getCodeEditor()?.detachDocument?.();
        this.documentSessions.closeActiveSession();
        if (previousPath) {
            this.registry.releaseDocument(previousPath, SECONDARY_DOCUMENT_OWNER);
            this.onReleased?.({ paneId: this.id, path: previousPath });
        }
        this.currentPath = null;
        this.currentDocument = null;
        this.activeViewMode = null;
        this.onContentChange?.({ paneId: this.id, path: null, dirty: false });
    }

    /**
     * 销毁副栏全部编辑器、查看器和订阅。
     */
    destroy() {
        this.close();
        this.registryUnsubscribe?.();
        this.registryUnsubscribe = null;
        this.paneUnsubscribe?.();
        this.paneUnsubscribe = null;
        this.editorRegistry.destroyAll();
        this.host?.replaceChildren();
        this.initialized = false;
    }
}
