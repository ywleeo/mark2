import { addClickHandler } from '../utils/PointerHelper.js';

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
        this.closeButtonCleanup = null;
        this.updateDebounceTimer = null;
        this.scrollContainer = null;
        this.scrollHandler = null;
        this.updateInterval = null;
        this.ignoreScrollUpdate = false;
    }

    /**
     * 设置编辑器实例
     * @param {Object} editor - Tiptap 编辑器实例
     */
    setEditor(editor) {
        this.editor = editor;
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
            <span class="toc-panel__title">目录</span>
            <button class="toc-panel__close" type="button" aria-label="关闭目录">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z" />
                </svg>
            </button>
        `;

        // 目录内容容器
        const content = document.createElement('div');
        content.className = 'toc-panel__content';

        // 空状态提示
        const empty = document.createElement('div');
        empty.className = 'toc-panel__empty';
        empty.textContent = '当前文档无标题';

        container.appendChild(header);
        container.appendChild(content);
        container.appendChild(empty);

        // 绑定关闭按钮事件
        const closeBtn = header.querySelector('.toc-panel__close');
        this.closeButtonCleanup = addClickHandler(closeBtn, () => {
            this.hide();
        });

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
        parent.appendChild(this.container);

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

        const headings = [];
        const doc = this.editor.state.doc;

        doc.descendants((node, pos) => {
            if (node.type.name === 'heading' && node.attrs.level <= 3) {
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
        if (!this.container) return;

        this.headings = this.extractHeadings();

        const content = this.container.querySelector('.toc-panel__content');
        const empty = this.container.querySelector('.toc-panel__empty');

        if (this.headings.length === 0) {
            content.innerHTML = '';
            empty.style.display = 'flex';
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
        const headingElements = editorElement.querySelectorAll('h1, h2, h3');

        // 找到对应的标题元素
        let targetElement = null;
        let currentIndex = 0;

        for (const el of headingElements) {
            const level = parseInt(el.tagName.substring(1));
            if (level <= 3) {
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

        const headingElements = editorElement.querySelectorAll('h1, h2, h3');
        const scrollTop = this.scrollContainer.scrollTop;

        // 找到当前滚动位置之前最后一个标题
        let activeIndex = -1;
        let currentIndex = 0;

        for (const el of headingElements) {
            const level = parseInt(el.tagName.substring(1));
            if (level <= 3) {
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

        this.isVisible = true;
        this.container.style.display = 'flex';
        this.render();

        // 触发重排以启动过渡动画
        this.container.offsetHeight;
        this.container.classList.add('toc-panel--visible');

        // 启动定期更新（每2秒检查一次内容变化）
        this.startAutoUpdate();
    }

    /**
     * 隐藏目录面板
     */
    hide() {
        if (!this.container) return;

        this.isVisible = false;
        this.container.classList.remove('toc-panel--visible');

        // 停止自动更新
        this.stopAutoUpdate();

        // 等待过渡动画完成后隐藏
        setTimeout(() => {
            if (!this.isVisible) {
                this.container.style.display = 'none';
            }
        }, 200);
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
            if (this.isVisible) {
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

    /**
     * 销毁面板
     */
    destroy() {
        // 停止自动更新
        this.stopAutoUpdate();

        // 清理滚动事件
        if (this.scrollContainer && this.scrollHandler) {
            this.scrollContainer.removeEventListener('scroll', this.scrollHandler);
        }

        // 清理关闭按钮事件
        if (this.closeButtonCleanup && typeof this.closeButtonCleanup === 'function') {
            this.closeButtonCleanup();
            this.closeButtonCleanup = null;
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

        // 移除 DOM
        if (this.container && this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }

        this.container = null;
        this.editor = null;
    }
}
