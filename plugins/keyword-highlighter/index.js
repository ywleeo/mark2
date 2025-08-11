/**
 * 关键词高亮插件 - 重构版
 * 使用平台 API 实现真正的插件化架构
 */

const BasePlugin = require('../BasePlugin');
const fs = require('fs');
const path = require('path');

class KeywordHighlighterPlugin extends BasePlugin {
    constructor(pluginConfig) {
        super(pluginConfig);
        
        // 插件自定义的匹配规则
        this.patterns = {
            numbers: [
                /\d+(?:\.\d+)?%/g,                          // 百分比
                /\d+(?:\.\d+)?个百分点/g,                    // 百分点
                /[￥$€£¥]\d+(?:[,\.]\d+)*/g,                 // 货币
                /\d+(?:\.\d+)?(?:千瓦|兆瓦|吉瓦|GW|MW|KW)/g, // 电力单位
                /\d+(?:\.\d+)?[万百十亿]/g,                  // 中文数字单位
                /\d{1,3}(?:,\d{3})+/g,                      // 带逗号数字
                /\d{4,}/g                                   // 大数字
            ],
            dates: [
                /(\d{4}年(?:1[0-2]|0[1-9]|[1-9])月(?:[12][0-9]|3[01]|0[1-9]|[1-9])日)/g,
                /((?:1[0-2]|0[1-9]|[1-9])月(?:[12][0-9]|3[01]|0[1-9]|[1-9])日)/g,
                /(\d{4}年(?:1[0-2]|0[1-9]|[1-9])月)/g,
                /(\d{4}-(?:1[0-2]|0[1-9]|[1-9])-(?:[12][0-9]|3[01]|0[1-9]|[1-9]))/g,
                /(上午|下午|晚上|今天|明天|昨天|本周|下周|上周|本月|下月|上月|今年|明年|去年)/g,
                /(第[一二三四]季度|Q[1-4]|[一二三四]季度)/g,
                /(\d{4}年)(?![0-9月])/g
            ]
        };
        
        // 动态生成的样式配置（将在 init 时根据配置生成）
        this.styleConfig = {};
        
        // 自定义关键词库
        this.customKeywords = {};
    }

    async init() {
        await super.init();
        
        // 根据配置动态生成样式
        this.generateDynamicStyles();
        
        // 加载自定义关键词
        await this.loadCustomKeywords();
        
        // 监听主题变化
        this.setupThemeListener();
        
        this.api.log(this.name, '插件初始化完成', {
            patterns: Object.keys(this.patterns).length,
            keywords: Object.keys(this.customKeywords).length,
            enabledTypes: this.getEnabledTypes().length
        });
    }

    /**
     * 根据配置动态生成样式（支持双主题）
     */
    generateDynamicStyles() {
        const types = this.config.highlightTypes || {};
        const general = this.config.general || {};
        
        // 检测当前主题
        const isDark = this.isDarkTheme();
        const currentTheme = isDark ? 'dark' : 'light';
        
        Object.entries(types).forEach(([typeName, typeConfig]) => {
            if (typeConfig.enabled) {
                const className = `highlight-${typeName}`;
                const themeColors = typeConfig.themes?.[currentTheme] || typeConfig.themes?.light || {};
                
                this.styleConfig[className] = {
                    backgroundColor: themeColors.backgroundColor || '#f3f4f6',
                    color: themeColors.textColor || '#374151',
                    padding: general.padding || '1px 2px',
                    borderRadius: general.borderRadius || '2px',
                    fontWeight: general.fontWeight || 'normal',
                    border: 'none'
                };
            }
        });
        
        // 使用平台 API 注册样式
        this.api.addCSSBatch(this.styleConfig);
        
        this.api.log(this.name, `动态样式已生成 (${currentTheme} 主题)`, Object.keys(this.styleConfig));
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
                        this.api.log(this.name, '主题已切换，重新生成样式');
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
     * 获取启用的高亮类型
     */
    getEnabledTypes() {
        const types = this.config.highlightTypes || {};
        return Object.entries(types)
            .filter(([_, config]) => config.enabled)
            .map(([typeName, _]) => typeName);
    }

    /**
     * 加载自定义关键词
     */
    async loadCustomKeywords() {
        try {
            const keywordFilePath = path.join(__dirname, 'keywords.json');
            if (fs.existsSync(keywordFilePath)) {
                const content = fs.readFileSync(keywordFilePath, 'utf-8');
                this.customKeywords = JSON.parse(content);
                this.api.log(this.name, `加载关键词库: ${Object.keys(this.customKeywords).length} 个分类`);
            }
        } catch (error) {
            this.api.warn(this.name, '加载关键词失败:', error);
        }
    }

    /**
     * 处理 Markdown 渲染
     */
    processMarkdown(html) {
        if (!this.isActive()) return html;
        
        // 检查全局开关
        const keywordHighlightEnabled = localStorage.getItem('keywordHighlight') !== 'false';
        if (!keywordHighlightEnabled) return html;
        
        try {
            // 收集所有需要高亮的文本
            const highlightItems = [];
            
            const enabledTypes = this.getEnabledTypes();
            
            // 1. 处理数字类高亮
            if (enabledTypes.includes('numbers')) {
                const numberHighlights = this.extractNumbers(html);
                highlightItems.push(...numberHighlights);
            }
            
            // 2. 处理日期类高亮  
            if (enabledTypes.includes('dates')) {
                const dateHighlights = this.extractDates(html);
                highlightItems.push(...dateHighlights);
            }
            
            // 3. 处理实体类高亮
            if (enabledTypes.includes('entities')) {
                const entityHighlights = this.extractEntities(html);
                highlightItems.push(...entityHighlights);
            }
            
            // 4. 处理热词类高亮
            if (enabledTypes.includes('hotwords')) {
                const hotwordHighlights = this.extractHotwords(html);
                highlightItems.push(...hotwordHighlights);
            }
            
            // 使用平台 API 批量高亮
            return this.api.batchHighlight(html, highlightItems);
            
        } catch (error) {
            this.api.warn(this.name, '处理失败:', error);
            return html;
        }
    }

    /**
     * 提取数字信息
     */
    extractNumbers(html) {
        const text = this.api.extractText(html);
        const matches = this.api.findMatchesAll(text, this.patterns.numbers);
        
        return matches.map(match => ({
            text: match,
            className: 'highlight-numbers'
        }));
    }

    /**
     * 提取日期信息
     */
    extractDates(html) {
        const text = this.api.extractText(html);
        const matches = this.api.findMatchesAll(text, this.patterns.dates);
        
        return matches.map(match => ({
            text: match,
            className: 'highlight-dates'
        }));
    }

    /**
     * 提取实体信息
     */
    extractEntities(html) {
        const highlightItems = [];
        const text = this.api.extractText(html);
        
        if (this.customKeywords.entities) {
            this.customKeywords.entities.forEach(keyword => {
                if (text.includes(keyword)) {
                    highlightItems.push({
                        text: keyword,
                        className: 'highlight-entities'
                    });
                }
            });
        }
        
        return highlightItems;
    }

    /**
     * 提取热词信息
     */
    extractHotwords(html) {
        const highlightItems = [];
        const text = this.api.extractText(html);
        
        if (this.customKeywords.hotwords) {
            this.customKeywords.hotwords.forEach(keyword => {
                if (text.includes(keyword)) {
                    highlightItems.push({
                        text: keyword,
                        className: 'highlight-hotwords'
                    });
                }
            });
        }
        
        // 处理数字关键词（来自词库的货币等）
        if (this.customKeywords.numbers) {
            this.customKeywords.numbers.forEach(keyword => {
                if (text.includes(keyword)) {
                    highlightItems.push({
                        text: keyword,
                        className: 'highlight-numbers'
                    });
                }
            });
        }
        
        return highlightItems;
    }


    /**
     * 更新配置
     */
    updateConfig(config) {
        super.updateConfig(config);
        this.api.log(this.name, '配置已更新', this.config);
    }

    /**
     * 启用/禁用特定功能
     */
    toggleFeature(featureName, enabled) {
        const newConfig = { ...this.config };
        newConfig[featureName] = enabled;
        this.updateConfig(newConfig);
        
        this.api.log(this.name, `功能 ${featureName} ${enabled ? '启用' : '禁用'}`);
    }

    /**
     * 添加自定义样式
     */
    addCustomStyle(className, styles) {
        this.api.addCSS(className, styles);
        this.api.log(this.name, `添加自定义样式: ${className}`);
    }

    /**
     * 添加自定义匹配模式
     */
    addCustomPattern(category, pattern) {
        if (!this.patterns[category]) {
            this.patterns[category] = [];
        }
        this.patterns[category].push(pattern);
        this.api.log(this.name, `添加自定义模式到 ${category}`);
    }

    async destroy() {
        // 清理主题监听器
        if (this.themeObserver) {
            this.themeObserver.disconnect();
            this.themeObserver = null;
        }
        
        this.customKeywords = {};
        this.patterns = {};
        await super.destroy();
    }
}

module.exports = KeywordHighlighterPlugin;