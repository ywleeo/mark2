/**
 * 荧光马克笔插件
 * 将加粗文本渲染为荧光高亮效果
 */

const BasePlugin = require('../BasePlugin');

class BoldHighlighterPlugin extends BasePlugin {
    constructor(pluginConfig) {
        super(pluginConfig);

        // 动态生成的样式配置
        this.styleConfig = {};

        // 主题监听器
        this.themeObserver = null;
    }

    async init() {
        await super.init();

        // 根据配置动态生成样式
        this.generateDynamicStyles();

        // 监听主题变化
        this.setupThemeListener();

        this.api.log(this.name, '插件初始化完成');
    }

    /**
     * 根据配置动态生成样式（支持双主题）
     */
    generateDynamicStyles() {
        const highlightStyle = this.config.highlightStyle || {};

        if (!highlightStyle.enabled) return;

        // 检测当前主题
        const isDark = this.isDarkTheme();
        const currentTheme = isDark ? 'dark' : 'light';

        const themeColors = highlightStyle.themes?.[currentTheme] || highlightStyle.themes?.light || {};

        // 将十六进制颜色转换为 rgba，只让背景透明
        const bgColor = themeColors.backgroundColor || '#7afcff';
        const opacity = parseFloat(highlightStyle.opacity || '0.15');
        const rgba = this.hexToRgba(bgColor, opacity);

        this.styleConfig = {
            'bold-highlight': {
                backgroundColor: rgba,
                padding: highlightStyle.padding || '2px 4px',
                borderRadius: highlightStyle.borderRadius || '2px',
                fontWeight: this.config.general?.keepFontWeight ? 'bold' : 'normal',
                border: 'none',
                display: 'inline'
            }
        };

        // 使用平台 API 注册样式
        this.api.addCSSBatch(this.styleConfig);

        this.api.log(this.name, `动态样式已生成 (${currentTheme} 主题)`);
    }

    /**
     * 将十六进制颜色转换为 rgba
     */
    hexToRgba(hex, alpha) {
        // 移除 # 号
        hex = hex.replace('#', '');

        // 转换为 RGB
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);

        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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
     * 设置主题监听器
     */
    setupThemeListener() {
        const themeCSS = document.getElementById('theme-css');
        if (!themeCSS) return;

        // 监听CSS文件的href属性变化
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'href') {
                    // 延迟一点时间让CSS加载完成
                    setTimeout(() => {
                        this.generateDynamicStyles();
                    }, 100);
                }
            });
        });

        // 监听theme-css元素的href属性变化
        observer.observe(themeCSS, {
            attributes: true,
            attributeFilter: ['href']
        });

        // 保存observer引用以便销毁时清理
        this.themeObserver = observer;
    }

    /**
     * 处理 Markdown 渲染
     * 将 <strong> 和 <b> 标签转换为荧光高亮
     */
    processMarkdown(html) {
        if (!this.isActive()) return html;

        if (!this.config.highlightStyle?.enabled) return html;

        try {
            // 替换 <strong> 标签
            html = html.replace(/<strong>(.*?)<\/strong>/g, (match, content) => {
                return `<span class="bold-highlight">${content}</span>`;
            });

            // 替换 <b> 标签
            html = html.replace(/<b>(.*?)<\/b>/g, (match, content) => {
                return `<span class="bold-highlight">${content}</span>`;
            });

            return html;

        } catch (error) {
            this.api.warn(this.name, '处理失败:', error);
            return html;
        }
    }

    /**
     * 销毁插件
     */
    async destroy() {
        // 清理主题监听器
        if (this.themeObserver) {
            this.themeObserver.disconnect();
            this.themeObserver = null;
        }

        await super.destroy();
    }
}

module.exports = BoldHighlighterPlugin;