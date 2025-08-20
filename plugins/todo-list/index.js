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
                transition: `all ${animationConfig.duration || '200ms'} ${animationConfig.easing || 'ease-in-out'}`,
                marginLeft: '0',
                borderLeft: '2px solid transparent',
                listStyleType: 'none'
            },
            // 隐藏todo项的原生marker
            'todo-list-item::marker': {
                display: 'none !important'
            },
            'todo-list-item:hover': {
                borderLeft: '2px solid rgba(115, 119, 193, 0.25)',
                // backgroundColor: themeConfig.hoverBackground || (isDark ? '#374151' : '#f3f4f6')
            },
            // 默认显示圆点（普通todo项）
            'todo-list-item::after': {
                content: '"●"',
                position: 'absolute',
                left: '-15px',
                top: '10px',
                fontSize: '8px',
                color: themeConfig.checkboxColor || (isDark ? '#34d399' : '#10b981'),
                lineHeight: '1'
            },
            // 有折叠内容的显示三角形（覆盖圆点）
            'todo-list-item.has-collapsible::after': {
                content: '"▼" !important',
                fontSize: '12px !important',
                top: '12px !important',
                color: '#ffb650',
                transition: `transform ${animationConfig.duration || '200ms'} ${animationConfig.easing || 'ease-in-out'}`
            },
            // 收缩时旋转三角形
            'todo-list-item.todo-collapsed::after': {
                transform: 'rotate(-90deg)'
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
            'todo-collapsible': {
                cursor: 'pointer',
                userSelect: 'none',
                borderRadius: '3px',
                padding: '2px 4px',
                display: 'inline-block',
                position: 'relative'
            },
            'todo-collapsible:hover': {
                backgroundColor: themeConfig.hoverBackground || (isDark ? '#374151' : '#f3f4f6'),
                boxShadow: `0 1px 3px ${isDark ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.1)'}`
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
                display: 'inline'
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
            
            // 处理点击 todo 文本进行收缩/展开 - 只有可收缩的文本才响应
            const isTodoCollapsible = event.target.classList && 
                event.target.classList.contains('todo-list-text') && 
                event.target.classList.contains('todo-collapsible');
            if (isTodoCollapsible) {
                event.preventDefault();
                event.stopPropagation();
                this.handleTextClick(event.target);
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
        
        this.api.log(this.name, `找到 ${nestedTodoItems.length} 个嵌套任务`);
        
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
                
                this.api.log(this.name, `增强嵌套任务: ${lineInfo.text}, 行号: ${lineInfo.lineNumber}`);
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
                // 给li添加has-collapsible类，用于显示三角形
                li.classList.add('has-collapsible');
                textSpan.classList.add('todo-collapsible');
                textSpan.title = '点击收缩/展开内容';
                
                const contentContainer = document.createElement('div');
                contentContainer.classList.add('todo-content-container');
                
                additionalContent.forEach(node => {
                    contentContainer.appendChild(node);
                });
                
                li.appendChild(contentContainer);
                
                // 恢复保存的收缩状态（从文件中解析得到）
                if (lineInfo.collapsed) {
                    li.classList.add('todo-collapsed');
                    textSpan.title = '点击展开内容';
                    this.api.log(this.name, `已恢复收缩状态: 行${lineInfo.lineNumber}`);
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
        // 如果没有传入新状态，使用checkbox当前状态
        if (newChecked === null) {
            newChecked = checkbox.checked;
        }
        
        // 立即更新UI
        this.updateTaskUI(checkbox, newChecked);
        
        // 嵌套任务不需要更新文件
        if (isNestedTask) {
            this.api.log(this.name, `嵌套任务状态更新: ${newChecked}`);
            return;
        }
        
        const lineNumber = parseInt(checkbox.getAttribute('data-todo-line'));
        
        if (isNaN(lineNumber)) {
            this.api.warn(this.name, '无效的行号:', checkbox.getAttribute('data-todo-line'));
            return;
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
            } else {
                this.api.warn(this.name, `任务状态更新失败: 行 ${lineNumber}, 尝试状态: ${newChecked}`);
                // 如果更新失败，恢复checkbox状态
                checkbox.checked = !newChecked;
                this.updateTaskUI(checkbox, !newChecked);
            }
            
        } catch (error) {
            this.api.warn(this.name, '更新任务状态失败:', error);
            // 恢复checkbox状态
            checkbox.checked = !newChecked;
            this.updateTaskUI(checkbox, !newChecked);
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
            
            // this.api.log(this.name, `行内容更新: "${line}" → "${newLine}"`);
            
            if (newLine === line) {
                this.api.warn(this.name, '行内容没有变化，跳过更新');
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
                    // this.api.log(this.name, 'EditorManager.originalContent 已同步更新');
                    
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
     * 处理文本点击（收缩/展开功能）
     */
    handleTextClick(textSpan) {
        const listItem = textSpan.closest('li');
        if (!listItem) return;
        
        // 切换收缩状态
        const isCollapsed = listItem.classList.contains('todo-collapsed');
        
        if (isCollapsed) {
            // 展开：移除收缩类
            listItem.classList.remove('todo-collapsed');
            textSpan.title = '点击收缩内容';
        } else {
            // 收缩：添加收缩类
            listItem.classList.add('todo-collapsed');
            textSpan.title = '点击展开内容';
        }
        
        // 保存收缩状态到文件
        this.saveCollapseStateToFile(listItem, !isCollapsed);
        
        // 添加切换动画效果（如果启用）
        if (this.config.general?.enableAnimation) {
            listItem.style.transition = 'all 200ms ease-in-out';
        }
        
        this.api.log(this.name, `Todo 项${isCollapsed ? '展开' : '收缩'}: ${textSpan.textContent}`);
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
                this.api.log(this.name, `收缩状态已保存到文件: ${fileInfo.path}:${lineNumber} = ${isCollapsed}`);
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
            
            this.api.log(this.name, `行内容更新: "${lines[lineNumber]}" → "${line}"`);
            
            if (line === lines[lineNumber]) {
                this.api.warn(this.name, '行内容没有变化，跳过更新');
                return false;
            }
            
            lines[lineNumber] = line;
            const newContent = lines.join('\n');
            
            // 更新文件内容
            await this.updateFileContent(newContent);
            
            this.api.log(this.name, `收缩状态标记已更新: 行 ${lineNumber}`);
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