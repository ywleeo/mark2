/**
 * 平台 API
 * 为插件提供通用的基础能力
 */

class PlatformAPI {
    constructor() {
        this.dynamicStyles = new Map(); // 存储动态添加的样式
        this.setupStyleSystem();
    }

    /**
     * 设置样式系统
     */
    setupStyleSystem() {
        // 创建动态样式表
        if (!document.getElementById('plugin-styles')) {
            const styleSheet = document.createElement('style');
            styleSheet.id = 'plugin-styles';
            document.head.appendChild(styleSheet);
        }
        
        // 加载平台UI样式
        this.loadPlatformUIStyles();
    }
    
    /**
     * 加载平台UI样式
     */
    loadPlatformUIStyles() {
        // 基础样式
        if (!document.getElementById('platform-ui-base')) {
            const baseLink = document.createElement('link');
            baseLink.id = 'platform-ui-base';
            baseLink.rel = 'stylesheet';
            baseLink.href = 'styles/platform-ui.css';
            document.head.appendChild(baseLink);
        }
        
        // 主题样式
        this.updatePlatformUITheme();
    }
    
    /**
     * 更新平台UI主题
     */
    updatePlatformUITheme() {
        const isDark = this.isDarkTheme();
        const themeId = 'platform-ui-theme';
        
        // 移除现有主题
        const existingTheme = document.getElementById(themeId);
        if (existingTheme) {
            existingTheme.remove();
        }
        
        // 添加新主题
        const themeLink = document.createElement('link');
        themeLink.id = themeId;
        themeLink.rel = 'stylesheet';
        themeLink.href = isDark ? 'styles/platform-ui-dark.css' : 'styles/platform-ui-light.css';
        document.head.appendChild(themeLink);
    }

    /**
     * 基础高亮函数
     * @param {string} text - 要高亮的文本
     * @param {string} className - CSS 类名
     * @returns {string} - 高亮后的 HTML
     */
    highlight(text, className) {
        return `<mark class="${className}">${this.escapeHtml(text)}</mark>`;
    }

    /**
     * 批量高亮函数
     * @param {string} html - HTML 内容
     * @param {Array} highlights - 高亮配置数组 [{text, className}, ...]
     * @returns {string} - 处理后的 HTML
     */
    batchHighlight(html, highlights) {
        let result = html;
        
        // 按文本长度排序，先处理长文本避免冲突
        highlights.sort((a, b) => b.text.length - a.text.length);
        
        highlights.forEach(({ text, className }) => {
            if (text && text.length > 0) {
                result = this.replaceInHTML(result, text, this.highlight(text, className));
            }
        });
        
        return result;
    }

    /**
     * 在 HTML 中替换文本（安全替换，避免破坏 HTML 结构）
     * @param {string} html - HTML 内容
     * @param {string} searchText - 搜索文本
     * @param {string} replacement - 替换文本
     * @returns {string} - 替换后的 HTML
     */
    replaceInHTML(html, searchText, replacement) {
        // 创建临时DOM容器
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;
        
        // 安全地替换文本节点
        this.safeReplaceTextNodes(tempDiv, searchText, replacement);
        
        return tempDiv.innerHTML;
    }

    /**
     * 安全的文本节点替换方法
     * 确保不破坏任何HTML结构
     */
    safeReplaceTextNodes(element, searchText, replacement) {
        // 收集所有文本节点
        const textNodes = [];
        const walker = document.createTreeWalker(
            element,
            NodeFilter.SHOW_TEXT,
            null,
            false
        );
        
        let node;
        while (node = walker.nextNode()) {
            // 跳过已经在mark标签内的文本
            if (!this.isInsideMarkTag(node)) {
                textNodes.push(node);
            }
        }
        
        // 对每个文本节点进行替换
        textNodes.forEach(textNode => {
            const text = textNode.textContent;
            if (text.includes(searchText)) {
                // 使用分割+重建的方法，避免innerHTML破坏结构
                this.replaceTextNodeContent(textNode, searchText, replacement);
            }
        });
    }
    
    /**
     * 检查节点是否在mark标签内
     */
    isInsideMarkTag(node) {
        let parent = node.parentElement;
        while (parent) {
            if (parent.tagName === 'MARK') {
                return true;
            }
            parent = parent.parentElement;
        }
        return false;
    }

    
    /**
     * 替换文本节点内容，保持父元素结构不变
     */
    replaceTextNodeContent(textNode, searchText, replacement) {
        const text = textNode.textContent;
        const regex = new RegExp(this.escapeRegex(searchText), 'gi');
        
        // 如果没有匹配，直接返回
        if (!regex.test(text)) {
            return;
        }
        
        // 重置regex
        regex.lastIndex = 0;
        
        // 分割文本
        const parts = text.split(regex);
        const matches = text.match(regex) || [];
        
        // 关键修复：检查父元素是否只有这一个文本节点
        const parentElement = textNode.parentElement;
        const isOnlyChild = parentElement && parentElement.childNodes.length === 1 && parentElement.childNodes[0] === textNode;
        
        if (isOnlyChild) {
            // 如果是唯一子节点，直接设置父元素的innerHTML
            const newHTML = text.replace(regex, replacement);
            parentElement.innerHTML = newHTML;
        } else {
            // 如果不是唯一子节点，创建文档片段进行替换
            const fragment = document.createDocumentFragment();
            
            for (let i = 0; i < parts.length; i++) {
                if (parts[i]) {
                    fragment.appendChild(document.createTextNode(parts[i]));
                }
                
                if (i < matches.length) {
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = replacement;
                    while (tempDiv.firstChild) {
                        fragment.appendChild(tempDiv.firstChild);
                    }
                }
            }
            
            textNode.parentNode.replaceChild(fragment, textNode);
        }
    }

    /**
     * 结构感知的文本替换算法（已弃用）
     * 确保不破坏 HTML 标签结构
     */
    structureAwareReplace(html, searchText, replacement) {
        // 解析 HTML 为文本片段和标签片段
        const segments = this.parseHTMLSegments(html);
        
        // 只在文本片段中进行替换
        const processedSegments = segments.map(segment => {
            if (segment.type === 'text' && !segment.insideTag) {
                return {
                    ...segment,
                    content: segment.content.replace(
                        new RegExp(this.escapeRegex(searchText), 'gi'),
                        replacement
                    )
                };
            }
            return segment;
        });
        
        // 重新组装 HTML
        return processedSegments.map(segment => segment.content).join('');
    }

    /**
     * 解析 HTML 为结构化片段
     * 将 HTML 分解为文本和标签片段，并标记是否在标签内部
     */
    parseHTMLSegments(html) {
        const segments = [];
        let current = '';
        let inTag = false;
        let inMarkTag = false; // 是否在已有的 mark 标签内
        let markDepth = 0;
        
        for (let i = 0; i < html.length; i++) {
            const char = html[i];
            const remaining = html.slice(i);
            
            if (char === '<') {
                // 遇到标签开始
                if (current.length > 0) {
                    segments.push({
                        type: 'text',
                        content: current,
                        insideTag: inMarkTag
                    });
                    current = '';
                }
                
                inTag = true;
                current = char;
                
                // 检查是否是 mark 标签
                if (remaining.toLowerCase().startsWith('<mark')) {
                    inMarkTag = true;
                    markDepth++;
                } else if (remaining.toLowerCase().startsWith('</mark')) {
                    markDepth--;
                    if (markDepth <= 0) {
                        inMarkTag = false;
                        markDepth = 0;
                    }
                }
            } else if (char === '>' && inTag) {
                // 标签结束
                current += char;
                segments.push({
                    type: 'tag',
                    content: current,
                    insideTag: false
                });
                current = '';
                inTag = false;
            } else {
                current += char;
            }
        }
        
        // 处理最后的内容
        if (current.length > 0) {
            segments.push({
                type: inTag ? 'tag' : 'text',
                content: current,
                insideTag: inMarkTag
            });
        }
        
        return segments;
    }

    /**
     * 在文本节点中替换内容（已弃用，保留兼容性）
     */
    replaceInTextNodes(element, searchText, replacement) {
        // 已替换为 structureAwareReplace，保留此方法以防有其他依赖
        console.warn('replaceInTextNodes 方法已弃用，请使用 structureAwareReplace');
    }

    /**
     * 从 HTML 提取纯文本
     * @param {string} html - HTML 内容
     * @returns {string} - 纯文本内容
     */
    extractText(html) {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;
        return tempDiv.textContent || tempDiv.innerText || '';
    }

    /**
     * 添加 CSS 样式类
     * @param {string} className - CSS 类名
     * @param {Object} styles - 样式对象
     */
    addCSS(className, styles) {
        this.dynamicStyles.set(className, styles);
        this.updateStyleSheet();
    }

    /**
     * 批量添加样式
     * @param {Object} classStyles - 样式映射对象 {className: styles}
     */
    addCSSBatch(classStyles) {
        Object.entries(classStyles).forEach(([className, styles]) => {
            this.dynamicStyles.set(className, styles);
        });
        this.updateStyleSheet();
    }

    /**
     * 更新样式表
     */
    updateStyleSheet() {
        const styleSheet = document.getElementById('plugin-styles');
        if (!styleSheet) return;
        
        let cssText = '';
        this.dynamicStyles.forEach((styles, className) => {
            const styleProps = Object.entries(styles)
                .map(([prop, value]) => `${this.camelToKebab(prop)}: ${value}`)
                .join('; ');
            cssText += `.${className} { ${styleProps} }\n`;
        });
        
        styleSheet.textContent = cssText;
    }

    /**
     * 文本匹配工具
     * @param {string} text - 文本内容
     * @param {RegExp|string} pattern - 匹配模式
     * @returns {Array} - 匹配结果数组
     */
    findMatches(text, pattern) {
        if (typeof pattern === 'string') {
            return text.includes(pattern) ? [pattern] : [];
        }
        return text.match(pattern) || [];
    }

    /**
     * 批量文本匹配
     * @param {string} text - 文本内容  
     * @param {Array} patterns - 匹配模式数组
     * @returns {Array} - 所有匹配结果
     */
    findMatchesAll(text, patterns) {
        let allMatches = [];
        patterns.forEach(pattern => {
            const matches = this.findMatches(text, pattern);
            allMatches.push(...matches);
        });
        return [...new Set(allMatches)]; // 去重
    }

    /**
     * 配置管理
     */
    getConfig(key) {
        try {
            const config = JSON.parse(localStorage.getItem('pluginConfig') || '{}');
            return key ? config[key] : config;
        } catch {
            return key ? undefined : {};
        }
    }

    setConfig(key, value) {
        try {
            const config = this.getConfig();
            config[key] = value;
            localStorage.setItem('pluginConfig', JSON.stringify(config));
        } catch (error) {
            console.warn('设置配置失败:', error);
        }
    }

    /**
     * 工具函数
     */
    escapeHtml(text) {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    escapeRegex(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    camelToKebab(str) {
        return str.replace(/([a-z0-9]|(?=[A-Z]))([A-Z])/g, '$1-$2').toLowerCase();
    }

    /**
     * 事件系统 - 让插件可以通信
     */
    emit(eventName, data) {
        if (window.pluginManager) {
            window.pluginManager.emit(eventName, data);
        }
    }

    on(eventName, handler) {
        if (window.pluginManager) {
            window.pluginManager.on(eventName, handler);
        }
    }

    /**
     * 右键菜单相关API
     */
    
    /**
     * 获取当前选中的文本
     * @returns {string} - 选中的文本
     */
    getSelectedText() {
        const selection = window.getSelection();
        return selection.toString().trim();
    }

    /**
     * 创建右键菜单
     * @param {Array} menuItems - 菜单项数组
     * @param {Object} position - 菜单位置 {x, y}
     * @returns {Element} - 菜单DOM元素
     */
    createContextMenu(menuItems, position) {
        // 移除已存在的菜单
        this.removeContextMenu();

        // 确保主题样式是最新的
        this.updatePlatformUITheme();

        const menu = document.createElement('div');
        menu.id = 'platform-context-menu';
        menu.className = 'context-menu';
        menu.style.left = `${position.x}px`;
        menu.style.top = `${position.y}px`;

        menuItems.forEach((item, index) => {
            if (item.separator) {
                const separator = document.createElement('div');
                separator.className = 'menu-separator';
                menu.appendChild(separator);
            } else {
                const menuItem = document.createElement('div');
                menuItem.className = 'menu-item';
                menuItem.textContent = item.label;
                
                // 点击事件
                if (item.action && typeof item.action === 'function') {
                    menuItem.addEventListener('click', (e) => {
                        e.stopPropagation();
                        item.action();
                        this.removeContextMenu();
                    });
                }
                
                menu.appendChild(menuItem);
            }
        });

        document.body.appendChild(menu);
        
        // 点击其他地方时关闭菜单
        setTimeout(() => {
            document.addEventListener('click', this.removeContextMenu.bind(this));
        }, 0);

        return menu;
    }

    /**
     * 移除右键菜单
     */
    removeContextMenu() {
        const existingMenu = document.getElementById('platform-context-menu');
        if (existingMenu) {
            existingMenu.remove();
            document.removeEventListener('click', this.removeContextMenu.bind(this));
        }
    }

    /**
     * 创建模态窗口
     * @param {Object} options - 窗口配置 {title, content, width, height}
     * @returns {Element} - 模态窗口DOM元素
     */
    createModal(options = {}) {
        const {
            title = '提示',
            content = '',
            width = '400px',
            height = 'auto',
            onClose = null
        } = options;

        // 确保主题样式是最新的
        this.updatePlatformUITheme();

        // 创建遮罩层
        const overlay = document.createElement('div');
        overlay.id = 'platform-modal-overlay';
        overlay.className = 'modal-overlay';

        // 创建模态框
        const modal = document.createElement('div');
        modal.className = 'modal-window';
        modal.style.width = width;
        modal.style.height = height;

        // 创建标题栏
        const header = document.createElement('div');
        header.className = 'modal-header';

        const titleElement = document.createElement('h3');
        titleElement.textContent = title;

        const closeBtn = document.createElement('button');
        closeBtn.className = 'modal-close-btn';
        closeBtn.textContent = '×';

        header.appendChild(titleElement);
        header.appendChild(closeBtn);

        // 创建内容区域
        const body = document.createElement('div');
        body.className = 'modal-body';

        if (typeof content === 'string') {
            body.innerHTML = content;
        } else if (content instanceof Element) {
            body.appendChild(content);
        }

        modal.appendChild(header);
        modal.appendChild(body);
        overlay.appendChild(modal);

        // 关闭事件
        const closeModal = () => {
            overlay.remove();
            if (onClose && typeof onClose === 'function') {
                onClose();
            }
        };

        closeBtn.addEventListener('click', closeModal);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                closeModal();
            }
        });

        // 添加到页面
        document.body.appendChild(overlay);

        return { overlay, modal, body, close: closeModal };
    }

    /**
     * 检测当前主题
     */
    isDarkTheme() {
        // 方法1: 检查 CSS 文件
        const themeCSS = document.getElementById('theme-css');
        if (themeCSS && themeCSS.href) {
            return themeCSS.href.includes('dark-theme.css');
        }
        
        // 方法2: 检查 localStorage
        return localStorage.getItem('theme') === 'dark';
    }


    /**
     * 调试工具
     */
    log(pluginName, message, ...args) {
        console.log(`[${pluginName}]`, message, ...args);
    }

    warn(pluginName, message, ...args) {
        console.warn(`[${pluginName}]`, message, ...args);
    }
}

// 创建全局 API 实例
window.platformAPI = new PlatformAPI();

module.exports = PlatformAPI;