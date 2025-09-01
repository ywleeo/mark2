class EditorManager {
  constructor(markdownRenderer, eventManager, appManager, tabManager = null) {
    this.markdownRenderer = markdownRenderer;
    this.eventManager = eventManager;
    this.appManager = appManager;
    this.tabManager = tabManager;
    this.isEditMode = false;
    this.currentFilePath = null;
    this.originalContent = '';
    this.hasUnsavedChanges = false;
    
    // 滚动位置比例记录（用比例在两个模式间同步滚动位置）
    this.scrollRatio = 0; // 当前滚动位置的比例（0-1）
    
    // Markdown 语法高亮器
    this.markdownHighlighter = null;
    
    // 窗口大小调整防抖定时器
    this.resizeTimer = null;
    // 窗口是否稳定的标志
    this.isWindowStable = true;
    
    this.setupEditor();
    this.setupResizeHandler();
    this.setupPreviewScrollListener();
  }

  setupEditor() {
    const editor = document.getElementById('editorTextarea');
    if (!editor) return;
    
    // 监听编辑器内容变化
    editor.addEventListener('input', () => {
      this.hasUnsavedChanges = true;
      this.updateSaveButton();
      this.eventManager.emit('content-changed');
      
      // 通知TabManager更新当前tab状态
      if (this.tabManager && typeof this.tabManager.updateCurrentTabState === 'function') {
        this.tabManager.updateCurrentTabState();
      }
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
    let isProcessing = false;
    
    window.addEventListener('resize', () => {
      // 标记窗口不稳定
      this.isWindowStable = false;
      
      // 防止重复处理
      if (isProcessing) return;
      isProcessing = true;
      
      // 清除之前的定时器
      if (this.resizeTimer) {
        cancelAnimationFrame(this.resizeTimer);
      }
      
      // 使用 requestAnimationFrame 确保在下一帧处理
      this.resizeTimer = requestAnimationFrame(() => {
        this.isWindowStable = true;
        isProcessing = false;
        // 如果在编辑模式且语法高亮器存在，检查是否需要修复
        this.checkAndFixHighlighterIfNeeded();
      });
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
        // 因为scrollRatio包含了从view模式传递过来的重要信息
        this.markdownHighlighter.destroy();
        this.markdownHighlighter = null;
        
        const editor = document.getElementById('editorTextarea');
        requestAnimationFrame(() => {
          this.initMarkdownHighlighter(editor);
          // 立即恢复滚动位置，不等待语法高亮器
          // 因为滚动位置恢复与语法高亮是独立的
          requestAnimationFrame(() => {
            this.restoreScrollPosition();
            
            // 重新添加滚动监听器
            this.setupCodeMirrorScrollListener();
          });
        });
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
      requestAnimationFrame(() => {
        this.initMarkdownHighlighter(editor);
      });
      return;
    }
    
    try {
      const CodeMirrorHighlighter = require('./CodeMirrorHighlighter');
      this.markdownHighlighter = new CodeMirrorHighlighter();
      // 延迟初始化，确保编辑器已经显示且窗口稳定
      requestAnimationFrame(async () => {
        // 再次检查窗口是否稳定
        if (this.isWindowStable) {
          await this.markdownHighlighter.init(editor);
          
          // 添加滚动监听器，实时更新编辑器滚动位置
          this.setupCodeMirrorScrollListener();
          
          // 如果有待执行的滚动恢复回调，执行它
          if (this.pendingScrollRestore) {
            // 确保 CodeMirror 完全初始化后再执行滚动恢复，使用 requestAnimationFrame 确保渲染完成
            requestAnimationFrame(() => {
              if (this.pendingScrollRestore) {
                this.pendingScrollRestore();
                this.pendingScrollRestore = null;
              }
            });
          }
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

  // 设置编辑模式（不切换，直接设置）
  async setEditMode(editMode) {
    if (this.isEditMode === editMode) {
      return; // 已经是目标模式，无需变化
    }
    
    // 直接调用 toggleEditMode，因为它已经有完整的逻辑
    await this.toggleEditMode();
  }

  async toggleEditMode() {
    // 检查只读状态，只读文件不能进入编辑模式
    if (!this.isEditMode && this.isCurrentFileReadOnly()) {
      // 显示只读提示，不切换模式
      if (this.appManager && this.appManager.uiManager) {
        this.appManager.uiManager.showMessage('此文件为只读，无法编辑。如需编辑，请另存为本地副本。', 'info');
      }
      return;
    }
    
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
          // console.log('[EditorManager] 切换到编辑模式:', {
          //   editorValue: editor.value ? editor.value.substring(0, 100) + '...' : '(空)',
          //   originalContent: this.originalContent ? this.originalContent.substring(0, 100) + '...' : '(空)',
          //   hasUnsavedChanges: this.hasUnsavedChanges,
          //   needsUpdate: !editor.value || editor.value !== this.originalContent
          // });
          
          // 强制从磁盘重新读取文件内容，确保编辑器显示最新版本
          if (this.currentFilePath) {
            // console.log('[EditorManager] 强制从磁盘重新读取文件:', this.currentFilePath);
            
            const { ipcRenderer } = require('electron');
            try {
              const result = await ipcRenderer.invoke('open-file-dialog', this.currentFilePath);
              if (result && result.content) {
                this.originalContent = result.content;
                editor.value = result.content;
                // console.log('[EditorManager] 成功从磁盘重新加载文件内容');
              } else {
                // console.log('[EditorManager] 磁盘读取失败，使用缓存的 originalContent');
                editor.value = this.originalContent;
              }
            } catch (error) {
              console.error('[EditorManager] 读取文件失败:', error);
              editor.value = this.originalContent;
            }
          } else {
            // console.log('[EditorManager] 无文件路径，使用缓存的 originalContent');
            editor.value = this.originalContent;
          }
          editor.focus();
          
          // 强制重新初始化语法高亮器，确保使用最新内容
          if (this.markdownHighlighter) {
            // console.log('[EditorManager] 销毁现有的 CodeMirror 实例');
            this.markdownHighlighter.destroy();
            this.markdownHighlighter = null;
          }
          this.initMarkdownHighlighter(editor);
          
          // 等待 CodeMirror 内容加载完成后恢复滚动位置
          this.waitForCodeMirrorContent(() => {
            this.restoreScrollPositionWithCallback();
          });
          
          // CodeMirror 自己处理光标定位，不需要额外的滚动修正
        }
      }
      if (contentArea) contentArea.style.display = 'none';
      if (editButton) editButton.textContent = '预览';
      
      // 滚动位置恢复已移到 waitForCodeMirrorContent 中处理
    } else {
      // 切换到预览模式
      if (editorContent) {
        editorContent.style.display = 'none';
        // 自动保存文件（如果有未保存的更改且有有效文件路径）
        const currentPath = this.appManager ? this.appManager.getCurrentFilePath() : this.currentFilePath;
        if (this.hasUnsavedChanges && currentPath) {
          // 只对已存在的文件进行自动保存，避免对新文件弹出保存对话框
          this.saveFile().catch(error => {
            console.warn('自动保存失败:', error);
          });
        }
        // 更新预览内容
        const editor = document.getElementById('editorTextarea');
        if (editor) {
          const content = editor.value;
          this.updatePreview(content);
        }
      }
      if (contentArea) contentArea.style.display = 'block';
      if (editButton) editButton.textContent = '编辑';
      
      // 使用回调方式恢复预览滚动位置
      this.restorePreviewScrollPositionWithCallback();
    }
    
    this.eventManager.emit('edit-mode-changed', this.isEditMode);
    
    // 通知TabManager更新当前tab状态
    if (this.tabManager && typeof this.tabManager.updateCurrentTabState === 'function') {
      this.tabManager.updateCurrentTabState();
    }
    
    // 同步全局状态到当前活动tab的状态
    if (this.tabManager) {
      const activeTab = this.tabManager.getActiveTab();
      if (activeTab) {
        // 确保Tab对象的编辑模式状态与EditorManager同步
        activeTab.isEditMode = this.isEditMode;
      }
    }
  }


  updatePreview(content) {
    const preview = document.getElementById('markdownContent');
    if (!preview) {
      return;
    }
    
    // 使用异步渲染：立即显示基础内容，然后异步应用关键词高亮
    const html = this.markdownRenderer.renderMarkdown(content, preview);
    preview.innerHTML = html;
    
    // 移除自定义搜索功能
    // 恢复搜索高亮（如果搜索处于激活状态）
    // if (this.appManager && this.appManager.getSearchManager()) {
    //   this.appManager.getSearchManager().reapplySearch();
    // }
  }

  setContent(content, filePath, resetSaveState = true, resetEditMode = true) {
    this.originalContent = content;
    this.currentFilePath = filePath;
    
    // 检查当前文件是否为只读
    const isReadOnly = this.isCurrentFileReadOnly();
    
    // 只有在需要重置保存状态时才重置
    if (resetSaveState) {
      this.hasUnsavedChanges = false;
    }
    
    // 只有在需要重置编辑模式时才重置（文件外部更新时保持当前编辑状态）
    const wasInEditMode = this.isEditMode;
    if (resetEditMode || isReadOnly) {
      // 只读文件强制保持预览模式
      this.isEditMode = false;
    }
    
    // 通知主进程编辑模式状态
    const { ipcRenderer } = require('electron');
    ipcRenderer.send('set-edit-mode', this.isEditMode);
    
    // 只有在重置编辑模式时才重置滚动位置和尺寸信息（新文件从顶部开始）
    if (resetEditMode) {
      this.scrollRatio = 0;
    }
    
    // 只有在重置编辑模式时才清理语法高亮器（避免正在编辑时被重置）
    if (resetEditMode && this.markdownHighlighter) {
      this.markdownHighlighter.destroy();
      this.markdownHighlighter = null;
    }
    
    // 更新编辑器内容
    const editor = document.getElementById('editorTextarea');
    if (editor) {
      editor.value = content;
      if (resetEditMode) {
        editor.scrollTop = 0; // 只有在重置编辑模式时才重置滚动位置
      }
    }

    // 如果当前在编辑模式且不重置编辑模式，更新CodeMirror内容
    if (wasInEditMode && !resetEditMode && this.markdownHighlighter && this.markdownHighlighter.isReady()) {
      this.markdownHighlighter.setValue(content);
    }
    
    // 只有在重置编辑模式时或只读文件时才强制切换UI状态
    if (resetEditMode || isReadOnly) {
      const editorContent = document.getElementById('editorContent');
      const contentArea = document.querySelector('.content-area');
      const editButton = document.getElementById('edit-button');
      
      // 确保编辑器容器隐藏，内容区域显示（预览模式）
      if (editorContent) editorContent.style.display = 'none';
      if (contentArea) contentArea.style.display = 'block';
      if (editButton) {
        editButton.textContent = isReadOnly ? '只读' : '编辑';
      }
    } else if (wasInEditMode && !isReadOnly) {
      // 如果之前在编辑模式且不重置编辑模式，保持编辑模式UI状态
      // 但需要确保编辑器中的内容是最新的
      const editorContent = document.getElementById('editorContent');
      const contentArea = document.querySelector('.content-area');
      const editButton = document.getElementById('edit-button');
      
      if (editorContent) editorContent.style.display = 'block';
      if (contentArea) contentArea.style.display = 'none';
      if (editButton) editButton.textContent = '预览';
    }
    
    this.updatePreview(content);
    
    // 只有在重置编辑模式时或只读文件时才重置预览区域滚动位置
    if (resetEditMode || isReadOnly) {
      setTimeout(() => {
        const contentArea = document.querySelector('.content-area');
        if (contentArea) {
          contentArea.scrollTop = 0;
        }
      }, 50);
    }
    
    // 显示只读提示
    this.updateReadOnlyIndicator();
    
    this.updateSaveButton();
  }

  // 检查当前文件是否为只读
  isCurrentFileReadOnly() {
    if (!this.tabManager) return false;
    return this.tabManager.isActiveTabReadOnly();
  }

  // 更新只读指示器
  updateReadOnlyIndicator() {
    const isReadOnly = this.isCurrentFileReadOnly();
    let indicator = document.getElementById('readonly-indicator');
    
    if (isReadOnly) {
      if (!indicator) {
        indicator = document.createElement('div');
        indicator.id = 'readonly-indicator';
        indicator.className = 'readonly-indicator';
        
        const contentArea = document.querySelector('.content-area');
        if (contentArea) {
          contentArea.insertBefore(indicator, contentArea.firstChild);
        }
      }
      
      indicator.innerHTML = `
        <div class="readonly-banner">
          <svg width="16" height="16" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" style="display: inline-block; vertical-align: middle; margin-right: 6px;"><rect x="2" y="5" width="8" height="5" rx="1" stroke="currentColor" stroke-width="1" fill="currentColor" fill-opacity="0.1"/><path d="M3.5 5V3.5C3.5 2.39543 4.39543 1.5 5.5 1.5H6.5C7.60457 1.5 8.5 2.39543 8.5 3.5V5" stroke="currentColor" stroke-width="1" fill="none"/><circle cx="6" cy="7.5" r="0.8" fill="currentColor"/></svg>此文件为只读文件，如需编辑请
          <button class="readonly-save-copy-btn" onclick="window.editorManager.saveAsLocalCopy()">
            另存为本地副本
          </button>
        </div>
      `;
    } else {
      if (indicator) {
        indicator.remove();
      }
    }
  }

  // 另存为本地副本
  async saveAsLocalCopy() {
    try {
      const content = this.getCurrentContent();
      const { ipcRenderer } = require('electron');
      
      // 获取当前文件名作为建议名称
      const currentPath = this.getCurrentFilePath();
      const suggestedName = currentPath ? require('path').basename(currentPath) : null;
      
      // 调用IPC接口，使用保存对话框选择位置
      const result = await ipcRenderer.invoke('save-file-as', content, suggestedName);
      
      if (result && result.success) {
        if (this.appManager && this.appManager.uiManager) {
          this.appManager.uiManager.showMessage(`文件已另存为: ${result.filePath}`, 'success');
        }
      }
    } catch (error) {
      console.error('另存为失败:', error);
      if (this.appManager && this.appManager.uiManager) {
        this.appManager.uiManager.showMessage(`另存为失败: ${error.message}`, 'error');
      }
    }
  }

  getCurrentContent() {
    if (this.isEditMode) {
      const editor = document.getElementById('editorTextarea');
      return editor ? editor.value : this.originalContent;
    }
    return this.originalContent;
  }

  async saveFile() {
    // 检查只读状态，只读文件不能直接保存
    if (this.isCurrentFileReadOnly()) {
      // 提示用户需要另存为
      if (this.appManager && this.appManager.uiManager) {
        this.appManager.uiManager.showMessage('此文件为只读，无法直接保存。如需编辑，请另存为本地副本。', 'warning');
      }
      return;
    }
    
    // 使用全局文件路径
    const currentPath = this.appManager ? this.appManager.getCurrentFilePath() : this.currentFilePath;
    
    // 对于已保存的文件，如果没有未保存的更改，直接返回
    // 对于新建文件（currentPath为null），无论是否有更改都要弹出保存对话框
    if (!this.hasUnsavedChanges && currentPath) {
      return;
    }
    
    const editor = document.getElementById('editorTextarea');
    if (!editor) return;
    
    const content = editor.value;
    
    try {
      const { ipcRenderer } = require('electron');
      
      if (!currentPath) {
        // 新文件，需要保存对话框
        const saveResult = await ipcRenderer.invoke('show-save-dialog');
        if (!saveResult) {
          return; // 用户取消了保存
        }
        
        // 保存新文件
        const result = await ipcRenderer.invoke('save-new-file', saveResult.filePath, content);
        if (result.success) {
          // 更新文件路径
          this.currentFilePath = result.filePath;
          if (this.appManager) {
            this.appManager.currentFilePath = result.filePath;
            
            // 更新当前活动的tab
            const activeTab = this.appManager.tabManager.tabs.find(tab => tab.id === this.appManager.tabManager.activeTabId);
            if (activeTab) {
              activeTab.filePath = result.filePath;
              const path = require('path');
              activeTab.title = path.basename(result.filePath);
              this.appManager.tabManager.updateTabTitle(activeTab.id, activeTab.title);
              
              // 检查并关闭重复的tab（具有相同文件路径但不同ID的tab）
              const duplicateTabs = this.appManager.tabManager.tabs.filter(tab => 
                tab.filePath === result.filePath && tab.id !== activeTab.id
              );
              
              for (const duplicateTab of duplicateTabs) {
                console.log(`[EditorManager] 关闭重复的tab: ${duplicateTab.title} (ID: ${duplicateTab.id})`);
                await this.appManager.tabManager.closeTab(duplicateTab.id);
              }
            }
            
            // 更新文件树中的文件信息
            this.appManager.fileTreeManager.updateNewFileInfo(result.filePath, content);
            
            // 更新界面显示
            this.appManager.uiManager.updateFileNameDisplay(result.filePath);
          }
          
          this.originalContent = content;
          this.hasUnsavedChanges = false;
          this.updateSaveButton();
          
          // 更新预览
          if (!this.isEditMode) {
            this.updatePreview(content);
          }
          
          this.eventManager.emit('file-saved', result.filePath);
          
          if (this.appManager && this.appManager.getUIManager()) {
            this.appManager.getUIManager().showMessage('文件保存成功', 'success');
          }
        }
      } else {
        // 已存在的文件
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
      }
    } catch (error) {
      console.error('保存文件失败:', error);
      if (this.appManager && this.appManager.getUIManager()) {
        this.appManager.getUIManager().showMessage('保存失败: ' + error.message, 'error');
      }
    }
  }

  updateSaveButton() {
    // 检查只读状态并更新按钮
    const editButton = document.getElementById('edit-button');
    const saveBtn = document.getElementById('saveBtn');
    
    const isReadOnly = this.isCurrentFileReadOnly();
    
    if (editButton) {
      if (isReadOnly) {
        editButton.textContent = '只读';
        editButton.style.color = '#666';
        editButton.title = '此文件为只读，无法编辑';
        editButton.disabled = true;
      } else {
        editButton.textContent = this.isEditMode ? '预览' : '编辑';
        editButton.style.color = '';
        editButton.title = '';
        editButton.disabled = false;
      }
    }
    
    if (saveBtn) {
      if (isReadOnly) {
        saveBtn.textContent = '另存为';
        saveBtn.title = '另存为本地副本';
        saveBtn.disabled = false;
      } else {
        saveBtn.textContent = '保存';
        saveBtn.title = '';
        saveBtn.disabled = false;
      }
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
    
    // 重置滚动比例
    this.scrollRatio = 0;
    
    // 清理语法高亮器
    if (this.markdownHighlighter) {
      this.markdownHighlighter.destroy();
      this.markdownHighlighter = null;
    }
    
    // 清理resize定时器
    if (this.resizeTimer) {
      cancelAnimationFrame(this.resizeTimer);
      this.resizeTimer = null;
    }
    
    // 清理只读指示器
    this.updateReadOnlyIndicator();
    
    // 清理预览滚动监听器
    if (this.removePreviewScrollListener) {
      this.removePreviewScrollListener();
      this.removePreviewScrollListener = null;
    }
    
    // 清理待执行回调
    this.pendingScrollRestore = null;
    this.onCodeMirrorReady = null;
    
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

  // 保存当前模式的滚动比例
  saveCurrentScrollPosition() {
    if (this.isEditMode) {
      // 当前在编辑模式，获取当前滚动比例
      if (this.markdownHighlighter && this.markdownHighlighter.isReady()) {
        const scrollInfo = this.markdownHighlighter.getScrollInfo();
        const maxScroll = Math.max(1, scrollInfo.height - scrollInfo.clientHeight);
        this.scrollRatio = scrollInfo.top / maxScroll;
      } else {
        // 备用方案：使用原始textarea
        const editor = document.getElementById('editorTextarea');
        if (editor) {
          const maxScroll = Math.max(1, editor.scrollHeight - editor.clientHeight);
          this.scrollRatio = editor.scrollTop / maxScroll;
        }
      }
    } else {
      // 当前在预览模式，获取当前滚动比例
      const contentArea = document.querySelector('.content-area');
      if (contentArea) {
        const maxScroll = Math.max(1, contentArea.scrollHeight - contentArea.clientHeight);
        this.scrollRatio = contentArea.scrollTop / maxScroll;
      }
    }
  }


  // 使用回调方式恢复编辑器滚动位置
  restoreScrollPositionWithCallback(callback) {
    if (this.markdownHighlighter && this.markdownHighlighter.isReady()) {
      this.restoreEditorScrollPosition();
      if (callback) callback();
    } else {
      // 设置待执行回调，等待 CodeMirror 初始化完成
      this.pendingScrollRestore = () => {
        this.restoreEditorScrollPosition();
        if (callback) callback();
      };
    }
  }

  // 恢复编辑器滚动位置的具体实现
  restoreEditorScrollPosition() {
    if (this.markdownHighlighter && this.markdownHighlighter.isReady()) {
      const scrollInfo = this.markdownHighlighter.getScrollInfo();
      const editorMaxScroll = Math.max(1, scrollInfo.height - scrollInfo.clientHeight);
      const targetScroll = this.scrollRatio * editorMaxScroll;
      this.markdownHighlighter.scrollTo(targetScroll);
    }
  }

  // 使用回调方式恢复预览滚动位置
  restorePreviewScrollPositionWithCallback() {
    const contentArea = document.querySelector('.content-area');
    if (!contentArea) return;

    // 使用 ResizeObserver 监听内容变化
    const observer = new ResizeObserver(() => {
      const previewMaxScroll = Math.max(0, contentArea.scrollHeight - contentArea.clientHeight);
      
      if (previewMaxScroll > 0) {
        observer.disconnect();
        this.restorePreviewScrollPosition(contentArea);
      }
    });
    
    observer.observe(contentArea);
    
    // 立即尝试一次
    const previewMaxScroll = Math.max(0, contentArea.scrollHeight - contentArea.clientHeight);
    if (previewMaxScroll > 0) {
      observer.disconnect();
      this.restorePreviewScrollPosition(contentArea);
    }
  }

  // 恢复预览滚动位置的具体实现
  restorePreviewScrollPosition(contentArea) {
    const previewMaxScroll = Math.max(1, contentArea.scrollHeight - contentArea.clientHeight);
    const targetScroll = this.scrollRatio * previewMaxScroll;
    contentArea.scrollTop = targetScroll;
  }


  // CodeMirror 自己处理所有光标和滚动问题，不再需要手动修正

  // 设置预览模式滚动监听器
  setupPreviewScrollListener() {
    const contentArea = document.querySelector('.content-area');
    
    if (contentArea) {
      const handlePreviewScroll = () => {
        if (!this.isEditMode) {
          const scrollTop = contentArea.scrollTop;
          const maxScroll = Math.max(1, contentArea.scrollHeight - contentArea.clientHeight);
          this.scrollRatio = scrollTop / maxScroll;
        }
      };
      
      contentArea.addEventListener('scroll', handlePreviewScroll, { passive: true });
      
      // 保存移除函数
      this.removePreviewScrollListener = () => {
        contentArea.removeEventListener('scroll', handlePreviewScroll);
      };
    } else {
      // 使用回调方式等待 DOM 准备好
      const observer = new MutationObserver(() => {
        const contentArea = document.querySelector('.content-area');
        if (contentArea) {
          observer.disconnect();
          this.setupPreviewScrollListener();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  // 设置 CodeMirror 滚动监听器
  setupCodeMirrorScrollListener() {
    if (this.markdownHighlighter && this.markdownHighlighter.isReady()) {
      this.markdownHighlighter.onScroll((scrollInfo) => {
        const scrollTop = scrollInfo.top;
        const maxScroll = Math.max(1, scrollInfo.height - scrollInfo.clientHeight);
        this.scrollRatio = scrollTop / maxScroll;
      });
      
      // 执行回调，通知 CodeMirror 设置完成
      if (this.onCodeMirrorReady) {
        // 使用 requestAnimationFrame 确保 CodeMirror 完全准备好
        requestAnimationFrame(() => {
          if (this.onCodeMirrorReady) {
            this.onCodeMirrorReady();
            this.onCodeMirrorReady = null;
          }
        });
      }
    } else {
      // 设置回调，当 CodeMirror 准备好时调用
      this.onCodeMirrorReady = () => {
        this.setupCodeMirrorScrollListener();
      };
    }
  }

  // 等待 CodeMirror 内容加载完成
  waitForCodeMirrorContent(callback) {
    
    const checkContentLoaded = () => {
      // 检查 CodeMirror 是否已初始化并且内容已加载
      if (!this.markdownHighlighter || !this.markdownHighlighter.isReady()) {
        setTimeout(checkContentLoaded, 50);
        return;
      }
      
      const scrollInfo = this.markdownHighlighter.getScrollInfo();
      const hasContent = scrollInfo.height > scrollInfo.clientHeight;
      
      if (hasContent) {
        requestAnimationFrame(() => {
          callback();
        });
      } else {
        setTimeout(checkContentLoaded, 50);
      }
    };
    
    // 立即开始检查
    checkContentLoaded();
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