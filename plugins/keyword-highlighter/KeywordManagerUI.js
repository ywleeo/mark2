/**
 * 关键词管理UI组件
 * 提供添加、删除关键词的用户界面
 */

class KeywordManagerUI {
    constructor(keywordManager, platformAPI) {
        this.keywordManager = keywordManager;
        this.api = platformAPI;
        this.currentModal = null;
    }

    /**
     * 显示添加关键词的对话框
     * @param {string} selectedText - 选中的文本
     */
    showAddKeywordDialog(selectedText) {
        const categories = this.keywordManager.getCategories();
        const categoryOptions = categories.map(cat => `<option value="${cat}">${this.getCategoryDisplayName(cat)}</option>`).join('');

        const content = `
            <div class="keyword-dialog">
                <div class="keyword-form-group">
                    <label class="keyword-form-label">要添加的关键词：</label>
                    <input type="text" id="keyword-input" value="${selectedText}" class="keyword-form-input">
                </div>
                
                <div class="keyword-form-group has-select">
                    <label class="keyword-form-label">选择分类：</label>
                    <select id="category-select" class="keyword-form-select">
                        ${categoryOptions}
                    </select>
                </div>
                
                <div class="keyword-form-actions">
                    <button id="cancel-btn" class="btn-secondary">取消</button>
                    <button id="confirm-btn" class="btn-primary">确定</button>
                </div>
            </div>
        `;

        this.currentModal = this.api.createModal({
            title: '添加关键词',
            content: content,
            width: '400px'
        });

        // 绑定事件
        const keywordInput = document.getElementById('keyword-input');
        const categorySelect = document.getElementById('category-select');
        const cancelBtn = document.getElementById('cancel-btn');
        const confirmBtn = document.getElementById('confirm-btn');

        // 自动聚焦并选中文本
        setTimeout(() => {
            keywordInput.focus();
            keywordInput.select();
        }, 100);

        // 回车确认
        keywordInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.handleAddKeyword();
            }
        });

        cancelBtn.addEventListener('click', () => {
            this.currentModal.close();
        });

        confirmBtn.addEventListener('click', () => {
            this.handleAddKeyword();
        });
    }

    /**
     * 处理添加关键词
     */
    handleAddKeyword() {
        const keywordInput = document.getElementById('keyword-input');
        const categorySelect = document.getElementById('category-select');
        
        const keyword = keywordInput.value.trim();
        const category = categorySelect.value;

        if (!keyword) {
            this.showMessage('关键词不能为空', 'error');
            return;
        }

        const result = this.keywordManager.addKeyword(category, keyword);
        
        if (result.success) {
            this.showMessage('关键词添加成功', 'success');
            this.currentModal.close();
            
            // 触发内容重新渲染
            this.triggerContentRefresh();
        } else if (result.existsInCategory) {
            // 关键词在其他分类中存在，询问是否移动
            this.showMoveConfirmDialog(keyword, result.existsInCategory, category);
        } else {
            this.showMessage(result.message, 'error');
        }
    }

    /**
     * 显示移动确认对话框
     */
    showMoveConfirmDialog(keyword, fromCategory, toCategory) {
        const content = `
            <div class="keyword-move-dialog">
                <div class="keyword-move-message">
                    关键词 "<strong>${keyword}</strong>" 已存在于 "<strong>${this.getCategoryDisplayName(fromCategory)}</strong>" 分类中。
                </div>
                <div class="keyword-move-message">
                    是否要将其移动到 "<strong>${this.getCategoryDisplayName(toCategory)}</strong>" 分类？
                </div>
                
                <div class="keyword-form-actions">
                    <button id="cancel-move-btn" class="btn-secondary">取消</button>
                    <button id="confirm-move-btn" class="btn-primary">移动</button>
                </div>
            </div>
        `;

        // 关闭当前对话框
        this.currentModal.close();

        // 显示新对话框
        this.currentModal = this.api.createModal({
            title: '关键词已存在',
            content: content,
            width: '400px'
        });

        const cancelBtn = document.getElementById('cancel-move-btn');
        const confirmBtn = document.getElementById('confirm-move-btn');

        cancelBtn.addEventListener('click', () => {
            this.currentModal.close();
        });

        confirmBtn.addEventListener('click', () => {
            const result = this.keywordManager.moveKeyword(keyword, fromCategory, toCategory);
            
            if (result.success) {
                this.showMessage(result.message, 'success');
                this.triggerContentRefresh();
            } else {
                this.showMessage(result.message, 'error');
            }
            
            this.currentModal.close();
        });
    }

    /**
     * 显示删除关键词的确认对话框
     * @param {string} keyword - 要删除的关键词
     */
    showDeleteKeywordDialog(keyword) {
        const categories = this.keywordManager.findKeywordCategories(keyword);
        
        if (categories.length === 0) {
            this.showMessage('该关键词未被高亮', 'info');
            return;
        }

        const categoryList = categories.map(cat => `<li>${this.getCategoryDisplayName(cat)}</li>`).join('');

        const content = `
            <div class="keyword-delete-dialog">
                <div class="keyword-move-message">
                    关键词 "<strong>${keyword}</strong>" 存在于以下分类中：
                </div>
                <ul class="keyword-delete-list">
                    ${categoryList}
                </ul>
                <div class="keyword-delete-warning">
                    确定要从所有分类中删除该关键词吗？
                </div>
                
                <div class="keyword-form-actions">
                    <button id="cancel-delete-btn" class="btn-secondary">取消</button>
                    <button id="confirm-delete-btn" class="btn-danger">删除</button>
                </div>
            </div>
        `;

        this.currentModal = this.api.createModal({
            title: '删除关键词',
            content: content,
            width: '400px'
        });

        const cancelBtn = document.getElementById('cancel-delete-btn');
        const confirmBtn = document.getElementById('confirm-delete-btn');

        cancelBtn.addEventListener('click', () => {
            this.currentModal.close();
        });

        confirmBtn.addEventListener('click', () => {
            this.handleDeleteKeyword(keyword, categories);
        });
    }

    /**
     * 处理删除关键词
     */
    handleDeleteKeyword(keyword, categories) {
        let allSuccess = true;
        let errorMessages = [];

        categories.forEach(category => {
            const result = this.keywordManager.removeKeyword(category, keyword);
            if (!result.success) {
                allSuccess = false;
                errorMessages.push(`从 ${this.getCategoryDisplayName(category)} 删除失败: ${result.message}`);
            }
        });

        if (allSuccess) {
            this.showMessage('关键词删除成功', 'success');
            this.triggerContentRefresh();
        } else {
            this.showMessage(`删除过程中出现错误:\n${errorMessages.join('\n')}`, 'error');
        }

        this.currentModal.close();
    }

    /**
     * 获取分类的显示名称
     */
    getCategoryDisplayName(category) {
        const displayNames = {
            'entities': '实体词',
            'hotwords': '热词',
            'numbers': '数字词',
            'dates': '日期词'
        };
        return displayNames[category] || category;
    }

    /**
     * 显示消息提示
     */
    showMessage(message, type = 'info') {
        // 确保样式是最新的
        this.api.updatePlatformUITheme();

        const messageEl = document.createElement('div');
        messageEl.className = `message-toast ${type}`;
        messageEl.textContent = message;

        document.body.appendChild(messageEl);

        // 3秒后自动消失
        setTimeout(() => {
            if (messageEl.parentNode) {
                messageEl.remove();
            }
        }, 3000);
    }

    /**
     * 触发内容重新渲染
     */
    triggerContentRefresh() {
        // 重新加载关键词数据
        if (window.pluginManager) {
            const keywordPlugin = window.pluginManager.getPlugin('keyword-highlighter');
            if (keywordPlugin) {
                keywordPlugin.loadCustomKeywords();
            }
        }

        // 通知EditorManager更新预览内容
        if (window.editorManager && window.tabManager) {
            const activeTab = window.tabManager.getActiveTab();
            if (activeTab && activeTab.content) {
                window.editorManager.updatePreview(activeTab.content);
            }
        }
    }
}

module.exports = KeywordManagerUI;