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
    
    this.setupEditor();
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

  toggleEditMode() {
    // 保存当前模式的滚动位置
    this.saveCurrentScrollPosition();
    
    this.isEditMode = !this.isEditMode;
    
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
        }
      }
      if (contentArea) contentArea.style.display = 'none';
      if (editButton) editButton.textContent = '预览';
      
      // 恢复编辑器的滚动位置 - 延迟更长时间确保布局完成
      setTimeout(() => {
        this.restoreScrollPosition();
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
    
    // 恢复搜索高亮（如果搜索处于激活状态）
    if (this.appManager && this.appManager.getSearchManager()) {
      this.appManager.getSearchManager().reapplySearch();
    }
  }

  setContent(content, filePath) {
    this.originalContent = content;
    this.currentFilePath = filePath;
    this.hasUnsavedChanges = false;
    
    // 重置编辑模式状态
    this.isEditMode = false;
    
    // 重置滚动位置（新文件从顶部开始）
    this.previewScrollPosition = 0;
    this.editorScrollPosition = 0;
    
    // 重置尺寸信息
    this.previewDimensions = { scrollHeight: 0, clientHeight: 0 };
    this.editorDimensions = { scrollHeight: 0, clientHeight: 0 };
    
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
      const editor = document.getElementById('editorTextarea');
      if (editor) {
        this.editorScrollPosition = editor.scrollTop;
        this.editorDimensions = {
          scrollHeight: editor.scrollHeight,
          clientHeight: editor.clientHeight
        };
        console.log('保存编辑器滚动位置:', this.editorScrollPosition);
        console.log('保存编辑器尺寸:', this.editorDimensions);
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
        console.log('保存预览滚动位置:', this.previewScrollPosition);
        console.log('保存预览尺寸:', this.previewDimensions);
      }
    }
  }

  // 恢复对应模式的滚动位置
  restoreScrollPosition() {
    console.log('开始恢复滚动位置, 当前模式:', this.isEditMode ? '编辑' : '预览');
    console.log('保存的位置 - 预览:', this.previewScrollPosition, '编辑:', this.editorScrollPosition);
    
    if (this.isEditMode) {
      // 切换到编辑模式，恢复编辑器滚动位置
      const editor = document.getElementById('editorTextarea');
      if (editor) {
        console.log('编辑器元素尺寸:', {
          scrollHeight: editor.scrollHeight,
          clientHeight: editor.clientHeight,
          maxScroll: editor.scrollHeight - editor.clientHeight
        });
        
        // 先尝试直接使用比例计算
        const scrollRatio = this.calculateScrollRatio('preview');
        const editorMaxScroll = Math.max(0, editor.scrollHeight - editor.clientHeight);
        const targetScroll = scrollRatio * editorMaxScroll;
        
        console.log('计算的目标滚动位置:', targetScroll);
        
        // 如果目标位置为0但预览位置不为0，尝试简单的直接设置
        if (targetScroll === 0 && this.previewScrollPosition > 0) {
          // 简单策略：如果预览位置大于0，至少让编辑器也滚动一点
          editor.scrollTop = Math.min(this.previewScrollPosition, editorMaxScroll);
          console.log('使用简单策略设置编辑器位置:', editor.scrollTop);
        } else {
          editor.scrollTop = targetScroll;
          console.log('使用计算位置设置编辑器:', targetScroll);
        }
      }
    } else {
      // 切换到预览模式，恢复主容器滚动位置
      const mainContent = document.querySelector('.main-content');
      if (mainContent) {
        console.log('主容器元素尺寸:', {
          scrollHeight: mainContent.scrollHeight,
          clientHeight: mainContent.clientHeight,
          maxScroll: mainContent.scrollHeight - mainContent.clientHeight
        });
        
        // 先尝试直接使用比例计算
        const scrollRatio = this.calculateScrollRatio('editor');
        const previewMaxScroll = Math.max(0, mainContent.scrollHeight - mainContent.clientHeight);
        const targetScroll = scrollRatio * previewMaxScroll;
        
        console.log('计算的目标滚动位置:', targetScroll);
        
        // 如果目标位置为0但编辑器位置不为0，尝试简单的直接设置  
        if (targetScroll === 0 && this.editorScrollPosition > 0) {
          // 简单策略：如果编辑器位置大于0，至少让预览也滚动一点
          mainContent.scrollTop = Math.min(this.editorScrollPosition, previewMaxScroll);
          console.log('使用简单策略设置预览位置:', mainContent.scrollTop);
        } else {
          mainContent.scrollTop = targetScroll;
          console.log('使用计算位置设置预览:', targetScroll);
        }
      }
    }
  }

  // 计算滚动比例 - 使用保存的尺寸信息
  calculateScrollRatio(fromMode) {
    if (fromMode === 'preview') {
      const maxScroll = Math.max(0, this.previewDimensions.scrollHeight - this.previewDimensions.clientHeight);
      const ratio = maxScroll > 0 ? this.previewScrollPosition / maxScroll : 0;
      console.log('预览模式计算比例 (使用保存的尺寸):', {
        scrollPosition: this.previewScrollPosition,
        scrollHeight: this.previewDimensions.scrollHeight,
        clientHeight: this.previewDimensions.clientHeight,
        maxScroll: maxScroll,
        ratio: ratio
      });
      return ratio;
    } else if (fromMode === 'editor') {
      const maxScroll = Math.max(0, this.editorDimensions.scrollHeight - this.editorDimensions.clientHeight);
      const ratio = maxScroll > 0 ? this.editorScrollPosition / maxScroll : 0;
      console.log('编辑器模式计算比例 (使用保存的尺寸):', {
        scrollPosition: this.editorScrollPosition,
        scrollHeight: this.editorDimensions.scrollHeight,
        clientHeight: this.editorDimensions.clientHeight,
        maxScroll: maxScroll,
        ratio: ratio
      });
      return ratio;
    }
    return 0;
  }

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