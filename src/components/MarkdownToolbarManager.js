import { MarkdownToolbar } from './markdown-toolbar/index.js';

/**
 * Markdown工具栏管理器
 * 负责工具栏的生命周期管理和系统集成
 */
export class MarkdownToolbarManager {
    constructor(appServices, options = {}) {
        this.appServices = appServices;
        this.toolbar = null;
        this.container = null;
        this.isVisible = true;
        this.skipNextVisibilityPersistence = false;
        this.editorInstance = null;
        this.rawEditorInstance = null;
        this.editorType = null; // 'tiptap' 或 'monaco'
        this.isInitialized = false;
        this.onToggleViewMode = options.onToggleViewMode || null;
        this.onCardExport = options.onCardExport || null;

        // 从设置中加载工具栏可见性
        this.loadVisibility();
    }

    /**
     * 初始化工具栏
     * @param {Object} editorInstance - 编辑器实例
     * @param {string} editorType - 编辑器类型 ('tiptap' 或 'monaco')
     */
    async initialize(editorInstance, editorType = 'tiptap') {
        // console.log('MarkdownToolbarManager: initialize called', { editorInstance, editorType });

        if (this.isInitialized) {
            console.warn('Markdown toolbar already initialized');
            return;
        }

        this.editorType = editorType;
        this.rawEditorInstance = editorInstance;
        this.editorInstance = this.resolveEditorInstance(editorInstance, editorType);

        if (!this.editorInstance) {
            console.warn('MarkdownToolbarManager: 无法解析有效的编辑器实例');
            return;
        }

        // 创建工具栏容器
        this.createContainer();

        // 创建工具栏实例
        this.toolbar = new MarkdownToolbar({
            position: 'top',
            theme: this.getTheme(),
            buttons: [
                'bold',
                'italic',
                'strikethrough',
                'separator',
                'heading1',
                'heading2',
                'heading3',
                'separator',
                'quote',
                'code',
                'codeBlock',
                'separator',
                'unorderedList',
                'orderedList',
                'taskList',
                'separator',
                'link',
                'image',
                'table',
                'horizontalRule',
                'separator',
                'clearFormatting',
                'emoji',
                'cardExport',
                'separator',
                'toc',
                'copyMarkdown',
                'toggleViewMode'
            ]
        });

        // 设置编辑器
        this.toolbar.setEditor(this.getEditorProxy());

        // 渲染工具栏
        this.toolbar.render(this.container);
        this.updateContainerTheme(this.toolbar.options.theme);

        // 设置初始可见性
        if (!this.isVisible) {
            this.hide();
        }

        // 监听工具栏事件
        this.setupEventListeners();

        this.isInitialized = true;
        console.log('Markdown toolbar initialized');
    }

    /**
     * 获取编辑器代理，统一不同编辑器的接口
     */
    getEditorProxy() {
        const manager = this;

        if (!manager.editorInstance) {
            console.warn('MarkdownToolbarManager: editor instance not available for proxy');
            return null;
        }

        if (manager.editorType === 'tiptap') {
            // TipTap 编辑器
            return {
                get state() {
                    return manager.editorInstance?.state;
                },
                get view() {
                    return manager.editorInstance?.view;
                },
                chain() {
                    return manager.editorInstance?.chain();
                },
                get commands() {
                    return manager.editorInstance?.commands;
                }
            };
        } else if (manager.editorType === 'monaco') {
            // Monaco 编辑器 - 模拟 textarea 接口
            // 辅助函数：动态获取真正的 Monaco 编辑器实例
            const getMonacoEditor = () => {
                // 尝试从 CodeEditor 包装类中获取
                if (manager.rawEditorInstance?.editor) {
                    return manager.rawEditorInstance.editor;
                }
                // 或者直接使用已解析的实例
                return manager.editorInstance;
            };

            return {
                get value() {
                    const editor = getMonacoEditor();
                    return editor?.getValue() || '';
                },
                // 模拟 textarea 的 selectionStart 属性
                get selectionStart() {
                    const editor = getMonacoEditor();
                    const model = editor?.getModel?.();
                    const selection = editor?.getSelection?.();
                    if (!model || !selection) {
                        return 0;
                    }
                    return model.getOffsetAt({
                        lineNumber: selection.startLineNumber,
                        column: selection.startColumn
                    });
                },
                // 模拟 textarea 的 selectionEnd 属性
                get selectionEnd() {
                    const editor = getMonacoEditor();
                    const model = editor?.getModel?.();
                    const selection = editor?.getSelection?.();
                    if (!model || !selection) {
                        return 0;
                    }
                    return model.getOffsetAt({
                        lineNumber: selection.endLineNumber,
                        column: selection.endColumn
                    });
                },
                getSelection() {
                    const editor = getMonacoEditor();
                    const model = editor?.getModel?.();
                    const selection = editor?.getSelection?.();
                    if (!model || !selection) {
                        return null;
                    }

                    // 将 Monaco 的位置转换为字符偏移量
                    const start = model.getOffsetAt({
                        lineNumber: selection.startLineNumber,
                        column: selection.startColumn
                    });
                    const end = model.getOffsetAt({
                        lineNumber: selection.endLineNumber,
                        column: selection.endColumn
                    });

                    return {
                        start,
                        end,
                        line: selection.startLineNumber - 1
                    };
                },
                setSelectionRange(start, end) {
                    const editor = getMonacoEditor();
                    const model = editor?.getModel?.();
                    if (!editor || !model) {
                        return;
                    }
                    const startPos = model.getPositionAt(start);
                    const endPos = model.getPositionAt(end);
                    editor.setSelection({
                        startLineNumber: startPos.lineNumber,
                        startColumn: startPos.column,
                        endLineNumber: endPos.lineNumber,
                        endColumn: endPos.column
                    });
                },
                focus() {
                    const editor = getMonacoEditor();
                    editor?.focus?.();
                },
                setRangeText(text, start, end, selectionMode = 'end') {
                    const editor = getMonacoEditor();
                    const model = editor?.getModel?.();
                    if (!editor || !model) {
                        return;
                    }

                    // 如果没有提供参数，使用当前选区
                    if (start === undefined || end === undefined) {
                        const selection = editor.getSelection?.();
                        if (selection) {
                            start = model.getOffsetAt({
                                lineNumber: selection.startLineNumber,
                                column: selection.startColumn
                            });
                            end = model.getOffsetAt({
                                lineNumber: selection.endLineNumber,
                                column: selection.endColumn
                            });
                        } else {
                            start = 0;
                            end = 0;
                        }
                    }

                    // 将字符偏移量转换为 Monaco 位置
                    const startPos = model.getPositionAt(start);
                    const endPos = model.getPositionAt(end);

                    // 获取当前选区作为 beforeCursorState
                    const currentSelection = editor.getSelection?.();

                    // 使用 pushEditOperations 正确编辑
                    model.pushEditOperations(
                        currentSelection ? [currentSelection] : [],
                        [{
                            range: {
                                startLineNumber: startPos.lineNumber,
                                startColumn: startPos.column,
                                endLineNumber: endPos.lineNumber,
                                endColumn: endPos.column
                            },
                            text,
                            forceMoveMarkers: true
                        }],
                        null  // Monaco Editor bug: afterEditAction 被忽略，需要手动设置选区
                    );

                    // 编辑完成后，根据 selectionMode 显式设置选区
                    if (selectionMode === 'select') {
                        // 选中整个插入的文本
                        const newStart = model.getPositionAt(start);
                        const newEnd = model.getPositionAt(start + text.length);
                        editor.setSelection({
                            selectionStartLineNumber: newStart.lineNumber,
                            selectionStartColumn: newStart.column,
                            positionLineNumber: newEnd.lineNumber,
                            positionColumn: newEnd.column
                        });
                    } else if (selectionMode === 'start') {
                        // 光标移到开始位置
                        const newPos = model.getPositionAt(start);
                        editor.setSelection({
                            selectionStartLineNumber: newPos.lineNumber,
                            selectionStartColumn: newPos.column,
                            positionLineNumber: newPos.lineNumber,
                            positionColumn: newPos.column
                        });
                    } else {
                        // 默认 'end'：光标移到末尾
                        const newOffset = start + text.length;
                        const newPos = model.getPositionAt(newOffset);
                        editor.setSelection({
                            selectionStartLineNumber: newPos.lineNumber,
                            selectionStartColumn: newPos.column,
                            positionLineNumber: newPos.lineNumber,
                            positionColumn: newPos.column
                        });
                    }
                },
                // 模拟 textarea 的 dispatchEvent（虽然可能不需要）
                dispatchEvent(event) {
                    // Monaco 不需要手动触发 input 事件
                    return true;
                }
            };
        }

        return manager.editorInstance;
    }

    /**
     * 将传入的编辑器引用解析为可用于工具栏的实例
     * @param {any} editorInstance
     * @param {string} editorType
     * @returns {any}
     */
    resolveEditorInstance(editorInstance, editorType) {
        if (!editorInstance) {
            return null;
        }

        if (editorType === 'tiptap') {
            if (typeof editorInstance.chain === 'function' && editorInstance.state) {
                return editorInstance;
            }

            if (editorInstance.editor && typeof editorInstance.editor.chain === 'function') {
                return editorInstance.editor;
            }

            if (typeof editorInstance.getEditor === 'function') {
                const nestedEditor = editorInstance.getEditor();
                if (nestedEditor && typeof nestedEditor.chain === 'function') {
                    return nestedEditor;
                }
            }
        } else if (editorType === 'monaco') {
            // 优先检查 .editor 属性（CodeEditor 包装类）
            if (editorInstance.editor && typeof editorInstance.editor.getValue === 'function') {
                return editorInstance.editor;
            }

            if (editorInstance.monacoEditor && typeof editorInstance.monacoEditor.getValue === 'function') {
                return editorInstance.monacoEditor;
            }

            if (typeof editorInstance.getMonacoEditor === 'function') {
                const monacoEditor = editorInstance.getMonacoEditor();
                if (monacoEditor && typeof monacoEditor.getValue === 'function') {
                    return monacoEditor;
                }
            }

            // 最后才检查实例本身（如果是直接传入的 Monaco 编辑器）
            if (typeof editorInstance.getValue === 'function' && typeof editorInstance.getModel === 'function') {
                return editorInstance;
            }
        }

        // 返回原始实例，允许 MarkdownToolbar 退回到 textarea 逻辑
        return editorInstance;
    }

    /**
     * 创建工具栏容器
     */
    createContainer() {
        // console.log('MarkdownToolbarManager: createContainer called');

        // 查找合适的容器位置
        const editorContainer = this.findEditorContainer();

        // console.log('MarkdownToolbarManager: editorContainer found', editorContainer);

        if (editorContainer) {
            this.container = document.createElement('div');
            this.container.className = 'markdown-toolbar-container';

            // 插入到编辑器容器之前
            editorContainer.parentNode.insertBefore(this.container, editorContainer);
            // console.log('MarkdownToolbarManager: toolbar container inserted');
        } else {
            console.warn('Could not find editor container');
        }
    }

    /**
     * 查找编辑器容器
     */
    findEditorContainer() {
        // 根据编辑器类型查找容器
        if (this.editorType === 'tiptap') {
            // 优先使用 markdown 内容容器，确保工具栏插入在外层 padding 之外
            const markdownContent = document.querySelector('.markdown-pane .markdown-content');
            if (markdownContent) {
                return markdownContent;
            }
            // 回退到 TipTap 宿主
            const tiptapEditor = document.querySelector('[data-markdown-editor-host]') ||
                document.querySelector('.tiptap-editor');
            if (tiptapEditor) {
                return tiptapEditor;
            }
        } else if (this.editorType === 'monaco') {
            // 查找 Code Editor 容器 - 优先查找 code-editor-pane
            const codeEditorPane = document.querySelector('.code-editor-pane');
            if (codeEditorPane) {
                // 查找内部的 monaco 编辑器实例
                const monacoEditor = codeEditorPane.querySelector('.code-editor__instance');
                if (monacoEditor) {
                    return monacoEditor;
                }
            }

            // 备用方案：查找任何 monaco-editor
            const monacoEditor = document.querySelector('.monaco-editor');
            if (monacoEditor) {
                return monacoEditor;
            }
        }

        // 通用查找 - 尝试更多选择器
        let container = document.querySelector('[data-editor-container]') ||
                     document.querySelector('.editor') ||
                     document.querySelector('.markdown-editor') ||
                     document.querySelector('#markdownPane') ||
                     document.querySelector('.markdown-pane');

        // 如果还是找不到，尝试查找任何包含 ProseMirror 或编辑器的元素
        if (!container) {
            const proseMirror = document.querySelector('.ProseMirror');
            if (proseMirror) {
                container = proseMirror.closest('.editor, .markdown-editor, .pane, div');
            }
        }

        return container;
    }

    /**
     * 设置事件监听
     */
    setupEventListeners() {
        // 监听工具栏可见性变化
        this.toolbar.on('visibility-change', (visible) => {
            if (this.skipNextVisibilityPersistence) {
                this.skipNextVisibilityPersistence = false;
                return;
            }
            this.isVisible = visible;
            this.saveVisibility();
        });

        // 监听主题变化
        this.toolbar.on('theme-change', (theme) => {
            this.saveTheme(theme);
            this.updateContainerTheme(theme);
        });

        // 监听工具栏动作
        this.toolbar.on('action', (action) => {
            // 处理视图模式切换
            if (action === 'toggleViewMode' && this.onToggleViewMode) {
                this.onToggleViewMode();
            }
            // 处理复制 markdown
            if (action === 'copyMarkdown') {
                this.copyMarkdown();
            }
            if (action === 'cardExport' && this.onCardExport) {
                this.onCardExport();
            }
        });
    }

    /**
     * 显示工具栏
     */
    show(options = {}) {
        if (!this.toolbar) {
            return;
        }

        this.prepareVisibilityPersistence(options);
        this.toolbar.show();
    }

    /**
     * 隐藏工具栏
     */
    hide(options = {}) {
        if (!this.toolbar) {
            return;
        }

        this.prepareVisibilityPersistence(options);
        this.toolbar.hide();
    }

    /**
     * 根据选项决定是否持久化下次可见性变化
     */
    prepareVisibilityPersistence(options = {}) {
        const shouldPersist = options.persist !== false;
        if (!shouldPersist && this.toolbar) {
            this.skipNextVisibilityPersistence = true;
        }
    }

    /**
     * 切换工具栏显示状态
     */
    toggle() {
        // console.log('MarkdownToolbarManager: toggle called', {
        //     isInitialized: this.isInitialized,
        //     hasToolbar: !!this.toolbar,
        //     hasEditor: !!this.editorInstance
        // });

        if (this.toolbar) {
            this.toolbar.toggle();
        } else if (!this.isInitialized && window.editor) {
            // console.log('MarkdownToolbarManager: Auto-initializing toolbar...');
            this.initialize(window.editor, 'tiptap');
        } else {
            console.warn('MarkdownToolbarManager: Cannot toggle - toolbar not initialized');
        }
    }

    /**
     * 设置主题
     * @param {string} theme - 'light' 或 'dark'
     */
    setTheme(theme) {
        if (this.toolbar) {
            this.toolbar.setTheme(theme);
            this.updateContainerTheme(theme);
        }
    }

    /**
     * 获取当前主题
     */
    getTheme() {
        // 优先使用应用当前外观
        try {
            const root = document?.documentElement;
            const currentAppearance = root?.dataset?.themeAppearance;
            if (currentAppearance === 'dark' || currentAppearance === 'light') {
                return currentAppearance;
            }
        } catch (error) {
            console.warn('MarkdownToolbarManager: failed to read document appearance', error);
        }

        // 其次读取上次保存的主题
        try {
            const savedTheme = localStorage.getItem('markdown-toolbar-theme');
            if (savedTheme === 'dark' || savedTheme === 'light') {
                return savedTheme;
            }
        } catch (error) {
            console.warn('MarkdownToolbarManager: failed to read saved theme', error);
        }

        // 最后回退到系统主题
        const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        return prefersDark ? 'dark' : 'light';
    }

    /**
     * 从设置中加载可见性
     */
    loadVisibility() {
        try {
            const saved = localStorage.getItem('markdown-toolbar-visible');
            this.isVisible = saved !== null ? saved === 'true' : true;
        } catch (error) {
            console.warn('Failed to load toolbar visibility:', error);
        }
    }

    /**
     * 保存可见性到设置
     */
    saveVisibility() {
        try {
            localStorage.setItem('markdown-toolbar-visible', this.isVisible.toString());
        } catch (error) {
            console.warn('Failed to save toolbar visibility:', error);
        }
    }

    /**
     * 保存主题到设置
     */
    saveTheme(theme) {
        try {
            localStorage.setItem('markdown-toolbar-theme', theme);
        } catch (error) {
            console.warn('Failed to save toolbar theme:', error);
        }
    }

    /**
     * 销毁工具栏
     */
    destroy() {
        if (this.toolbar) {
            this.toolbar.destroy();
            this.toolbar = null;
        }

        if (this.container && this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
            this.container = null;
        }

        this.isInitialized = false;
        this.editorInstance = null;
        this.editorType = null;

        console.log('Markdown toolbar destroyed');
    }

    /**
     * 更新编辑器实例（用于切换编辑器时）
     * @param {Object} editorInstance - 新的编辑器实例
     * @param {string} editorType - 编辑器类型
     */
    updateEditor(editorInstance, editorType) {
        if (this.toolbar && editorInstance) {
            const typeChanged = this.editorType !== editorType;
            this.editorType = editorType;
            this.rawEditorInstance = editorInstance;
            this.editorInstance = this.resolveEditorInstance(editorInstance, editorType);
            this.toolbar.setEditor(this.getEditorProxy());

            // 如果编辑器类型改变，需要重新定位容器
            if (typeChanged && this.container) {
                this.relocateContainer();
            }
        }
    }

    /**
     * 设置视图模式切换回调
     * @param {Function} callback - 回调函数
     */
    setToggleViewModeCallback(callback) {
        this.onToggleViewMode = callback;
    }

    /**
     * 设置卡片导出回调
     * @param {Function} callback - 回调函数
     */
    setCardExportCallback(callback) {
        this.onCardExport = callback;
    }

    /**
     * 重新定位工具栏容器到正确的编辑器位置
     */
    relocateContainer() {
        if (!this.container) {
            return;
        }

        // 从 DOM 中移除当前容器
        const oldParent = this.container.parentNode;
        if (oldParent) {
            oldParent.removeChild(this.container);
        }

        // 查找新的编辑器容器位置
        const editorContainer = this.findEditorContainer();
        if (editorContainer && editorContainer.parentNode) {
            // 重新插入到新位置
            editorContainer.parentNode.insertBefore(this.container, editorContainer);
        } else {
            console.warn('MarkdownToolbarManager: could not relocate container, editor container not found');
            // 如果找不到新位置，尝试放回原位
            if (oldParent) {
                oldParent.appendChild(this.container);
            }
        }
    }

    updateContainerTheme(theme) {
        if (!this.container) {
            return;
        }
        const isDark = theme === 'dark';
        this.container.classList.remove('markdown-toolbar-container--dark', 'markdown-toolbar-container--light');
        this.container.classList.add(isDark ? 'markdown-toolbar-container--dark' : 'markdown-toolbar-container--light');
    }

    /**
     * 复制 markdown 内容到剪贴板
     */
    async copyMarkdown() {
        try {
            let markdown = '';

            // 获取 markdown 内容
            if (this.editorType === 'tiptap') {
                // TipTap 编辑器 - 需要从全局的 markdownEditor 实例获取 markdown
                // 因为 getMarkdown() 方法在 MarkdownEditor 上，而不是在 TipTap 编辑器上
                if (typeof window !== 'undefined' && window.markdownEditor && typeof window.markdownEditor.getMarkdown === 'function') {
                    markdown = window.markdownEditor.getMarkdown();
                } else if (this.rawEditorInstance && typeof this.rawEditorInstance.getMarkdown === 'function') {
                    markdown = this.rawEditorInstance.getMarkdown();
                } else if (this.editorInstance && typeof this.editorInstance.getMarkdown === 'function') {
                    markdown = this.editorInstance.getMarkdown();
                } else {
                    return;
                }
            } else if (this.editorType === 'monaco') {
                // Monaco 编辑器 - 直接获取文本内容
                if (this.rawEditorInstance && typeof this.rawEditorInstance.getValue === 'function') {
                    markdown = this.rawEditorInstance.getValue();
                } else if (this.editorInstance && typeof this.editorInstance.getValue === 'function') {
                    markdown = this.editorInstance.getValue();
                } else {
                    return;
                }
            }

            // 复制到剪贴板
            if (markdown) {
                await navigator.clipboard.writeText(markdown);
                this.showCopyFeedback();
            }
        } catch (error) {
            console.error('复制 markdown 失败:', error);
        }
    }

    /**
     * 显示复制成功的视觉反馈
     */
    showCopyFeedback() {
        if (!this.container) {
            return;
        }

        // 查找复制按钮
        const copyButton = this.container.querySelector('[data-action="copyMarkdown"]');
        if (copyButton) {
            // 添加一个临时的类来显示反馈
            copyButton.classList.add('toolbar-button--copied');

            // 2秒后移除反馈样式
            setTimeout(() => {
                copyButton.classList.remove('toolbar-button--copied');
            }, 2000);
        }
    }
}
