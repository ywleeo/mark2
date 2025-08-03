class EditorManager {
  constructor(markdownRenderer, eventManager, appManager) {
    this.markdownRenderer = markdownRenderer;
    this.eventManager = eventManager;
    this.appManager = appManager;
    this.isEditMode = false;
    this.currentFilePath = null;
    this.originalContent = '';
    this.hasUnsavedChanges = false;
    
    // 滚动位置记录
    this.previewScrollPosition = 0;
    this.editorScrollPosition = 0;
    
    // 保存切换前的容器尺寸信息
    this.previewDimensions = { scrollHeight: 0, clientHeight: 0 };
    this.editorDimensions = { scrollHeight: 0, clientHeight: 0 };
    
    // Markdown 语法高亮器
    this.markdownHighlighter = null;
    
    // 窗口大小调整防抖定时器
    this.resizeTimer = null;
    // 窗口是否稳定的标志
    this.isWindowStable = true;
    
    this.setupEditor();
    this.setupResizeHandler();
  }

  setupEditor() {
    const editor = document.getElementById('editorTextarea');
    if (!editor) return;
    
    // 监听编辑器内容变化
    editor.addEventListener('input', () => {
      this.hasUnsavedChanges = true;
      this.updateSaveButton();
      this.eventManager.emit('content-changed');
    });
    
    // 监听快捷键
    editor.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 's') {
        event.preventDefault();
        this.saveFile();
      }
    });
  }

  // 设置窗口大小调整处理
  setupResizeHandler() {
    window.addEventListener('resize', () => {
      // 标记窗口不稳定
      this.isWindowStable = false;
      
      // 清除之前的定时器
      if (this.resizeTimer) {
        clearTimeout(this.resizeTimer);
      }
      
      // 设置新的定时器，窗口停止调整300ms后标记为稳定
      this.resizeTimer = setTimeout(() => {
        this.isWindowStable = true;
        // 如果在编辑模式且语法高亮器存在，检查是否需要修复
        this.checkAndFixHighlighterIfNeeded();
      }, 300);
    });
  }

  // 检查语法高亮器是否需要修复
  checkAndFixHighlighterIfNeeded() {
    if (!this.isEditMode || !this.markdownHighlighter || !this.markdownHighlighter.isReady()) {
      return;
    }
    
    // 检查ldt-output元素的尺寸
    const ldtOutput = document.querySelector('.ldt-output');
    if (ldtOutput) {
      const rect = ldtOutput.getBoundingClientRect();
      
      // 如果ldt-output异常小（比如32x32），说明需要修复
      if (rect.width < 100 || rect.height < 100) {
        // 重新初始化语法高亮器，但不要修改滚动信息
        // 因为previewScrollPosition和previewDimensions包含了从view模式传递过来的重要信息
        this.markdownHighlighter.destroy();
        this.markdownHighlighter = null;
        
        const editor = document.getElementById('editorTextarea');
        setTimeout(() => {
          this.initMarkdownHighlighter(editor);
          // 立即恢复滚动位置，不等待语法高亮器
          // 因为滚动位置恢复与语法高亮是独立的
          setTimeout(() => {
            this.restoreScrollPosition();
          }, 100);
        }, 50);
      }
    }
  }

  // 初始化 Markdown 语法高亮器（在切换到编辑模式时调用）
  async initMarkdownHighlighter(editor) {
    if (this.markdownHighlighter) {
      return; // 已经初始化过了
    }
    
    // 如果窗口不稳定，等待稳定后再初始化
    if (!this.isWindowStable) {
      setTimeout(() => {
        this.initMarkdownHighlighter(editor);
      }, 100);
      return;
    }
    
    try {
      const CodeMirrorHighlighter = require('./CodeMirrorHighlighter');
      this.markdownHighlighter = new CodeMirrorHighlighter();
      // 延迟初始化，确保编辑器已经显示且窗口稳定
      setTimeout(async () => {
        // 再次检查窗口是否稳定
        if (this.isWindowStable) {
          await this.markdownHighlighter.init(editor);
        } else {
          // 如果不稳定，重置并等待下次
          this.markdownHighlighter = null;
        }
      }, 100);
    } catch (error) {
      console.warn('CodeMirror 语法高亮器初始化失败:', error);
      // 继续使用普通 textarea
    }
  }

  toggleEditMode() {
    // 保存当前模式的滚动位置
    this.saveCurrentScrollPosition();
    
    // 重置搜索框状态
    if (window.searchManager) {
      window.searchManager.reset();
    }
    
    this.isEditMode = !this.isEditMode;
    
    // 通知主进程编辑模式状态变化
    const { ipcRenderer } = require('electron');
    ipcRenderer.send('set-edit-mode', this.isEditMode);
    
    const editorContent = document.getElementById('editorContent');
    const contentArea = document.querySelector('.content-area');
    const editButton = document.getElementById('edit-button');
    
    if (this.isEditMode) {
      // 切换到编辑模式
      if (editorContent) {
        editorContent.style.display = 'block';
        const editor = document.getElementById('editorTextarea');
        if (editor) {
          editor.value = this.originalContent;
          editor.focus();
          
          // 初始化语法高亮器
          this.initMarkdownHighlighter(editor);
          
          // CodeMirror 自己处理光标定位，不需要额外的滚动修正
        }
      }
      if (contentArea) contentArea.style.display = 'none';
      if (editButton) editButton.textContent = '预览';
      
      // 恢复编辑器的滚动位置 - 延迟确保布局完成
      setTimeout(() => {
        this.restoreScrollPosition();
        // 切换到编辑模式后也检查一下语法高亮器状态
        setTimeout(() => {
          this.checkAndFixHighlighterIfNeeded();
        }, 200);
      }, 100);
    } else {
      // 切换到预览模式
      if (editorContent) {
        editorContent.style.display = 'none';
        // 更新预览内容
        const editor = document.getElementById('editorTextarea');
        if (editor) {
          const content = editor.value;
          this.updatePreview(content);
        }
      }
      if (contentArea) contentArea.style.display = 'block';
      if (editButton) editButton.textContent = '编辑';
      
      // 恢复预览的滚动位置 - 延迟更长时间确保布局完成
      setTimeout(() => {
        this.restoreScrollPosition();
      }, 100);
    }
    
    this.eventManager.emit('edit-mode-changed', this.isEditMode);
  }

  updatePreview(content) {
    const preview = document.getElementById('markdownContent');
    if (!preview) {
      return;
    }
    
    const html = this.markdownRenderer.renderMarkdown(content);
    preview.innerHTML = html;
    
    // 移除自定义搜索功能
    // 恢复搜索高亮（如果搜索处于激活状态）
    // if (this.appManager && this.appManager.getSearchManager()) {
    //   this.appManager.getSearchManager().reapplySearch();
    // }
  }

  setContent(content, filePath, resetSaveState = true) {
    this.originalContent = content;
    this.currentFilePath = filePath;
    
    // 只有在需要重置保存状态时才重置
    if (resetSaveState) {
      this.hasUnsavedChanges = false;
    }
    
    // 重置编辑模式状态
    this.isEditMode = false;
    
    // 通知主进程编辑模式状态
    const { ipcRenderer } = require('electron');
    ipcRenderer.send('set-edit-mode', this.isEditMode);
    
    // 重置滚动位置（新文件从顶部开始）
    this.previewScrollPosition = 0;
    this.editorScrollPosition = 0;
    
    // 重置尺寸信息
    this.previewDimensions = { scrollHeight: 0, clientHeight: 0 };
    this.editorDimensions = { scrollHeight: 0, clientHeight: 0 };
    
    // 清理旧的语法高亮器，避免内容缓存
    if (this.markdownHighlighter) {
      this.markdownHighlighter.destroy();
      this.markdownHighlighter = null;
    }
    
    // 确保UI元素状态正确
    const editor = document.getElementById('editorTextarea');
    const editorContent = document.getElementById('editorContent');
    const contentArea = document.querySelector('.content-area');
    const editButton = document.getElementById('edit-button');
    
    if (editor) {
      editor.value = content;
      editor.scrollTop = 0; // 重置编辑器滚动位置
    }
    
    // 确保编辑器容器隐藏，内容区域显示（预览模式）
    if (editorContent) editorContent.style.display = 'none';
    if (contentArea) contentArea.style.display = 'block';
    if (editButton) editButton.textContent = '编辑';
    
    this.updatePreview(content);
    
    // 重置预览区域滚动位置
    setTimeout(() => {
      const mainContent = document.querySelector('.main-content');
      if (mainContent) {
        mainContent.scrollTop = 0;
      }
    }, 50);
    
    this.updateSaveButton();
  }

  getCurrentContent() {
    if (this.isEditMode) {
      const editor = document.getElementById('editorTextarea');
      return editor ? editor.value : this.originalContent;
    }
    return this.originalContent;
  }

  async saveFile() {
    // 使用全局文件路径
    const currentPath = this.appManager ? this.appManager.getCurrentFilePath() : this.currentFilePath;
    
    if (!currentPath || !this.hasUnsavedChanges) {
      return;
    }
    
    const editor = document.getElementById('editorTextarea');
    if (!editor) return;
    
    const content = editor.value;
    
    try {
      const { ipcRenderer } = require('electron');
      await ipcRenderer.invoke('save-file', currentPath, content);
      
      this.originalContent = content;
      this.hasUnsavedChanges = false;
      this.updateSaveButton();
      
      // 更新预览
      if (!this.isEditMode) {
        this.updatePreview(content);
      }
      
      this.eventManager.emit('file-saved', currentPath);
      
      // 使用统一的消息提示样式
      if (this.appManager && this.appManager.getUIManager()) {
        this.appManager.getUIManager().showMessage('文件保存成功', 'success');
      }
    } catch (error) {
      console.error('保存文件失败:', error);
      if (this.appManager && this.appManager.getUIManager()) {
        this.appManager.getUIManager().showMessage('保存失败: ' + error.message, 'error');
      }
    }
  }

  updateSaveButton() {
    // 移除了保存按钮，不再需要更新状态
    // 保存状态通过 UI 消息提示显示
  }

  showSaveStatus(message, type) {
    // 创建或更新状态提示
    let statusElement = document.getElementById('save-status');
    if (!statusElement) {
      statusElement = document.createElement('div');
      statusElement.id = 'save-status';
      statusElement.className = 'save-status';
      document.body.appendChild(statusElement);
    }
    
    statusElement.textContent = message;
    statusElement.className = `save-status ${type}`;
    statusElement.style.display = 'block';
    
    // 3秒后隐藏
    setTimeout(() => {
      statusElement.style.display = 'none';
    }, 3000);
  }

  hasUnsavedContent() {
    return this.hasUnsavedChanges;
  }

  getCurrentFilePath() {
    return this.currentFilePath;
  }

  isInEditMode() {
    return this.isEditMode;
  }

  resetToInitialState() {
    this.isEditMode = false;
    this.currentFilePath = null;
    this.originalContent = '';
    this.hasUnsavedChanges = false;
    
    // 重置滚动位置
    this.previewScrollPosition = 0;
    this.editorScrollPosition = 0;
    
    // 重置尺寸信息
    this.previewDimensions = { scrollHeight: 0, clientHeight: 0 };
    this.editorDimensions = { scrollHeight: 0, clientHeight: 0 };
    
    // 清理语法高亮器
    if (this.markdownHighlighter) {
      this.markdownHighlighter.destroy();
      this.markdownHighlighter = null;
    }
    
    // 清理resize定时器
    if (this.resizeTimer) {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = null;
    }
    
    const editor = document.getElementById('editorTextarea');
    const editorContent = document.getElementById('editorContent');
    const preview = document.getElementById('markdownContent');
    const editButton = document.getElementById('edit-button');
    
    if (editorContent) {
      editorContent.style.display = 'none';
    }
    if (editor) {
      editor.value = '';
    }
    if (preview) {
      preview.style.display = 'block';
      preview.innerHTML = '';
    }
    if (editButton) editButton.textContent = '编辑';
    
    this.updateSaveButton();
  }

  // 保存当前模式的滚动位置和尺寸信息
  saveCurrentScrollPosition() {
    if (this.isEditMode) {
      // 当前在编辑模式，保存编辑器滚动位置和尺寸
      if (this.markdownHighlighter && this.markdownHighlighter.isReady()) {
        const scrollInfo = this.markdownHighlighter.getScrollInfo();
        this.editorScrollPosition = scrollInfo.top;
        this.editorDimensions = {
          scrollHeight: scrollInfo.height,
          clientHeight: scrollInfo.clientHeight
        };
      } else {
        // 备用方案：使用原始textarea
        const editor = document.getElementById('editorTextarea');
        if (editor) {
          this.editorScrollPosition = editor.scrollTop;
          this.editorDimensions = {
            scrollHeight: editor.scrollHeight,
            clientHeight: editor.clientHeight
          };
        }
      }
    } else {
      // 当前在预览模式，保存主容器滚动位置和尺寸
      const mainContent = document.querySelector('.main-content');
      if (mainContent) {
        this.previewScrollPosition = mainContent.scrollTop;
        this.previewDimensions = {
          scrollHeight: mainContent.scrollHeight,
          clientHeight: mainContent.clientHeight
        };
      }
    }
  }

  // 恢复对应模式的滚动位置
  restoreScrollPosition() {
    if (this.isEditMode) {
      // 切换到编辑模式，恢复编辑器滚动位置
      if (this.markdownHighlighter && this.markdownHighlighter.isReady()) {
        // 使用CodeMirror的滚动方法
        const scrollRatio = this.calculateScrollRatio('preview');
        const scrollInfo = this.markdownHighlighter.getScrollInfo();
        const editorMaxScroll = Math.max(0, scrollInfo.height - scrollInfo.clientHeight);
        const targetScroll = scrollRatio * editorMaxScroll;

        if (targetScroll === 0 && this.previewScrollPosition > 0) {
          this.markdownHighlighter.scrollTo(Math.min(this.previewScrollPosition, editorMaxScroll));
        } else {
          this.markdownHighlighter.scrollTo(targetScroll);
        }
      } else {
        // 备用方案：使用原始textarea
        const editor = document.getElementById('editorTextarea');
        if (editor) {
          const scrollRatio = this.calculateScrollRatio('preview');
          const editorMaxScroll = Math.max(0, editor.scrollHeight - editor.clientHeight);
          const targetScroll = scrollRatio * editorMaxScroll;

          if (targetScroll === 0 && this.previewScrollPosition > 0) {
            editor.scrollTop = Math.min(this.previewScrollPosition, editorMaxScroll);
          } else {
            editor.scrollTop = targetScroll;
          }
        }
      }
    } else {
      // 切换到预览模式，恢复主容器滚动位置
      const mainContent = document.querySelector('.main-content');
      if (mainContent) {
        // 先尝试直接使用比例计算
        const scrollRatio = this.calculateScrollRatio('editor');
        const previewMaxScroll = Math.max(0, mainContent.scrollHeight - mainContent.clientHeight);
        const targetScroll = scrollRatio * previewMaxScroll;
        
        // 如果目标位置为0但编辑器位置不为0，尝试简单的直接设置  
        if (targetScroll === 0 && this.editorScrollPosition > 0) {
          // 简单策略：如果编辑器位置大于0，至少让预览也滚动一点
          mainContent.scrollTop = Math.min(this.editorScrollPosition, previewMaxScroll);
        } else {
          mainContent.scrollTop = targetScroll;
        }
      }
    }
  }

  // 计算滚动比例 - 使用保存的尺寸信息
  calculateScrollRatio(fromMode) {
    if (fromMode === 'preview') {
      const maxScroll = Math.max(0, this.previewDimensions.scrollHeight - this.previewDimensions.clientHeight);
      const ratio = maxScroll > 0 ? this.previewScrollPosition / maxScroll : 0;
      return ratio;
    } else if (fromMode === 'editor') {
      const maxScroll = Math.max(0, this.editorDimensions.scrollHeight - this.editorDimensions.clientHeight);
      const ratio = maxScroll > 0 ? this.editorScrollPosition / maxScroll : 0;
      return ratio;
    }
    return 0;
  }

  // CodeMirror 自己处理所有光标和滚动问题，不再需要手动修正

  // 获取可滚动的父元素
  getScrollableParent(element) {
    // 首先检查元素本身是否可滚动
    if (element.scrollHeight > element.clientHeight) {
      return element;
    }
    
    // 然后检查父元素
    let parent = element.parentElement;
    while (parent && parent !== document.body) {
      const overflowY = window.getComputedStyle(parent).overflowY;
      if ((overflowY === 'scroll' || overflowY === 'auto') && 
          parent.scrollHeight > parent.clientHeight) {
        return parent;
      }
      parent = parent.parentElement;
    }
    
    // 如果没找到，返回window（使用document.documentElement）
    return document.documentElement;
  }
}

module.exports = EditorManager;