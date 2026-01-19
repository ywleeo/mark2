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
        this.lastSelectionRange = null;
        this.restoreSelectionRaf = null;

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
            <div class="ai-toolbar-row ai-toolbar-text">
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
                <div class="ai-selection-divider"></div>
                <div class="ai-style-selector ai-text-style-selector" title="文字输出风格">
                    <div class="ai-style-current"></div>
                    <div class="ai-style-dropdown">
                        <div class="ai-style-group">
                            <div class="ai-style-group-title">基础风格</div>
                            <div class="ai-style-option" data-value="balanced">平衡</div>
                            <div class="ai-style-option" data-value="rational">理性</div>
                            <div class="ai-style-option" data-value="humorous">幽默</div>
                            <div class="ai-style-option" data-value="cute">可爱</div>
                            <div class="ai-style-option" data-value="business_style">商务</div>
                            <div class="ai-style-option" data-value="literary">文艺</div>
                        </div>
                        <div class="ai-style-group">
                            <div class="ai-style-group-title">小说风格</div>
                            <div class="ai-style-option" data-value="novel_romance">言情</div>
                            <div class="ai-style-option" data-value="novel_mystery">悬疑</div>
                            <div class="ai-style-option" data-value="novel_costume">古偶</div>
                            <div class="ai-style-option" data-value="novel_wuxia">武侠</div>
                            <div class="ai-style-option" data-value="novel_xianxia">修仙</div>
                            <div class="ai-style-option" data-value="novel_history">历史</div>
                        </div>
                        <div class="ai-style-group">
                            <div class="ai-style-group-title">平台风格</div>
                            <div class="ai-style-option" data-value="xiaohongshu">小红书</div>
                            <div class="ai-style-option" data-value="zhihu">知乎</div>
                            <div class="ai-style-option" data-value="weibo">微博</div>
                            <div class="ai-style-option" data-value="bilibili">B站</div>
                            <div class="ai-style-option" data-value="wechat">公众号</div>
                            <div class="ai-style-option" data-value="toutiao">头条</div>
                            <div class="ai-style-option" data-value="douyin">抖音</div>
                            <div class="ai-style-option" data-value="shipinhao">视频号</div>
                            <div class="ai-style-option" data-value="taobao">淘宝</div>
                        </div>
                        <div class="ai-style-group">
                            <div class="ai-style-group-title">特色风格</div>
                            <div class="ai-style-option" data-value="novel_master">大师</div>
                            <div class="ai-style-option" data-value="standup_comedy">脱口秀</div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="ai-toolbar-row ai-toolbar-special">
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
                <button class="ai-selection-btn" data-action="brainstorm" title="头脑风暴">
                    <span>💡</span>
                    <span class="ai-selection-btn-label">脑暴</span>
                </button>
                <button class="ai-selection-btn" data-action="podcast_solo" title="播客-单人独白">
                    <span>🎙️</span>
                    <span class="ai-selection-btn-label">播客单人</span>
                </button>
                <button class="ai-selection-btn" data-action="podcast_duo" title="播客-双人对话">
                    <span>🎧</span>
                    <span class="ai-selection-btn-label">播客双人</span>
                </button>
            </div>
            <div class="ai-toolbar-row ai-toolbar-image">
                <button class="ai-selection-btn" data-action="illustration" title="生成插画提示词">
                    <span>🎨</span>
                    <span class="ai-selection-btn-label">插画</span>
                </button>
                <button class="ai-selection-btn" data-action="storyboard" title="生成分镜提示词">
                    <span>🎬</span>
                    <span class="ai-selection-btn-label">分镜</span>
                </button>
                <div class="ai-selection-divider"></div>
                <div class="ai-style-selector ai-image-style-selector" title="图片艺术风格">
                    <div class="ai-style-current"></div>
                    <div class="ai-style-dropdown">
                        <div class="ai-style-group">
                            <div class="ai-style-group-title">动漫风格</div>
                            <div class="ai-style-option" data-value="ghibli">吉卜力</div>
                            <div class="ai-style-option" data-value="shinkai">新海诚</div>
                            <div class="ai-style-option" data-value="kyoani">京都动画</div>
                            <div class="ai-style-option" data-value="pixar">皮克斯</div>
                            <div class="ai-style-option" data-value="disney">迪士尼</div>
                            <div class="ai-style-option" data-value="jump_manga">Jump热血</div>
                            <div class="ai-style-option" data-value="shoujo_manga">少女漫画</div>
                            <div class="ai-style-option" data-value="gekiga">剧画</div>
                            <div class="ai-style-option" data-value="chibi">Q版</div>
                            <div class="ai-style-option" data-value="mecha_anime">机甲动画</div>
                        </div>
                        <div class="ai-style-group">
                            <div class="ai-style-group-title">绘画风格</div>
                            <div class="ai-style-option" data-value="watercolor">水彩</div>
                            <div class="ai-style-option" data-value="oil_painting">油画</div>
                            <div class="ai-style-option" data-value="chinese_painting">工笔画</div>
                            <div class="ai-style-option" data-value="ink_wash">水墨画</div>
                            <div class="ai-style-option" data-value="ukiyo_e">浮世绘</div>
                        </div>
                        <div class="ai-style-group">
                            <div class="ai-style-group-title">海报风格</div>
                            <div class="ai-style-option" data-value="huanghai_poster">黄海</div>
                            <div class="ai-style-option" data-value="marvel_poster">漫威</div>
                            <div class="ai-style-option" data-value="saul_bass">索尔·巴斯</div>
                            <div class="ai-style-option" data-value="drew_struzan">德鲁·斯特鲁赞</div>
                            <div class="ai-style-option" data-value="minimalist_poster">极简海报</div>
                        </div>
                        <div class="ai-style-group">
                            <div class="ai-style-group-title">电影风格</div>
                            <div class="ai-style-option" data-value="zhang_yimou">张艺谋</div>
                            <div class="ai-style-option" data-value="xu_ke">徐克</div>
                            <div class="ai-style-option" data-value="wong_kar_wai">王家卫</div>
                            <div class="ai-style-option" data-value="wes_anderson">韦斯·安德森</div>
                            <div class="ai-style-option" data-value="christopher_nolan">诺兰</div>
                            <div class="ai-style-option" data-value="tim_burton">蒂姆·伯顿</div>
                            <div class="ai-style-option" data-value="quentin_tarantino">昆汀</div>
                            <div class="ai-style-option" data-value="ridley_scott">雷德利·斯科特</div>
                        </div>
                        <div class="ai-style-group">
                            <div class="ai-style-group-title">现代风格</div>
                            <div class="ai-style-option" data-value="flat_illustration">扁平插画</div>
                            <div class="ai-style-option" data-value="cyberpunk">赛博朋克</div>
                            <div class="ai-style-option" data-value="vaporwave">蒸汽波</div>
                        </div>
                        <div class="ai-style-group">
                            <div class="ai-style-group-title">经典艺术</div>
                            <div class="ai-style-option" data-value="impressionism">印象派</div>
                            <div class="ai-style-option" data-value="van_gogh">梵高风格</div>
                            <div class="ai-style-option" data-value="monet">莫奈风格</div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(this.element);

        // 初始化文字风格选择器
        this.textStyleSelector = this.element.querySelector('.ai-text-style-selector');
        this.textStyleCurrent = this.textStyleSelector.querySelector('.ai-style-current');
        this.textStyleDropdown = this.textStyleSelector.querySelector('.ai-style-dropdown');
        this.textStyleOptions = this.textStyleSelector.querySelectorAll('.ai-style-option');
        this.currentTextStyleValue = 'balanced';

        // 初始化图片风格选择器
        this.imageStyleSelector = this.element.querySelector('.ai-image-style-selector');
        this.imageStyleCurrent = this.imageStyleSelector.querySelector('.ai-style-current');
        this.imageStyleDropdown = this.imageStyleSelector.querySelector('.ai-style-dropdown');
        this.imageStyleOptions = this.imageStyleSelector.querySelectorAll('.ai-style-option');
        this.currentImageStyleValue = 'ghibli';

        this.loadCurrentStyle();
        this.bindEvents();
    }

    /**
     * 绑定事件
     */
    bindEvents() {
        // 文字风格选择器点击切换下拉
        if (this.textStyleSelector) {
            this.textStyleSelector.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.captureSelectionRange();
                this.deferRestoreSelectionRange();
                this.toggleDropdown(this.textStyleDropdown);
            });
        }

        // 文字风格选项点击
        this.textStyleOptions.forEach(option => {
            option.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.captureSelectionRange();
                this.deferRestoreSelectionRange();
                const value = option.dataset.value;
                const text = option.textContent;
                this.selectStyle('text', value, text);
            });
        });

        // 图片风格选择器点击切换下拉
        if (this.imageStyleSelector) {
            this.imageStyleSelector.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.captureSelectionRange();
                this.deferRestoreSelectionRange();
                this.toggleDropdown(this.imageStyleDropdown);
            });
        }

        // 图片风格选项点击
        this.imageStyleOptions.forEach(option => {
            option.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.captureSelectionRange();
                this.deferRestoreSelectionRange();
                const value = option.dataset.value;
                const text = option.textContent;
                this.selectStyle('image', value, text);
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
            this.restoreSelectionRange();

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
                const style = this.getCurrentStyle(action);
                this.onActionClick(action, style);
            }
        });

        // 点击外部区域关闭（延迟到 pointerup，避免把拖动误判为点击）
        this.pendingOutsideClose = null;
        this.documentPointerDownHandler = (e) => {
            if (!this.isVisible) return;

            // 忽略右键
            if (e.button === 2) {
                return;
            }

            const isInsideToolbar = this.element.contains(e.target);

            if (isInsideToolbar) {
                // 点击在工具栏内部时仅处理下拉菜单状态
                const isInTextSelector = this.textStyleSelector && this.textStyleSelector.contains(e.target);
                const isInImageSelector = this.imageStyleSelector && this.imageStyleSelector.contains(e.target);

                if (!isInTextSelector && !isInImageSelector) {
                    this.closeAllDropdowns();
                }
                this.clearPendingOutsideClose();
                return;
            }

            // 记录一次可能的外部点击，等待 pointerup 时再决定是否关闭
            this.pendingOutsideClose = {
                pointerId: e.pointerId,
                startX: e.clientX,
                startY: e.clientY,
                moved: false
            };
        };

        this.documentPointerMoveHandler = (e) => {
            if (!this.pendingOutsideClose) return;
            if (e.pointerId !== this.pendingOutsideClose.pointerId) return;

            const deltaX = Math.abs(e.clientX - this.pendingOutsideClose.startX);
            const deltaY = Math.abs(e.clientY - this.pendingOutsideClose.startY);

            if (deltaX > 2 || deltaY > 2) {
                this.pendingOutsideClose.moved = true;
            }
        };

        this.documentPointerUpHandler = (e) => {
            if (!this.pendingOutsideClose) return;
            if (e.pointerId !== this.pendingOutsideClose.pointerId) return;

            const moved = this.pendingOutsideClose.moved;
            this.clearPendingOutsideClose();

            // 如果 pointerdown 之后没有明显拖动，视为真正的点击
            if (!moved) {
                this.closeAllDropdowns();
                this.hide();
            }
        };

        document.addEventListener('pointerdown', this.documentPointerDownHandler, true);
        document.addEventListener('pointermove', this.documentPointerMoveHandler, true);
        document.addEventListener('pointerup', this.documentPointerUpHandler, true);
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
            this.captureSelectionRange();
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
        this.captureSelectionRange();
    }

    /**
     * 隐藏工具栏
     */
    hide() {
        if (!this.element) return;

        this.element.classList.remove('is-visible');
        this.isVisible = false;
        this.closeAllDropdowns();
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
    toggleDropdown(dropdown) {
        const isOpen = dropdown.classList.contains('is-open');
        if (isOpen) {
            dropdown.classList.remove('is-open');
        } else {
            // 先关闭其他下拉
            this.closeAllDropdowns();
            dropdown.classList.add('is-open');
        }
    }

    /**
     * 关闭所有下拉菜单
     */
    closeAllDropdowns() {
        if (this.textStyleDropdown) {
            this.textStyleDropdown.classList.remove('is-open');
        }
        if (this.imageStyleDropdown) {
            this.imageStyleDropdown.classList.remove('is-open');
        }
    }

    /**
     * 选择风格
     */
    selectStyle(type, value, text) {
        if (type === 'text') {
            this.currentTextStyleValue = value;
            this.textStyleCurrent.textContent = text;
            this.deferRestoreSelectionRange();

            // 更新选中状态
            this.textStyleOptions.forEach(opt => {
                if (opt.dataset.value === value) {
                    opt.classList.add('is-selected');
                } else {
                    opt.classList.remove('is-selected');
                }
            });

            this.saveCurrentStyle('text', value);
            this.textStyleDropdown.classList.remove('is-open');
        } else if (type === 'image') {
            this.currentImageStyleValue = value;
            this.imageStyleCurrent.textContent = text;
            this.deferRestoreSelectionRange();

            // 更新选中状态
            this.imageStyleOptions.forEach(opt => {
                if (opt.dataset.value === value) {
                    opt.classList.add('is-selected');
                } else {
                    opt.classList.remove('is-selected');
                }
            });

            this.saveCurrentStyle('image', value);
            this.imageStyleDropdown.classList.remove('is-open');
        }
    }

    /**
     * 加载当前风格设置
     */
    loadCurrentStyle() {
        try {
            // 加载文字风格
            let textStyle = localStorage.getItem('ai-output-style-text');
            if (!textStyle) {
                const aiConfig = JSON.parse(localStorage.getItem('ai-config') || '{}');
                textStyle = aiConfig.preferences?.outputStyle || 'balanced';
            }

            const textOption = Array.from(this.textStyleOptions).find(opt => opt.dataset.value === textStyle);
            if (textOption) {
                this.selectStyle('text', textStyle, textOption.textContent);
            } else {
                this.selectStyle('text', 'balanced', '平衡');
            }

            // 加载图片风格
            let imageStyle = localStorage.getItem('ai-output-style-image');
            if (!imageStyle) {
                imageStyle = 'ghibli';
            }

            const imageOption = Array.from(this.imageStyleOptions).find(opt => opt.dataset.value === imageStyle);
            if (imageOption) {
                this.selectStyle('image', imageStyle, imageOption.textContent);
            } else {
                this.selectStyle('image', 'ghibli', '吉卜力');
            }
        } catch (error) {
            console.warn('[SelectionToolbar] 加载风格设置失败:', error);
            this.selectStyle('text', 'balanced', '平衡');
            this.selectStyle('image', 'ghibli', '吉卜力');
        }
    }

    /**
     * 保存当前风格设置
     */
    saveCurrentStyle(type, style) {
        try {
            if (type === 'text') {
                localStorage.setItem('ai-output-style-text', style);
                console.log('[SelectionToolbar] 文字风格已切换为:', style);
            } else if (type === 'image') {
                localStorage.setItem('ai-output-style-image', style);
                console.log('[SelectionToolbar] 图片风格已切换为:', style);
            }
        } catch (error) {
            console.warn('[SelectionToolbar] 保存风格设置失败:', error);
        }
    }

    /**
     * 获取当前选择的风格
     */
    getCurrentStyle(action) {
        // 图片任务使用图片风格
        if (action === 'illustration' || action === 'storyboard') {
            return this.currentImageStyleValue || 'ghibli';
        }
        // 特殊格式任务不使用风格
        const specialActions = ['compress', 'summarize', 'translate', 'brainstorm', 'podcast_solo', 'podcast_duo'];
        if (specialActions.includes(action)) {
            return null;
        }
        // 其他文字任务使用文字风格
        return this.currentTextStyleValue || 'balanced';
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
        if (this.documentPointerDownHandler) {
            document.removeEventListener('pointerdown', this.documentPointerDownHandler, true);
            this.documentPointerDownHandler = null;
        }
        if (this.documentPointerMoveHandler) {
            document.removeEventListener('pointermove', this.documentPointerMoveHandler, true);
            this.documentPointerMoveHandler = null;
        }
        if (this.documentPointerUpHandler) {
            document.removeEventListener('pointerup', this.documentPointerUpHandler, true);
            this.documentPointerUpHandler = null;
        }

        if (this.element && this.element.parentNode) {
            this.element.parentNode.removeChild(this.element);
            this.element = null;
        }

        this.editor = null;
        this.onActionClick = null;

        if (this.restoreSelectionRaf) {
            cancelAnimationFrame(this.restoreSelectionRaf);
            this.restoreSelectionRaf = null;
        }
    }

    /**
     * 清理外部点击的临时状态
     */
    clearPendingOutsideClose() {
        this.pendingOutsideClose = null;
    }

    /**
     * 记录当前编辑器选区，供需要时恢复
     */
    captureSelectionRange() {
        if (!this.editor?.editor?.state?.selection) {
            return;
        }
        const tiptapSelection = this.editor.editor.state.selection;
        if (!tiptapSelection || tiptapSelection.empty) {
            return;
        }
        this.lastSelectionRange = {
            from: tiptapSelection.from,
            to: tiptapSelection.to
        };
    }

    /**
     * 恢复之前记录的编辑器选区
     */
    restoreSelectionRange() {
        if (!this.lastSelectionRange || !this.editor?.editor?.chain) {
            return;
        }

        const { from, to } = this.lastSelectionRange;
        if (typeof from !== 'number' || typeof to !== 'number') {
            return;
        }

        this.editor.editor.chain().focus().setTextSelection({ from, to }).run();
    }

    /**
     * 延迟恢复选区，保证在本次交互完成后重新选中
     */
    deferRestoreSelectionRange() {
        if (!this.lastSelectionRange) {
            return;
        }

        if (this.restoreSelectionRaf) {
            cancelAnimationFrame(this.restoreSelectionRaf);
        }

        this.restoreSelectionRaf = requestAnimationFrame(() => {
            this.restoreSelectionRaf = null;
            this.restoreSelectionRange();
        });
    }
}
