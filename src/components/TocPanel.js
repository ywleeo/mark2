import { addClickHandler } from '../utils/PointerHelper.js';
import { t } from '../i18n/index.js';

/**
 * 目录面板组件
 * 提供浮动的 Markdown 文档大纲功能
 */
export class TocPanel {
    constructor() {
        this.container = null;
        this.editor = null;
        this.isVisible = false;
        this.headings = [];
        this.activeHeadingId = null;
        this.clickCleanups = [];
        this.updateDebounceTimer = null;
        this.scrollContainer = null;
        this.scrollHandler = null;
        this.updateInterval = null;
        this.ignoreScrollUpdate = false;
        this.currentWarning = null;
        this.warningTimeout = null;
        this.isDirty = true;
        this.editorUpdateHandler = null;
        this.resizeCleanup = null;
    }

    /**
     * 设置编辑器实例
     * @param {Object} editor - Tiptap 编辑器实例
     */
    setEditor(editor) {
        if (this.editor && this.editorUpdateHandler && typeof this.editor.off === 'function') {
            this.editor.off('update', this.editorUpdateHandler);
        }
        this.editor = editor;
        if (this.editor && typeof this.editor.on === 'function') {
            this.editorUpdateHandler = () => {
                this.markDirty();
            };
            this.editor.on('update', this.editorUpdateHandler);
        }
        this.markDirty();
    }

    /**
     * 创建目录面板容器
     * @returns {HTMLElement}
     */
    createContainer() {
        const container = document.createElement('div');
        container.className = 'toc-panel';
        container.style.display = 'none';

        // 头部
        const header = document.createElement('div');
        header.className = 'toc-panel__header';
        header.innerHTML = `
            <span class="toc-panel__title">${t('toc.title')}</span>
        `;

        // 目录内容容器
        const content = document.createElement('div');
        content.className = 'toc-panel__content';

        // 空状态提示
        const empty = document.createElement('div');
        empty.className = 'toc-panel__empty';
        empty.textContent = t('toc.empty');

        // 拖拽调整宽度的手柄
        const resizer = document.createElement('div');
        resizer.className = 'toc-panel__resizer';

        container.appendChild(resizer);
        container.appendChild(header);
        container.appendChild(content);
        container.appendChild(empty);

        return container;
    }

    /**
     * 初始化面板
     * @param {HTMLElement} parent - 父容器元素
     */
    init(parent) {
        if (!parent) {
            throw new Error('TocPanel requires a parent element');
        }

        this.container = this.createContainer();

        // 挂载到 #contentArea 作为 content-main 的右侧兄弟
        const contentArea = document.getElementById('contentArea');
        if (contentArea) {
            contentArea.appendChild(this.container);
        } else {
            parent.appendChild(this.container);
        }

        // 恢复保存的宽度
        const savedWidth = localStorage.getItem('toc-panel-width');
        if (savedWidth) {
            this.container.style.flexBasis = savedWidth + 'px';
        }

        // 绑定拖拽调整宽度
        this.resizeCleanup = this.setupResize();

        // 绑定滚动事件
        this.bindScrollEvent();
    }

    /**
     * 绑定滚动事件，用于高亮当前可见的标题
     */
    bindScrollEvent() {
        // 查找 Markdown 面板的滚动容器
        const markdownPane = document.querySelector('.markdown-pane');
        if (!markdownPane) return;

        this.scrollContainer = markdownPane;

        this.scrollHandler = this.debounce(() => {
            this.updateActiveHeading();
        }, 100);

        this.scrollContainer.addEventListener('scroll', this.scrollHandler);
    }

    /**
     * 设置拖拽调整宽度
     */
    setupResize() {
        const resizer = this.container.querySelector('.toc-panel__resizer');
        if (!resizer) return null;

        const MIN_WIDTH = 140;
        const MAX_WIDTH = 400;
        let startX = 0;
        let startWidth = 0;
        let pointerId = null;

        const stop = (e) => {
            if (pointerId === null || e.pointerId !== pointerId) return;
            if (resizer.hasPointerCapture(pointerId)) {
                resizer.releasePointerCapture(pointerId);
            }
            pointerId = null;
            document.body.classList.remove('toc-resizing');
            document.body.style.userSelect = '';
            localStorage.setItem('toc-panel-width', this.container.getBoundingClientRect().width);
        };

        const onDown = (e) => {
            if (pointerId !== null) return;
            startX = e.clientX;
            startWidth = this.container.getBoundingClientRect().width;
            pointerId = e.pointerId;
            resizer.setPointerCapture(pointerId);
            document.body.classList.add('toc-resizing');
            document.body.style.userSelect = 'none';
            e.preventDefault();
        };

        const onMove = (e) => {
            if (pointerId === null || e.pointerId !== pointerId) return;
            // 向左拖 = 变宽（因为面板在右侧）
            const delta = startX - e.clientX;
            const next = Math.min(Math.max(MIN_WIDTH, startWidth + delta), MAX_WIDTH);
            this.container.style.flexBasis = next + 'px';
        };

        resizer.addEventListener('pointerdown', onDown);
        resizer.addEventListener('pointermove', onMove);
        resizer.addEventListener('pointerup', stop);
        resizer.addEventListener('pointercancel', stop);

        return () => {
            resizer.removeEventListener('pointerdown', onDown);
            resizer.removeEventListener('pointermove', onMove);
            resizer.removeEventListener('pointerup', stop);
            resizer.removeEventListener('pointercancel', stop);
        };
    }

    /**
     * 防抖函数
     */
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    /**
     * 从编辑器中提取标题
     * @returns {Array} 标题列表
     */
    extractHeadings() {
        if (!this.editor) return [];

        // 检查是否是 Tiptap 编辑器（有 state.doc）
        if (!this.editor.state || !this.editor.state.doc) {
            return [];
        }

        const headings = [];
        const doc = this.editor.state.doc;

        doc.descendants((node, pos) => {
            if (node.type.name === 'heading' && node.attrs.level <= 4) {
                const text = node.textContent;
                if (text.trim()) {
                    // 生成唯一 ID
                    const id = this.generateHeadingId(text, headings.length);

                    headings.push({
                        id,
                        level: node.attrs.level,
                        text,
                        pos
                    });
                }
            }
        });

        return headings;
    }

    /**
     * 生成标题 ID
     * @param {string} text - 标题文本
     * @param {number} index - 索引
     * @returns {string}
     */
    generateHeadingId(text, index) {
        // 简单的 ID 生成策略：使用索引
        return `heading-${index}`;
    }

    /**
     * 渲染目录列表
     */
    render() {
        if (!this.container || !this.isVisible) return;

        this.headings = this.extractHeadings();

        const content = this.container.querySelector('.toc-panel__content');
        const empty = this.container.querySelector('.toc-panel__empty');

        if (this.headings.length === 0) {
            content.innerHTML = '';
            empty.style.display = 'flex';
            this.isDirty = false;
            return;
        }

        empty.style.display = 'none';

        // 清理之前的点击事件
        this.clickCleanups.forEach(cleanup => {
            if (typeof cleanup === 'function') {
                cleanup();
            }
        });
        this.clickCleanups = [];

        // 创建目录列表
        const list = document.createElement('div');
        list.className = 'toc-panel__list';

        this.headings.forEach((heading, index) => {
            const item = document.createElement('a');
            item.className = `toc-panel__item toc-panel__item--level${heading.level}`;
            item.setAttribute('data-heading-id', heading.id);
            item.setAttribute('data-heading-index', index);
            item.textContent = heading.text;

            const cleanup = addClickHandler(item, (e) => {
                e.preventDefault();
                this.scrollToHeading(index);
            });

            if (cleanup) {
                this.clickCleanups.push(cleanup);
            }

            list.appendChild(item);
        });

        content.innerHTML = '';
        content.appendChild(list);
        this.isDirty = false;
    }

    /**
     * 滚动到指定标题
     * @param {number} index - 标题索引
     */
    scrollToHeading(index) {
        if (!this.editor || !this.headings[index]) return;

        const heading = this.headings[index];
        const editorElement = this.editor.view?.dom;

        if (!editorElement || !this.scrollContainer) return;

        // 获取编辑器中对应的 DOM 元素
        const headingElements = editorElement.querySelectorAll('h1, h2, h3, h4');

        // 找到对应的标题元素
        let targetElement = null;
        let currentIndex = 0;

        for (const el of headingElements) {
            const level = parseInt(el.tagName.substring(1));
            if (level <= 4) {
                if (currentIndex === index) {
                    targetElement = el;
                    break;
                }
                currentIndex++;
            }
        }

        if (targetElement) {
            // 暂时禁用滚动更新，避免冲突
            this.ignoreScrollUpdate = true;

            // 先立即设置高亮
            this.setActiveHeading(heading.id);

            // 计算目标元素相对于滚动容器的位置
            // 需要计算从 targetElement 到 scrollContainer 的累计偏移
            let offsetTop = 0;
            let element = targetElement;

            while (element && element !== this.scrollContainer) {
                offsetTop += element.offsetTop;
                element = element.offsetParent;
            }

            // 滚动到目标位置（留出顶部空间）
            const scrollTop = offsetTop - 80;
            this.scrollContainer.scrollTo({
                top: scrollTop,
                behavior: 'smooth'
            });

            // 滚动完成后恢复自动更新（使用较长延迟确保滚动完成）
            setTimeout(() => {
                this.ignoreScrollUpdate = false;
            }, 800);
        }
    }

    /**
     * 更新当前激活的标题（根据滚动位置）
     */
    updateActiveHeading() {
        // 如果正在处理点击滚动，暂时跳过自动更新
        if (this.ignoreScrollUpdate) return;

        if (!this.scrollContainer || this.headings.length === 0) return;

        const editorElement = this.editor?.view?.dom;
        if (!editorElement) return;

        const headingElements = editorElement.querySelectorAll('h1, h2, h3, h4');
        const scrollTop = this.scrollContainer.scrollTop;

        // 找到当前滚动位置之前最后一个标题
        let activeIndex = -1;
        let currentIndex = 0;

        for (const el of headingElements) {
            const level = parseInt(el.tagName.substring(1));
            if (level <= 4) {
                // 计算元素相对于滚动容器的累计偏移
                let offsetTop = 0;
                let element = el;

                while (element && element !== this.scrollContainer) {
                    offsetTop += element.offsetTop;
                    element = element.offsetParent;
                }

                // 如果标题在当前滚动位置之上（加一些缓冲区）
                if (offsetTop - 100 <= scrollTop) {
                    activeIndex = currentIndex;
                } else {
                    // 已经超过滚动位置，停止查找
                    break;
                }

                currentIndex++;
            }
        }

        if (activeIndex >= 0 && this.headings[activeIndex]) {
            this.setActiveHeading(this.headings[activeIndex].id);
        } else if (scrollTop < 50) {
            // 滚动到顶部时，取消所有高亮
            this.setActiveHeading(null);
        }
    }

    /**
     * 设置激活的标题
     * @param {string|null} headingId - 标题 ID
     */
    setActiveHeading(headingId) {
        if (this.activeHeadingId === headingId) return;

        this.activeHeadingId = headingId;

        if (!this.container) return;

        // 移除之前的激活状态
        const items = this.container.querySelectorAll('.toc-panel__item');
        items.forEach(item => {
            item.classList.remove('toc-panel__item--active');
        });

        // 添加新的激活状态
        if (headingId) {
            const activeItem = this.container.querySelector(`[data-heading-id="${headingId}"]`);
            if (activeItem) {
                activeItem.classList.add('toc-panel__item--active');

                // 确保激活项在视口内
                const content = this.container.querySelector('.toc-panel__content');
                if (content) {
                    const itemTop = activeItem.offsetTop;
                    const itemHeight = activeItem.offsetHeight;
                    const contentScrollTop = content.scrollTop;
                    const contentHeight = content.clientHeight;

                    if (itemTop < contentScrollTop) {
                        content.scrollTop = itemTop - 10;
                    } else if (itemTop + itemHeight > contentScrollTop + contentHeight) {
                        content.scrollTop = itemTop + itemHeight - contentHeight + 10;
                    }
                }
            }
        }
    }

    /**
     * 显示目录面板
     */
    show() {
        if (!this.container) return;

        // 检查是否在 Markdown 编辑模式（Tiptap）
        const isTiptapMode = this.editor && this.editor.state && this.editor.state.doc;

        if (!isTiptapMode) {
            // 在代码模式下显示提示
            this.showModeWarning();
            return;
        }

        this.isVisible = true;
        this.container.style.display = 'flex';
        this.markDirty();
        this.scheduleRender();

        // 更新状态栏按钮状态
        document.getElementById('statusBarToc')?.classList.add('is-active');

        // 启动定期更新（每2秒检查一次内容变化）
        this.startAutoUpdate();
    }

    /**
     * 显示模式警告提示
     */
    showModeWarning() {
        // 如果已经有警告存在，先移除
        if (this.currentWarning) {
            this.removeWarning();
        }

        // 创建临时提示元素
        this.currentWarning = document.createElement('div');
        this.currentWarning.className = 'toc-mode-warning';
        this.currentWarning.textContent = t('toc.warningPreviewOnly');

        // 添加到页面
        document.body.appendChild(this.currentWarning);

        // 触发动画
        setTimeout(() => {
            if (this.currentWarning) {
                this.currentWarning.classList.add('toc-mode-warning--visible');
            }
        }, 10);

        // 2秒后移除
        this.warningTimeout = setTimeout(() => {
            this.removeWarning();
        }, 2000);
    }

    /**
     * 移除警告提示
     */
    removeWarning() {
        // 清除定时器
        if (this.warningTimeout) {
            clearTimeout(this.warningTimeout);
            this.warningTimeout = null;
        }

        // 移除元素
        if (this.currentWarning) {
            this.currentWarning.classList.remove('toc-mode-warning--visible');

            setTimeout(() => {
                if (this.currentWarning && this.currentWarning.parentNode) {
                    this.currentWarning.parentNode.removeChild(this.currentWarning);
                }
                this.currentWarning = null;
            }, 200);
        }
    }

    /**
     * 隐藏目录面板
     */
    hide() {
        if (!this.container) return;

        this.isVisible = false;
        this.container.style.display = 'none';

        // 更新状态栏按钮状态
        document.getElementById('statusBarToc')?.classList.remove('is-active');

        // 停止自动更新
        this.stopAutoUpdate();
    }

    /**
     * 切换显示/隐藏
     */
    toggle() {
        if (this.isVisible) {
            this.hide();
        } else {
            this.show();
        }
    }

    /**
     * 启动自动更新
     */
    startAutoUpdate() {
        // 清除可能存在的旧定时器
        this.stopAutoUpdate();

        // 每2秒检查一次内容变化并更新目录
        this.updateInterval = setInterval(() => {
            if (!this.isVisible) return;
            if (this.isDirty) {
                this.render();
            }
        }, 2000);
    }

    /**
     * 停止自动更新
     */
    stopAutoUpdate() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
    }

    markDirty() {
        this.isDirty = true;
        if (this.isVisible) {
            this.scheduleRender();
        }
    }

    scheduleRender() {
        if (this.updateDebounceTimer) {
            return;
        }
        this.updateDebounceTimer = setTimeout(() => {
            this.updateDebounceTimer = null;
            if (this.isVisible && this.isDirty) {
                this.render();
            }
        }, 200);
    }

    /**
     * 销毁面板
     */
    destroy() {
        // 停止自动更新
        this.stopAutoUpdate();

        // 清理警告提示
        this.removeWarning();

        // 清理拖拽事件
        if (this.resizeCleanup) {
            this.resizeCleanup();
            this.resizeCleanup = null;
        }

        // 清理滚动事件
        if (this.scrollContainer && this.scrollHandler) {
            this.scrollContainer.removeEventListener('scroll', this.scrollHandler);
        }

        // 清理目录项点击事件
        this.clickCleanups.forEach(cleanup => {
            if (typeof cleanup === 'function') {
                cleanup();
            }
        });
        this.clickCleanups = [];

        // 清理定时器
        if (this.updateDebounceTimer) {
            clearTimeout(this.updateDebounceTimer);
        }
        if (this.editor && this.editorUpdateHandler && typeof this.editor.off === 'function') {
            this.editor.off('update', this.editorUpdateHandler);
        }
        this.editorUpdateHandler = null;

        // 移除 DOM
        if (this.container && this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }

        this.container = null;
        this.editor = null;
    }
}
