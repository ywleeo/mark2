/**
 * 关键词高亮模块 - 3分类高亮系统
 * 支持数字类、名词类、热词类三大类关键词高亮
 * 输入 HTML 内容，返回高亮后的 HTML
 * 不依赖任何外部库和应用状态
 */

class KeywordHighlighter {
    constructor(options = {}) {
        this.options = {
            enableNumbers: true,        // 启用数字类高亮（包含货币、日期等）
            enableDates: true,          // 启用日期高亮（作为数字类的补充）
            enableEntities: true,       // 启用名词类高亮（人名、地名、公司名等）
            enableHotwords: true,       // 启用热词类高亮（技术、金融、政治等热词）
            enableCustomKeywords: true, // 启用自定义关键词
            minKeywordLength: 2,
            maxKeywordLength: 10,
            ...options
        };
        
        // 中文常见停用词
        this.stopWords = new Set([
            '的', '了', '是', '在', '有', '和', '就', '不', '人', '都', '一', '一个',
            '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看',
            '好', '自己', '这', '那', '之', '与', '及', '或', '但', '而', '所以',
            '因为', '如果', '虽然', '然而', '不过', '只是', '可以', '能够', '应该'
        ]);

        // 自定义关键词存储（支持动态分类）
        this.customKeywords = {};

        // 加载自定义关键词
        this.loadCustomKeywords();
    }

    /**
     * 主要入口函数：对 HTML 内容进行关键信息高亮
     * @param {string} html - 输入的 HTML 内容
     * @returns {string} - 高亮后的 HTML 内容
     */
    highlight(html) {
        if (!html || typeof html !== 'string') {
            return html;
        }

        try {
            // 提取纯文本内容进行数字分析
            const textContent = this.extractTextFromHtml(html);
            
            // 3个主要分类的高亮样式映射
            const categoryStyleMap = {
                'numbers': 'highlight-number',     // 数字类 - 蓝色
                'entities': 'highlight-entity',    // 名词类 - 绿色  
                'hotwords': 'highlight-keyword'    // 热词类 - 橙色
            };

            // 按分类收集关键词并分配样式
            let allHighlights = [];
            
            // 优先添加动态提取的数字和日期（通常更长更具体）
            if (this.options.enableNumbers) {
                const numberKeywords = this.extractNumbers(textContent);
                numberKeywords.forEach(keyword => {
                    allHighlights.push({ word: keyword, class: 'highlight-number' });
                });
            }

            if (this.options.enableDates) {
                const dateKeywords = this.extractDates(textContent);
                dateKeywords.forEach(keyword => {
                    allHighlights.push({ word: keyword, class: 'highlight-number' }); // 日期也用数字样式
                });
            }
            
            // 然后添加静态关键词
            if (this.options.enableCustomKeywords) {
                Object.entries(this.customKeywords).forEach(([categoryName, categoryList]) => {
                    if (Array.isArray(categoryList)) {
                        const styleClass = categoryStyleMap[categoryName] || 'highlight-keyword';
                        categoryList.forEach(keyword => {
                            allHighlights.push({ word: keyword, class: styleClass });
                        });
                    }
                });
            }

            let resultHtml = this.applyAllHighlights(html, allHighlights);
            return resultHtml;
        } catch (error) {
            console.warn('关键词高亮处理失败:', error);
            return html; // 失败时返回原始内容
        }
    }

    // 修改 applyHighlights 支持传入高亮类名 - 按标题分块处理
    applyHighlights(html, keywords, highlightClass = 'highlight-keyword') {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;
        
        // 清除之前的处理标记
        tempDiv.querySelectorAll('.highlight-processed').forEach(el => {
            el.classList.remove('highlight-processed');
        });
        
        // 按标题级别分块，每个块独立处理高亮
        const contentBlocks = this.splitContentByHeadings(tempDiv);
        
        keywords.sort((a, b) => b.length - a.length);
        const uniqueKeywords = [...new Set(keywords.filter(k => k.trim().length > 0))];
        
        // 清空原容器
        tempDiv.innerHTML = '';
        
        // 对每个内容块独立应用高亮，然后放回容器
        contentBlocks.forEach((block, index) => {
            this.highlightInBlock(block, uniqueKeywords, highlightClass);
            
            // 将处理后的块添加回容器
            while (block.firstChild) {
                tempDiv.appendChild(block.firstChild);
            }
        });
        
        return tempDiv.innerHTML;
    }

    // 统一处理所有高亮，避免多次处理导致覆盖
    applyAllHighlights(html, highlights) {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;
        
        // 清除之前的处理标记
        tempDiv.querySelectorAll('.highlight-processed').forEach(el => {
            el.classList.remove('highlight-processed');
        });
        
        // 按标题级别分块，每个块独立处理高亮
        const contentBlocks = this.splitContentByHeadings(tempDiv);
        
        // 按长度排序所有关键词，避免短词覆盖长词
        highlights.sort((a, b) => b.word.length - a.word.length);
        
        // 清空原容器
        tempDiv.innerHTML = '';
        
        // 对每个内容块独立应用高亮，然后放回容器
        contentBlocks.forEach((block, index) => {
            this.highlightInBlockUnified(block, highlights);
            
            // 将处理后的块添加回容器
            while (block.firstChild) {
                tempDiv.appendChild(block.firstChild);
            }
        });
        
        return tempDiv.innerHTML;
    }

    // 统一高亮处理方法
    highlightInBlockUnified(block, highlights) {
        // 获取块中所有可高亮的元素
        const targetElements = block.querySelectorAll('p, li, blockquote, h1, h2, h3, h4, h5, h6, td, th, span, div:not(.highlight-processed)');
        
        // 如果没有找到特定元素，就处理整个块
        if (targetElements.length === 0) {
            this.highlightInElementUnified(block, highlights);
        } else {
            targetElements.forEach(element => {
                this.highlightInElementUnified(element, highlights);
            });
        }
        
        // 标记此块已处理
        block.classList.add('highlight-processed');
    }

    // 统一的元素高亮方法
    highlightInElementUnified(element, highlights) {
        highlights.forEach(({ word, class: highlightClass }) => {
            if (word.length <= 1) return;
            
            const walker = document.createTreeWalker(
                element,
                NodeFilter.SHOW_TEXT,
                {
                    acceptNode: (node) => {
                        return NodeFilter.FILTER_ACCEPT;
                    }
                }
            );
            const textNodes = [];
            let node;
            while (node = walker.nextNode()) {
                textNodes.push(node);
            }
            
            textNodes.forEach(textNode => {
                if (!textNode.parentNode) return;
                
                // 跳过已经高亮的节点
                if (textNode.parentElement.tagName === 'MARK') {
                    return;
                }
                
                const text = textNode.textContent;
                let regex;
                // 检查关键词是否包含数字和特殊符号（不使用单词边界）
                const hasNumbers = /\d/.test(word);
                const hasSpecialChars = /[%￥$€£¥,.-]/.test(word);

                if (/[一-龥]/.test(word)) {
                    // 中文关键词
                    regex = new RegExp(`(${this.escapeRegex(word)})`, 'gi');
                } else if (hasNumbers || hasSpecialChars) {
                    // 包含数字或特殊符号的关键词，不使用单词边界
                    regex = new RegExp(`(${this.escapeRegex(word)})`, 'gi');
                } else {
                    // 其他英文关键词，使用单词边界
                    regex = new RegExp(`\\b(${this.escapeRegex(word)})\\b`, 'gi');
                }
                
                if (regex.test(text)) {
                    const replacedHTML = text.replace(regex, 
                        `<mark class="${highlightClass}">$1</mark>`
                    );
                    if (replacedHTML !== text) {
                        const tempSpan = document.createElement('span');
                        tempSpan.innerHTML = replacedHTML;
                        while (tempSpan.firstChild) {
                            textNode.parentNode.insertBefore(tempSpan.firstChild, textNode);
                        }
                        textNode.parentNode.removeChild(textNode);
                    }
                }
            });
        });
    }

    // 按标题将内容分块 - 简化版本
    splitContentByHeadings(container) {
        const blocks = [];
        const allElements = Array.from(container.children);
        
        if (allElements.length === 0) {
            blocks.push(container);
            return blocks;
        }
        
        let currentBlock = document.createElement('div');
        
        allElements.forEach(element => {
            // 如果遇到标题元素，结束当前块，开始新块
            if (element.tagName && element.tagName.match(/^H[1-6]$/)) {
                // 如果当前块有内容，保存它
                if (currentBlock.children.length > 0 || currentBlock.textContent.trim()) {
                    blocks.push(currentBlock);
                }
                // 开始新块，包含这个标题
                currentBlock = document.createElement('div');
                currentBlock.appendChild(element.cloneNode(true));
            } else {
                // 将当前元素添加到当前块
                currentBlock.appendChild(element.cloneNode(true));
            }
        });
        
        // 添加最后一个块
        if (currentBlock.children.length > 0 || currentBlock.textContent.trim()) {
            blocks.push(currentBlock);
        }
        
        // 如果没有生成任何块，就把整个容器作为一个块
        if (blocks.length === 0) {
            blocks.push(container);
        }
        
        return blocks;
    }

    // 在单个内容块中应用高亮
    highlightInBlock(block, keywords, highlightClass) {
        // 获取块中所有可高亮的元素
        const targetElements = block.querySelectorAll('p, li, blockquote, h1, h2, h3, h4, h5, h6, td, th, span, div:not(.highlight-processed)');
        
        // 如果没有找到特定元素，就处理整个块
        if (targetElements.length === 0) {
            this.highlightInElement(block, keywords, highlightClass);
        } else {
            targetElements.forEach(element => {
                this.highlightInElement(element, keywords, highlightClass);
            });
        }
        
        // 标记此块已处理
        block.classList.add('highlight-processed');
    }

    // 修改 highlightInElement 支持传入高亮类名，并处理冲突
    highlightInElement(element, keywords, highlightClass = 'highlight-keyword') {
        // 按长度排序，先处理长的关键词
        const sortedKeywords = keywords.sort((a, b) => b.length - a.length);
        
        sortedKeywords.forEach(keyword => {
            if (keyword.length <= 1) return;
            
            const walker = document.createTreeWalker(
                element,
                NodeFilter.SHOW_TEXT,
                {
                    acceptNode: (node) => {
                        // 跳过已经高亮的节点，但检查是否需要替换
                        return NodeFilter.FILTER_ACCEPT;
                    }
                }
            );
            const textNodes = [];
            let node;
            while (node = walker.nextNode()) {
                textNodes.push(node);
            }
            
            textNodes.forEach(textNode => {
                if (!textNode.parentNode) return;
                
                // 检查父元素是否已经是高亮标签
                if (textNode.parentElement.tagName === 'MARK') {
                    // 如果当前关键词更长，且包含已高亮的内容，则考虑替换
                    const currentHighlightText = textNode.parentElement.textContent;
                    if (keyword.length > currentHighlightText.length && keyword.includes(currentHighlightText)) {
                        // 替换为更长的高亮
                        const grandParent = textNode.parentElement.parentElement;
                        if (grandParent) {
                            const fullText = grandParent.textContent;
                            if (fullText.includes(keyword)) {
                                // 进行替换操作
                                const regex = new RegExp(`(${this.escapeRegex(keyword)})`, 'gi');
                                if (regex.test(fullText)) {
                                    const newHTML = fullText.replace(regex, `<mark class="${highlightClass}">$1</mark>`);
                                    grandParent.innerHTML = newHTML;
                                    return;
                                }
                            }
                        }
                    }
                    return; // 已经高亮的节点，跳过
                }
                
                const text = textNode.textContent;
                let regex;
                // 检查关键词是否包含数字和特殊符号（不使用单词边界）
                const hasNumbers = /\d/.test(keyword);
                const hasSpecialChars = /[%￥$€£¥,.-]/.test(keyword);

                if (/[一-龥]/.test(keyword)) {
                    // 中文关键词
                    regex = new RegExp(`(${this.escapeRegex(keyword)})`, 'gi');
                } else if (hasNumbers || hasSpecialChars) {
                    // 包含数字或特殊符号的关键词，不使用单词边界
                    regex = new RegExp(`(${this.escapeRegex(keyword)})`, 'gi');
                } else {
                    // 其他英文关键词，使用单词边界
                    regex = new RegExp(`\\b(${this.escapeRegex(keyword)})\\b`, 'gi');
                }
                
                if (regex.test(text)) {
                    const replacedHTML = text.replace(regex, 
                        `<mark class="${highlightClass}">$1</mark>`
                    );
                    if (replacedHTML !== text) {
                        const tempSpan = document.createElement('span');
                        tempSpan.innerHTML = replacedHTML;
                        while (tempSpan.firstChild) {
                            textNode.parentNode.insertBefore(tempSpan.firstChild, textNode);
                        }
                        textNode.parentNode.removeChild(textNode);
                    }
                }
            });
        });
    }

    /**
     * 从 HTML 中提取纯文本内容
     */
    extractTextFromHtml(html) {
        // 创建临时元素来解析 HTML
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;
        return tempDiv.textContent || tempDiv.innerText || '';
    }


    /**
     * 提取数字信息（金额、百分比、统计数据等）
     */
    extractNumbers(text) {
        const allNumbers = [];
        
        // 所有数字匹配模式 - 按优先级排序，避免冲突
        const patterns = [
            // 百分比和百分点
            /\d+(?:\.\d+)?%/g, // 百分比：25%、11.5%
            /\d+(?:\.\d+)?个百分点/g, // 百分点：0.1个百分点、2.5个百分点
            
            // 移除日期相关模式，由extractDates方法专门处理
            
            // 带货币符号的金额
            /[￥$€£¥]\d+(?:[,\.]\d+)*/g, // 带符号货币：$100、￥200
            
            // 完整的计量单位（优先级高于万千百十亿，避免"千瓦"中的"千"被单独匹配）
            /\d+(?:\.\d+)?(?:千瓦|兆瓦|吉瓦|瓦特|千瓦时|兆瓦时|GW|MW|KW|TW)/g, // 电力单位：340千瓦、1.5兆瓦、570GW
            /\d+(?:\.\d+)?(?:毫米|厘米|分米|千米|公里|英寸|英尺|英里)/g, // 长度单位：15毫米、3.5千米
            /\d+(?:\.\d+)?(?:毫克|千克|公斤|吨|磅|盎司)/g, // 重量单位：500毫克、2.5千克
            /\d+(?:\.\d+)?(?:毫升|立方米|立方厘米|加仑)/g, // 体积单位：250毫升、1.5立方米
            /\d+(?:\.\d+)?(?:分钟|小时|天|周|月|年)/g, // 时间单位：30分钟、2.5小时
            /\d+(?:\.\d+)?(?:摄氏度|华氏度|开尔文)/g, // 温度单位：25摄氏度、98.6华氏度
            /\d+(?:\.\d+)?(?:千赫|兆赫|吉赫|赫兹)/g, // 频率单位：2.4吉赫、50千赫
            /\d+(?:\.\d+)?(?:字节|KB|MB|GB|TB|PB)/g, // 存储单位：256GB、1.5TB
            
            // 特殊处理：单独的"米"、"克"、"升"、"秒"、"度"（避免与其他单位冲突）
            /\d+(?:\.\d+)?米(?![千公])/g, // 米（但不包括千米、公里）
            /\d+(?:\.\d+)?克(?![千毫])/g, // 克（但不包括千克、毫克）
            /\d+(?:\.\d+)?升(?![毫])/g, // 升（但不包括毫升）
            /\d+(?:\.\d+)?秒/g, // 秒
            /\d+(?:\.\d+)?度(?![摄华开])/g, // 度（但不包括摄氏度等）
            
            // 金额相关（在计量单位后处理，避免"千瓦"被"千"匹配）
            /\d+(?:\.\d+)?[万百十亿](?:美元|欧元|英镑|日元|人民币|元)/g, // 完整金额：11.6亿欧元、7000万美元
            /\d+(?:\.\d+)?[万百十亿]/g, // 简单金额：100万、11.6亿、90.94亿
            
            // 统计数字
            /\d+(?:\.\d+)?[个人次倍家份件台辆]/g, // 统计数字：1000个、200人
            
            // 其他数字格式
            /\d{1,3}(?:,\d{3})+/g, // 带逗号数字：1,000
            /\d{4,}/g // 大数字：10000
        ];

        // 每个正则都跑一遍，收集所有匹配
        patterns.forEach(pattern => {
            const matches = text.match(pattern);
            if (matches) {
                allNumbers.push(...matches);
            }
        });

        // 去重
        return [...new Set(allNumbers)];
    }

    /**
     * 提取时间日期信息 - 支持更多日期格式
     */
    extractDates(text) {
        const patterns = [
            // 完整年月日格式：2025年5月28日、2025年12月1日、2025年05月05日
            /(\d{4}年(?:1[0-2]|0[1-9]|[1-9])月(?:[12][0-9]|3[01]|0[1-9]|[1-9])日)/g,
            
            // 月日格式：7月23日、12月5日、05月05日
            /((?:1[0-2]|0[1-9]|[1-9])月(?:[12][0-9]|3[01]|0[1-9]|[1-9])日)/g,
            
            // 年月格式：2025年8月、2025年12月、2025年05月
            /(\d{4}年(?:1[0-2]|0[1-9]|[1-9])月)/g,
            
            // 数字日期格式：2025-1-15、2025-01-03、2024-12-31
            /(\d{4}-(?:1[0-2]|0[1-9]|[1-9])-(?:[12][0-9]|3[01]|0[1-9]|[1-9]))/g,
            
            // 数字年月格式：2025-08、2025-1
            /(\d{4}-(?:1[0-2]|0[1-9]|[1-9]))/g,
            
            // 单独月份：6月、12月、05月（避免误匹配其他数字）
            /(?:^|[^0-9年])((?:1[0-2]|0[1-9]|[1-9])月)(?![0-9日])/g,
            
            // 时间段词汇
            /(上午|下午|晚上|今天|明天|昨天|本周|下周|上周|本月|下月|上月|今年|明年|去年)/g,
            
            // 季度表示
            /(第[一二三四]季度|Q[1-4]|[一二三四]季度)/g,
            
            // 具体时间：14:30、上午10点、下午3点半
            /(\d{1,2}:\d{2}|\d{1,2}[点时](?:半|一刻|三刻)?)/g,
            
            // 年份单独出现：2025年、2024年
            /(\d{4}年)(?![0-9月])/g
        ];

        const dates = [];
        patterns.forEach(pattern => {
            const matches = text.match(pattern);
            if (matches) {
                // 对于月份单独匹配的情况，需要从捕获组中提取
                if (pattern.source.includes('?:^|[^0-9年]')) {
                    // 这是单独月份的正则，需要提取捕获组
                    const fullMatches = [...text.matchAll(pattern)];
                    fullMatches.forEach(match => {
                        if (match[1]) dates.push(match[1]);
                    });
                } else {
                    dates.push(...matches);
                }
            }
        });

        return [...new Set(dates)];
    }

    /**
     * 提取实体信息（人名、公司名、地名等）
     */
    extractEntities(text) {
        const entities = [];

        // 人名模式：X总、X先生、X女士、X经理
        const namePatterns = [
            /([A-Z][a-z]+\s+[A-Z][a-z]+)/g, // 英文姓名
            /([\u4e00-\u9fa5]{2,4}[总经理先生女士董事长主任部长])/g, // 中文职位+姓名
        ];

        // 公司机构名：XX公司、XX银行、XX大学
        const orgPatterns = [
            /([\u4e00-\u9fa5]{2,10}[公司集团银行大学医院政府部门])/g,
            /([A-Z][a-zA-Z\s]{2,20}(Inc|Corp|Ltd|Company|Bank|University))/g
        ];

        // 地名：XX市、XX省、XX区
        const placePatterns = [
            /([\u4e00-\u9fa5]{2,8}[省市区县街道路])/g,
        ];

        [...namePatterns, ...orgPatterns, ...placePatterns].forEach(pattern => {
            const matches = text.match(pattern);
            if (matches) {
                entities.push(...matches);
            }
        });

        return [...new Set(entities)];
    }

    /**
     * 提取重要词汇（基于频率和长度的启发式方法）
     */
    extractImportantWords(text) {
        // 简单的中文分词（基于标点和空格）
        const words = text
            .replace(/[，。！？；：""''（）【】《》\s]/g, ' ')
            .split(/\s+/)
            .filter(word => {
                return word.length >= this.options.minKeywordLength && 
                       word.length <= this.options.maxKeywordLength &&
                       !this.stopWords.has(word) &&
                       /[\u4e00-\u9fa5]/.test(word); // 包含中文字符
            });

        // 统计词频
        const wordCount = {};
        words.forEach(word => {
            wordCount[word] = (wordCount[word] || 0) + 1;
        });

        // 返回出现2次以上的词汇
        return Object.keys(wordCount).filter(word => wordCount[word] >= 2);
    }


    /**
     * 转义正则表达式特殊字符
     */
    escapeRegex(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    /**
     * 加载关键词
     */
    loadCustomKeywords() {
        // 从文件加载关键词
        this.loadKeywordsFromFile();
    }

    /**
     * 尝试从 keywords.json 文件加载关键词
     */
    loadKeywordsFromFile() {
        // 在 Electron 环境中可以读取文件
        if (typeof require !== 'undefined') {
            try {
                const fs = require('fs');
                const path = require('path');
                const keywordFilePath = path.join(__dirname, 'keywords.json');
                
                if (fs.existsSync(keywordFilePath)) {
                    const content = fs.readFileSync(keywordFilePath, 'utf-8');
                    const fileKeywords = JSON.parse(content);
                    
                    // 直接加载所有分类，不限制固定的类型
                    this.customKeywords = { ...fileKeywords };
                    
                    // 关键词加载成功
                }
            } catch (error) {
                console.warn('从文件加载关键词失败:', error);
            }
        }
    }

}

// 导出为全局可用的工具
window.KeywordHighlighter = KeywordHighlighter;

// 创建默认实例
window.keywordHighlighter = new KeywordHighlighter();
