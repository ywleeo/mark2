export const ZOOM_DEFAULT = 1;
export const ZOOM_MIN = 0.6;
export const ZOOM_MAX = 2.4;
export const ZOOM_STEP = 0.1;

const ZOOM_SUPPORTED_VIEWS = new Set(['markdown', 'code', 'image', 'pdf', 'spreadsheet']);

export function createViewController(options = {}) {
    // 按文件路径存储滚动状态: { markdown: number, code: number }
    const scrollPositions = new Map();

    const getStatusBar = () => options.getStatusBarController?.() ?? null;
    const getCurrentFile = () => options.getCurrentFile?.() ?? null;
    const getViewContainer = () => options.getViewContainer?.() ?? null;
    const getActiveViewMode = () => options.getActiveViewModeState?.() ?? 'markdown';
    const setActiveViewModeState = (mode) => options.setActiveViewModeState?.(mode);
    const getContentZoomState = () => options.getContentZoomState?.() ?? ZOOM_DEFAULT;
    const setContentZoomState = (value) => options.setContentZoomState?.(value);
    const getPdfZoomState = () => options.getPdfZoomState?.() ?? {
        zoomValue: 1,
        canZoomIn: true,
        canZoomOut: true,
    };
    const setPdfZoomState = (value) => options.setPdfZoomStateState?.(value);

    const VIEW_MODE_BEHAVIORS = {
        markdown: {
            getPane: () => options.getMarkdownPane?.() ?? null,
            onEnter: () => {
                options.getCodeEditor?.()?.hide?.();
                options.getImageViewer?.()?.hide?.();
                options.getMediaViewer?.()?.hide?.();
                options.getSpreadsheetViewer?.()?.hide?.();
                options.getPdfViewer?.()?.hide?.();
                options.getUnsupportedViewer?.()?.hide?.();
                // 不在这里主动 focus Markdown 编辑器，交由 editor.loadFile(..., { autoFocus }) 控制，
                // 避免在从文件树切换文件时抢夺焦点，影响回车重命名。
            },
        },
        code: {
            getPane: () => options.getCodePane?.() ?? null,
            onEnter: () => {
                options.getImageViewer?.()?.hide?.();
                options.getMediaViewer?.()?.hide?.();
                options.getSpreadsheetViewer?.()?.hide?.();
                options.getPdfViewer?.()?.hide?.();
                options.getUnsupportedViewer?.()?.hide?.();
                // 同样不在这里主动 focus 代码编辑器，交由 codeEditor.show(..., { autoFocus }) 控制，
                // 这样点击文件树节点时不会把焦点从文件树抢走。
            },
        },
        image: {
            getPane: () => options.getImagePane?.() ?? null,
            onEnter: () => {
                options.getEditor?.()?.clear?.();
                options.getCodeEditor?.()?.hide?.();
                options.getImageViewer?.()?.show?.();
                options.getMediaViewer?.()?.hide?.();
                options.getSpreadsheetViewer?.()?.hide?.();
                options.getPdfViewer?.()?.hide?.();
                options.getUnsupportedViewer?.()?.hide?.();
            },
        },
        media: {
            getPane: () => options.getMediaPane?.() ?? null,
            onEnter: () => {
                options.getEditor?.()?.clear?.();
                options.getCodeEditor?.()?.hide?.();
                options.getImageViewer?.()?.hide?.();
                options.getSpreadsheetViewer?.()?.hide?.();
                options.getPdfViewer?.()?.hide?.();
                options.getUnsupportedViewer?.()?.hide?.();
                options.getMediaViewer?.()?.show?.();
            },
        },
        spreadsheet: {
            getPane: () => options.getSpreadsheetPane?.() ?? null,
            onEnter: () => {
                options.getEditor?.()?.clear?.();
                options.getCodeEditor?.()?.hide?.();
                options.getImageViewer?.()?.hide?.();
                options.getMediaViewer?.()?.hide?.();
                options.getPdfViewer?.()?.hide?.();
                options.getUnsupportedViewer?.()?.hide?.();
                options.getSpreadsheetViewer?.()?.show?.();
            },
        },
        pdf: {
            getPane: () => options.getPdfPane?.() ?? null,
            onEnter: () => {
                options.getEditor?.()?.clear?.();
                options.getCodeEditor?.()?.hide?.();
                options.getImageViewer?.()?.hide?.();
                options.getSpreadsheetViewer?.()?.hide?.();
                options.getMediaViewer?.()?.hide?.();
                options.getUnsupportedViewer?.()?.hide?.();
                options.getPdfViewer?.()?.show?.();
            },
        },
        // 通用嵌入渲染视图:内容由 renderer handler 自行注入 embed pane,
        // 这里只负责隐藏其它视图(pane 显隐交给 .is-active class)
        embed: {
            getPane: () => options.getEmbedPane?.() ?? null,
            onEnter: () => {
                options.getEditor?.()?.clear?.();
                options.getCodeEditor?.()?.hide?.();
                options.getImageViewer?.()?.hide?.();
                options.getMediaViewer?.()?.hide?.();
                options.getSpreadsheetViewer?.()?.hide?.();
                options.getPdfViewer?.()?.hide?.();
                options.getUnsupportedViewer?.()?.hide?.();
            },
        },
        unsupported: {
            getPane: () => options.getUnsupportedPane?.() ?? null,
            onEnter: () => {
                options.getEditor?.()?.clear?.();
                options.getCodeEditor?.()?.hide?.();
                options.getImageViewer?.()?.hide?.();
                options.getSpreadsheetViewer?.()?.hide?.();
                options.getMediaViewer?.()?.hide?.();
                options.getPdfViewer?.()?.hide?.();
            },
        },
    };

    function getMarkdownScrollContainer() {
        return options.getMarkdownPane?.() ?? getViewContainer();
    }

    /**
     * 保存滚动位置（支持 markdown 和 code）
     */
    function rememberScrollPosition(filePath = getCurrentFile(), viewMode = getActiveViewMode()) {
        if (!filePath) return;

        const state = scrollPositions.get(filePath) || {};

        if (viewMode === 'markdown') {
            const container = getMarkdownScrollContainer();
            if (container) {
                state.markdown = container.scrollTop || 0;
            }
        } else if (viewMode === 'code') {
            const codeEditor = options.getCodeEditor?.();
            if (codeEditor) {
                state.code = codeEditor.getScrollTop() || 0;
            }
        }

        scrollPositions.set(filePath, state);
    }

    /**
     * 恢复滚动位置（支持 markdown 和 code）
     */
    function restoreScrollPosition(filePath, viewMode = getActiveViewMode()) {
        if (!filePath) return;

        const state = scrollPositions.get(filePath);
        if (!state) return;

        if (viewMode === 'markdown') {
            const target = state.markdown ?? 0;
            const container = getMarkdownScrollContainer();
            if (container) {
                container.scrollTop = target;
            }
        } else if (viewMode === 'code') {
            const target = state.code ?? 0;
            const codeEditor = options.getCodeEditor?.();
            if (codeEditor) {
                requestAnimationFrame(() => {
                    codeEditor.setScrollTop(target);
                });
            }
        }
    }

    // 兼容旧 API
    function rememberMarkdownScrollPosition(filePath, viewMode) {
        rememberScrollPosition(filePath, viewMode);
    }

    function restoreMarkdownScrollPosition(filePath) {
        restoreScrollPosition(filePath, 'markdown');
    }

    function clampZoomValue(value) {
        if (!Number.isFinite(value)) {
            return ZOOM_DEFAULT;
        }
        return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
    }

    function isZoomSupportedView(mode) {
        return ZOOM_SUPPORTED_VIEWS.has(mode);
    }

    function updateZoomDisplayForActiveView() {
        const mode = getActiveViewMode();
        const statusBar = getStatusBar();
        statusBar?.setZoomVisibility?.(isZoomSupportedView(mode));
        if (!statusBar || !isZoomSupportedView(mode)) {
            return;
        }
        if (mode === 'pdf') {
            const pdfViewer = options.getPdfViewer?.();
            const zoomState = pdfViewer?.getZoomState?.() || getPdfZoomState();
            if (zoomState) {
                setPdfZoomState(zoomState);
                statusBar.updateZoomDisplay?.(zoomState);
            }
            return;
        }
        const zoomValue = getContentZoomState();
        statusBar.updateZoomDisplay?.({
            zoomValue,
            canZoomIn: zoomValue < ZOOM_MAX - 0.001,
            canZoomOut: zoomValue > ZOOM_MIN + 0.001,
        });
    }

    function applyContentZoom() {
        const root = document.documentElement;
        const zoomValue = getContentZoomState();
        if (root) {
            root.style.setProperty('--content-zoom', zoomValue.toString());
            root.style.setProperty('--editor-zoom-scale', zoomValue.toString());
        }
        options.getCodeEditor?.()?.setZoomScale?.(zoomValue);
        options.getImageViewer?.()?.setZoomScale?.(zoomValue);
        options.getMediaViewer?.()?.setZoomScale?.(zoomValue);
        options.getSpreadsheetViewer?.()?.setZoomScale?.(zoomValue);
        updateZoomDisplayForActiveView();
    }

    function setContentZoom(nextZoom, { silent } = {}) {
        const clamped = clampZoomValue(nextZoom);
        const current = getContentZoomState();
        if (Math.abs(clamped - current) < 0.001 && !silent) {
            return;
        }
        setContentZoomState(clamped);
        applyContentZoom();
    }

    function adjustContentZoom(delta) {
        const current = getContentZoomState();
        setContentZoom(current + delta);
    }

    function handleZoomControl(delta) {
        if (getActiveViewMode() === 'pdf') {
            void options.getPdfViewer?.()?.adjustZoomScale?.(delta);
            return;
        }
        adjustContentZoom(delta);
    }

    function setActiveViewMode(nextMode) {
        const config = VIEW_MODE_BEHAVIORS[nextMode];
        if (!config) {
            return;
        }
        const currentMode = getActiveViewMode();

        // 保留原有的滚动位置记忆（用于文件切换等场景）
        if (currentMode === 'markdown' && nextMode !== 'markdown' && nextMode !== 'code') {
            rememberMarkdownScrollPosition(getCurrentFile(), currentMode);
        }

        Object.entries(VIEW_MODE_BEHAVIORS).forEach(([mode, entry]) => {
            const pane = entry.getPane?.();
            if (!pane) {
                return;
            }
            if (mode === nextMode) {
                pane.classList.add('is-active');
            } else {
                pane.classList.remove('is-active');
            }
        });

        config.onEnter?.();

        const container = getViewContainer();
        if (container) {
            const shouldHideContainerScroll = nextMode === 'code';
            container.style.overflowY = shouldHideContainerScroll ? 'hidden' : '';
            // markdown ↔ code 切换时不再使用 scrollTop，改用位置同步
            if (nextMode !== 'markdown' && nextMode !== 'code') {
                container.scrollTop = 0;
            }
        }

        if (nextMode !== 'pdf') {
            getStatusBar()?.setPageInfo?.('');
        }

        setActiveViewModeState(nextMode);
        updateZoomDisplayForActiveView();
        options.onViewModeChange?.(nextMode);
    }

    return {
        rememberScrollPosition,
        restoreScrollPosition,
        rememberMarkdownScrollPosition,
        restoreMarkdownScrollPosition,
        setActiveViewMode,
        activateMarkdownView: (viewOptions) => setActiveViewMode('markdown', viewOptions),
        activateCodeView: (viewOptions) => setActiveViewMode('code', viewOptions),
        activateImageView: () => setActiveViewMode('image'),
        activateMediaView: () => setActiveViewMode('media'),
        activateSpreadsheetView: () => setActiveViewMode('spreadsheet'),
        activatePdfView: () => setActiveViewMode('pdf'),
        activateEmbedView: () => setActiveViewMode('embed'),
        activateUnsupportedView: () => setActiveViewMode('unsupported'),
        updateZoomDisplayForActiveView,
        handleZoomControl,
        setContentZoom,
        adjustContentZoom,
        applyContentZoom,
    };
}
