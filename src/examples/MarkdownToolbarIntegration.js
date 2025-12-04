/**
 * Markdown工具栏集成示例
 * 展示如何在现有应用中集成和使用工具栏
 */

import { MarkdownToolbarManager } from '../components/MarkdownToolbarManager.js';

/**
 * 工具栏集成类
 * 可以在应用启动时初始化
 */
export class MarkdownToolbarIntegration {
    constructor(appServices) {
        this.appServices = appServices;
        this.toolbarManager = null;
        this.currentEditor = null;
        this.currentEditorType = null;
        this.isInitialized = false;
    }

    /**
     * 在应用启动时初始化工具栏
     */
    async initialize() {
        console.log('Initializing Markdown toolbar integration...');

        // 创建工具栏管理器
        this.toolbarManager = new MarkdownToolbarManager(this.appServices);

        // 监听编辑器切换事件
        this.setupEditorListeners();

        // 注册菜单处理函数
        this.registerMenuHandlers();

        this.isInitialized = true;
        console.log('Markdown toolbar integration initialized');
    }

    /**
     * 设置编辑器监听
     * 监听编辑器切换事件，自动更新工具栏
     */
    setupEditorListeners() {
        // 监听编辑器切换
        eventBus.on('editor-changed', ({ editor, type }) => {
            this.onEditorChanged(editor, type);
        });

        // 监听文件切换
        eventBus.on('file-changed', ({ path, type }) => {
            this.onFileChanged(path, type);
        });

        // 监听视图模式切换
        eventBus.on('view-mode-changed', ({ mode }) => {
            this.onViewModeChanged(mode);
        });
    }

    /**
     * 注册菜单处理函数
     */
    registerMenuHandlers() {
        // 添加到菜单处理器中
        if (window.menuHandlers) {
            window.menuHandlers.onToggleMarkdownToolbar = () => {
                this.toggleToolbar();
            };
        }
    }

    /**
     * 编辑器切换时的处理
     */
    onEditorChanged(editor, type) {
        if (!this.toolbarManager || !this.isInitialized) {
            return;
        }

        this.currentEditor = editor;
        this.currentEditorType = type;

        // 如果是Markdown编辑器，初始化或更新工具栏
        if (type === 'markdown' && editor) {
            if (!this.toolbarManager.isInitialized) {
                this.toolbarManager.initialize(editor, 'tiptap');
            } else {
                this.toolbarManager.updateEditor(editor, 'tiptap');
            }
        }
        // 如果是代码编辑器，且当前是Markdown文件，也可以使用工具栏
        else if (type === 'code' && this.isMarkdownFile()) {
            if (!this.toolbarManager.isInitialized) {
                this.toolbarManager.initialize(editor, 'monaco');
            } else {
                this.toolbarManager.updateEditor(editor, 'monaco');
            }
        }
        // 其他编辑器类型，隐藏工具栏
        else {
            if (this.toolbarManager.isInitialized) {
                this.toolbarManager.hide();
            }
        }
    }

    /**
     * 文件切换时的处理
     */
    onFileChanged(path, type) {
        if (!this.toolbarManager || !this.isInitialized) {
            return;
        }

        // 只有Markdown文件才显示工具栏
        if (type === 'markdown' || this.isMarkdownFile(path)) {
            this.toolbarManager.show();
        } else {
            this.toolbarManager.hide();
        }
    }

    /**
     * 视图模式切换时的处理
     */
    onViewModeChanged(mode) {
        if (!this.toolbarManager || !this.isInitialized) {
            return;
        }

        // 根据视图模式显示或隐藏工具栏
        if (mode === 'markdown' || mode === 'split') {
            if (this.currentEditor) {
                this.toolbarManager.show();
            }
        } else {
            this.toolbarManager.hide();
        }
    }

    /**
     * 判断当前是否为Markdown文件
     */
    isMarkdownFile(path) {
        path = path || window.currentFile || '';
        return /\.(md|markdown)$/i.test(path);
    }

    /**
     * 切换工具栏显示/隐藏
     */
    toggleToolbar() {
        if (!this.toolbarManager) {
            console.warn('Toolbar manager not initialized');
            return;
        }

        this.toolbarManager.toggle();

        // 发送通知
        const isVisible = this.toolbarManager.isVisible;
        console.log(`Markdown toolbar ${isVisible ? 'shown' : 'hidden'}`);

        // 可以在这里添加用户反馈，比如状态栏提示
        if (window.appServices && window.appServices.ui) {
            window.appServices.ui.showNotification(
                `工具栏已${isVisible ? '显示' : '隐藏'}`,
                'info'
            );
        }
    }

    /**
     * 显示工具栏
     */
    showToolbar() {
        if (this.toolbarManager) {
            this.toolbarManager.show();
        }
    }

    /**
     * 隐藏工具栏
     */
    hideToolbar() {
        if (this.toolbarManager) {
            this.toolbarManager.hide();
        }
    }

    /**
     * 设置工具栏主题
     */
    setToolbarTheme(theme) {
        if (this.toolbarManager) {
            this.toolbarManager.setTheme(theme);
        }
    }

    /**
     * 销毁集成
     */
    destroy() {
        if (this.toolbarManager) {
            this.toolbarManager.destroy();
            this.toolbarManager = null;
        }

        // 移除事件监听
        eventBus.off('editor-changed', this.onEditorChanged);
        eventBus.off('file-changed', this.onFileChanged);
        eventBus.off('view-mode-changed', this.onViewModeChanged);

        this.isInitialized = false;
        console.log('Markdown toolbar integration destroyed');
    }
}

/**
 * 在main.js中的集成示例代码
 *
 * 在应用启动后，添加以下代码：
 *
 * ```javascript
 * // 导入工具栏集成
 * import { MarkdownToolbarIntegration } from './examples/MarkdownToolbarIntegration.js';
 *
 * // 在appServices创建后初始化
 * const appServices = createAppServices();
 * const toolbarIntegration = new MarkdownToolbarIntegration(appServices);
 *
 * // 在应用启动时初始化工具栏
 * await toolbarIntegration.initialize();
 *
 * // 确保在应用关闭时销毁
 * window.addEventListener('beforeunload', () => {
 *     toolbarIntegration.destroy();
 * });
 * ```
 */

/**
 * 在菜单中添加工具栏切换选项
 *
 * 需要在Tauri后端（Rust代码）的菜单配置中添加：
 *
 * ```rust
 * // 在View菜单中添加
 * Submenu {
 *     title: "View",
 *     menu: vec![
 *         // ... 其他菜单项
 *         MenuItem::Separator,
 *         MenuItem {
 *             id: Some("toggle-markdown-toolbar".to_string()),
 *             title: "Toolbar",
 *             accelerator: Some(accelerator!(CmdOrCtrl + Shift + T)),
 *             ..Default::default()
 *         },
 *     ],
 * },
 * ```
 */

/**
 * 自定义工具栏配置示例
 *
 * 可以通过修改MarkdownToolbarManager来使用不同的配置：
 *
 * ```javascript
 * // 自定义按钮配置
 * const customToolbarManager = new MarkdownToolbarManager(appServices);
 *
 * // 初始化时传入自定义选项
 * await customToolbarManager.initialize(editor, 'tiptap', {
 *     position: 'bottom', // 工具栏位置
 *     theme: 'dark',      // 主题
 *     buttons: [          // 自定义按钮列表
 *         'bold',
 *         'italic',
 *         'separator',
 *         'heading1',
 *         'heading2',
 *         'separator',
 *         'code',
 *         'link'
 *     ]
 * });
 * ```

/**
 * 扩展工具栏功能
 *
 * 要添加新的格式化按钮，需要：
 *
 * 1. 在MarkdownToolbar.js中的buttonConfig添加新按钮配置
 * 2. 在handleAction方法中添加处理逻辑
 * 3. 可选：在MarkdownToolbarManager中添加自定义选项
 *
 * 示例：
 * ```javascript
 * // 添加高亮按钮
 this.buttonConfig.highlight = {
     icon: `<svg>...</svg>`,
     title: '高亮',
     shortcut: 'Ctrl+Shift+H'
 };

 // 在handleActions中添加
 highlight: () => this.toggleFormat('==', '=='),
 ```
 */