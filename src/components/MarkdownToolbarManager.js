import { MarkdownToolbar } from './MarkdownToolbar.js';

/**
 * Markdown工具栏管理器
 * 负责工具栏的生命周期管理和系统集成
 */
export class MarkdownToolbarManager {
    constructor(appServices) {
        this.appServices = appServices;
        this.toolbar = null;
        this.container = null;
        this.isVisible = true;
        this.editorInstance = null;
        this.rawEditorInstance = null;
        this.editorType = null; // 'tiptap' 或 'monaco'
        this.isInitialized = false;

        // 从设置中加载工具栏可见性
        this.loadVisibility();
    }

    /**
     * 初始化工具栏
     * @param {Object} editorInstance - 编辑器实例
     * @param {string} editorType - 编辑器类型 ('tiptap' 或 'monaco')
     */
    async initialize(editorInstance, editorType = 'tiptap') {
        console.log('MarkdownToolbarManager: initialize called', { editorInstance, editorType });

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
                'horizontalRule'
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
            // Monaco 编辑器
            return {
                get value() {
                    return manager.editorInstance?.getValue();
                },
                getSelection() {
                    const selection = manager.editorInstance?.getSelection();
                    if (!selection) {
                        return null;
                    }
                    return {
                        start: selection.getStartPosition().column - 1,
                        end: selection.getEndPosition().column - 1,
                        line: selection.startLineNumber - 1
                    };
                },
                setSelectionRange(start, end) {
                    const model = manager.editorInstance?.getModel();
                    if (model) {
                        const startPos = model.getPositionAt(start);
                        const endPos = model.getPositionAt(end);
                        manager.editorInstance.setSelection({
                            startLineNumber: startPos.lineNumber,
                            startColumn: startPos.column,
                            endLineNumber: endPos.lineNumber,
                            endColumn: endPos.column
                        });
                    }
                },
                focus() {
                    manager.editorInstance?.focus();
                },
                setRangeText(text, start, end) {
                    const model = manager.editorInstance?.getModel();
                    if (model) {
                        const range = {
                            startLineNumber: 1,
                            startColumn: start + 1,
                            endLineNumber: 1,
                            endColumn: end + 1
                        };
                        const operation = {
                            range,
                            text,
                            forceMoveMarkers: true
                        };
                        model.applyEdits([operation]);
                    }
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
            if (typeof editorInstance.getValue === 'function') {
                return editorInstance;
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
        }

        // 返回原始实例，允许 MarkdownToolbar 退回到 textarea 逻辑
        return editorInstance;
    }

    /**
     * 创建工具栏容器
     */
    createContainer() {
        console.log('MarkdownToolbarManager: createContainer called');

        // 查找合适的容器位置
        const editorContainer = this.findEditorContainer();

        console.log('MarkdownToolbarManager: editorContainer found', editorContainer);

        if (editorContainer) {
            this.container = document.createElement('div');
            this.container.className = 'markdown-toolbar-container';

            // 插入到编辑器容器之前
            editorContainer.parentNode.insertBefore(this.container, editorContainer);
            console.log('MarkdownToolbarManager: toolbar container inserted');
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
            // 查找 TipTap 编辑器的容器
            const tiptapEditor = document.querySelector('.tiptap-editor');
            if (tiptapEditor) {
                return tiptapEditor;
            }
        } else if (this.editorType === 'monaco') {
            // 查找 Monaco 编辑器的容器
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
            this.isVisible = visible;
            this.saveVisibility();
        });

        // 监听主题变化
        this.toolbar.on('theme-change', (theme) => {
            this.saveTheme(theme);
            this.updateContainerTheme(theme);
        });

        // 监听工具栏动作，可以在这里添加统计或日志
        this.toolbar.on('action', (action) => {
            console.log('Toolbar action:', action);
        });
    }

    /**
     * 显示工具栏
     */
    show() {
        if (this.toolbar) {
            this.toolbar.show();
        }
    }

    /**
     * 隐藏工具栏
     */
    hide() {
        if (this.toolbar) {
            this.toolbar.hide();
        }
    }

    /**
     * 切换工具栏显示状态
     */
    toggle() {
        console.log('MarkdownToolbarManager: toggle called', {
            isInitialized: this.isInitialized,
            hasToolbar: !!this.toolbar,
            hasEditor: !!this.editorInstance
        });

        if (this.toolbar) {
            this.toolbar.toggle();
        } else if (!this.isInitialized && window.editor) {
            console.log('MarkdownToolbarManager: Auto-initializing toolbar...');
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
            this.editorType = editorType;
            this.rawEditorInstance = editorInstance;
            this.editorInstance = this.resolveEditorInstance(editorInstance, editorType);
            this.toolbar.setEditor(this.getEditorProxy());
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
}
