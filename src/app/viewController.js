export const ZOOM_DEFAULT = 1;
export const ZOOM_MIN = 0.6;
export const ZOOM_MAX = 2.4;
export const ZOOM_STEP = 0.1;

const ZOOM_SUPPORTED_VIEWS = new Set(['markdown', 'code', 'image', 'pdf', 'spreadsheet', 'html']);

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
                options.getHtmlViewer?.()?.hide?.();
                options.getUnsupportedViewer?.()?.hide?.();
                options.getWorkflowEditor?.()?.hide?.();
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
                options.getHtmlViewer?.()?.hide?.();
                options.getUnsupportedViewer?.()?.hide?.();
                options.getWorkflowEditor?.()?.hide?.();
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
                options.getHtmlViewer?.()?.hide?.();
                options.getUnsupportedViewer?.()?.hide?.();
                options.getWorkflowEditor?.()?.hide?.();
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
                options.getHtmlViewer?.()?.hide?.();
                options.getUnsupportedViewer?.()?.hide?.();
                options.getWorkflowEditor?.()?.hide?.();
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
                options.getHtmlViewer?.()?.hide?.();
                options.getUnsupportedViewer?.()?.hide?.();
                options.getWorkflowEditor?.()?.hide?.();
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
                options.getHtmlViewer?.()?.hide?.();
                options.getUnsupportedViewer?.()?.hide?.();
                options.getWorkflowEditor?.()?.hide?.();
                options.getPdfViewer?.()?.show?.();
            },
        },
        html: {
            getPane: () => options.getHtmlPane?.() ?? null,
            onEnter: () => {
                options.getEditor?.()?.clear?.();
                options.getCodeEditor?.()?.hide?.();
                options.getImageViewer?.()?.hide?.();
                options.getMediaViewer?.()?.hide?.();
                options.getSpreadsheetViewer?.()?.hide?.();
                options.getPdfViewer?.()?.hide?.();
                options.getUnsupportedViewer?.()?.hide?.();
                options.getWorkflowEditor?.()?.hide?.();
                options.getHtmlViewer?.()?.show?.();
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
                options.getHtmlViewer?.()?.hide?.();
                options.getWorkflowEditor?.()?.hide?.();
            },
        },
        workflow: {
            getPane: () => options.getWorkflowPane?.() ?? null,
            onEnter: () => {
                options.getEditor?.()?.clear?.();
                options.getCodeEditor?.()?.hide?.();
                options.getImageViewer?.()?.hide?.();
                options.getSpreadsheetViewer?.()?.hide?.();
                options.getMediaViewer?.()?.hide?.();
                options.getPdfViewer?.()?.hide?.();
                options.getHtmlViewer?.()?.hide?.();
                options.getUnsupportedViewer?.()?.hide?.();
                options.getWorkflowEditor?.()?.show?.();
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

    // 用于 markdown ↔ code 切换时的位置同步
    let pendingSyncPosition = null;  // 光标位置（行号+列号）
    let pendingSyncScrollRatio = null;  // 滚动位置（百分比，0-1）

    function getScrollRatio(scrollContainer) {
        if (!scrollContainer) return null;
        const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
        const maxScroll = scrollHeight - clientHeight;
        if (maxScroll <= 0) return 0;
        return scrollTop / maxScroll;
    }

    function applyScrollRatio(scrollContainer, ratio) {
        if (!scrollContainer || ratio === null) return;
        const { scrollHeight, clientHeight } = scrollContainer;
        const maxScroll = scrollHeight - clientHeight;
        if (maxScroll <= 0) return;
        scrollContainer.scrollTop = ratio * maxScroll;
    }

    /**
     * 等待滚动容器渲染稳定后再应用滚动比例
     * @param {HTMLElement} scrollContainer - 滚动容器
     * @param {number} ratio - 滚动比例 (0-1)
     * @param {number} maxRetries - 最大重试次数
     */
    function waitForRenderThenScroll(scrollContainer, ratio, maxRetries = 10) {
        if (!scrollContainer || ratio === null) return;

        let lastHeight = 0;
        let retries = 0;

        function check() {
            const height = scrollContainer.scrollHeight ?? 0;
            if (height > 0 && height === lastHeight) {
                // 高度稳定，渲染完成，应用滚动
                applyScrollRatio(scrollContainer, ratio);
            } else if (retries < maxRetries) {
                lastHeight = height;
                retries++;
                requestAnimationFrame(check);
            }
        }
        requestAnimationFrame(check);
    }

    function setActiveViewMode(nextMode) {
        const config = VIEW_MODE_BEHAVIORS[nextMode];
        if (!config) {
            return;
        }
        const currentMode = getActiveViewMode();

        // markdown → code: 记录光标位置和滚动百分比
        if (currentMode === 'markdown' && nextMode === 'code') {
            const editor = options.getEditor?.();
            pendingSyncPosition = editor?.getCurrentSourcePosition?.() ?? null;
            // 使用 markdownPane 作为滚动容器（和 rememberMarkdownScrollPosition 一致）
            const scrollContainer = getMarkdownScrollContainer();
            pendingSyncScrollRatio = getScrollRatio(scrollContainer);
        }

        // code → markdown: 记录光标位置和滚动百分比
        if (currentMode === 'code' && nextMode === 'markdown') {
            const codeEditor = options.getCodeEditor?.();
            pendingSyncPosition = codeEditor?.getCurrentPosition?.() ?? null;
            const monacoEditor = codeEditor?.editor;
            if (monacoEditor) {
                const scrollTop = monacoEditor.getScrollTop();
                const scrollHeight = monacoEditor.getScrollHeight();
                const clientHeight = monacoEditor.getLayoutInfo?.()?.height ?? 0;
                const maxScroll = scrollHeight - clientHeight;
                pendingSyncScrollRatio = maxScroll > 0 ? scrollTop / maxScroll : 0;
            }
        }

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

        // 同步光标位置和滚动位置
        if (pendingSyncPosition !== null || pendingSyncScrollRatio !== null) {
            if (nextMode === 'code') {
                // markdown → code: 设置光标位置，然后按百分比滚动
                requestAnimationFrame(() => {
                    const codeEditor = options.getCodeEditor?.();
                    // 先设置光标位置（不滚动）
                    if (pendingSyncPosition !== null) {
                        codeEditor?.setPositionOnly?.(pendingSyncPosition.lineNumber, pendingSyncPosition.column);
                    }
                    // 按百分比滚动
                    if (pendingSyncScrollRatio !== null && codeEditor?.editor) {
                        const monacoEditor = codeEditor.editor;
                        const scrollHeight = monacoEditor.getScrollHeight();
                        const clientHeight = monacoEditor.getLayoutInfo?.()?.height ?? 0;
                        const maxScroll = scrollHeight - clientHeight;
                        if (maxScroll > 0) {
                            monacoEditor.setScrollTop(pendingSyncScrollRatio * maxScroll);
                        }
                    }
                    pendingSyncPosition = null;
                    pendingSyncScrollRatio = null;
                });
            } else if (nextMode === 'markdown') {
                // code → markdown: 设置光标位置，然后按百分比滚动
                const savedPosition = pendingSyncPosition;
                const savedRatio = pendingSyncScrollRatio;
                pendingSyncPosition = null;
                pendingSyncScrollRatio = null;

                // 先设置光标位置（不滚动）
                requestAnimationFrame(() => {
                    const editor = options.getEditor?.();
                    if (savedPosition !== null) {
                        editor?.setSourcePositionOnly?.(savedPosition.lineNumber, savedPosition.column);
                    }
                });

                // 等待渲染稳定后按百分比滚动
                if (savedRatio !== null) {
                    const scrollContainer = getMarkdownScrollContainer();
                    waitForRenderThenScroll(scrollContainer, savedRatio);
                }
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
        activateHtmlView: () => setActiveViewMode('html'),
        activateWorkflowView: () => setActiveViewMode('workflow'),
        activateUnsupportedView: () => setActiveViewMode('unsupported'),
        updateZoomDisplayForActiveView,
        handleZoomControl,
        setContentZoom,
        adjustContentZoom,
        applyContentZoom,
    };
}
