import { MarkdownToolbar } from './index.js';
import { COMMAND_IDS } from '../../core/commands/commandIds.js';
import { createStore } from '../../services/storage.js';

const store = createStore('toolbar');
store.migrateFrom('markdown-toolbar-theme', 'theme', { parse: 'raw' });
store.migrateFrom('markdown-toolbar-visible', 'visible', { parse: (raw) => raw === 'true' });
store.migrateFrom('markdown-content-centered', 'contentCentered', { parse: (raw) => raw === 'true' });

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
        this.editorType = null; // 'tiptap' 或 'codemirror'
        this.isInitialized = false;
        this.executeCommand = options.executeCommand || null;
        this.onToggleViewMode = options.onToggleViewMode || null;
        this.onCardExport = options.onCardExport || null;
        this._getEditorRegistry = options.getEditorRegistry || null;
        this._getCurrentFilePath = options.getCurrentFilePath || null;

        // 从设置中加载工具栏可见性
        this.loadVisibility();
    }

    /**
     * 初始化工具栏
     * @param {Object} editorInstance - 编辑器实例
     * @param {string} editorType - 编辑器类型 ('tiptap' 或 'codemirror')
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

        // 创建工具栏实例（按钮布局见 toolbarConfig 的 TOOLBAR_GROUPS）
        this.toolbar = new MarkdownToolbar({
            position: 'top',
            theme: this.getTheme(),
            getCurrentFilePath: this._getCurrentFilePath,
        });

        // 设置编辑器
        this.toolbar.setEditor(this.getEditorProxy());

        // 渲染工具栏
        this.toolbar.render(this.container);

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
            // on/off 用闭包持有当前 instance，避免 updateEditor 切换后 off 作用到新 instance
            // 导致旧 listener 永远解绑不掉。
            const boundInstance = manager.editorInstance;
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
                },
                on(event, handler) {
                    boundInstance?.on?.(event, handler);
                },
                off(event, handler) {
                    boundInstance?.off?.(event, handler);
                }
            };
        } else if (manager.editorType === 'codemirror') {
            // CodeMirror 编辑器 - 模拟 textarea 接口
            const getEditorView = () => {
                // 从 CodeEditor 包装类中获取 EditorView
                if (manager.rawEditorInstance?.editor) {
                    return manager.rawEditorInstance.editor;
                }
                return manager.editorInstance;
            };

            return {
                get value() {
                    const view = getEditorView();
                    return view?.state?.doc?.toString() || '';
                },
                get selectionStart() {
                    const view = getEditorView();
                    return view?.state?.selection?.main?.from ?? 0;
                },
                get selectionEnd() {
                    const view = getEditorView();
                    return view?.state?.selection?.main?.to ?? 0;
                },
                getSelection() {
                    const view = getEditorView();
                    if (!view?.state) return null;
                    const { from, to } = view.state.selection.main;
                    const line = view.state.doc.lineAt(from);
                    return { start: from, end: to, line: line.number - 1 };
                },
                setSelectionRange(start, end) {
                    const view = getEditorView();
                    if (!view) return;
                    view.dispatch({ selection: { anchor: start, head: end } });
                },
                focus() {
                    const view = getEditorView();
                    view?.focus?.();
                },
                setRangeText(text, start, end, selectionMode = 'end') {
                    const view = getEditorView();
                    if (!view?.state) return;

                    if (start === undefined || end === undefined) {
                        const sel = view.state.selection.main;
                        start = sel.from;
                        end = sel.to;
                    }

                    view.dispatch({
                        changes: { from: start, to: end, insert: text },
                    });

                    if (selectionMode === 'select') {
                        view.dispatch({ selection: { anchor: start, head: start + text.length } });
                    } else if (selectionMode === 'start') {
                        view.dispatch({ selection: { anchor: start } });
                    } else {
                        view.dispatch({ selection: { anchor: start + text.length } });
                    }
                },
                dispatchEvent() {
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
        } else if (editorType === 'codemirror') {
            // CodeEditor 包装类 - 返回内部 EditorView
            if (editorInstance.editor && editorInstance.editor.state) {
                return editorInstance.editor;
            }
            // 直接传入的 EditorView
            if (editorInstance.state && editorInstance.dispatch) {
                return editorInstance;
            }
        }

        // 返回原始实例，允许 MarkdownToolbar 退回到 textarea 逻辑
        return editorInstance;
    }

    /**
     * 绑定工具栏容器（应用级固定栏，静态存在于 index.html）
     */
    createContainer() {
        this.container = document.getElementById('markdownToolbar');
        if (!this.container) {
            console.warn('MarkdownToolbarManager: 未找到 #markdownToolbar 容器');
        }
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
        });

        // 监听工具栏动作
        this.toolbar.on('action', (action) => {
            // 处理视图模式切换
            if (action === 'toggleViewMode') {
                if (this.dispatchCommand(COMMAND_IDS.VIEW_TOGGLE_SOURCE_MODE, action)) {
                    return;
                }
                this.onToggleViewMode?.();
                return;
            }
            // 处理复制 markdown
            if (action === 'copyMarkdown') {
                if (this.dispatchCommand(COMMAND_IDS.DOCUMENT_COPY_MARKDOWN, action)) {
                    return;
                }
                this.copyMarkdown();
                return;
            }
            // 复制选中内容
            if (action === 'copy') {
                this.dispatchCommand(COMMAND_IDS.EDITOR_COPY, action);
                return;
            }
            // 复制并整理列表
            if (action === 'copyPlainText') {
                if (this.dispatchCommand(COMMAND_IDS.DOCUMENT_COPY_PLAIN_TEXT, action)) {
                    return;
                }
                this.copyPlainText();
                return;
            }
            // 生成 mark2 cloud 分享链接
            if (action === 'shareLink') {
                this.dispatchCommand(COMMAND_IDS.DOCUMENT_SHARE_LINK, action);
                return;
            }
        });
    }

    /**
     * 将工具栏动作转发到统一命令层。
     * @param {string} commandId - 命令 ID
     * @param {string} action - 工具栏动作名
     * @returns {boolean}
     */
    dispatchCommand(commandId, action) {
        if (typeof this.executeCommand !== 'function') {
            return false;
        }

        void this.executeCommand(commandId, {}, {
            source: 'markdown-toolbar',
            action,
        });
        return true;
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
        } else if (!this.isInitialized && this._getEditorRegistry) {
            const mdEditor = this._getEditorRegistry()?.getMarkdownEditor?.();
            const tiptapEditor = mdEditor?.editor;
            if (tiptapEditor) {
                this.initialize(tiptapEditor, 'tiptap');
            }
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
        const savedTheme = store.get('theme');
        if (savedTheme === 'dark' || savedTheme === 'light') {
            return savedTheme;
        }

        // 最后回退到系统主题
        const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        return prefersDark ? 'dark' : 'light';
    }

    /**
     * 从设置中加载可见性
     */
    loadVisibility() {
        const saved = store.get('visible');
        this.isVisible = saved == null ? true : Boolean(saved);
    }

    /**
     * 保存可见性到设置
     */
    saveVisibility() {
        store.set('visible', this.isVisible);
    }

    /**
     * 保存主题到设置
     */
    saveTheme(theme) {
        store.set('theme', theme);
    }

    /**
     * 销毁工具栏
     */
    destroy() {
        if (this.toolbar) {
            this.toolbar.destroy();
            this.toolbar = null;
        }

        // #markdownToolbar 是静态容器，仅清空内容、不移除节点
        if (this.container) {
            this.container.innerHTML = '';
            this.container.classList.remove('is-visible');
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

    /**
     * 设置视图模式切换回调
     * @param {Function} callback - 回调函数
     */
    setToggleViewModeCallback(callback) {
        this.onToggleViewMode = callback;
    }

    /**
     * 切换目录面板显示
     */
    toggleToc() {
        if (this.toolbar) {
            this.toolbar.handleToc();
        }
    }

    /**
     * 复制 markdown 内容到剪贴板。
     * 有选区时复制选中内容的 markdown 原文，无选区时复制整篇。
     */
    async copyMarkdown() {
        try {
            let markdown = '';

            if (this.editorType === 'tiptap') {
                const mdEditor = this._getEditorRegistry?.()?.getMarkdownEditor?.();
                if (mdEditor) {
                    // 优先复制选中内容的 markdown
                    const selected = mdEditor.getSelectedMarkdown?.();
                    markdown = selected || mdEditor.getMarkdown?.() || '';
                } else if (this.rawEditorInstance?.getMarkdown) {
                    markdown = this.rawEditorInstance.getMarkdown();
                } else if (this.editorInstance?.getMarkdown) {
                    markdown = this.editorInstance.getMarkdown();
                } else {
                    return;
                }
            } else if (this.editorType === 'codemirror') {
                // CodeMirror：选中文本即为 markdown/code 原文
                const selected = window.getSelection()?.toString() ?? '';
                if (selected.trim()) {
                    markdown = selected;
                } else if (this.rawEditorInstance?.getValue) {
                    markdown = this.rawEditorInstance.getValue();
                } else if (this.editorInstance?.getValue) {
                    markdown = this.editorInstance.getValue();
                } else {
                    return;
                }
            }

            if (markdown) {
                await navigator.clipboard.writeText(markdown);
                this.showCopyFeedback();
            }
        } catch (error) {
            console.error('复制 markdown 失败:', error);
        }
    }

    async copyPlainText() {
        try {
            let markdown = '';

            if (this.editorType === 'tiptap') {
                const mdEditor = this._getEditorRegistry?.()?.getMarkdownEditor?.();
                if (mdEditor) {
                    // 优先复制选中内容的 markdown，无选区则整篇
                    const selected = mdEditor.getSelectedMarkdown?.();
                    markdown = selected || mdEditor.getMarkdown?.() || '';
                } else if (this.rawEditorInstance?.getMarkdown) {
                    markdown = this.rawEditorInstance.getMarkdown();
                } else if (this.editorInstance?.getMarkdown) {
                    markdown = this.editorInstance.getMarkdown();
                } else {
                    return;
                }
            } else if (this.editorType === 'codemirror') {
                // CodeMirror 显示的就是 markdown 原文，选区即原文
                const selected = window.getSelection()?.toString() ?? '';
                if (selected.trim()) {
                    markdown = selected;
                } else if (this.rawEditorInstance?.getValue) {
                    markdown = this.rawEditorInstance.getValue();
                } else if (this.editorInstance?.getValue) {
                    markdown = this.editorInstance.getValue();
                } else {
                    return;
                }
            }

            if (markdown) {
                // 先整理列表序号,再去掉 markdown 标记(顺序:列表整理只看行首,不会被行内标记影响)
                // 去标记会把代码围栏 / HR 等留成空行,最后压缩多余空行 + 首尾 trim
                const plain = _stripMarkdownMarks(_formatListMarkdown(markdown))
                    .replace(/\n{3,}/g, '\n\n')
                    .trim();
                await navigator.clipboard.writeText(plain);
                this.showCopyFeedback();
            }
        } catch (error) {
            console.error('复制纯文本失败:', error);
        }
    }

    /**
     * 显示复制成功的视觉反馈
     */
    showCopyFeedback() {
        if (!this.container) {
            return;
        }

        // 复制按钮已并入「复制」下拉，反馈打在下拉 trigger 上
        const copyButton = this.container.querySelector('[data-action="copy"]');
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

/**
 * 复制 markdown 原文时的列表格式化：
 * 1. 有序列表序号连续累加（1. 1. 1. → 1. 2. 3.），按缩进层级各自计数
 * 2. 列表组之间补空行：一个有序项 + 跟随的无序条目算一组，组与组之间空一行
 * 重置时机：遇到普通内容（非列表、非空行、非缩进续行）时该层级序号归零。
 */
function _formatListMarkdown(md) {
    const lines = String(md ?? '').split('\n');
    const out = [];
    // 缩进长度 → { count, sawBullet }，按层级各自累加，避免嵌套列表被错误连号
    const levels = new Map();
    const orderedRe = /^(\s*)(\d+)\.(\s+)/;
    const bulletRe = /^(\s*)[-*+](\s+)/;

    const resetDeeperThan = (indentLen) => {
        for (const key of [...levels.keys()]) {
            if (key > indentLen) levels.delete(key);
        }
    };

    for (const line of lines) {
        const om = orderedRe.exec(line);
        if (om) {
            const indentLen = om[1].length;
            resetDeeperThan(indentLen);
            let lvl = levels.get(indentLen);
            if (!lvl) { lvl = { count: 0, sawBullet: false }; levels.set(indentLen, lvl); }
            lvl.count += 1;
            // 同层级、且本组里出现过无序条目 → 组间补空行（避免重复空行）
            if (lvl.count > 1 && lvl.sawBullet && out.length > 0 && out[out.length - 1].trim() !== '') {
                out.push('');
            }
            lvl.sawBullet = false;
            out.push(line.replace(orderedRe, (m, ind, num, sp) => `${ind}${lvl.count}.${sp}`));
            continue;
        }
        const bm = bulletRe.exec(line);
        if (bm) {
            const indentLen = bm[1].length;
            resetDeeperThan(indentLen);
            // 标记同级或更浅的有序层级"本组见过无序条目"
            for (const [key, lvl] of levels) {
                if (key <= indentLen) lvl.sawBullet = true;
            }
            out.push(line);
            continue;
        }
        // 空行 / 缩进续行：保持列表上下文，不重置
        if (line.trim() === '' || /^\s/.test(line)) {
            out.push(line);
            continue;
        }
        // 普通内容：清空所有层级计数
        levels.clear();
        out.push(line);
    }
    return out.join('\n').trim();
}

/**
 * 把 markdown 标记剥掉,只留纯文本(列表行首前缀由 _formatListMarkdown 负责保留)。
 * 覆盖常见标记:代码围栏 / 水平线 / 标题 / 引用 / 链接 / 图片 / 行内代码 / 加粗 / 斜体 / 删除线。
 * 复杂嵌套(如 **bold *italic***)不保证完美,常见 95% 场景按 CommonMark 习惯处理。
 */
function _stripMarkdownMarks(text) {
    return String(text ?? '')
        // 代码围栏整行:``` 或 ~~~ 开头的行直接删
        .replace(/^[ \t]*(?:```|~~~).*$/gm, '')
        // 水平分隔线:---  ***  ___
        .replace(/^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/gm, '')
        // 标题:去掉行首的 #...# 和后随空格
        .replace(/^[ \t]*#{1,6}[ \t]+/gm, '')
        // 引用:去掉行首的 > 和紧跟的空格(保留原缩进)
        .replace(/^([ \t]*)>[ \t]?/gm, '$1')
        // 图片 ![alt](url) → alt
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
        // 链接 [text](url) → text
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        // 行内代码 `xxx`
        .replace(/`([^`\n]+)`/g, '$1')
        // 加粗(先做,避免被斜体吃掉一只 *):**xxx** / __xxx__
        .replace(/\*\*([^*\n]+?)\*\*/g, '$1')
        .replace(/__([^_\n]+?)__/g, '$1')
        // 斜体 *xxx*:不挨着另一个 *(避开 **),内部不以空白起止(避开列表 "* item")
        .replace(/(?<!\*)\*(?!\s)([^*\n]+?)(?<!\s)\*(?!\*)/g, '$1')
        // 斜体 _xxx_:用 \b 边界避免误伤 snake_case
        .replace(/\b_([^_\n]+?)_\b/g, '$1')
        // 删除线 ~~xxx~~
        .replace(/~~([^~\n]+?)~~/g, '$1');
}
