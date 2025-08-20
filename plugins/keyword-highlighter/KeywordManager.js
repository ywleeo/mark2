/**
 * 关键词管理器
 * 负责关键词的增删改查和排重处理
 */

const fs = require('fs');
const path = require('path');

class KeywordManager {
    constructor(keywordFilePath) {
        this.keywordFilePath = keywordFilePath;
        this.keywords = {};
        this.loadKeywords();
    }

    /**
     * 加载关键词
     */
    loadKeywords() {
        try {
            if (fs.existsSync(this.keywordFilePath)) {
                const content = fs.readFileSync(this.keywordFilePath, 'utf-8');
                this.keywords = JSON.parse(content);
            } else {
                this.keywords = { entities: [], hotwords: [], numbers: [] };
            }
        } catch (error) {
            console.error('加载关键词失败:', error);
            this.keywords = { entities: [], hotwords: [], numbers: [] };
        }
    }

    /**
     * 保存关键词到文件
     */
    saveKeywords() {
        try {
            fs.writeFileSync(this.keywordFilePath, JSON.stringify(this.keywords, null, 2), 'utf-8');
            return true;
        } catch (error) {
            console.error('保存关键词失败:', error);
            return false;
        }
    }

    /**
     * 获取所有分类
     */
    getCategories() {
        return Object.keys(this.keywords);
    }

    /**
     * 获取指定分类的关键词
     */
    getKeywordsByCategory(category) {
        return this.keywords[category] || [];
    }

    /**
     * 添加关键词（包含排重）
     * @param {string} category - 分类名
     * @param {string} keyword - 关键词
     * @returns {Object} - {success: boolean, message: string}
     */
    addKeyword(category, keyword) {
        if (!keyword || keyword.trim() === '') {
            return { success: false, message: '关键词不能为空' };
        }

        keyword = keyword.trim();

        // 确保分类存在
        if (!this.keywords[category]) {
            this.keywords[category] = [];
        }

        // 检查是否重复
        if (this.keywords[category].includes(keyword)) {
            return { success: false, message: '关键词已存在于该分类中' };
        }

        // 检查是否在其他分类中存在
        for (const [cat, words] of Object.entries(this.keywords)) {
            if (cat !== category && words.includes(keyword)) {
                return { 
                    success: false, 
                    message: `关键词已存在于 "${cat}" 分类中，是否要移动到 "${category}"？`,
                    existsInCategory: cat
                };
            }
        }

        // 添加关键词
        this.keywords[category].push(keyword);
        
        // 排序（可选）
        this.keywords[category].sort();

        // 保存到文件
        const saved = this.saveKeywords();
        
        return { 
            success: saved, 
            message: saved ? '关键词添加成功' : '保存失败' 
        };
    }

    /**
     * 移动关键词到其他分类
     * @param {string} keyword - 关键词
     * @param {string} fromCategory - 源分类
     * @param {string} toCategory - 目标分类
     * @returns {Object} - {success: boolean, message: string}
     */
    moveKeyword(keyword, fromCategory, toCategory) {
        if (!this.keywords[fromCategory] || !this.keywords[fromCategory].includes(keyword)) {
            return { success: false, message: '源分类中未找到该关键词' };
        }

        // 从源分类中删除
        this.keywords[fromCategory] = this.keywords[fromCategory].filter(w => w !== keyword);

        // 添加到目标分类（自动排重）
        const result = this.addKeyword(toCategory, keyword);
        
        if (result.success) {
            return { success: true, message: `关键词已从 "${fromCategory}" 移动到 "${toCategory}"` };
        } else {
            // 如果添加失败，回滚
            this.keywords[fromCategory].push(keyword);
            this.keywords[fromCategory].sort();
            return result;
        }
    }

    /**
     * 删除关键词
     * @param {string} category - 分类名
     * @param {string} keyword - 关键词
     * @returns {Object} - {success: boolean, message: string}
     */
    removeKeyword(category, keyword) {
        if (!this.keywords[category]) {
            return { success: false, message: '分类不存在' };
        }

        const index = this.keywords[category].indexOf(keyword);
        if (index === -1) {
            return { success: false, message: '关键词不存在于该分类中' };
        }

        // 删除关键词
        this.keywords[category].splice(index, 1);

        // 保存到文件
        const saved = this.saveKeywords();
        
        return { 
            success: saved, 
            message: saved ? '关键词删除成功' : '保存失败' 
        };
    }

    /**
     * 查找关键词所在的分类
     * @param {string} keyword - 关键词
     * @returns {Array} - 包含该关键词的分类数组
     */
    findKeywordCategories(keyword) {
        const categories = [];
        for (const [category, words] of Object.entries(this.keywords)) {
            if (words.includes(keyword)) {
                categories.push(category);
            }
        }
        return categories;
    }

    /**
     * 检查关键词是否被高亮（在任何分类中存在）
     * @param {string} keyword - 关键词
     * @returns {boolean} - 是否被高亮
     */
    isKeywordHighlighted(keyword) {
        return this.findKeywordCategories(keyword).length > 0;
    }

    /**
     * 获取分类统计信息
     */
    getStatistics() {
        const stats = {};
        for (const [category, words] of Object.entries(this.keywords)) {
            stats[category] = words.length;
        }
        stats.total = Object.values(stats).reduce((sum, count) => sum + count, 0);
        return stats;
    }

    /**
     * 批量导入关键词
     * @param {string} category - 目标分类
     * @param {Array} keywordList - 关键词数组
     * @returns {Object} - 导入结果
     */
    batchImport(category, keywordList) {
        const results = {
            success: 0,
            duplicate: 0,
            error: 0,
            details: []
        };

        keywordList.forEach(keyword => {
            const result = this.addKeyword(category, keyword);
            if (result.success) {
                results.success++;
            } else if (result.message.includes('已存在')) {
                results.duplicate++;
            } else {
                results.error++;
            }
            results.details.push({ keyword, result });
        });

        return results;
    }

    /**
     * 导出关键词
     * @param {string} category - 分类名（可选，不指定则导出全部）
     * @returns {Object} - 关键词数据
     */
    exportKeywords(category = null) {
        if (category) {
            return { [category]: this.keywords[category] || [] };
        }
        return { ...this.keywords };
    }
}

module.exports = KeywordManager;