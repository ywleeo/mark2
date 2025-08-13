/**
 * Todo List 插件
 * 为 Markdown 任务列表添加交互功能，支持点击切换状态并自动保存
 */

const BasePlugin = require('../BasePlugin');

class TodoListPlugin extends BasePlugin {
    constructor(pluginConfig) {
        super(pluginConfig);
        
        // 任务项映射表：存储 HTML 元素到原始文本行号的映射
        this.taskItemMap = new Map();
        
        // 当前处理的内容标识
        this.currentContentId = null;
        
        // 事件监听器引用，用于清理
        this.clickHandler = null;
        
        // 动态样式配置
        this.styleConfig = {};
    }

    async init() {
        await super.init();
        
        // 生成样式
        this.generateStyles();
        
        // 设置点击事件监听器
        this.setupEventListeners();
        
        this.api.log(this.name, 'Todo List 插件初始化完成');
    }

    /**
     * 生成动态样式
     */
    generateStyles() {
        const isDark = this.isDarkTheme();
        const theme = isDark ? 'dark' : 'light';
        const themeConfig = this.config.styles?.[theme] || this.config.styles?.light || {};
        const animationConfig = this.config.animation || {};
        const checkboxConfig = this.config.checkbox || {};
        
        // 获取对勾位置配置
        const checkmarkPos = themeConfig.checkmarkPosition || { left: '2px', top: '-1px' };
        
        this.styleConfig = {
            'todo-list-item': {
                position: 'relative',
                cursor: 'pointer',
                padding: '4px 0',
                borderRadius: '4px',
                transition: `all ${animationConfig.duration || '200ms'} ${animationConfig.easing || 'ease-in-out'}`,
                marginLeft: '0'
            },
            'todo-list-item:hover': {
                backgroundColor: themeConfig.hoverBackground || (isDark ? '#374151' : '#f3f4f6')
            },
            'todo-list-checkbox': {
                cursor: 'pointer',
                accentColor: `${themeConfig.checkboxColor || (isDark ? '#34d399' : '#10b981')} !important`,
                backgroundColor: `${themeConfig.checkboxBackground || (isDark ? '#2d3748' : '#ffffff')} !important`,
                border: `${checkboxConfig.borderWidth || '2px'} solid ${themeConfig.checkboxBorder || (isDark ? '#4a5568' : '#cbd5e0')} !important`,
                borderRadius: `${checkboxConfig.borderRadius || '3px'} !important`,
                marginRight: '8px',
                width: `${checkboxConfig.size || '16px'} !important`,
                height: `${checkboxConfig.size || '16px'} !important`,
                minWidth: `${checkboxConfig.size || '16px'} !important`,
                minHeight: `${checkboxConfig.size || '16px'} !important`,
                transition: `all ${animationConfig.duration || '200ms'} ${animationConfig.easing || 'ease-in-out'}`,
                appearance: 'none',
                WebkitAppearance: 'none',
                MozAppearance: 'none',
                position: 'relative',
                display: 'inline-block',
                verticalAlign: 'middle'
            },
            'todo-list-checkbox:hover': {
                borderColor: `${themeConfig.checkboxHoverBorder || themeConfig.checkboxColor || (isDark ? '#34d399' : '#10b981')} !important`,
                boxShadow: `0 0 0 2px ${(themeConfig.checkboxHoverBorder || themeConfig.checkboxColor || (isDark ? '#34d399' : '#10b981'))}40 !important`
            },
            'todo-list-checkbox:checked': {
                backgroundColor: `${themeConfig.checkboxCheckedBackground || themeConfig.checkboxColor || (isDark ? '#34d399' : '#10b981')} !important`,
                borderColor: `${themeConfig.checkboxCheckedBorder || themeConfig.checkboxColor || (isDark ? '#34d399' : '#10b981')} !important`
            },
            'todo-list-checkbox:checked::after': {
                content: `"${themeConfig.checkmarkSymbol || '✓'}"`,
                position: 'absolute',
                left: checkmarkPos.left || '2px',
                top: checkmarkPos.top || '-1px',
                fontSize: themeConfig.checkmarkSize || '12px',
                fontWeight: 'bold',
                color: themeConfig.checkmarkColor || '#ffffff',
                lineHeight: '1',
                textAlign: 'center',
                width: '100%',
                pointerEvents: 'none'
            },
            'todo-list-text': {
                transition: `all ${animationConfig.duration || '200ms'} ${animationConfig.easing || 'ease-in-out'}`
            },
            'todo-list-completed': {
                textDecoration: 'line-through',
                color: themeConfig.completedTextColor || (isDark ? '#9ca3af' : '#6b7280'),
                opacity: '0.7'
            },
            'todo-list-progress': {
                fontSize: '0.875rem',
                color: themeConfig.checkboxColor || (isDark ? '#34d399' : '#10b981'),
                fontWeight: 'bold',
                marginBottom: '8px'
            }
        };
        
        // 应用样式
        this.api.addCSSBatch(this.styleConfig);
        
        this.api.log(this.name, `样式已生成 (${theme} 主题)`);
    }

    /**
     * 检测当前主题
     */
    isDarkTheme() {
        const themeCSS = document.getElementById('theme-css');
        if (themeCSS && themeCSS.href) {
            return themeCSS.href.includes('dark-theme.css');
        }
        return localStorage.getItem('theme') === 'dark';
    }

    /**
     * 设置事件监听器
     */
    setupEventListeners() {
        // 使用事件委托处理点击
        this.clickHandler = (event) => {
            // 检查是否直接点击了 checkbox
            const isCheckbox = event.target.tagName === 'INPUT' && event.target.type === 'checkbox';
            const hasDataTodoLine = event.target.hasAttribute && event.target.hasAttribute('data-todo-line');
            
            // 首先检查直接点击的是否是 checkbox
            if (isCheckbox && hasDataTodoLine) {
                // 不阻止默认行为，让checkbox正常切换
                // 使用setTimeout确保checkbox状态已经更新
                setTimeout(() => {
                    this.handleCheckboxClick(event.target, event.target.checked);
                }, 0);
                return;
            }
            
            // 如果不是直接点击 checkbox，检查是否点击了包含 checkbox 的 li 元素或文字
            const parentLi = event.target.closest('li.todo-list-item');
            const checkboxInLi = parentLi ? parentLi.querySelector('input[type="checkbox"][data-todo-line]') : null;
            
            // 只有当点击的不是checkbox本身时，才处理li点击
            if (checkboxInLi && !isCheckbox) {
                event.preventDefault();
                // 切换checkbox状态并处理
                const newState = !checkboxInLi.checked;
                checkboxInLi.checked = newState;
                this.handleCheckboxClick(checkboxInLi, newState);
                return;
            }
        };
        
        document.addEventListener('click', this.clickHandler, true);
        
        // 监听主题变化
        this.setupThemeListener();
    }

    /**
     * 设置主题监听器
     */
    setupThemeListener() {
        const themeCSS = document.getElementById('theme-css');
        if (!themeCSS) return;
        
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'href') {
                    setTimeout(() => {
                        this.api.log(this.name, '主题已切换，重新生成样式');
                        this.generateStyles();
                    }, 100);
                }
            });
        });
        
        observer.observe(themeCSS, {
            attributes: true,
            attributeFilter: ['href']
        });
        
        this.themeObserver = observer;
    }

    /**
     * 处理 Markdown 渲染
     * 增强生成的 HTML，添加交互功能
     */
    processMarkdown(html) {
        
        try {
            // 获取当前文件内容用于行号映射
            const currentFile = this.getCurrentFileInfo();
            if (!currentFile || !currentFile.content) {
                return html;
            }
            
            // 解析任务列表并增强 HTML
            const enhancedHtml = this.enhanceTaskLists(html, currentFile.content);
            
            // 添加进度显示（如果启用）
            if (this.config.general?.showProgress) {
                return this.addProgressIndicator(enhancedHtml);
            }
            
            return enhancedHtml;
            
        } catch (error) {
            this.api.warn(this.name, '处理失败:', error);
            return html;
        }
    }

    /**
     * 获取当前文件信息
     */
    getCurrentFileInfo() {
        try {
            // 方法1：从编辑器获取内容（最可靠的方式）
            const editor = document.getElementById('editorTextarea');
            if (editor && editor.value) {
                // 获取文件路径
                let filePath = 'current';
                if (window.appManager && typeof window.appManager.getCurrentFilePath === 'function') {
                    filePath = window.appManager.getCurrentFilePath() || 'current';
                }
                
                return {
                    path: filePath,
                    content: editor.value
                };
            }
            
            // 方法2：如果编辑器不可用，尝试从预览内容推断
            const previewElement = document.getElementById('content');
            if (previewElement && window.appManager) {
                // 这种情况下我们无法获取原始内容，只能跳过
                this.api.warn(this.name, '预览模式下无法获取原始 Markdown 内容');
                return null;
            }
            
            return null;
        } catch (error) {
            this.api.warn(this.name, '获取文件信息失败:', error);
            return null;
        }
    }

    /**
     * 增强任务列表 HTML
     */
    enhanceTaskLists(html, originalContent) {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;
        
        // 构建原始内容的行映射
        const lines = originalContent.split('\n');
        const taskLineMap = this.buildTaskLineMap(lines);
        
        // 找到所有任务列表项
        const listItems = tempDiv.querySelectorAll('li');
        let taskIndex = 0;
        
        listItems.forEach((li) => {
            const checkbox = li.querySelector('input[type="checkbox"]');
            if (checkbox) {
                // 这是一个任务列表项
                const lineInfo = taskLineMap[taskIndex];
                
                if (lineInfo) {
                    // 添加行号标识
                    checkbox.setAttribute('data-todo-line', lineInfo.lineNumber);
                    checkbox.setAttribute('data-todo-original', lineInfo.originalText);
                    
                    // 添加样式类
                    li.classList.add('todo-list-item');
                    checkbox.classList.add('todo-list-checkbox');
                    
                    // 为文本添加样式类
                    const textNode = this.getTaskTextNode(li);
                    if (textNode) {
                        const span = document.createElement('span');
                        span.classList.add('todo-list-text');
                        if (checkbox.checked) {
                            span.classList.add('todo-list-completed');
                        }
                        span.textContent = textNode.textContent;
                        textNode.parentNode.replaceChild(span, textNode);
                    }
                }
                taskIndex++;
            }
        });
        
        return tempDiv.innerHTML;
    }

    /**
     * 构建任务行映射表
     */
    buildTaskLineMap(lines) {
        const taskLines = [];
        
        lines.forEach((line, index) => {
            const trimmed = line.trim();
            // 匹配任务列表语法：- [ ] 或 - [x] 或 * [ ] 或 * [x]
            const taskMatch = trimmed.match(/^[-*]\s*\[([ x])\]\s*(.*)$/);
            if (taskMatch) {
                taskLines.push({
                    lineNumber: index,
                    originalText: line,
                    checked: taskMatch[1] === 'x',
                    text: taskMatch[2]
                });
            }
        });
        
        return taskLines;
    }

    /**
     * 获取任务文本节点
     */
    getTaskTextNode(listItem) {
        const walker = document.createTreeWalker(
            listItem,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode: (node) => {
                    // 跳过checkbox内的文本
                    return node.parentElement.tagName !== 'INPUT' ? 
                        NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
                }
            }
        );
        
        let textNode;
        while (textNode = walker.nextNode()) {
            if (textNode.textContent.trim()) {
                return textNode;
            }
        }
        
        return null;
    }

    /**
     * 处理复选框点击
     */
    async handleCheckboxClick(checkbox, newChecked = null) {
        const lineNumber = parseInt(checkbox.getAttribute('data-todo-line'));
        
        if (isNaN(lineNumber)) {
            this.api.warn(this.name, '无效的行号:', checkbox.getAttribute('data-todo-line'));
            return;
        }
        
        // 如果没有传入新状态，使用checkbox当前状态
        if (newChecked === null) {
            newChecked = checkbox.checked;
        }
        
        this.api.log(this.name, `处理 checkbox 点击: 行 ${lineNumber}, 新状态: ${newChecked}`);
        
        try {
            // 获取当前文件信息
            const fileInfo = this.getCurrentFileInfo();
            
            if (!fileInfo) {
                this.api.warn(this.name, '无法获取当前文件信息');
                return;
            }
            
            // 更新文件内容
            const success = await this.updateTaskState(fileInfo, lineNumber, newChecked);
            
            if (success) {
                this.api.log(this.name, `任务状态更新成功: 行 ${lineNumber}, 新状态: ${newChecked}`);
                // 确保checkbox状态正确
                checkbox.checked = newChecked;
                // 立即更新UI
                this.updateTaskUI(checkbox, newChecked);
            } else {
                this.api.warn(this.name, `任务状态更新失败: 行 ${lineNumber}, 尝试状态: ${newChecked}`);
                // 如果更新失败，恢复checkbox状态
                checkbox.checked = !newChecked;
            }
            
        } catch (error) {
            this.api.warn(this.name, '更新任务状态失败:', error);
            // 恢复checkbox状态
            checkbox.checked = !newChecked;
        }
    }

    /**
     * 更新任务状态
     */
    async updateTaskState(fileInfo, lineNumber, checked) {
        try {
            const lines = fileInfo.content.split('\n');
            
            if (lineNumber >= lines.length) {
                this.api.warn(this.name, '行号超出范围:', lineNumber);
                return false;
            }
            
            const line = lines[lineNumber];
            
            // 更宽松的正则表达式，支持任意空白字符和 - 或 * 开头
            const regex = /^(\s*[-*]\s*\[)[ x](\].*)/;
            const match = line.match(regex);
            
            if (!match) {
                this.api.warn(this.name, '未找到有效的任务列表语法:', line);
                return false;
            }
            
            const newLine = line.replace(regex, `$1${checked ? 'x' : ' '}$2`);
            
            this.api.log(this.name, `行内容更新: "${line}" → "${newLine}"`);
            
            if (newLine === line) {
                this.api.warn(this.name, '行内容没有变化，跳过更新');
                return false;
            }
            
            lines[lineNumber] = newLine;
            const newContent = lines.join('\n');
            
            // 更新文件内容
            await this.updateFileContent(newContent);
            
            this.api.log(this.name, `文件内容更新完成: 行 ${lineNumber}`);
            return true;
            
        } catch (error) {
            this.api.warn(this.name, '更新文件内容失败:', error);
            return false;
        }
    }

    /**
     * 更新文件内容并保存
     */
    async updateFileContent(newContent) {
        try {
            // 直接更新编辑器内容
            const editor = document.getElementById('editorTextarea');
            if (editor) {
                // 更新编辑器内容
                editor.value = newContent;
                
                // 触发 input 事件，让编辑器知道内容已变化
                editor.dispatchEvent(new Event('input', { bubbles: true }));
                
                // 更新 EditorManager 的状态
                if (window.editorManager) {
                    // 同步更新 originalContent，确保编辑模式切换时内容一致
                    window.editorManager.originalContent = newContent;
                    this.api.log(this.name, 'EditorManager.originalContent 已同步更新');
                    
                    // 标记为有未保存的更改
                    window.editorManager.hasUnsavedChanges = true;
                    window.editorManager.updateSaveButton();
                    
                    // 如果启用自动保存，触发保存
                    if (this.config.general?.autoSave && typeof window.editorManager.saveFile === 'function') {
                        await window.editorManager.saveFile();
                    }
                } else {
                    // 备用方法：点击保存按钮
                    if (this.config.general?.autoSave) {
                        setTimeout(() => {
                            const saveButton = document.getElementById('saveButton');
                            if (saveButton && !saveButton.disabled) {
                                saveButton.click();
                            }
                        }, 100);
                    }
                }
                
                // 如果在预览模式，需要重新渲染
                if (!document.body.classList.contains('edit-mode')) {
                    // 触发内容变化事件，让应用重新渲染预览
                    if (window.eventManager) {
                        window.eventManager.emit('content-changed');
                    }
                }
                
                return;
            }
            
            this.api.warn(this.name, '找不到编辑器元素');
            
        } catch (error) {
            this.api.warn(this.name, '更新编辑器内容失败:', error);
            throw error;
        }
    }

    /**
     * 更新任务 UI 状态
     */
    updateTaskUI(checkbox, checked) {
        const listItem = checkbox.closest('li');
        if (!listItem) return;
        
        const textSpan = listItem.querySelector('.todo-list-text');
        if (textSpan) {
            if (checked) {
                textSpan.classList.add('todo-list-completed');
            } else {
                textSpan.classList.remove('todo-list-completed');
            }
        }
        
        // 添加完成动画效果（如果启用）
        if (this.config.general?.enableAnimation) {
            listItem.style.transform = 'scale(0.98)';
            setTimeout(() => {
                listItem.style.transform = '';
            }, 150);
        }
    }

    /**
     * 添加进度指示器
     */
    addProgressIndicator(html) {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;
        
        const checkboxes = tempDiv.querySelectorAll('input[type="checkbox"][data-todo-line]');
        if (checkboxes.length === 0) return html;
        
        const completed = Array.from(checkboxes).filter(cb => cb.checked).length;
        const total = checkboxes.length;
        const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
        
        const progressHtml = `
            <div class="todo-list-progress">
                📋 任务进度: ${completed}/${total} (${percentage}%)
            </div>
        `;
        
        // 在第一个任务列表前插入进度指示器
        const firstList = tempDiv.querySelector('ul, ol');
        if (firstList) {
            firstList.insertAdjacentHTML('beforebegin', progressHtml);
        }
        
        return tempDiv.innerHTML;
    }

    /**
     * 销毁插件
     */
    async destroy() {
        // 清理事件监听器
        if (this.clickHandler) {
            document.removeEventListener('click', this.clickHandler, true);
            this.clickHandler = null;
        }
        
        // 清理主题监听器
        if (this.themeObserver) {
            this.themeObserver.disconnect();
            this.themeObserver = null;
        }
        
        // 清理数据
        this.taskItemMap.clear();
        this.styleConfig = {};
        
        await super.destroy();
    }
}

module.exports = TodoListPlugin;