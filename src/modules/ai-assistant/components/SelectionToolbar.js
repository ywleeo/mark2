/**
 * 选中文字时显示的浮动工具栏
 * 提供快捷 AI 操作按钮
 */
export class SelectionToolbar {
    constructor() {
        this.element = null;
        this.isVisible = false;
        this.editor = null;
        this.onActionClick = null;
        this.hideTimer = null;
        this.lastSelection = null;

        // 立即创建工具栏元素
        this.createElement();

        // 立即添加全局右键菜单拦截器（不需要 editor）
        this.setupGlobalContextMenuHandler();
    }

    /**
     * 绑定编辑器
     * @param {Object} editor - MarkdownEditor 实例
     * @param {Function} onActionClick - 点击操作按钮的回调 (action) => {}
     */
    init(editor, onActionClick) {
        // console.log('[SelectionToolbar] ========== init 被调用 ==========', {
        //     hasEditor: !!editor,
        //     hasCallback: typeof onActionClick === 'function',
        //     editorType: editor?.constructor?.name
        // });

        this.editor = editor;
        this.onActionClick = onActionClick;

        // console.log('[SelectionToolbar] init 完成后的状态', {
        //     thisEditor: !!this.editor,
        //     thisOnActionClick: typeof this.onActionClick === 'function'
        // });

        // 不再自动监听选中变化，只通过右键菜单显示
        // this.setupSelectionListener();
    }

    /**
     * 创建工具栏元素
     */
    createElement() {
        this.element = document.createElement('div');
        this.element.className = 'ai-selection-toolbar';
        this.element.innerHTML = `
            <button class="ai-selection-btn" data-action="polish" title="润色优化">
                <span>✨</span>
                <span class="ai-selection-btn-label">润色</span>
            </button>
            <button class="ai-selection-btn" data-action="continue" title="智能续写">
                <span>✍️</span>
                <span class="ai-selection-btn-label">续写</span>
            </button>
            <button class="ai-selection-btn" data-action="expand" title="扩写内容">
                <span>📝</span>
                <span class="ai-selection-btn-label">扩写</span>
            </button>
            <button class="ai-selection-btn" data-action="compress" title="精简压缩">
                <span>✂️</span>
                <span class="ai-selection-btn-label">精简</span>
            </button>
            <button class="ai-selection-btn" data-action="summarize" title="总结提炼">
                <span>📋</span>
                <span class="ai-selection-btn-label">总结</span>
            </button>
            <button class="ai-selection-btn" data-action="translate" title="智能翻译">
                <span>🌐</span>
                <span class="ai-selection-btn-label">翻译</span>
            </button>
            <div class="ai-selection-divider"></div>
            <div class="ai-style-selector" title="输出风格">
                <div class="ai-style-current"></div>
                <div class="ai-style-dropdown">
                    <div class="ai-style-option" data-value="balanced">平衡</div>
                    <div class="ai-style-option" data-value="formal">正式</div>
                    <div class="ai-style-option" data-value="casual">口语</div>
                    <div class="ai-style-option" data-value="xiaohongshu">小红书</div>
                    <div class="ai-style-option" data-value="zhihu">知乎</div>
                    <div class="ai-style-option" data-value="weibo">微博</div>
                    <div class="ai-style-option" data-value="bilibili">B站</div>
                    <div class="ai-style-option" data-value="wechat">公众号</div>
                    <div class="ai-style-option" data-value="toutiao">头条</div>
                </div>
            </div>
        `;

        document.body.appendChild(this.element);

        // 初始化风格选择器
        this.styleSelector = this.element.querySelector('.ai-style-selector');
        this.styleCurrent = this.element.querySelector('.ai-style-current');
        this.styleDropdown = this.element.querySelector('.ai-style-dropdown');
        this.styleOptions = this.element.querySelectorAll('.ai-style-option');
        this.currentStyleValue = 'balanced';

        this.loadCurrentStyle();
        this.bindEvents();
    }

    /**
     * 绑定事件
     */
    bindEvents() {
        // 风格选择器点击切换下拉
        if (this.styleSelector) {
            this.styleSelector.addEventListener('mousedown', (e) => {
                e.stopPropagation();
                this.toggleDropdown();
            });
        }

        // 风格选项点击
        this.styleOptions.forEach(option => {
            option.addEventListener('mousedown', (e) => {
                e.stopPropagation();
                const value = option.dataset.value;
                const text = option.textContent;
                this.selectStyle(value, text);
            });
        });

        // 点击按钮 - 使用 mousedown 而不是 click，避免事件冲突
        this.element.addEventListener('mousedown', (e) => {
            // 只处理左键点击
            if (e.button !== 0) return;

            const btn = e.target.closest('.ai-selection-btn');
            // console.log('[SelectionToolbar] mousedown on toolbar', {
            //     hasBtn: !!btn,
            //     target: e.target,
            //     targetClass: e.target.className,
            // });

            if (!btn) return;

            // 阻止默认行为和事件传播，避免被 documentClickHandler 干扰
            e.preventDefault();
            e.stopPropagation();

            const action = btn.dataset.action;
            // console.log('[SelectionToolbar] 按钮被点击', {
            //     action,
            //     hasCallback: typeof this.onActionClick === 'function',
            //     hasEditor: !!this.editor
            // });

            if (!this.onActionClick) {
                console.error('[SelectionToolbar] onActionClick 回调未设置，请先打开一个 Markdown 文件');
                alert('请先打开一个 Markdown 文件');
                return;
            }

            if (action && typeof this.onActionClick === 'function') {
                this.onActionClick(action);
            }
        });

        // 鼠标进入工具栏，取消隐藏
        this.element.addEventListener('mouseenter', () => {
            this.clearHideTimer();
        });

        // 鼠标离开工具栏，延迟隐藏
        this.element.addEventListener('mouseleave', () => {
            this.scheduleHide();
        });

        // 点击外部区域立即关闭
        this.documentClickHandler = (e) => {
            // console.log('[SelectionToolbar] documentClickHandler', {
            //     isVisible: this.isVisible,
            //     eventType: e.type,
            //     button: e.button,
            //     target: e.target,
            //     targetTagName: e.target?.tagName,
            //     targetClassName: e.target?.className,
            //     contains: this.element?.contains(e.target)
            // });

            if (!this.isVisible) return;

            // 忽略右键点击（button = 2）
            if (e.button === 2) {
                // console.log('[SelectionToolbar] 忽略右键点击');
                return;
            }

            // 如果点击的是工具栏本身，不关闭工具栏，但要关闭下拉菜单
            if (this.element.contains(e.target)) {
                // 如果点击的不是选择器，关闭下拉菜单
                if (!this.styleSelector.contains(e.target)) {
                    this.closeDropdown();
                }
                return;
            }

            // 立即关闭工具栏和下拉菜单
            // console.log('[SelectionToolbar] 点击外部，关闭工具栏');
            this.closeDropdown();
            this.hide();
        };

        // 同时监听 mousedown，因为有些情况下 click 不会触发
        document.addEventListener('mousedown', this.documentClickHandler, true);
    }

    /**
     * 全局右键菜单拦截器（在 document 级别）
     */
    setupGlobalContextMenuHandler() {
        this.globalContextMenuHandler = (e) => {
            // 检查是否有选中文字
            const selection = window.getSelection();
            const selectedText = selection?.toString().trim();

            // console.log('[SelectionToolbar] 全局右键事件', {
            //     hasSelection: !!selectedText,
            //     selectionLength: selectedText?.length,
            //     target: e.target?.className
            // });

            // 如果没有选中文字或文字太短，允许默认菜单
            if (!selectedText || selectedText.length < 5) {
                // console.log('[SelectionToolbar] 无选中文字，允许默认菜单');
                return;
            }

            // 检查是否在编辑器区域内（确保不是在文件树或其他地方右键）
            const isInEditor = e.target.closest('.tiptap-editor') ||
                               e.target.closest('.view-content') ||
                               e.target.classList.contains('ProseMirror');

            if (!isInEditor) {
                // console.log('[SelectionToolbar] 不在编辑器区域，允许默认菜单');
                return;
            }

            // console.log('[SelectionToolbar] 阻止默认菜单，显示 AI 工具栏');

            // 阻止默认菜单
            e.preventDefault();
            e.stopPropagation();

            // 显示工具栏
            this.clearHideTimer();
            this.show();
            this.updatePositionAtMouse(e);
        };

        // 添加到 document，capture 阶段拦截
        document.addEventListener('contextmenu', this.globalContextMenuHandler, { capture: true });
        // console.log('[SelectionToolbar] 全局右键菜单拦截器已添加');
    }

    /**
     * 监听编辑器选中变化
     */
    setupSelectionListener() {
        if (!this.editor?.editor) {
            console.warn('[SelectionToolbar] 编辑器未找到，无法设置监听');
            return;
        }

        // 获取 TipTap 实际的编辑器 DOM 元素
        const editorDom = this.editor.editor.view?.dom;

        // console.log('[SelectionToolbar] 开始设置选中监听', {
        //     hasEditor: !!this.editor,
        //     hasEditorElement: !!this.editor.element,
        //     hasEditorDom: !!editorDom,
        //     editorDomClass: editorDom?.className
        // });

        if (!editorDom) {
            console.error('[SelectionToolbar] 无法获取编辑器 DOM');
            return;
        }

        // TipTap 编辑器的选中变化事件
        this.editor.editor.on('selectionUpdate', () => {
            this.handleSelectionChange();
        });

        // 同时监听 mouseup 事件（确保捕获选中）
        editorDom.addEventListener('mouseup', () => {
            setTimeout(() => this.handleSelectionChange(), 10);
        });

        // console.log('[SelectionToolbar] 选中监听已添加');
    }

    /**
     * 处理选中变化
     */
    handleSelectionChange() {
        const selectedText = this.editor.getSelectedMarkdown();

        // 如果没有选中文字，隐藏工具栏
        if (!selectedText || selectedText.trim().length === 0) {
            this.scheduleHide();
            return;
        }

        // 如果选中文字太短（少于 5 个字符），不显示工具栏
        if (selectedText.trim().length < 5) {
            this.scheduleHide();
            return;
        }

        // 显示工具栏
        this.clearHideTimer();
        this.show();
        this.updatePosition();
    }

    /**
     * 显示工具栏
     */
    show() {
        if (!this.element) return;

        this.element.classList.add('is-visible');
        this.isVisible = true;
    }

    /**
     * 隐藏工具栏
     */
    hide() {
        if (!this.element) return;

        this.element.classList.remove('is-visible');
        this.isVisible = false;
        this.closeDropdown();
    }

    /**
     * 计划隐藏（延迟 300ms）
     */
    scheduleHide() {
        this.clearHideTimer();
        this.hideTimer = setTimeout(() => {
            this.hide();
        }, 300);
    }

    /**
     * 清除隐藏计时器
     */
    clearHideTimer() {
        if (this.hideTimer) {
            clearTimeout(this.hideTimer);
            this.hideTimer = null;
        }
    }

    /**
     * 更新工具栏位置
     */
    updatePosition() {
        if (!this.element || !this.editor?.editor) return;

        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) return;

        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();

        // 工具栏显示在选中文字上方
        const toolbarWidth = 280; // 预估宽度
        const toolbarHeight = 40; // 预估高度

        let left = rect.left + (rect.width - toolbarWidth) / 2;
        let top = rect.top - toolbarHeight - 8; // 上方 8px 间距

        // 防止超出屏幕左侧
        if (left < 10) {
            left = 10;
        }

        // 防止超出屏幕右侧
        if (left + toolbarWidth > window.innerWidth - 10) {
            left = window.innerWidth - toolbarWidth - 10;
        }

        // 如果上方空间不足，显示在下方
        if (top < 10) {
            top = rect.bottom + 8;
        }

        this.element.style.left = `${left}px`;
        this.element.style.top = `${top}px`;
    }

    /**
     * 在鼠标位置更新工具栏位置（用于右键菜单）
     */
    updatePositionAtMouse(event) {
        if (!this.element) return;

        const toolbarWidth = 280;
        const toolbarHeight = 40;

        let left = event.clientX - toolbarWidth / 2;
        let top = event.clientY - toolbarHeight - 8;

        // 防止超出屏幕
        if (left < 10) {
            left = 10;
        }
        if (left + toolbarWidth > window.innerWidth - 10) {
            left = window.innerWidth - toolbarWidth - 10;
        }
        if (top < 10) {
            top = event.clientY + 8;
        }

        this.element.style.left = `${left}px`;
        this.element.style.top = `${top}px`;
    }

    /**
     * 切换下拉菜单
     */
    toggleDropdown() {
        const isOpen = this.styleDropdown.classList.contains('is-open');
        if (isOpen) {
            this.closeDropdown();
        } else {
            this.openDropdown();
        }
    }

    /**
     * 打开下拉菜单
     */
    openDropdown() {
        this.styleDropdown.classList.add('is-open');
    }

    /**
     * 关闭下拉菜单
     */
    closeDropdown() {
        this.styleDropdown.classList.remove('is-open');
    }

    /**
     * 选择风格
     */
    selectStyle(value, text) {
        this.currentStyleValue = value;
        this.styleCurrent.textContent = text;

        // 更新选中状态
        this.styleOptions.forEach(opt => {
            if (opt.dataset.value === value) {
                opt.classList.add('is-selected');
            } else {
                opt.classList.remove('is-selected');
            }
        });

        this.saveCurrentStyle(value);
        this.closeDropdown();
    }

    /**
     * 加载当前风格设置
     */
    loadCurrentStyle() {
        try {
            // 优先从 localStorage 读取工具栏的风格设置
            let style = localStorage.getItem('ai-output-style-toolbar');

            // 如果没有，则从设置中读取默认值
            if (!style) {
                const aiConfig = JSON.parse(localStorage.getItem('ai-config') || '{}');
                style = aiConfig.preferences?.outputStyle || 'balanced';
            }

            // 查找对应的选项文本
            const option = Array.from(this.styleOptions).find(opt => opt.dataset.value === style);
            const text = option ? option.textContent : '平衡';

            this.selectStyle(style, text);
        } catch (error) {
            console.warn('[SelectionToolbar] 加载风格设置失败:', error);
            this.selectStyle('balanced', '平衡');
        }
    }

    /**
     * 保存当前风格设置
     */
    saveCurrentStyle(style) {
        try {
            // 保存到独立的 localStorage 键
            localStorage.setItem('ai-output-style-toolbar', style);
            console.log('[SelectionToolbar] 风格已切换为:', style);
        } catch (error) {
            console.warn('[SelectionToolbar] 保存风格设置失败:', error);
        }
    }

    /**
     * 获取当前选择的风格
     */
    getCurrentStyle() {
        return this.currentStyleValue || 'balanced';
    }

    /**
     * 销毁工具栏
     */
    destroy() {
        this.clearHideTimer();

        // 移除全局右键菜单监听器
        if (this.globalContextMenuHandler) {
            document.removeEventListener('contextmenu', this.globalContextMenuHandler, { capture: true });
            this.globalContextMenuHandler = null;
        }

        // 移除点击外部关闭监听器
        if (this.documentClickHandler) {
            document.removeEventListener('mousedown', this.documentClickHandler, true);
            this.documentClickHandler = null;
        }

        if (this.element && this.element.parentNode) {
            this.element.parentNode.removeChild(this.element);
            this.element = null;
        }

        this.editor = null;
        this.onActionClick = null;
    }
}
