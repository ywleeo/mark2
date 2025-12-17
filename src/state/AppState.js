/**
 * 应用核心状态管理类
 * 集中管理应用级的状态，替代原先散落在 main.js 中的全局变量
 */
export class AppState {
    constructor() {
        // ========== 文件相关状态 ==========
        this.currentFile = null;
        this.hasUnsavedChanges = false;

        // ========== 编辑器设置 ==========
        this.editorSettings = null;
        this.availableFontFamilies = [];

        // ========== 视图模式状态 ==========
        this.activeViewMode = 'markdown'; // markdown | code | image | media | spreadsheet | pdf | unsupported

        // ========== 缩放状态 ==========
        this.contentZoom = 1; // 内容缩放级别（默认1表示100%）
        this.pdfZoomState = {
            zoomValue: 1,
            canZoomIn: true,
            canZoomOut: true,
        };

        // ========== 导出菜单状态 ==========
        this.exportMenuEnabledState = null;

        // ========== UI 组件实例 ==========
        this.fileTree = null;
        this.tabManager = null;
        this.settingsDialog = null;
        this.markdownToolbarManager = null;

        // ========== 控制器实例 ==========
        this.statusBarController = null;
        this.fileWatcherController = null;
        this.fileDropController = null;
        this.markdownCodeMode = null;
        this.svgCodeMode = null;
        this.documentIO = null;

        // ========== DOM 元素引用 ==========
        this.paneElements = {
            markdown: null,
            code: null,
            image: null,
            media: null,
            spreadsheet: null,
            pdf: null,
            unsupported: null,
            viewContainer: null,
        };

        // ========== 清理函数 ==========
        this.cleanupFunctions = {
            keyboardShortcut: null,
            sidebarResizer: null,
            menuListeners: null,
            fileDrop: null,
            appearanceChange: null,
        };
    }

    // ========== 文件状态管理 ==========

    getCurrentFile() {
        return this.currentFile;
    }

    setCurrentFile(filePath) {
        this.currentFile = filePath;
        // 同时导出到 window（兼容现有代码）
        if (typeof window !== 'undefined') {
            window.currentFile = filePath;
        }
    }

    getHasUnsavedChanges() {
        return this.hasUnsavedChanges;
    }

    setHasUnsavedChanges(value) {
        this.hasUnsavedChanges = Boolean(value);
    }

    // ========== 编辑器设置管理 ==========

    getEditorSettings() {
        return this.editorSettings;
    }

    setEditorSettings(settings) {
        this.editorSettings = settings;
    }

    getAvailableFontFamilies() {
        return this.availableFontFamilies;
    }

    setAvailableFontFamilies(fonts) {
        this.availableFontFamilies = fonts;
    }

    // ========== 视图模式管理 ==========

    getActiveViewMode() {
        return this.activeViewMode;
    }

    setActiveViewMode(mode) {
        this.activeViewMode = mode;
    }

    // ========== 缩放状态管理 ==========

    getContentZoom() {
        return this.contentZoom;
    }

    setContentZoom(value) {
        this.contentZoom = value;
    }

    getPdfZoomState() {
        return this.pdfZoomState;
    }

    setPdfZoomState(state) {
        this.pdfZoomState = state;
    }

    // ========== 导出菜单状态 ==========

    getExportMenuEnabledState() {
        return this.exportMenuEnabledState;
    }

    setExportMenuEnabledState(enabled) {
        this.exportMenuEnabledState = enabled;
    }

    // ========== UI 组件实例管理 ==========

    getFileTree() {
        return this.fileTree;
    }

    setFileTree(instance) {
        this.fileTree = instance;
    }

    getTabManager() {
        return this.tabManager;
    }

    setTabManager(instance) {
        this.tabManager = instance;
    }

    getSettingsDialog() {
        return this.settingsDialog;
    }

    setSettingsDialog(instance) {
        this.settingsDialog = instance;
    }

    getMarkdownToolbarManager() {
        return this.markdownToolbarManager;
    }

    setMarkdownToolbarManager(instance) {
        this.markdownToolbarManager = instance;
    }

    // ========== 控制器实例管理 ==========

    getStatusBarController() {
        return this.statusBarController;
    }

    setStatusBarController(instance) {
        this.statusBarController = instance;
    }

    getFileWatcherController() {
        return this.fileWatcherController;
    }

    setFileWatcherController(instance) {
        this.fileWatcherController = instance;
    }

    getFileDropController() {
        return this.fileDropController;
    }

    setFileDropController(instance) {
        this.fileDropController = instance;
    }

    getMarkdownCodeMode() {
        return this.markdownCodeMode;
    }

    setMarkdownCodeMode(instance) {
        this.markdownCodeMode = instance;
    }

    getSvgCodeMode() {
        return this.svgCodeMode;
    }

    setSvgCodeMode(instance) {
        this.svgCodeMode = instance;
    }

    getDocumentIO() {
        return this.documentIO;
    }

    setDocumentIO(instance) {
        this.documentIO = instance;
    }

    // ========== DOM 元素管理 ==========

    getPaneElement(type) {
        return this.paneElements[type];
    }

    setPaneElement(type, element) {
        this.paneElements[type] = element;
    }

    getAllPaneElements() {
        return this.paneElements;
    }

    // ========== 清理函数管理 ==========

    setCleanupFunction(type, cleanupFn) {
        this.cleanupFunctions[type] = cleanupFn;
    }

    getCleanupFunction(type) {
        return this.cleanupFunctions[type];
    }

    executeCleanup(type) {
        const cleanupFn = this.cleanupFunctions[type];
        if (cleanupFn && typeof cleanupFn === 'function') {
            cleanupFn();
            this.cleanupFunctions[type] = null;
        }
    }

    executeAllCleanups() {
        Object.keys(this.cleanupFunctions).forEach(type => {
            this.executeCleanup(type);
        });
    }

    // ========== 重置状态 ==========

    reset() {
        this.currentFile = null;
        this.hasUnsavedChanges = false;
        this.activeViewMode = 'markdown';
        if (typeof window !== 'undefined') {
            window.currentFile = null;
        }
    }
}
