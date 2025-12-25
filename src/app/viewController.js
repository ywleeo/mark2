export const ZOOM_DEFAULT = 1;
export const ZOOM_MIN = 0.6;
export const ZOOM_MAX = 2.4;
export const ZOOM_STEP = 0.1;

const ZOOM_SUPPORTED_VIEWS = new Set(['markdown', 'code', 'image', 'pdf', 'spreadsheet']);

export function createViewController(options = {}) {
    const markdownScrollPositions = new Map();

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

    function rememberMarkdownScrollPosition(filePath = getCurrentFile(), viewMode = getActiveViewMode()) {
        if (!filePath) {
            return;
        }
        if (viewMode !== 'markdown') {
            return;
        }
        const container = getMarkdownScrollContainer();
        if (!container) {
            return;
        }
        const scrollTop = container.scrollTop || 0;
        markdownScrollPositions.set(filePath, scrollTop);
    }

    function restoreMarkdownScrollPosition(filePath) {
        if (!filePath) {
            return;
        }
        const container = getMarkdownScrollContainer();
        if (!container) {
            return;
        }
        const target = markdownScrollPositions.get(filePath) ?? 0;
        container.scrollTop = target;
        if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
            window.requestAnimationFrame(() => {
                const refreshedContainer = getMarkdownScrollContainer();
                if (!refreshedContainer) {
                    return;
                }
                refreshedContainer.scrollTop = target;
            });
        }
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
        if (currentMode === 'markdown' && nextMode !== 'markdown') {
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
            if (nextMode === 'markdown') {
                restoreMarkdownScrollPosition(getCurrentFile());
            } else {
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
        rememberMarkdownScrollPosition,
        restoreMarkdownScrollPosition,
        setActiveViewMode,
        activateMarkdownView: () => setActiveViewMode('markdown'),
        activateCodeView: () => setActiveViewMode('code'),
        activateImageView: () => setActiveViewMode('image'),
        activateMediaView: () => setActiveViewMode('media'),
        activateSpreadsheetView: () => setActiveViewMode('spreadsheet'),
        activatePdfView: () => setActiveViewMode('pdf'),
        activateUnsupportedView: () => setActiveViewMode('unsupported'),
        updateZoomDisplayForActiveView,
        handleZoomControl,
        setContentZoom,
        adjustContentZoom,
        applyContentZoom,
    };
}
