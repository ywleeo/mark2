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
        // 创建临时 DOM 来安全处理
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;
        
        // 遍历文本节点进行替换
        this.replaceInTextNodes(tempDiv, searchText, replacement);
        
        return tempDiv.innerHTML;
    }

    /**
     * 在文本节点中替换内容
     */
    replaceInTextNodes(element, searchText, replacement) {
        const walker = document.createTreeWalker(
            element,
            NodeFilter.SHOW_TEXT,
            null,
            false
        );
        
        const textNodes = [];
        let node;
        while (node = walker.nextNode()) {
            textNodes.push(node);
        }
        
        textNodes.forEach(textNode => {
            if (textNode.parentElement.tagName !== 'MARK') { // 避免重复高亮
                const text = textNode.textContent;
                if (text.includes(searchText)) {
                    const newHTML = text.replace(
                        new RegExp(this.escapeRegex(searchText), 'gi'),
                        replacement
                    );
                    if (newHTML !== text) {
                        const tempSpan = document.createElement('span');
                        tempSpan.innerHTML = newHTML;
                        while (tempSpan.firstChild) {
                            textNode.parentNode.insertBefore(tempSpan.firstChild, textNode);
                        }
                        textNode.remove();
                    }
                }
            }
        });
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