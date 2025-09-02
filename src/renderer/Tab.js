class Tab {
  constructor(filePath, title, belongsTo = 'folder', fileType = 'subfolder-file') {
    this.id = Tab.generateId();
    this.filePath = filePath;
    this.content = ''; // 初始为空，激活时从文件加载
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
    
    // 保存文件的原始内容和MD5，用于检测变化
    this.originalFileContent = null;
    this.originalContentMD5 = null;
    
    // 依赖注入
    this.editorManager = null;
    this.eventManager = null;
  }
  
  // 静态方法：生成唯一ID
  static generateId() {
    if (!Tab._nextId) Tab._nextId = 1;
    return Tab._nextId++;
  }
  
  // 预处理Markdown内容（与CodeMirrorHighlighter保持一致）
  preprocessMarkdownForMD5(content) {
    if (!content) return content;
    
    let processed = content;
    
    // 匹配 文本\n--- 的模式，将其转换为 文本\n\n---
    // 避免 CodeMirror Markdown 解析器将前面的文本识别为标题
    processed = processed.replace(/^(.+)\n(-{3,})$/gm, (match, text, dashes) => {
      return `${text}\n\n${dashes}`;
    });
    
    // 对 = 号也做同样处理
    processed = processed.replace(/^(.+)\n(={3,})$/gm, (match, text, equals) => {
      return `${text}\n\n${equals}`;
    });
    
    return processed;
  }

  // 计算文本的 MD5 哈希值
  static calculateMD5(text) {
    if (!text) return '';
    const crypto = require('crypto');
    return crypto.createHash('md5').update(text, 'utf8').digest('hex');
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
    
    // 【智能缓存】只有检测到文件变化时才重新加载
    if (this.filePath) {
      const hasExternalChanges = await this.checkFileTimestamp();
      if (hasExternalChanges) {
        await this.reloadFromFile();
        console.log(`[Tab] 检测到外部文件变化，重新加载: ${this.title}`);
      } else {
        console.log(`[Tab] 文件无变化，使用缓存内容: ${this.title} (长度: ${this.content ? this.content.length : 0})`);
      }
    }
    
    // 恢复编辑器状态
    this.restoreToEditor();
    
    if (this.eventManager) {
      this.eventManager.emit('tab-activated', this);
    }
  }
  
  // 从文件重新加载内容
  async reloadFromFile() {
    if (!this.filePath) return;
    
    try {
      const { ipcRenderer } = require('electron');
      const result = await ipcRenderer.invoke('open-file-dialog', this.filePath);
      
      if (result && result.content !== undefined) {
        this.content = result.content;
        this.originalFileContent = result.content;
        
        // 使用预处理后的内容计算MD5
        const processedContent = this.preprocessMarkdownForMD5(result.content);
        this.originalContentMD5 = Tab.calculateMD5(processedContent);
        
        // 重置未保存状态
        this.hasUnsavedChanges = false;
        
        console.log(`[Tab] 从文件重新加载内容: ${this.title} (长度: ${this.content.length})`);
      }
    } catch (error) {
      console.error(`[Tab] 重新加载文件失败: ${this.title}`, error);
    }
  }

  // 检查文件时间戳是否变化
  async checkFileTimestamp() {
    if (!this.filePath) return false;
    
    try {
      const { ipcRenderer } = require('electron');
      const timestampResult = await ipcRenderer.invoke('get-file-timestamp', this.filePath);
      
      if (timestampResult.success) {
        const currentTimestamp = timestampResult.timestamp;
        
        // 【修复】如果内容为空，强制加载，无论时间戳如何
        if (!this.content || this.content === '') {
          this.fileTimestamp = currentTimestamp;
          console.log(`[Tab] 内容为空，强制加载: ${this.title}`);
          return true; // 内容为空，需要加载
        }
        
        // 如果是首次加载或时间戳不存在，记录当前时间戳
        if (!this.fileTimestamp) {
          this.fileTimestamp = currentTimestamp;
          return true; // 首次加载，需要加载内容
        }
        
        // 比较时间戳
        if (currentTimestamp !== this.fileTimestamp) {
          console.log(`[Tab] 检测到文件时间戳变化: ${this.title}`, {
            old: this.fileTimestamp,
            new: currentTimestamp
          });
          this.fileTimestamp = currentTimestamp;
          return true; // 文件有变化，需要重新加载
        }
        
        return false; // 文件无变化，使用缓存
      }
      
      return false;
    } catch (error) {
      console.error(`[Tab] 检查文件时间戳失败: ${this.title}`, error);
      return false;
    }
  }

  // 检查文件是否被外部修改，如果是则刷新内容
  async checkAndRefreshContent() {
    if (!this.filePath) return false;
    
    try {
      const { ipcRenderer } = require('electron');
      const result = await ipcRenderer.invoke('open-file-dialog', this.filePath);
      
      if (result && result.content !== undefined) {
        // 使用预处理后的内容计算MD5来比较
        const processedContent = this.preprocessMarkdownForMD5(result.content);
        const currentFileMD5 = Tab.calculateMD5(processedContent);
        
        // 如果文件内容发生变化，更新内容
        if (currentFileMD5 !== this.originalContentMD5) {
          this.content = result.content;
          this.originalFileContent = result.content;
          this.originalContentMD5 = currentFileMD5;
          
          // 重置未保存状态，因为我们现在与文件同步了
          this.hasUnsavedChanges = false;
          
          console.log(`[Tab] 检测到文件外部修改，已刷新内容: ${this.title}`);
          return true;
        }
      }
      
      return false;
    } catch (error) {
      console.error(`[Tab] 检查文件内容失败: ${this.title}`, error);
      return false;
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
    
    // 【关键修复】只有活动的tab才需要从编辑器同步状态
    if (!this.isActive) {
      console.log(`[Tab] 跳过非活动tab的状态同步: ${this.title}`);
      return;
    }
    
    try {
      // 只同步滚动位置，不同步内容（内容在确认修改时才同步）
      this.scrollRatio = this.editorManager.getCurrentScrollPosition(this.isEditMode);
      
      console.log(`[Tab] 已同步滚动状态: ${this.title}`, {
        isEditMode: this.isEditMode,
        scrollRatio: this.scrollRatio,
        contentLength: this.content ? this.content.length : 0
      });
      
    } catch (error) {
      console.error(`[Tab] 同步状态失败: ${this.title}`, error);
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
  async toggleEditMode() {
    // 如果是从编辑模式切换到预览模式，需要确认修改
    if (this.isEditMode && this.filePath && !this.isReadOnly) {
      console.log(`[Tab] 从编辑模式切换到预览模式，确认修改: ${this.title}`);
      
      // 从编辑器获取当前内容
      const editor = document.getElementById('editorTextarea');
      const editorContent = editor ? editor.value : '';
      
      // 比较编辑器内容与Tab原始内容
      const editorContentMD5 = Tab.calculateMD5(editorContent);
      const originalContentMD5 = this.originalContentMD5 || '';
      const hasChanges = (editorContentMD5 !== originalContentMD5);
      
      console.log(`[Tab] 检查编辑器变化: ${this.title}`, {
        editorLength: editorContent.length,
        originalLength: this.originalFileContent ? this.originalFileContent.length : 0,
        editorMD5: editorContentMD5.substring(0, 8) + '...',
        originalMD5: originalContentMD5.substring(0, 8) + '...',
        hasChanges: hasChanges
      });
      
      if (hasChanges) {
        console.log(`[Tab] 确认修改，调用EditorManager保存: ${this.title}`);
        
        // 确认修改：调用EditorManager统一保存方法
        try {
          await this.editorManager.saveFile();
          
          // 保存成功后，更新Tab的内容和基准
          this.content = editorContent;
          this.originalFileContent = editorContent;
          this.originalContentMD5 = editorContentMD5;
          this.hasUnsavedChanges = false;
          
          console.log(`[Tab] 确认修改完成: ${this.title}`);
        } catch (error) {
          console.error(`[Tab] 确认修改失败: ${this.title}`, error);
          // 保存失败时不阻止模式切换，但保持未保存状态
        }
      } else {
        console.log(`[Tab] 无变化，跳过保存: ${this.title}`);
      }
      
      // 保存当前状态（包括滚动位置）
      this.saveFromEditor();
    } else {
      // 其他情况只保存状态
      this.saveFromEditor();
    }
    
    // 切换模式
    this.isEditMode = !this.isEditMode;
    
    // 如果切换到预览模式，检查是否需要重新加载内容
    if (!this.isEditMode && this.filePath) {
      const contentRefreshed = await this.checkAndRefreshContent();
      if (contentRefreshed) {
        console.log(`[Tab] 切换到预览模式时重新加载了文件内容: ${this.title}`);
      }
    }
    
    // 使用新的 EditorManager 服务方法切换模式
    if (this.editorManager) {
      this.editorManager.switchMode(this.isEditMode, {
        scrollRatio: this.scrollRatio,
        content: this.content
      });
    }
  }
  
  
  // 更新文件信息（用于文件夹tab切换文件时）
  async updateFileInfo(filePath, fileType, belongsTo = null) {
    this.filePath = filePath;
    this.title = this.extractTitle(filePath);
    this.fileType = fileType;
    this.isModified = false;
    this.isReadOnly = this.determineReadOnlyStatus();
    
    // 如果指定了新的归属，更新它
    if (belongsTo !== null) {
      this.belongsTo = belongsTo;
    }
    
    // 【修复】从文件重新加载内容，不接收传递的content
    if (filePath) {
      await this.reloadFromFile();
    }
    
    // 如果这个tab是当前活动的，立即重新渲染内容
    if (this.isActive && this.editorManager) {
      this.restoreToEditor();
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
    
    // 【修复】直接使用Tab的hasUnsavedChanges状态，不依赖全局编辑器
    return this.hasUnsavedChanges;
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
        // 【修复】使用Tab自己的content保存
        const { ipcRenderer } = require('electron');
        const saveResult = await ipcRenderer.invoke('save-file', this.filePath, this.content);
        if (saveResult.success) {
          this.hasUnsavedChanges = false;
          return true; // 保存成功，可以关闭
        } else {
          return false; // 保存失败，不关闭
        }
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
    const tab = new Tab(data.filePath, data.title, data.belongsTo, data.fileType);
    
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