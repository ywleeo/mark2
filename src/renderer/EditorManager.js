class EditorManager {
  constructor(markdownRenderer, eventManager, appManager) {
    this.markdownRenderer = markdownRenderer;
    this.eventManager = eventManager;
    this.appManager = appManager;
    this.isEditMode = false;
    this.currentFilePath = null;
    this.originalContent = '';
    this.hasUnsavedChanges = false;
    
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
    this.isEditMode = !this.isEditMode;
    
    const editorContent = document.getElementById('editorContent');
    const contentArea = document.querySelector('.content-area');
    const editButton = document.getElementById('edit-button');
    const saveButton = document.getElementById('saveBtn');
    
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
      if (saveButton) saveButton.style.display = 'inline-block';
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
      if (saveButton) saveButton.style.display = 'none';
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
  }

  setContent(content, filePath) {
    this.originalContent = content;
    this.currentFilePath = filePath;
    this.hasUnsavedChanges = false;
    
    const editor = document.getElementById('editorTextarea');
    if (editor) {
      editor.value = content;
    }
    
    this.updatePreview(content);
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
    const saveButton = document.getElementById('saveBtn');
    if (!saveButton) return;
    
    if (this.hasUnsavedChanges && this.currentFilePath) {
      saveButton.disabled = false;
      saveButton.textContent = '保存 *';
    } else {
      saveButton.disabled = true;
      saveButton.textContent = '保存';
    }
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
    
    const editor = document.getElementById('editorTextarea');
    const preview = document.getElementById('markdownContent');
    const editButton = document.getElementById('edit-button');
    const saveButton = document.getElementById('saveBtn');
    
    if (editor) {
      editor.style.display = 'none';
      editor.value = '';
    }
    if (preview) {
      preview.style.display = 'block';
      preview.innerHTML = '';
    }
    if (editButton) editButton.textContent = '编辑';
    if (saveButton) {
      saveButton.style.display = 'none';
      saveButton.disabled = true;
    }
    
    this.updateSaveButton();
  }
}

module.exports = EditorManager;