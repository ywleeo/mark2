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
      
      // 检查内容是否有变化
      const originalContent = this.content || '';
      this.hasUnsavedChanges = (currentContent !== originalContent);
      
      // 使用新的 EditorManager 服务方法获取滚动位置
      this.scrollRatio = this.editorManager.getCurrentScrollPosition(this.isEditMode);
      
      console.log(`[Tab] 已保存状态: ${this.title}`, {
        isEditMode: this.isEditMode,
        hasUnsavedChanges: this.hasUnsavedChanges,
        scrollRatio: this.scrollRatio,
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
        scrollRatio: this.scrollRatio,
        contentLength: this.content ? this.content.length : 0
      });
      
      // 使用新的 EditorManager 服务方法
      this.editorManager.renderContent(this.content, this.filePath, {
        isEditMode: this.isEditMode,
        scrollRatio: this.scrollRatio
      });
      
      console.log(`[Tab] 已恢复滚动位置和光标: ${this.title}`);
      
    } catch (error) {
      console.error(`[Tab] 恢复状态失败: ${this.title}`, error);
    }
  }
  
  // restoreEditMode 已移除 - 由 EditorManager.switchMode 取代
  
  // restoreScrollAndCursor 已移除 - 由 EditorManager.setScrollPosition 取代
  
  // 切换编辑模式
  toggleEditMode() {
    // 先保存当前状态（包括滚动位置）
    this.saveFromEditor();
    
    // 切换模式
    this.isEditMode = !this.isEditMode;
    
    // 使用新的 EditorManager 服务方法切换模式
    if (this.editorManager) {
      this.editorManager.switchMode(this.isEditMode, {
        scrollRatio: this.scrollRatio
      });
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
  
  // 检查是否有未保存的更改
  hasUnsavedContent() {
    // 新建文件（filePath为null）无论是否编辑都需要处理保存
    if (!this.filePath) {
      return true;
    }
    
    // 已保存文件：只在编辑模式下检查内容变化
    if (!this.isEditMode) {
      return false;
    }
    
    // 获取当前编辑器内容并比较
    if (this.editorManager) {
      const currentContent = this.editorManager.getCurrentContent();
      const originalContent = this.content || '';
      return currentContent !== originalContent;
    }
    
    return false;
  }
  
  // 关闭前的保存检查和处理（返回是否应该继续关闭）
  async handleCloseWithSaveCheck(tabManager) {
    if (!this.hasUnsavedContent()) {
      return true; // 没有未保存内容，可以直接关闭
    }
    
    // 显示保存确认对话框
    const result = await tabManager.showSaveConfirmDialog(this);
    
    if (result === 'save') {
      // 用户选择保存
      try {
        const currentContent = this.editorManager.getCurrentContent();
        await this.editorManager.saveFile(currentContent, this.filePath);
        return true; // 保存成功，可以关闭
      } catch (error) {
        console.error('[Tab] 保存失败:', error);
        // 保存失败，不关闭
        return false;
      }
    } else if (result === 'discard') {
      // 用户选择不保存
      return true; // 可以关闭
    } else {
      // 用户取消
      return false; // 不关闭
    }
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