class EditorManager {
  constructor(markdownRenderer, eventManager, appManager, tabManager = null) {
    this.markdownRenderer = markdownRenderer;
    this.eventManager = eventManager;
    this.appManager = appManager;
    this.tabManager = tabManager;
    
    // EditorManager 作为无状态的服务类，不保存 tab 状态
    // 状态由 Tab 管理，通过参数传递给服务方法
    
    // Markdown 语法高亮器
    this.markdownHighlighter = null;
    
    // 窗口大小调整防抖定时器
    this.resizeTimer = null;
    // 窗口是否稳定的标志
    this.isWindowStable = true;
    
    this.setupEditor();
    this.setupResizeHandler();
    this.setupThemeListener();
  }

  setupEditor() {
    const editor = document.getElementById('editorTextarea');
    if (!editor) return;
    
    // 监听编辑器内容变化
    editor.addEventListener('input', () => {
      this.eventManager.emit('content-changed');
      
      // 【修复】直接让活动tab更新自己的content和变化状态
      if (this.tabManager) {
        const activeTab = this.tabManager.getActiveTab();
        if (activeTab && activeTab.isActive) {
          // 直接从DOM获取内容并更新到活动tab
          activeTab.content = editor.value;
          
          // 更新未保存变化状态
          const originalContent = activeTab.originalFileContent || '';
          activeTab.hasUnsavedChanges = (activeTab.content !== originalContent);
          
          // 只同步滚动位置，不调用saveFromEditor避免递归
          activeTab.scrollRatio = this.getCurrentScrollPosition(activeTab.isEditMode);
        }
      }
    });
    
    // 监听快捷键
    editor.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 's') {
        event.preventDefault();
        this.saveFile();
      }
    });
    
    // 设置 view 模式滚动监听器
    this.setupViewScrollListener();
  }

  // 设置 view 模式滚动监听器
  setupViewScrollListener() {
    const contentArea = document.querySelector('.content-area');
    if (!contentArea) return;
    
    let scrollTimer = null;
    
    const handleViewScroll = () => {
      // 防抖处理，避免过于频繁的状态保存
      if (scrollTimer) {
        clearTimeout(scrollTimer);
      }
      
      scrollTimer = setTimeout(() => {
        // 只有在 view 模式下才保存滚动位置
        if (this.tabManager) {
          const activeTab = this.tabManager.getActiveTab();
          if (activeTab && !activeTab.isEditMode) {
            activeTab.saveFromEditor();
          }
        }
      }, 100); // 100ms 防抖
    };
    
    contentArea.addEventListener('scroll', handleViewScroll);
    
    // 保存移除函数以便销毁时清理
    this.removeViewScrollListener = () => {
      contentArea.removeEventListener('scroll', handleViewScroll);
      if (scrollTimer) {
        clearTimeout(scrollTimer);
        scrollTimer = null;
      }
    };
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
    // 从当前活动tab获取编辑模式状态
    const activeTab = this.tabManager?.getActiveTab();
    if (!activeTab?.isEditMode || !this.markdownHighlighter || !this.markdownHighlighter.isReady()) {
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
          this.initMarkdownHighlighter(editor, () => {
            // CodeMirror 重新初始化完成，滚动位置会在适当时机恢复
          });
        });
      }
    }
  }

  // 初始化 Markdown 语法高亮器（在切换到编辑模式时调用）
  async initMarkdownHighlighter(editor, onInitialized = null) {
    if (this.markdownHighlighter) {
      // 已经初始化过了，直接执行回调
      if (onInitialized) onInitialized();
      return;
    }
    
    // 如果窗口不稳定，等待稳定后再初始化
    if (!this.isWindowStable) {
      requestAnimationFrame(() => {
        this.initMarkdownHighlighter(editor, onInitialized);
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
          
          // 滚动监听器已在 CodeMirrorHighlighter.setupScrollListener() 中设置
          
          // CodeMirror 初始化完成，执行回调
          if (onInitialized) {
            onInitialized();
          }
          
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
      });
    } catch (error) {
      console.warn('CodeMirror 语法高亮器初始化失败:', error);
      // 继续使用普通 textarea
    }
  }



  updatePreview(content, filePath = null) {
    const preview = document.getElementById('markdownContent');
    if (!preview) {
      return;
    }
    
    // 获取文件路径（如果未提供，则从当前活动tab获取）
    if (!filePath) {
      const activeTab = this.tabManager?.getActiveTab();
      filePath = activeTab?.filePath || null;
    }
    
    // 使用异步渲染：立即显示基础内容，然后异步应用关键词高亮
    const html = this.markdownRenderer.renderMarkdown(content, preview, filePath);
    preview.innerHTML = html;
    
    // 移除自定义搜索功能
    // 恢复搜索高亮（如果搜索处于激活状态）
    // if (this.appManager && this.appManager.getSearchManager()) {
    //   this.appManager.getSearchManager().reapplySearch();
    // }
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
    const editor = document.getElementById('editorTextarea');
    return editor ? editor.value : '';
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
    
    // 从活动tab获取状态
    const activeTab = this.tabManager?.getActiveTab();
    if (!activeTab) return;
    
    const currentPath = activeTab.filePath;
    
    // 对于已保存的文件，如果没有未保存的更改，直接返回
    // 对于新建文件（currentPath为null），无论是否有更改都要弹出保存对话框
    if (!activeTab.hasUnsavedChanges && currentPath) {
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
          // 更新活动tab状态
          activeTab.filePath = result.filePath;
          const path = require('path');
          activeTab.title = path.basename(result.filePath);
          activeTab.content = content;
          activeTab.hasUnsavedChanges = false;
          
          // 更新TabManager
          if (this.appManager) {
            this.appManager.currentFilePath = result.filePath;
            this.appManager.tabManager.updateTabTitle(activeTab.id, activeTab.title);
            
            // 检查并关闭重复的tab（具有相同文件路径但不同ID的tab）
            const duplicateTabs = this.appManager.tabManager.tabs.filter(tab => 
              tab.filePath === result.filePath && tab.id !== activeTab.id
            );
            
            for (const duplicateTab of duplicateTabs) {
              console.log(`[EditorManager] 关闭重复的tab: ${duplicateTab.title} (ID: ${duplicateTab.id})`);
              await this.appManager.tabManager.closeTab(duplicateTab.id);
            }
            
            // 更新文件树中的文件信息
            this.appManager.fileTreeManager.updateNewFileInfo(result.filePath, content);
            
            // 更新界面显示
            this.appManager.uiManager.updateFileNameDisplay(result.filePath);
          }
          
          // 更新预览
          if (!activeTab.isEditMode) {
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
        
        // 更新活动tab状态
        activeTab.content = content;
        activeTab.hasUnsavedChanges = false;
        
        // 更新预览
        if (!activeTab.isEditMode) {
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

      // 检查是否为IPC连接失效导致的错误
      if (this.isIPCError(error)) {
        console.log('检测到IPC连接失效，尝试恢复...');

        // 尝试恢复IPC连接并重试保存
        const retryResult = await this.retryWithIPCRecovery(currentPath, content, activeTab);
        if (retryResult.success) {
          return; // 重试成功，直接返回
        }

        // 恢复失败，显示带恢复建议的错误信息
        if (this.appManager && this.appManager.getUIManager()) {
          this.appManager.getUIManager().showMessage(
            `保存失败: ${error.message}\n\n建议操作：\n1. 检查文件路径是否有效\n2. 确认文件写入权限\n3. 手动复制内容到其他位置备份`,
            'error'
          );
        }
      } else {
        // 常规错误处理
        if (this.appManager && this.appManager.getUIManager()) {
          this.appManager.getUIManager().showMessage('保存失败: ' + error.message, 'error');
        }
      }
    }
  }

  // 检查错误是否为IPC连接相关错误
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
      'Target is destroyed'
    ];

    return ipcErrorPatterns.some(pattern =>
      errorMessage.toLowerCase().includes(pattern.toLowerCase())
    );
  }

  // 尝试恢复IPC连接并重试保存
  async retryWithIPCRecovery(currentPath, content, activeTab) {
    const { ipcRenderer } = require('electron');

    try {
      // 第一步：测试IPC连接健康状态
      console.log('测试IPC连接健康状态...');

      // 使用简单的IPC调用测试连接
      const healthCheck = await Promise.race([
        ipcRenderer.invoke('check-file-exists', currentPath || '/tmp'),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('IPC健康检查超时')), 3000)
        )
      ]);

      console.log('IPC连接测试完成，状态正常');

      // 第二步：重新尝试文件保存
      console.log('重新尝试保存文件...');

      if (!currentPath) {
        // 新文件保存流程
        const saveResult = await ipcRenderer.invoke('show-save-dialog');
        if (!saveResult) {
          return { success: false, reason: '用户取消保存' };
        }

        const result = await ipcRenderer.invoke('save-new-file', saveResult.filePath, content);
        if (result.success) {
          // 更新tab状态
          activeTab.filePath = result.filePath;
          const path = require('path');
          activeTab.title = path.basename(result.filePath);
          activeTab.content = content;
          activeTab.hasUnsavedChanges = false;

          this.handleSuccessfulSave(result.filePath, content, activeTab, true);
          return { success: true };
        }
      } else {
        // 已存在文件保存流程
        await ipcRenderer.invoke('save-file', currentPath, content);

        // 更新tab状态
        activeTab.content = content;
        activeTab.hasUnsavedChanges = false;

        this.handleSuccessfulSave(currentPath, content, activeTab, false);
        return { success: true };
      }

      return { success: false, reason: '保存操作失败' };

    } catch (retryError) {
      console.error('IPC恢复重试失败:', retryError);
      return { success: false, reason: retryError.message };
    }
  }

  // 处理成功保存后的统一逻辑
  handleSuccessfulSave(filePath, content, activeTab, isNewFile) {
    try {
      if (isNewFile && this.appManager) {
        // 新文件的额外处理
        this.appManager.currentFilePath = filePath;
        this.appManager.tabManager.updateTabTitle(activeTab.id, activeTab.title);

        // 关闭重复tab
        const duplicateTabs = this.appManager.tabManager.tabs.filter(tab =>
          tab.filePath === filePath && tab.id !== activeTab.id
        );

        duplicateTabs.forEach(async (duplicateTab) => {
          await this.appManager.tabManager.closeTab(duplicateTab.id);
        });

        // 更新文件树和界面
        this.appManager.fileTreeManager.updateNewFileInfo(filePath, content);
        this.appManager.uiManager.updateFileNameDisplay(filePath);
      }

      // 更新预览
      if (!activeTab.isEditMode) {
        this.updatePreview(content, filePath);
      }

      // 发送保存事件
      this.eventManager.emit('file-saved', filePath);

      // 显示成功消息
      if (this.appManager && this.appManager.getUIManager()) {
        this.appManager.getUIManager().showMessage('文件保存成功（IPC恢复后）', 'success');
      }

      console.log('文件保存成功（通过IPC恢复）:', filePath);
    } catch (error) {
      console.error('保存后处理失败:', error);
    }
  }

  updateSaveButton() {
    // 检查只读状态并更新按钮
    const editButton = document.getElementById('edit-button');
    const saveBtn = document.getElementById('saveBtn');
    
    const isReadOnly = this.isCurrentFileReadOnly();
    const activeTab = this.tabManager?.getActiveTab();
    
    if (editButton) {
      if (isReadOnly) {
        editButton.textContent = '只读';
        editButton.style.color = '#666';
        editButton.title = '此文件为只读，无法编辑';
        editButton.disabled = true;
      } else {
        editButton.textContent = activeTab?.isEditMode ? '预览' : '编辑';
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
    const activeTab = this.tabManager?.getActiveTab();
    return activeTab?.hasUnsavedChanges || false;
  }

  getCurrentFilePath() {
    const activeTab = this.tabManager?.getActiveTab();
    return activeTab?.filePath || null;
  }

  isInEditMode() {
    const activeTab = this.tabManager?.getActiveTab();
    return activeTab?.isEditMode || false;
  }

  resetToInitialState() {
    console.log('[EditorManager] 重置到初始状态');
    
    // 清理语法高亮器
    if (this.markdownHighlighter) {
      this.markdownHighlighter.destroy();
      this.markdownHighlighter = null;
    }
    
    // 【修复】使用标准 API 而不是直接 DOM 操作
    // 只在真正没有活动 tab 时才清空内容
    const activeTab = this.tabManager?.getActiveTab();
    if (!activeTab) {
      console.log('[EditorManager] 无活动tab，渲染空内容');
      // 使用标准的 renderContent API 来清空内容
      this.renderContent('', null, { isEditMode: false, scrollRatio: 0 });
    }
    
    console.log('[EditorManager] 初始状态重置完成');
  }

  // ===== 新的无状态服务方法 =====
  
  /**
   * 渲染内容到编辑器
   * @param {string} content - 文件内容
   * @param {string} filePath - 文件路径
   * @param {object} options - 选项
   */
  renderContent(content, filePath, options) {
    options = options || {};
    const isEditMode = options.isEditMode || false;
    const scrollRatio = options.scrollRatio || 0;
    
    // 编辑器内容将通过switchMode中的CodeMirror API设置，这里不直接操作DOM
    
    // 更新预览内容，传递文件路径
    this.updatePreview(content, filePath);
    
    // 设置编辑模式
    this.switchMode(isEditMode, { scrollRatio, content, filePath });
  }
  
  /**
   * 切换编辑/预览模式
   * @param {boolean} isEditMode - 是否为编辑模式
   * @param {object} options - 选项
   */
  switchMode(isEditMode, options) {
    options = options || {};
    const scrollRatio = options.scrollRatio || 0;
    const content = options.content || ''; // 从外部接收内容，不从DOM获取
    const filePath = options.filePath || null;
    
    const editorContent = document.getElementById('editorContent');
    const contentArea = document.querySelector('.content-area');
    const editButton = document.getElementById('edit-button');
    
    if (isEditMode) {
      // 切换到编辑模式
      if (editorContent) editorContent.style.display = 'block';
      if (contentArea) contentArea.style.display = 'none';
      if (editButton) editButton.textContent = '预览';
      
      // 初始化语法高亮器
      const editor = document.getElementById('editorTextarea');
      if (editor) {
        // 第一个打点：view 传给 edit 的滚动位置
        console.log(`[滚动继承] 第一次切到edit，接收到的scrollRatio: ${scrollRatio}`);
        
        // 使用回调机制确保滚动位置在 CodeMirror 初始化完成后设置
        this.initMarkdownHighlighter(editor, () => {
          // 【核心修复】使用CodeMirror的setValue API设置内容
          if (this.markdownHighlighter && this.markdownHighlighter.setValue) {
            this.markdownHighlighter.setValue(content);
            console.log(`[EditorManager] 使用CodeMirror API设置编辑器内容，长度: ${content.length}`);
          }
          
          // CodeMirror 初始化完成的回调
          this.setScrollPosition(scrollRatio, true);
          
          // 第二个打点：设置完滚动位置后的实际位置
          const actualScrollRatio = this.getCurrentScrollPosition(true);
          console.log(`[滚动继承] edit初始化完成后，实际scrollRatio: ${actualScrollRatio}`);
          
          // CodeMirror 初始化完成后，更新活动 tab 的基准 MD5
          this.updateActiveTabBaselineMD5(content);
          
          // 设置编辑器焦点（确保新建文件等场景下编辑器获得焦点）
          console.log('[EditorManager] 检查是否设置编辑器焦点', {
            hasHighlighter: !!this.markdownHighlighter,
            hasFocusMethod: !!(this.markdownHighlighter && this.markdownHighlighter.focus)
          });
          if (this.markdownHighlighter && this.markdownHighlighter.focus) {
            // 使用 setTimeout 确保 DOM 完全更新后再设置焦点
            setTimeout(() => {
              console.log('[EditorManager] 设置编辑器焦点');
              this.markdownHighlighter.focus();
            }, 10);
          }
        });
      }
    } else {
      // 切换到预览模式
      if (editorContent) editorContent.style.display = 'none';
      if (contentArea) contentArea.style.display = 'block';
      if (editButton) editButton.textContent = '编辑';
      
      // 更新预览内容（使用传入的内容）
      if (content !== undefined) {
        this.updatePreview(content, filePath);
      }
      
      // 延迟设置滚动位置
      requestAnimationFrame(() => {
        this.setScrollPosition(scrollRatio, false);
      });
    }
    
    // 通知主进程编辑模式状态
    const { ipcRenderer } = require('electron');
    ipcRenderer.send('set-edit-mode', isEditMode);
    
    this.eventManager.emit('edit-mode-changed', isEditMode);
  }
  
  /**
   * 设置滚动位置
   * @param {number} scrollRatio - 滚动比例 (0-1)
   * @param {boolean} isEditMode - 是否为编辑模式
   */
  setScrollPosition(scrollRatio, isEditMode) {
    console.log(`[滚动设置] setScrollPosition调用: scrollRatio=${scrollRatio}, isEditMode=${isEditMode}`);
    
    if (isEditMode) {
      // 编辑模式滚动
      const hasHighlighter = !!this.markdownHighlighter;
      const isReady = hasHighlighter && this.markdownHighlighter.isReady();
      console.log(`[滚动设置] edit模式检查: hasHighlighter=${hasHighlighter}, isReady=${isReady}`);
      
      if (this.markdownHighlighter && this.markdownHighlighter.isReady()) {
        const scrollInfo = this.markdownHighlighter.getScrollInfo();
        const maxScroll = Math.max(1, scrollInfo.height - scrollInfo.clientHeight);
        const targetScroll = scrollRatio * maxScroll;
        console.log(`[滚动设置] edit模式设置滚动: targetScroll=${targetScroll}, maxScroll=${maxScroll}`);
        this.markdownHighlighter.scrollTo(targetScroll);
      } else {
        console.log(`[滚动设置] CodeMirror未准备好，无法设置滚动位置`);
      }
    } else {
      // 预览模式滚动
      const contentArea = document.querySelector('.content-area');
      if (contentArea) {
        const maxScroll = Math.max(1, contentArea.scrollHeight - contentArea.clientHeight);
        const targetScroll = scrollRatio * maxScroll;
        contentArea.scrollTop = targetScroll;
      }
    }
  }
  
  /**
   * 获取当前滚动位置
   * @param {boolean} isEditMode - 是否为编辑模式
   * @returns {number} 滚动比例 (0-1)
   */
  getCurrentScrollPosition(isEditMode) {
    if (isEditMode) {
      // 编辑模式
      if (this.markdownHighlighter && this.markdownHighlighter.isReady()) {
        const scrollInfo = this.markdownHighlighter.getScrollInfo();
        if (scrollInfo.height > scrollInfo.clientHeight) {
          const maxScroll = Math.max(1, scrollInfo.height - scrollInfo.clientHeight);
          return scrollInfo.top / maxScroll;
        }
      }
    } else {
      // 预览模式
      const contentArea = document.querySelector('.content-area');
      if (contentArea && contentArea.scrollHeight > contentArea.clientHeight) {
        const maxScroll = Math.max(1, contentArea.scrollHeight - contentArea.clientHeight);
        return contentArea.scrollTop / maxScroll;
      }
    }
    return 0;
  }
  
  /**
   * 获取当前编辑器内容
   * @returns {string} 当前内容
   */
  getCurrentContent() {
    // 优先从 CodeMirror 获取内容
    if (this.markdownHighlighter && this.markdownHighlighter.isReady()) {
      return this.markdownHighlighter.getValue();
    }
    
    // 如果 CodeMirror 不可用，回退到 textarea
    const editor = document.getElementById('editorTextarea');
    return editor ? editor.value : '';
  }
  
  /**
   * 重置编辑器状态
   */
  reset() {
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
    
    // 清理 view 模式滚动监听器
    if (this.removeViewScrollListener) {
      this.removeViewScrollListener();
      this.removeViewScrollListener = null;
    }
    
    // 清理只读指示器
    this.updateReadOnlyIndicator();
    
    // 重置UI到预览模式
    const editor = document.getElementById('editorTextarea');
    const editorContent = document.getElementById('editorContent');
    const preview = document.getElementById('markdownContent');
    const editButton = document.getElementById('edit-button');
    
    if (editorContent) {
      editorContent.style.display = 'none';
    }
    if (editor) {
      // 在reset()方法中，CodeMirror已被销毁，这里直接操作DOM是合理的
      editor.value = '';
    }
    if (preview) {
      preview.style.display = 'block';
      preview.innerHTML = '';
    }
    if (editButton) editButton.textContent = '编辑';
    
    this.updateSaveButton();
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

  // 更新活动 tab 的基准 MD5（CodeMirror 初始化完成后调用）
  updateActiveTabBaselineMD5(content) {
    if (!this.tabManager) return;
    
    const activeTab = this.tabManager.getActiveTab();
    if (!activeTab) return;
    
    // 使用传入的内容或从 Tab 获取内容，而不是从 DOM 获取
    const contentToUse = content !== undefined ? content : activeTab.content;
    if (contentToUse !== undefined) {
      // 用传入的内容（已预处理）生成新的基准 MD5
      const newBaselineMD5 = activeTab.constructor.calculateMD5(contentToUse);
      activeTab.originalContentMD5 = newBaselineMD5;
      
      console.log(`[MD5基准] 更新基准MD5: ${newBaselineMD5.substring(0, 8)}... (内容长度: ${contentToUse.length})`);
    }
  }

  // 设置主题监听
  setupThemeListener() {
    // 监听主题变化事件，更新 CodeMirror 编辑器主题
    this.eventManager.on('theme-changed', (theme) => {
      console.log('[EditorManager] 收到主题变化事件:', theme);
      if (this.markdownHighlighter && this.markdownHighlighter.updateTheme) {
        // 延迟一点让 CSS 加载完成
        setTimeout(() => {
          this.markdownHighlighter.updateTheme();
        }, 50);
      }
    });
  }
}

module.exports = EditorManager;