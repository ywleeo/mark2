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
        
        // this.api.log(this.name, 'Todo List 插件初始化完成');
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
                borderRadius: '4px',
                marginLeft: '-20px!important',
                borderLeft: '2px solid transparent',
                listStyleType: 'none',
                paddingLeft: '5px',
            },
            // 隐藏todo项的原生marker
            'todo-list-item::marker': {
                display: 'none !important'
            },
            'todo-list-item:hover': {
                borderLeft: '2px solid rgb(225, 105, 105)',
                backgroundColor: themeConfig.hoverBackground || (isDark ? '#2b2424' : '#f3f4f6'),
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
            'todo-toggle-button': {
                cursor: 'pointer',
                userSelect: 'none',
                marginLeft: '8px',
                fontSize: '0.85em',
                color: themeConfig.linkColor || (isDark ? '#60a5fa' : '#3b82f6'),
                textDecoration: 'none',
                display: 'inline',
                fontStyle: 'italic',
                opacity: '0.8',
                transition: `all ${animationConfig.duration || '150ms'} ${animationConfig.easing || 'ease-in-out'}`
            },
            'todo-toggle-button:hover': {
                color: themeConfig.linkHoverColor || (isDark ? '#93c5fd' : '#1d4ed8'),
                textDecoration: 'underline',
                opacity: '1'
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
            },
            // 内容容器样式
            'todo-content-container': {
                display: 'block',
                marginLeft: '15px',
                padding: '5px'
            },
            // 收缩状态样式
            'todo-collapsed': {
                overflow: 'visible'
            },
            // 收缩时隐藏内容容器
            'todo-collapsed .todo-content-container': {
                display: 'none !important'
            },
            // 确保文本始终可见
            'todo-collapsed .todo-list-text': {
                display: 'inline-block !important'
            }
        };
        
        // 应用样式
        this.api.addCSSBatch(this.styleConfig);
        
        // this.api.log(this.name, `样式已生成 (${theme} 主题)`);
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
        // 使用事件委托处理点击，只响应 checkbox 的直接点击
        this.clickHandler = (event) => {
            // 处理直接点击 checkbox 的情况
            const isCheckbox = event.target.tagName === 'INPUT' && event.target.type === 'checkbox';
            const hasDataTodoLine = event.target.hasAttribute && event.target.hasAttribute('data-todo-line');
            
            // 只有直接点击了带有 data-todo-line 属性的 checkbox 才处理
            if (isCheckbox && hasDataTodoLine) {
                // 检查是否为嵌套任务
                const isNestedTask = event.target.hasAttribute('data-nested-task');
                
                // 不阻止默认行为，让checkbox正常切换
                // 使用setTimeout确保checkbox状态已经更新
                setTimeout(() => {
                    this.handleCheckboxClick(event.target, event.target.checked, isNestedTask);
                }, 0);
                return;
            }
            
            // 处理点击 更多/收起 按钮进行收缩/展开
            const isToggleButton = event.target.classList && event.target.classList.contains('todo-toggle-button');
            if (isToggleButton) {
                event.preventDefault();
                event.stopPropagation();
                this.handleToggleClick(event.target);
                return;
            }
            
            // 其他所有点击都不处理，让用户可以正常选中文字或执行其他操作
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
                        // this.api.log(this.name, '主题已切换，重新生成样式');
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
    processMarkdown(html, originalContent = null) {
        
        try {
            // 优先使用传入的原始内容
            let content = originalContent;
            
            // 如果没有传入原始内容，尝试获取当前文件内容
            if (!content) {
                const currentFile = this.getCurrentFileInfo();
                if (!currentFile || !currentFile.content) {
                    return html;
                }
                content = currentFile.content;
            }
            
            // 解析任务列表并增强 HTML
            const enhancedHtml = this.enhanceTaskLists(html, content);
            
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
            
            // 方法2：从 Tab 系统获取活动 tab 的内容（适用于预览模式）
            if (window.tabManager && typeof window.tabManager.getActiveTab === 'function') {
                const activeTab = window.tabManager.getActiveTab();
                if (activeTab && activeTab.content) {
                    return {
                        path: activeTab.filePath || 'current',
                        content: activeTab.content
                    };
                }
            }
            
            // 方法3：如果都不可用，最后尝试从预览内容推断
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
        
        // 如果启用了排序功能，对任务列表进行排序
        if (this.config.general?.sortTasks) {
            this.sortTaskLists(tempDiv, taskLineMap);
        } else {
            // 原有的增强逻辑：按原始顺序处理
            this.enhanceTaskListsOriginalOrder(tempDiv, taskLineMap);
        }
        
        // 无论是否排序，都需要处理嵌套任务
        this.enhanceNestedTasks(tempDiv, taskLineMap);
        
        return tempDiv.innerHTML;
    }

    /**
     * 按原始顺序增强任务列表（原有逻辑）
     */
    enhanceTaskListsOriginalOrder(tempDiv, taskLineMap) {
        // 处理顶级任务项
        this.enhanceTopLevelTasks(tempDiv, taskLineMap);
    }
    
    /**
     * 增强顶级任务项（对应文件中的 todo 行）
     */
    enhanceTopLevelTasks(tempDiv, taskLineMap) {
        // 只选择顶级列表中的 li 元素，排除嵌套列表
        const topLevelLists = tempDiv.querySelectorAll('ul, ol');
        let taskIndex = 0;
        
        topLevelLists.forEach(list => {
            // 获取该列表的直接子元素（顶级任务）
            Array.from(list.children).forEach(li => {
                const checkbox = li.querySelector(':scope > input[type="checkbox"], :scope > p > input[type="checkbox"]');
                if (checkbox) {
                    const lineInfo = taskLineMap[taskIndex];
                    
                    if (lineInfo) {
                        this.enhanceTaskItem(li, checkbox, lineInfo);
                    }
                    taskIndex++;
                }
            });
        });
    }
    
    /**
     * 增强嵌套的子任务项
     */
    enhanceNestedTasks(tempDiv, taskLineMap) {
        // 查找所有嵌套的 todo 项（在其他 li 内部的 li）
        const nestedTodoItems = tempDiv.querySelectorAll('li li');
        
        // this.api.log(this.name, `找到 ${nestedTodoItems.length} 个嵌套任务`);
        
        // 获取所有嵌套任务的信息
        const nestedTasksFromFile = taskLineMap.filter(task => task.isNested);
        let nestedTaskIndex = 0;
        
        nestedTodoItems.forEach((li, index) => {
            const checkbox = li.querySelector('input[type="checkbox"]');
            // this.api.log(this.name, `处理嵌套任务 ${index}: checkbox=${!!checkbox}`);
            
            if (checkbox) {
                // 尝试匹配文件中对应的嵌套任务
                let lineInfo = null;
                if (nestedTaskIndex < nestedTasksFromFile.length) {
                    lineInfo = nestedTasksFromFile[nestedTaskIndex];
                    nestedTaskIndex++;
                } else {
                    // 如果没有对应的文件行，创建伪造的 lineInfo（只用于样式）
                    lineInfo = {
                        lineNumber: -1000 - index,
                        originalText: li.textContent.trim(),
                        checked: checkbox.checked,
                        text: li.textContent.replace(/^\s*[\[\]x ]*\s*/, '').trim(),
                        collapsed: false,
                        isNested: true
                    };
                }
                
                // this.api.log(this.name, `增强嵌套任务: ${lineInfo.text}, 行号: ${lineInfo.lineNumber}`);
                this.enhanceTaskItem(li, checkbox, lineInfo, lineInfo.lineNumber < 0);
            }
        });
    }

    /**
     * 对任务列表进行排序：未完成的在前，已完成的在后
     */
    sortTaskLists(tempDiv, taskLineMap) {
        // 找到所有包含任务的列表
        const lists = tempDiv.querySelectorAll('ul, ol');
        let globalTaskIndex = 0; // 全局任务索引，对应 taskLineMap 的索引
        
        lists.forEach(list => {
            const taskItems = [];
            const nonTaskItems = [];
            
            // 分离任务项和非任务项，同时记录全局索引
            Array.from(list.children).forEach(li => {
                const checkbox = li.querySelector('input[type="checkbox"]');
                if (checkbox) {
                    taskItems.push({
                        element: li,
                        checkbox: checkbox,
                        checked: checkbox.checked,
                        globalIndex: globalTaskIndex  // 保存全局索引，用于映射到正确的行号
                    });
                    globalTaskIndex++;
                } else {
                    nonTaskItems.push(li);
                }
            });
            
            if (taskItems.length > 0) {
                // 对任务项排序：未完成的在前，已完成的在后
                taskItems.sort((a, b) => {
                    if (a.checked === b.checked) {
                        // 同一状态内保持原有顺序（使用全局索引）
                        return a.globalIndex - b.globalIndex;
                    }
                    // 未完成的（false）排在前面，已完成的（true）排在后面
                    return a.checked ? 1 : -1;
                });
                
                // 清空列表
                list.innerHTML = '';
                
                // 按排序后的顺序添加任务项，使用全局索引来获取正确的行号映射
                taskItems.forEach(item => {
                    const lineInfo = taskLineMap[item.globalIndex];  // 使用全局索引
                    if (lineInfo) {
                        this.enhanceTaskItem(item.element, item.checkbox, lineInfo);
                    }
                    list.appendChild(item.element);
                });
                
                // 添加非任务项到列表末尾
                nonTaskItems.forEach(item => {
                    list.appendChild(item);
                });
            }
        });
    }

    /**
     * 增强单个任务项
     */
    enhanceTaskItem(li, checkbox, lineInfo, isNestedTask = false) {
        // 添加行号标识
        checkbox.setAttribute('data-todo-line', lineInfo.lineNumber);
        checkbox.setAttribute('data-todo-original', lineInfo.originalText);
        
        // 标记是否为嵌套任务
        if (isNestedTask) {
            checkbox.setAttribute('data-nested-task', 'true');
        }
        
        // 移除 disabled 属性，使 checkbox 可以被点击
        checkbox.removeAttribute('disabled');
        
        // 添加样式类
        li.classList.add('todo-list-item');
        checkbox.classList.add('todo-list-checkbox');
        
        // 重新构造 HTML 结构
        const textNode = this.getTaskTextNode(li);
        if (textNode) {
            // 创建文本 span
            const textSpan = document.createElement('span');
            textSpan.classList.add('todo-list-text');
            if (checkbox.checked) {
                textSpan.classList.add('todo-list-completed');
            }
            textSpan.textContent = textNode.textContent;
            
            // 收集真正的额外内容（子列表、段落、代码块等，但排除包含当前任务的主要内容）
            const childNodes = Array.from(li.childNodes);
            const additionalContent = [];
            
            childNodes.forEach(node => {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    // 跳过直接的 checkbox 元素
                    if (node.tagName === 'INPUT' && node.type === 'checkbox') {
                        return;
                    }
                    
                    // 跳过包含当前 checkbox 的段落或容器元素
                    const hasCurrentCheckbox = node.querySelector && node.querySelector(`input[data-todo-line="${lineInfo.lineNumber}"]`);
                    if (hasCurrentCheckbox) {
                        return;
                    }
                    
                    // 跳过只包含任务文本的纯文本段落
                    if (node.tagName === 'P' && node.textContent.trim() === lineInfo.text.trim()) {
                        return;
                    }
                    
                    // 这是真正的额外内容（子列表、段落、代码块等）
                    additionalContent.push(node.cloneNode(true));
                } else if (node.nodeType === Node.TEXT_NODE) {
                    const trimmed = node.textContent.trim();
                    // 只保留不等于任务文本的有意义文本节点
                    if (trimmed !== '' && trimmed !== lineInfo.text.trim()) {
                        additionalContent.push(node.cloneNode(true));
                    }
                }
            });
            
            // 检查是否有真正的额外内容
            const hasAdditionalContent = additionalContent.length > 0;
            
            // 清空 li 并重新构建结构
            li.innerHTML = '';
            
            // checkbox + span 的结构
            li.appendChild(checkbox);
            li.appendChild(textSpan);
            
            // 如果有额外内容，创建容器并添加展开功能
            if (hasAdditionalContent) {
                // 给li添加has-collapsible类
                li.classList.add('has-collapsible');
                
                // 创建 更多/收起 按钮
                const toggleButton = document.createElement('span');
                toggleButton.classList.add('todo-toggle-button');
                toggleButton.textContent = '更多...';
                toggleButton.title = '点击展开内容';
                
                // 插入按钮到 textSpan 后面
                textSpan.insertAdjacentElement('afterend', toggleButton);
                
                const contentContainer = document.createElement('div');
                contentContainer.classList.add('todo-content-container');
                
                additionalContent.forEach(node => {
                    contentContainer.appendChild(node);
                });
                
                li.appendChild(contentContainer);
                
                // 恢复保存的收缩状态（从文件中解析得到）
                if (lineInfo.collapsed) {
                    li.classList.add('todo-collapsed');
                    toggleButton.textContent = '更多...';
                    toggleButton.title = '点击展开内容';
                    // this.api.log(this.name, `已恢复收缩状态: 行${lineInfo.lineNumber}`);
                } else {
                    toggleButton.textContent = '收起';
                    toggleButton.title = '点击收缩内容';
                }
            }
        }
    }

    /**
     * 构建任务行映射表（包括嵌套任务）
     */
    buildTaskLineMap(lines) {
        const taskLines = [];
        
        lines.forEach((line, index) => {
            const trimmed = line.trim();
            // 匹配任务列表语法：- [ ] 或 - [x] 或 * [ ] 或 * [x]，可能包含收缩标记
            // 支持缩进的嵌套任务
            const taskMatch = trimmed.match(/^[-*]\s*\[([ x])\]\s*(.*)$/);
            if (taskMatch) {
                let text = taskMatch[2];
                let collapsed = false;
                
                // 检查是否有收缩标记注释
                const collapsedMatch = text.match(/^(.*?)\s*<!--\s*collapsed\s*-->$/);
                if (collapsedMatch) {
                    text = collapsedMatch[1].trim();
                    collapsed = true;
                }
                
                // 计算缩进级别
                const indent = line.length - line.trimLeft().length;
                const isNested = indent > 0;
                
                taskLines.push({
                    lineNumber: index,
                    originalText: line,
                    checked: taskMatch[1] === 'x',
                    text: text,
                    collapsed: collapsed,
                    isNested: isNested,
                    indent: indent
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
    async handleCheckboxClick(checkbox, newChecked = null, isNestedTask = false) {
        // 嵌套任务不需要更新文件
        if (isNestedTask) {
            // 如果没有传入新状态，使用checkbox当前状态
            if (newChecked === null) {
                newChecked = checkbox.checked;
            }
            // 立即更新UI
            this.updateTaskUI(checkbox, newChecked);
            // this.api.log(this.name, `嵌套任务状态更新: ${newChecked}`);
            return;
        }
        
        const lineNumber = parseInt(checkbox.getAttribute('data-todo-line'));
        
        if (isNaN(lineNumber)) {
            this.api.warn(this.name, '无效的行号:', checkbox.getAttribute('data-todo-line'));
            return;
        }
        
        // 获取当前文件信息来确定真实的文件状态
        const fileInfo = this.getCurrentFileInfo();
        if (!fileInfo) {
            this.api.warn(this.name, '无法获取当前文件信息');
            return;
        }
        
        // 从文件中读取该行的真实状态
        const lines = fileInfo.content.split('\n');
        if (lineNumber >= lines.length) {
            this.api.warn(this.name, '行号超出范围:', lineNumber);
            return;
        }
        
        const line = lines[lineNumber];
        const currentFileState = /\[x\]/.test(line); // true表示已完成，false表示未完成
        const targetState = !currentFileState; // 目标状态是相反的状态
        
        // 更新checkbox显示状态和UI
        checkbox.checked = targetState;
        this.updateTaskUI(checkbox, targetState);
        
        this.api.log(this.name, `处理 checkbox 点击: 行 ${lineNumber}, 文件当前状态: ${currentFileState}, 目标状态: ${targetState}`);
        
        try {
            // 更新文件内容
            const success = await this.updateTaskState(fileInfo, lineNumber, targetState);
            
            if (success) {
                this.api.log(this.name, `任务状态更新成功: 行 ${lineNumber}, 新状态: ${targetState}`);
                // checkbox状态已经在前面设置了，这里不需要再设置
            } else {
                this.api.warn(this.name, `任务状态更新失败: 行 ${lineNumber}, 尝试状态: ${targetState}`);
                // 如果更新失败，恢复checkbox状态
                checkbox.checked = currentFileState;
                this.updateTaskUI(checkbox, currentFileState);
            }
            
        } catch (error) {
            this.api.warn(this.name, '更新任务状态失败:', error);
            // 恢复checkbox状态
            checkbox.checked = currentFileState;
            this.updateTaskUI(checkbox, currentFileState);
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
            
            this.api.log(this.name, `行内容更新: "${line}" → "${newLine}" (目标状态: ${checked})`);
            
            if (newLine === line) {
                this.api.warn(this.name, '行内容没有变化，跳过更新');
                this.api.warn(this.name, `调试信息 - 原行: "${line}"`);
                this.api.warn(this.name, `调试信息 - 正则匹配: ${!!match}, checked: ${checked}`);
                return false;
            }
            
            lines[lineNumber] = newLine;
            const newContent = lines.join('\n');
            
            // 更新文件内容
            await this.updateFileContent(newContent);
            
            // this.api.log(this.name, `文件内容更新完成: 行 ${lineNumber}`);
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
            // 新 Tab 架构下的正确流程

            // 1. 获取活动 Tab
            const activeTab = window.tabManager?.getActiveTab();
            if (!activeTab || !activeTab.filePath) {
                this.api.warn(this.name, '无法获取活动 Tab 或文件路径');
                return;
            }

            // 2. 更新 Tab 的内容
            activeTab.content = newContent;
            activeTab.hasUnsavedChanges = true;

            // 3. 更新编辑器内容（如果在编辑模式）
            const editor = document.getElementById('editorTextarea');
            if (editor && activeTab.isEditMode) {
                editor.value = newContent;
                // 触发 input 事件，让编辑器知道内容已变化
                editor.dispatchEvent(new Event('input', { bubbles: true }));
            }

            // 4. 保存文件（带 IPC 连接检测和重连机制）
            if (this.config.general?.autoSave) {
                const success = await this.saveFileWithRetry(activeTab.filePath, newContent);
                if (success) {
                    // 保存成功后标记为已保存
                    activeTab.hasUnsavedChanges = false;
                    this.api.log(this.name, `文件保存成功: ${activeTab.filePath}`);
                } else {
                    this.api.warn(this.name, `文件保存失败: ${activeTab.filePath}`);
                    return;
                }
            }

            // 5. 如果在预览模式，需要延迟重新渲染内容
            if (!activeTab.isEditMode) {
                // 使用 setTimeout 确保保存操作完成后再重新渲染
                setTimeout(() => {
                    if (activeTab && activeTab.content === newContent) {
                        activeTab.restoreToEditor();
                    }
                }, 50);
            }

            this.api.log(this.name, '文件内容更新完成');

        } catch (error) {
            this.api.warn(this.name, '更新文件内容失败:', error);
            throw error;
        }
    }

    /**
     * 带重试机制的文件保存（解决休眠后IPC连接失效问题）
     */
    async saveFileWithRetry(filePath, content, maxRetries = 2) {
        const { ipcRenderer } = require('electron');

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                // 如果是第一次尝试失败后的重试，先测试IPC连接
                if (attempt > 1) {
                    this.api.log(this.name, `第 ${attempt} 次尝试保存，先测试IPC连接...`);

                    // 测试IPC连接健康状态
                    await Promise.race([
                        ipcRenderer.invoke('check-file-exists', filePath),
                        new Promise((_, reject) =>
                            setTimeout(() => reject(new Error('IPC健康检查超时')), 3000)
                        )
                    ]);

                    this.api.log(this.name, 'IPC连接测试通过，继续保存文件...');
                }

                // 执行文件保存
                await ipcRenderer.invoke('save-file', filePath, content);

                if (attempt > 1) {
                    this.api.log(this.name, `文件保存成功 (重试第 ${attempt - 1} 次后成功)`);
                }

                return true;

            } catch (error) {
                this.api.warn(this.name, `保存文件失败 (尝试 ${attempt}/${maxRetries}):`, error);

                // 检查是否为IPC连接相关错误
                if (this.isIPCError(error) && attempt < maxRetries) {
                    this.api.log(this.name, '检测到IPC连接问题，将重试...');
                    // 等待一小段时间后重试
                    await new Promise(resolve => setTimeout(resolve, 500));
                    continue;
                } else {
                    // 非IPC错误或已达到最大重试次数
                    if (attempt === maxRetries) {
                        this.api.warn(this.name, `文件保存最终失败，已重试 ${maxRetries - 1} 次`);
                    }
                    return false;
                }
            }
        }

        return false;
    }

    /**
     * 检查是否为IPC连接相关错误
     */
    isIPCError(error) {
        if (!error) return false;
        const errorMessage = error.message || error.toString();
        const ipcErrorPatterns = [
            'Cannot read properties of null',
            'Object has been destroyed',
            'webContents was destroyed',
            'Request timeout',
            'ENOTFOUND',
            'ECONNREFUSED',
            'Context destroyed',
            'Connection lost',
            'IPC timeout',
            'Target is destroyed',
            'main process is not responding',
            'No such channel'
        ];
        return ipcErrorPatterns.some(pattern =>
            errorMessage.toLowerCase().includes(pattern.toLowerCase())
        );
    }

    /**
     * 处理切换按钮点击（收缩/展开功能）
     */
    handleToggleClick(toggleButton) {
        const listItem = toggleButton.closest('li');
        if (!listItem) return;
        
        // 切换收缩状态
        const isCollapsed = listItem.classList.contains('todo-collapsed');
        
        if (isCollapsed) {
            // 展开：移除收缩类
            listItem.classList.remove('todo-collapsed');
            toggleButton.textContent = '收起';
            toggleButton.title = '点击收缩内容';
        } else {
            // 收缩：添加收缩类
            listItem.classList.add('todo-collapsed');
            toggleButton.textContent = '更多...';
            toggleButton.title = '点击展开内容';
        }
        
        // 保存收缩状态到文件
        this.saveCollapseStateToFile(listItem, !isCollapsed);
        
        // 添加切换动画效果（如果启用）
        if (this.config.general?.enableAnimation) {
            listItem.style.transition = 'all 200ms ease-in-out';
        }
        
        const textSpan = listItem.querySelector('.todo-list-text');
        this.api.log(this.name, `Todo 项${isCollapsed ? '展开' : '收缩'}: ${textSpan ? textSpan.textContent : 'unknown'}`);
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
        
        // 不再添加缩放动画效果，避免 zoom item 效果
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
        
        // 优先查找进度注释标记位置
        const progressMarker = '<!-- todo-progress -->';
        if (html.includes(progressMarker)) {
            // 如果存在进度标记，替换为实际进度
            return html.replace(progressMarker, progressHtml);
        }
        
        // 如果没有进度标记，检查是否有禁用标记
        const noProgressMarker = '<!-- no-todo-progress -->';
        if (html.includes(noProgressMarker)) {
            // 如果存在禁用标记，不显示进度
            return html;
        }
        
        // 默认行为：在第一个任务列表前插入进度指示器
        const firstList = tempDiv.querySelector('ul, ol');
        if (firstList) {
            firstList.insertAdjacentHTML('beforebegin', progressHtml);
        }
        
        return tempDiv.innerHTML;
    }

    /**
     * 保存收缩状态到文件
     */
    async saveCollapseStateToFile(listItem, isCollapsed) {
        try {
            const checkbox = listItem.querySelector('input[type="checkbox"][data-todo-line]');
            if (!checkbox) {
                this.api.log(this.name, '保存状态失败: 找不到checkbox');
                return;
            }
            
            const lineNumber = parseInt(checkbox.getAttribute('data-todo-line'));
            const fileInfo = this.getCurrentFileInfo();
            
            if (!fileInfo || isNaN(lineNumber)) {
                this.api.log(this.name, `保存状态失败: fileInfo=${!!fileInfo}, lineNumber=${lineNumber}`);
                return;
            }
            
            // 更新文件内容
            const success = await this.updateCollapseStateInFile(fileInfo, lineNumber, isCollapsed);
            
            if (success) {
                // this.api.log(this.name, `收缩状态已保存到文件: ${fileInfo.path}:${lineNumber} = ${isCollapsed}`);
            } else {
                this.api.warn(this.name, `保存收缩状态失败: ${fileInfo.path}:${lineNumber}`);
            }
            
        } catch (error) {
            this.api.warn(this.name, '保存收缩状态失败:', error);
        }
    }

    /**
     * 更新文件中的收缩状态标记
     */
    async updateCollapseStateInFile(fileInfo, lineNumber, isCollapsed) {
        try {
            const lines = fileInfo.content.split('\n');
            
            if (lineNumber >= lines.length) {
                this.api.warn(this.name, '行号超出范围:', lineNumber);
                return false;
            }
            
            let line = lines[lineNumber];
            const collapsedCommentPattern = /\s*<!--\s*collapsed\s*-->$/;
            
            if (isCollapsed) {
                // 添加收缩标记：如果没有则添加
                if (!collapsedCommentPattern.test(line)) {
                    line = line.replace(/\s*$/, '') + ' <!-- collapsed -->';
                }
            } else {
                // 移除收缩标记
                line = line.replace(collapsedCommentPattern, '');
            }
            
            // this.api.log(this.name, `行内容更新: "${lines[lineNumber]}" → "${line}"`);
            
            if (line === lines[lineNumber]) {
                this.api.warn(this.name, '行内容没有变化，跳过更新');
                return false;
            }
            
            lines[lineNumber] = line;
            const newContent = lines.join('\n');
            
            // 更新文件内容
            await this.updateFileContent(newContent);
            
            // this.api.log(this.name, `收缩状态标记已更新: 行 ${lineNumber}`);
            return true;
            
        } catch (error) {
            this.api.warn(this.name, '更新文件收缩状态失败:', error);
            return false;
        }
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