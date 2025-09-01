class Tab {
  constructor(filePath, content, title, belongsTo = 'folder', fileType = 'subfolder-file') {
    this.id = Tab.generateId();
    this.filePath = filePath;
    this.content = content;
    this.title = title || this.extractTitle(filePath);
    this.belongsTo = belongsTo; // 'file' 或 'folder'
    this.fileType = fileType;
    
    // 基本状态
    this.isActive = false;
    this.isModified = false;
    this.isReadOnly = this.determineReadOnlyStatus();
    this.fileTimestamp = null;
    
    // 编辑器状态 - 每个tab独立维护
    this.isEditMode = false;
    this.scrollRatio = 0;
    this.cursorPosition = null;
    this.hasUnsavedChanges = false;
    this.viewScrollTop = 0;
    this.editScrollTop = 0;
    
    // 依赖注入
    this.editorManager = null;
    this.eventManager = null;
  }
  
  // 静态方法：生成唯一ID
  static generateId() {
    if (!Tab._nextId) Tab._nextId = 1;
    return Tab._nextId++;
  }
  
  // 设置依赖
  setDependencies(editorManager, eventManager) {
    this.editorManager = editorManager;
    this.eventManager = eventManager;
  }
  
  // 从文件路径提取标题
  extractTitle(filePath) {
    if (!filePath) return 'Untitled.md';
    const path = require('path');
    return path.basename(filePath);
  }
  
  // 判断是否为只读文件
  determineReadOnlyStatus() {
    if (this.fileType === 'help' || this.fileType === 'demo') {
      return true;
    }
    if (this.filePath && this.filePath.includes('/docs/demo-')) {
      return true;
    }
    return false;
  }
  
  // 激活tab
  async activate() {
    if (this.isActive) return;
    
    console.log(`[Tab] 激活 tab: ${this.title}`);
    this.isActive = true;
    
    // 检查文件是否需要刷新
    const contentRefreshed = await this.checkAndRefreshContent();
    
    // 恢复编辑器状态
    this.restoreToEditor();
    
    if (this.eventManager) {
      this.eventManager.emit('tab-activated', this);
    }
  }
  
  // 取消激活
  deactivate() {
    if (!this.isActive) return;
    
    console.log(`[Tab] 取消激活 tab: ${this.title}`);
    
    // 保存当前状态
    this.saveFromEditor();
    
    this.isActive = false;
  }
  
  // 检查并刷新文件内容
  async checkAndRefreshContent() {
    if (!this.filePath) return;
    
    try {
      const { ipcRenderer } = require('electron');
      const timestampResult = await ipcRenderer.invoke('get-file-timestamp', this.filePath);
      
      if (timestampResult.success) {
        // 检查是否需要刷新内容
        const needRefresh = !this.fileTimestamp || 
                           this.fileTimestamp !== timestampResult.timestamp ||
                           !this.content || this.content.length === 0;
                           
        if (needRefresh) {
          const result = await ipcRenderer.invoke('open-file-dialog', this.filePath);
          if (result && result.content !== undefined) {
            this.content = result.content;
            this.fileTimestamp = timestampResult.timestamp;
            
            // 文件已更新，重置编辑器状态
            this.resetEditorState();
            
            console.log(`[Tab] 文件已更新，刷新内容: ${this.title} (长度: ${this.content.length})`);
            return true; // 返回true表示内容已刷新
          }
        } else {
          // 时间戳未变化，但更新文件时间戳用于下次比较
          this.fileTimestamp = timestampResult.timestamp;
        }
      }
    } catch (error) {
      console.warn(`[Tab] 检查文件变化失败: ${this.title}`, error);
    }
    return false; // 返回false表示内容未刷新
  }
  
  // 重置编辑器状态
  resetEditorState() {
    this.isEditMode = false;
    this.scrollRatio = 0;
    this.cursorPosition = null;
    this.hasUnsavedChanges = false;
    this.viewScrollTop = 0;
    this.editScrollTop = 0;
  }
  
  // 从编辑器保存状态
  saveFromEditor() {
    if (!this.editorManager) return;
    
    try {
      // 保存内容
      const currentContent = this.editorManager.getCurrentContent();
      if (currentContent !== undefined) {
        this.content = currentContent;
      }
      
      // 保存编辑器状态
      this.hasUnsavedChanges = this.editorManager.hasUnsavedChanges;
      
      // 保存滚动位置 - 优先使用 CodeMirror 的滚动信息
      if (this.isEditMode) {
        // 检查是否有 CodeMirror 高亮器
        if (this.editorManager.markdownHighlighter && this.editorManager.markdownHighlighter.isReady()) {
          const scrollInfo = this.editorManager.markdownHighlighter.getScrollInfo();
          this.editScrollTop = scrollInfo.top;
          
          // 保存光标位置（CodeMirror 有自己的光标管理，这里保存为null）
          this.cursorPosition = null;
        } else {
          // 备用方案：使用原始 textarea
          const editorTextarea = document.getElementById('editorTextarea');
          if (editorTextarea) {
            this.editScrollTop = editorTextarea.scrollTop;
            this.cursorPosition = {
              selectionStart: editorTextarea.selectionStart,
              selectionEnd: editorTextarea.selectionEnd
            };
          }
        }
      } else {
        const previewArea = document.querySelector('.preview-area');
        if (previewArea) {
          this.viewScrollTop = previewArea.scrollTop;
        }
      }
      
      // 保存滚动比例
      this.scrollRatio = this.editorManager.scrollRatio || 0;
      
      console.log(`[Tab] 已保存状态: ${this.title}`, {
        isEditMode: this.isEditMode,
        hasUnsavedChanges: this.hasUnsavedChanges,
        scrollRatio: this.scrollRatio,
        editScrollTop: this.editScrollTop,
        viewScrollTop: this.viewScrollTop,
        contentLength: this.content ? this.content.length : 0
      });
      
    } catch (error) {
      console.error(`[Tab] 保存状态失败: ${this.title}`, error);
    }
  }
  
  // 恢复状态到编辑器
  restoreToEditor() {
    if (!this.editorManager) {
      console.error(`[Tab] EditorManager未设置，无法恢复状态: ${this.title}`);
      return;
    }
    
    try {
      console.log(`[Tab] 开始恢复状态: ${this.title}`, {
        isEditMode: this.isEditMode,
        hasUnsavedChanges: this.hasUnsavedChanges,
        contentLength: this.content ? this.content.length : 0
      });
      
      // 恢复内容
      this.editorManager.setContent(this.content, this.filePath, false, false);
      
      // 恢复编辑器状态
      this.editorManager.hasUnsavedChanges = this.hasUnsavedChanges;
      
      // 恢复滚动比例
      if (this.scrollRatio !== undefined) {
        this.editorManager.scrollRatio = this.scrollRatio;
      }
      
      // 恢复编辑模式
      this.restoreEditMode();
      
      // 延迟恢复滚动位置和光标位置
      requestAnimationFrame(() => {
        this.restoreScrollAndCursor();
      });
      
    } catch (error) {
      console.error(`[Tab] 恢复状态失败: ${this.title}`, error);
    }
  }
  
  // 恢复编辑模式
  restoreEditMode() {
    if (!this.editorManager) return;
    
    const currentEditMode = this.editorManager.isInEditMode();
    if (this.isEditMode !== currentEditMode) {
      // 直接设置EditorManager状态和更新UI
      this.editorManager.isEditMode = this.isEditMode;
      
      const editorContent = document.getElementById('editorContent');
      const contentArea = document.querySelector('.content-area');
      const editButton = document.getElementById('edit-button');
      
      if (this.isEditMode) {
        if (editorContent) editorContent.style.display = 'block';
        if (contentArea) contentArea.style.display = 'none';
        if (editButton) editButton.textContent = '预览';
      } else {
        if (editorContent) editorContent.style.display = 'none';
        if (contentArea) contentArea.style.display = 'block';
        if (editButton) editButton.textContent = '编辑';
      }
      
      // 通知主进程编辑模式状态变化
      const { ipcRenderer } = require('electron');
      ipcRenderer.send('set-edit-mode', this.isEditMode);
    }
  }
  
  // 恢复滚动位置和光标位置
  restoreScrollAndCursor() {
    try {
      if (this.isEditMode) {
        // 检查是否有 CodeMirror 高亮器
        if (this.editorManager.markdownHighlighter && this.editorManager.markdownHighlighter.isReady()) {
          // 使用 CodeMirror 的滚动方法
          if (this.editScrollTop !== undefined) {
            this.editorManager.markdownHighlighter.scrollTo(this.editScrollTop);
          }
        } else {
          // 备用方案：使用原始 textarea
          const editorTextarea = document.getElementById('editorTextarea');
          if (editorTextarea) {
            if (this.editScrollTop !== undefined) {
              editorTextarea.scrollTop = this.editScrollTop;
            }
            if (this.cursorPosition) {
              editorTextarea.selectionStart = this.cursorPosition.selectionStart;
              editorTextarea.selectionEnd = this.cursorPosition.selectionEnd;
            }
          }
        }
      } else {
        const previewArea = document.querySelector('.preview-area');
        if (previewArea && this.viewScrollTop !== undefined) {
          previewArea.scrollTop = this.viewScrollTop;
        }
      }
      
      console.log(`[Tab] 已恢复滚动位置和光标: ${this.title}`);
    } catch (error) {
      console.error(`[Tab] 恢复滚动位置失败: ${this.title}`, error);
    }
  }
  
  // 切换编辑模式
  toggleEditMode() {
    this.isEditMode = !this.isEditMode;
    
    // 立即同步到EditorManager并更新UI
    if (this.editorManager) {
      this.editorManager.isEditMode = this.isEditMode;
      this.restoreEditMode();
    }
  }
  
  // 更新内容
  updateContent(content) {
    this.content = content;
    this.isModified = true;
  }
  
  // 更新文件信息（用于文件夹tab切换文件时）
  async updateFileInfo(filePath, content, fileType, belongsTo = null) {
    this.filePath = filePath;
    this.content = content;
    this.title = this.extractTitle(filePath);
    this.fileType = fileType;
    this.isModified = false;
    this.isReadOnly = this.determineReadOnlyStatus();
    
    // 如果指定了新的归属，更新它
    if (belongsTo !== null) {
      this.belongsTo = belongsTo;
    }
    
    // 更新文件时间戳
    try {
      const { ipcRenderer } = require('electron');
      const timestampResult = await ipcRenderer.invoke('get-file-timestamp', filePath);
      if (timestampResult.success) {
        this.fileTimestamp = timestampResult.timestamp;
      }
    } catch (error) {
      console.log('[Tab] 获取文件时间戳失败:', error.message);
    }
  }
  
  // 标记为已保存
  markSaved() {
    this.isModified = false;
    this.hasUnsavedChanges = false;
  }
  
  // 关闭tab前的清理
  destroy() {
    console.log(`[Tab] 销毁 tab: ${this.title}`);
    
    // 保存最终状态
    this.saveFromEditor();
    
    // 清理引用
    this.editorManager = null;
    this.eventManager = null;
  }
  
  // 序列化为普通对象（用于状态保存）
  serialize() {
    return {
      id: this.id,
      filePath: this.filePath,
      content: this.content,
      title: this.title,
      belongsTo: this.belongsTo,
      fileType: this.fileType,
      isActive: this.isActive,
      isModified: this.isModified,
      isReadOnly: this.isReadOnly,
      fileTimestamp: this.fileTimestamp,
      
      // 编辑器状态
      isEditMode: this.isEditMode,
      scrollRatio: this.scrollRatio,
      cursorPosition: this.cursorPosition,
      hasUnsavedChanges: this.hasUnsavedChanges,
      viewScrollTop: this.viewScrollTop,
      editScrollTop: this.editScrollTop
    };
  }
  
  // 从序列化数据恢复Tab对象
  static deserialize(data) {
    const tab = new Tab(data.filePath, data.content, data.title, data.belongsTo, data.fileType);
    
    // 恢复基本属性
    tab.id = data.id;
    tab.isActive = data.isActive || false;
    tab.isModified = data.isModified || false;
    tab.isReadOnly = data.isReadOnly || false;
    tab.fileTimestamp = data.fileTimestamp;
    
    // 恢复编辑器状态
    tab.isEditMode = data.isEditMode || false;
    tab.scrollRatio = data.scrollRatio || 0;
    tab.cursorPosition = data.cursorPosition;
    tab.hasUnsavedChanges = data.hasUnsavedChanges || false;
    tab.viewScrollTop = data.viewScrollTop || 0;
    tab.editScrollTop = data.editScrollTop || 0;
    
    // 确保ID序列正确
    if (tab.id >= Tab._nextId) {
      Tab._nextId = tab.id + 1;
    }
    
    return tab;
  }
}

module.exports = Tab;