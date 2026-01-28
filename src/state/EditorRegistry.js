/**
 * 编辑器/查看器实例注册表
 * 统一管理所有编辑器和查看器实例
 */
export class EditorRegistry {
    constructor() {
        // 编辑器/查看器实例映射
        this.editors = new Map();
        // 'markdown' -> MarkdownEditor 实例
        // 'code' -> CodeEditor 实例
        // 'image' -> ImageViewer 实例
        // 'media' -> MediaViewer 实例
        // 'spreadsheet' -> SpreadsheetViewer 实例
        // 'pdf' -> PdfViewer 实例
        // 'unsupported' -> UnsupportedViewer 实例

        // 构造函数映射（用于延迟初始化）
        this.constructors = new Map();
    }

    // ========== 注册构造函数 ==========

    /**
     * 注册编辑器构造函数（用于延迟加载）
     * @param {string} type - 编辑器类型
     * @param {Function} constructor - 构造函数
     */
    registerConstructor(type, constructor) {
        if (typeof constructor !== 'function') {
            throw new Error(`registerConstructor: ${type} 的构造函数必须是 function`);
        }
        this.constructors.set(type, constructor);
    }

    /**
     * 获取构造函数
     * @param {string} type - 编辑器类型
     * @returns {Function|null}
     */
    getConstructor(type) {
        return this.constructors.get(type) || null;
    }

    /**
     * 检查构造函数是否已注册
     * @param {string} type - 编辑器类型
     * @returns {boolean}
     */
    hasConstructor(type) {
        return this.constructors.has(type);
    }

    // ========== 注册实例 ==========

    /**
     * 注册编辑器/查看器实例
     * @param {string} type - 编辑器类型
     * @param {Object} instance - 编辑器实例
     */
    register(type, instance) {
        if (!instance) {
            throw new Error(`register: ${type} 的实例不能为空`);
        }
        this.editors.set(type, instance);
    }

    /**
     * 获取编辑器/查看器实例
     * @param {string} type - 编辑器类型
     * @returns {Object|null}
     */
    get(type) {
        return this.editors.get(type) || null;
    }

    /**
     * 检查实例是否已注册
     * @param {string} type - 编辑器类型
     * @returns {boolean}
     */
    has(type) {
        return this.editors.has(type);
    }

    /**
     * 移除编辑器/查看器实例
     * @param {string} type - 编辑器类型
     * @returns {boolean} 是否成功移除
     */
    unregister(type) {
        return this.editors.delete(type);
    }

    // ========== 便捷访问方法 ==========

    /**
     * 获取 Markdown 编辑器
     * @returns {Object|null}
     */
    getMarkdownEditor() {
        return this.get('markdown');
    }

    /**
     * 获取代码编辑器
     * @returns {Object|null}
     */
    getCodeEditor() {
        return this.get('code');
    }

    /**
     * 获取图片查看器
     * @returns {Object|null}
     */
    getImageViewer() {
        return this.get('image');
    }

    /**
     * 获取媒体查看器
     * @returns {Object|null}
     */
    getMediaViewer() {
        return this.get('media');
    }

    /**
     * 获取表格查看器
     * @returns {Object|null}
     */
    getSpreadsheetViewer() {
        return this.get('spreadsheet');
    }

    /**
     * 获取 PDF 查看器
     * @returns {Object|null}
     */
    getPdfViewer() {
        return this.get('pdf');
    }

    /**
     * 获取 HTML 查看器
     * @returns {Object|null}
     */
    getHtmlViewer() {
        return this.get('html');
    }

    /**
     * 获取不支持文件查看器
     * @returns {Object|null}
     */
    getUnsupportedViewer() {
        return this.get('unsupported');
    }

    /**
     * 获取 Workflow 编辑器
     * @returns {Object|null}
     */
    getWorkflowEditor() {
        return this.get('workflow');
    }

    /**
     * 根据视图模式获取对应的编辑器/查看器
     * @param {string} viewMode - 视图模式
     * @returns {Object|null}
     */
    getByViewMode(viewMode) {
        return this.get(viewMode);
    }

    /**
     * 获取当前激活的编辑器（根据视图模式）
     * @param {string} activeViewMode - 当前激活的视图模式
     * @returns {Object|null}
     */
    getActive(activeViewMode) {
        if (!activeViewMode) {
            return null;
        }

        // 特殊处理 split 模式（使用 markdown 编辑器）
        if (activeViewMode === 'split') {
            return this.get('markdown');
        }

        return this.get(activeViewMode);
    }

    // ========== 批量操作 ==========

    /**
     * 获取所有已注册的编辑器类型
     * @returns {string[]}
     */
    getAllTypes() {
        return Array.from(this.editors.keys());
    }

    /**
     * 获取所有已注册的编辑器实例
     * @returns {Object[]}
     */
    getAllInstances() {
        return Array.from(this.editors.values());
    }

    /**
     * 清空所有编辑器内容
     */
    clearAllContents() {
        this.editors.forEach(editor => {
            if (editor && typeof editor.clear === 'function') {
                editor.clear();
            }
        });
    }

    /**
     * 对所有编辑器执行 blur
     */
    blurAll() {
        this.editors.forEach(editor => {
            if (editor && typeof editor.blur === 'function') {
                editor.blur();
            }
        });
    }

    /**
     * 销毁所有编辑器实例
     */
    destroyAll() {
        this.editors.forEach(editor => {
            if (editor && typeof editor.destroy === 'function') {
                editor.destroy();
            } else if (editor && typeof editor.dispose === 'function') {
                editor.dispose();
            }
        });
        this.editors.clear();
    }

    /**
     * 重置注册表
     */
    reset() {
        this.destroyAll();
        this.constructors.clear();
    }
}
