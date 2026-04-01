/**
 * ViewManager 统一承接视图模式解析、渲染器查找和视图激活。
 * 它不决定当前文档是谁，只负责“当前文档如何展示”。
 */
export function createViewManager({
    getViewModeForPath,
    getRendererRegistry,
    viewController,
    logger,
    traceRecorder,
}) {
    if (typeof getViewModeForPath !== 'function') {
        throw new Error('createViewManager 需要 getViewModeForPath');
    }
    if (typeof getRendererRegistry !== 'function') {
        throw new Error('createViewManager 需要 getRendererRegistry');
    }
    if (!viewController || typeof viewController.setActiveViewMode !== 'function') {
        throw new Error('createViewManager 需要 viewController');
    }

    /**
     * 解析文件路径对应的默认视图模式。
     * @param {string} filePath - 目标文件路径
     * @returns {string}
     */
    function resolveViewMode(filePath) {
        return getViewModeForPath(filePath);
    }

    /**
     * 返回当前渲染器注册表。
     * @returns {object|null}
     */
    function getRendererRegistryInstance() {
        return getRendererRegistry?.() || null;
    }

    /**
     * 按文件路径查找首选渲染器。
     * @param {string} filePath - 目标文件路径
     * @returns {object|null}
     */
    function getRendererForPath(filePath) {
        return getRendererRegistryInstance()?.getHandlerForPath?.(filePath) || null;
    }

    /**
     * 按视图模式查找渲染器。
     * @param {string} viewMode - 目标视图模式
     * @returns {object|null}
     */
    function getRendererByViewMode(viewMode) {
        return getRendererRegistryInstance()?.getHandlerById?.(viewMode) || null;
    }

    /**
     * 为当前文件和目标视图模式挑选最终渲染器。
     * @param {string} filePath - 目标文件路径
     * @param {string} targetViewMode - 目标视图模式
     * @returns {object|null}
     */
    function resolveRenderer(filePath, targetViewMode) {
        const preferredRenderer = getRendererForPath(filePath);
        const preferredViewMode = preferredRenderer?.getViewMode?.(filePath) || null;

        if (preferredRenderer && preferredViewMode === targetViewMode) {
            return preferredRenderer;
        }

        return getRendererByViewMode(targetViewMode);
    }

    /**
     * 激活指定视图模式。
     * @param {string} viewMode - 目标视图模式
     * @param {object} viewOptions - 视图切换附加参数
     */
    function activateView(viewMode, viewOptions = {}) {
        logger?.debug?.('view:activate', {
            viewMode,
            viewOptions,
        });
        traceRecorder?.record?.('view:activate', {
            viewMode,
        });

        switch (viewMode) {
            case 'markdown':
                return viewController.activateMarkdownView(viewOptions);
            case 'code':
                return viewController.activateCodeView(viewOptions);
            case 'image':
                return viewController.activateImageView();
            case 'media':
                return viewController.activateMediaView();
            case 'spreadsheet':
                return viewController.activateSpreadsheetView();
            case 'pdf':
                return viewController.activatePdfView();
            case 'unsupported':
                return viewController.activateUnsupportedView();
            default:
                throw new Error(`未知视图模式: ${viewMode}`);
        }
    }

    /**
     * 创建稳定的视图协议对象，供 mode toggle、window lifecycle 和 renderer 复用。
     * 这样调用方不需要再感知 activateMarkdownView/activateCodeView 这类细节方法。
     * @returns {object}
     */
    function createViewProtocol() {
        return {
            /**
             * 激活指定视图模式。
             * @param {string} viewMode - 目标视图模式
             * @param {object} viewOptions - 激活附加参数
             */
            activate(viewMode, viewOptions = {}) {
                return activateView(viewMode, viewOptions);
            },

            /**
             * 解析路径的默认视图模式。
             * @param {string} filePath - 目标路径
             * @returns {string}
             */
            resolveMode(filePath) {
                return resolveViewMode(filePath);
            },

            /**
             * 为目标路径和视图模式解析渲染器。
             * @param {string} filePath - 目标路径
             * @param {string} targetViewMode - 目标视图模式
             * @returns {object|null}
             */
            resolveRenderer(filePath, targetViewMode) {
                return resolveRenderer(filePath, targetViewMode);
            },
        };
    }

    /**
     * 提供给 renderer 的统一视图激活上下文，避免调用方散传 activateXxxView。
     * @returns {object}
     */
    function createRendererLoadContext() {
        const view = createViewProtocol();
        return {
            view,
        };
    }

    return {
        ...viewController,
        resolveViewMode,
        getRendererRegistry: getRendererRegistryInstance,
        getRendererForPath,
        getRendererByViewMode,
        resolveRenderer,
        activateView,
        createViewProtocol,
        createRendererLoadContext,
    };
}
