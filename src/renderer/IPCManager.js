class IPCManager {
  constructor(eventManager, appManager, editorManager, uiManager, fileTreeManager, searchManager, tabManager) {
    this.eventManager = eventManager;
    this.appManager = appManager;
    this.editorManager = editorManager;
    this.uiManager = uiManager;
    this.fileTreeManager = fileTreeManager;
    this.searchManager = searchManager;
    this.tabManager = tabManager;
    
    this.setupIPCListeners();
  }

  setupIPCListeners() {
    const { ipcRenderer } = require('electron');
    
    // 文件操作相关
    this.setupFileOperationListeners(ipcRenderer);
    
    // 文件监听相关
    this.setupFileWatchingListeners(ipcRenderer);
    
    // 菜单操作相关
    this.setupMenuListeners(ipcRenderer);
    
    // 应用状态相关
    this.setupAppStateListeners(ipcRenderer);
    
    // 插件系统相关
    this.setupPluginListeners(ipcRenderer);
    
    // 系统电源事件相关
    this.setupPowerEventListeners(ipcRenderer);
    
    // 窗口激活刷新相关
    this.setupWindowActivationListeners(ipcRenderer);
  }

  setupFileOperationListeners(ipcRenderer) {
    // 监听主进程发送的文件打开事件
    ipcRenderer.on('file-opened', (event, data) => {
      this.displayMarkdown(data.content, data.filePath, false, false, false, 'file');
    });

    // 监听主进程发送的文件夹打开事件
    ipcRenderer.on('folder-opened', (event, data) => {
      this.displayFileTree(data.folderPath, data.fileTree);
    });

    // 监听文件树更新事件
    ipcRenderer.on('file-tree-updated', (event, data) => {
      this.fileTreeManager.updateFileTree(data.folderPath, data.fileTree);
    });

    // 监听文件内容更新事件
    ipcRenderer.on('file-content-updated', (event, data) => {
      this.handleFileContentUpdate(data);
    });
  }

  setupFileWatchingListeners(ipcRenderer) {
    // 监听文件监听开始事件
    ipcRenderer.on('file-watch-started', (event, data) => {
      console.log('开始监听文件:', data.filePath);
      this.updateFileWatchStatus(data.filePath, true);
    });

    // 监听文件监听停止事件
    ipcRenderer.on('file-watch-stopped', (event, data) => {
      console.log('停止监听文件:', data.filePath);
      this.updateFileWatchStatus(data.filePath, false);
    });

    // 监听监听器错误事件
    ipcRenderer.on('watcher-error', (event, data) => {
      console.error('监听器错误:', data);
      this.handleWatcherError(data);
    });
  }

  setupMenuListeners(ipcRenderer) {
    // 侧边栏切换
    ipcRenderer.on('toggle-sidebar', () => {
      this.uiManager.toggleSidebar();
    });

    // 编辑模式切换
    ipcRenderer.on('toggle-edit-mode', () => {
      if (this.tabManager.activeTabId) {
        this.editorManager.toggleEditMode();
      }
    });

    // 主题切换
    ipcRenderer.on('switch-theme', (event, theme) => {
      this.uiManager.switchTheme(theme);
    });

    // 搜索功能
    ipcRenderer.on('show-search', () => {
      this.searchManager.showSearch();
    });

    ipcRenderer.on('show-search-box', () => {
      this.searchManager.show();
    });

    // 设置对话框
    ipcRenderer.on('show-settings', () => {
      this.uiManager.showSettings();
    });

    // 重置到初始状态
    ipcRenderer.on('reset-to-initial-state', () => {
      this.resetToInitialState();
    });
  }

  setupAppStateListeners(ipcRenderer) {
    // 监听新建文件请求
    ipcRenderer.on('create-new-file', () => {
      this.tabManager.createNewFileTab();
    });

    // 监听 PDF 导出请求
    ipcRenderer.on('export-pdf-request', () => {
      this.exportToPDF();
    });

    // 监听状态恢复请求（窗口重新显示时）
    ipcRenderer.on('restore-app-state', () => {
      this.eventManager.emit('restore-app-state');
    });
  }

  setupPluginListeners(ipcRenderer) {
    // 监听插件切换事件
    ipcRenderer.on('toggle-plugin', (event, data) => {
      this.togglePlugin(data.pluginId, data.enabled);
    });

    // 监听刷新插件事件
    ipcRenderer.on('refresh-plugins', () => {
      this.refreshPlugins();
    });
  }

  setupPowerEventListeners(ipcRenderer) {
    // 保留基本的系统事件监听（简化版本）
    ipcRenderer.on('system-suspend', () => {
      console.log('接收到系统休眠信号');
      // 简化处理：只保存状态，不做复杂的监听暂停
      this.eventManager.emit('save-app-state');
    });

    ipcRenderer.on('system-resume', () => {
      console.log('接收到系统唤醒信号');
      // 简化处理：依赖窗口激活事件来刷新内容
      console.log('系统唤醒后，等待窗口激活事件来刷新内容');
    });
  }

  setupWindowActivationListeners(ipcRenderer) {
    // 监听窗口激活刷新事件
    ipcRenderer.on('window-activated-refresh', async () => {
      console.log('接收到窗口激活刷新信号');
      await this.handleWindowActivatedRefresh();
    });
  }

  // 文件操作处理方法
  displayMarkdown(content, filePath, fromFolderMode = false, forceNewTab = false, fromDoubleClick = false, fileType = 'subfolder-file') {
    // 使用Tab系统打开文件
    this.tabManager.openFileInTab(filePath, content, forceNewTab, fromDoubleClick, fileType);
    
    // 如果不是从文件夹模式打开的文件，将文件添加到侧边栏
    if (!fromFolderMode) {
      this.fileTreeManager.addFile(filePath, content);
    }
    
    // 显示markdown内容
    const markdownContent = document.querySelector('.markdown-content');
    if (markdownContent) {
      markdownContent.style.display = 'block';
    }
    
    // 停止动画并调整窗口大小到内容加载状态
    const { ipcRenderer } = require('electron');
    ipcRenderer.send('resize-window-to-content-loaded');
  }

  displayFileTree(folderPath, fileTree) {
    // 停止动画并调整窗口大小到内容加载状态
    const { ipcRenderer } = require('electron');
    ipcRenderer.send('resize-window-to-content-loaded');
    
    this.fileTreeManager.displayFileTree(folderPath, fileTree);
    
    // 保存状态
    this.eventManager.emit('save-app-state');
  }

  // 文件内容更新处理
  handleFileContentUpdate(data) {
    // 只有当更新的文件是当前正在显示的文件时才刷新
    const currentFilePath = this.tabManager.getActiveTab()?.filePath;
    if (data.filePath === currentFilePath) {
      // 更新编辑器内容（如果处于编辑模式，需要检查是否有未保存的更改）
      if (this.editorManager.hasUnsavedContent()) {
        // 如果有未保存的更改，显示警告提示用户
        this.uiManager.showMessage('文件已被外部修改，但您有未保存的更改', 'warning');
      } else {
        // 没有未保存的更改，直接更新内容，但保持当前编辑模式
        this.editorManager.setContent(data.content, data.filePath, false, false);
      }
    }
  }

  // 重置应用状态
  resetToInitialState() {
    // 重置Tab系统
    this.tabManager.resetTabs();
    
    // 隐藏markdown内容
    const markdownContent = document.querySelector('.markdown-content');
    if (markdownContent) {
      markdownContent.style.display = 'none';
    }
    
    // 调整窗口大小到初始状态并重启动画
    const { ipcRenderer } = require('electron');
    ipcRenderer.send('resize-window-to-initial-state');
    
    // 重置各个管理器
    this.editorManager.resetToInitialState();
    this.uiManager.resetToInitialState();
  }

  // PDF 导出
  async exportToPDF() {
    try {
      // 检查是否有内容可以导出
      const markdownContent = document.getElementById('markdownContent');
      
      if (!markdownContent || !markdownContent.innerHTML.trim()) {
        this.uiManager.showMessage('没有内容可以导出，请先打开一个Markdown文件', 'error');
        return;
      }

      // 直接导出HTML到浏览器
      const { ipcRenderer } = require('electron');
      const result = await ipcRenderer.invoke('export-pdf-simple', {});

      if (result.success) {
        this.uiManager.showMessage(result.message || 'HTML文件已在浏览器中打开', 'success');
      } else {
        this.uiManager.showMessage(`导出 HTML 失败: ${result.error || '未知错误'}`, 'error');
      }
    } catch (error) {
      console.error('Error exporting HTML:', error);
      this.uiManager.showMessage(`导出 HTML 失败: ${error.message}`, 'error');
    }
  }

  // 插件相关处理
  async togglePlugin(pluginId, enabled) {
    if (!window.pluginManager) {
      console.warn('插件管理器未初始化');
      return;
    }

    const plugin = window.pluginManager.getPlugin(pluginId);
    if (!plugin) {
      console.warn(`插件 ${pluginId} 不存在`);
      return;
    }

    try {
      // 保存插件设置
      const { ipcRenderer } = require('electron');
      await ipcRenderer.invoke('save-plugin-settings', pluginId, enabled);

      // 切换插件状态
      if (enabled) {
        plugin.enable();
      } else {
        plugin.disable();
      }

      // 重新渲染当前内容
      const currentContent = this.editorManager.getCurrentContent();
      if (currentContent) {
        this.editorManager.updatePreview(currentContent);
      }

      console.log(`插件 ${plugin.name} 已${enabled ? '启用' : '禁用'}`);
    } catch (error) {
      console.error(`切换插件 ${pluginId} 失败:`, error);
    }
  }

  async refreshPlugins() {
    if (!window.pluginManager) {
      console.warn('插件管理器未初始化');
      return;
    }

    try {
      console.log('[IPCManager] 开始刷新插件列表...');
      
      // 刷新插件管理器
      await window.pluginManager.refreshPlugins();
      
      // 通知AppManager重新加载插件状态
      this.eventManager.emit('plugins-refreshed');
      
      console.log('[IPCManager] 插件列表刷新完成');
    } catch (error) {
      console.error('刷新插件失败:', error);
    }
  }

  // 文件监听状态管理
  updateFileWatchStatus(filePath, isWatching) {
    console.log(`文件监听状态更新: ${filePath} -> ${isWatching ? '监听中' : '已停止'}`);
    this.eventManager.emit('file-watch-status-changed', { filePath, isWatching });
  }

  handleWatcherError(errorData) {
    const { type, error, userMessage } = errorData;
    
    // 显示用户友好的错误信息
    this.uiManager.showMessage(userMessage, 'warning');
    
    // 根据错误类型进行相应处理
    if (type === 'file') {
      // 文件监听错误：更新文件监听状态
      this.updateFileWatchStatus(error.path, false);
      
      // 如果是当前正在编辑的文件，提示用户
      const currentFilePath = this.tabManager.getActiveTab()?.filePath;
      if (error.path === currentFilePath) {
        this.uiManager.showMessage('当前文件的自动更新监听已停止', 'info');
      }
    } else if (type === 'folder') {
      // 文件夹监听错误：可能需要刷新文件树或提示用户重新选择文件夹
      if (error.code === 'ENOENT') {
        this.uiManager.showMessage('监听的文件夹已被删除，文件树将不再自动更新', 'warning');
      }
    }
    
    // 记录错误到本地日志
    console.error('监听器错误详情:', error);
  }

  // 向主进程发送消息的便捷方法
  sendToMain(channel, data = null) {
    const { ipcRenderer } = require('electron');
    if (data) {
      ipcRenderer.send(channel, data);
    } else {
      ipcRenderer.send(channel);
    }
  }

  // 向主进程发送异步请求的便捷方法
  async invokeMain(channel, data = null) {
    const { ipcRenderer } = require('electron');
    return await ipcRenderer.invoke(channel, data);
  }

  // 窗口激活刷新处理方法
  async handleWindowActivatedRefresh() {
    console.log('处理窗口激活刷新请求...');
    
    try {
      // 调用主进程的按需刷新方法
      const result = await this.invokeMain('refresh-content-on-demand');
      
      if (result.success) {
        if (result.hasChanges) {
          console.log('窗口激活检测到内容变化:', result.message);
        } else {
          console.log('窗口激活检查完成，无内容变化');
        }
      } else {
        console.warn('窗口激活刷新失败:', result.error);
      }
    } catch (error) {
      console.error('窗口激活刷新出错:', error);
    }
  }

  // 移除所有IPC监听器（用于清理）
  removeAllListeners() {
    const { ipcRenderer } = require('electron');
    const channels = [
      'file-opened', 'folder-opened', 'file-tree-updated', 'file-content-updated',
      'file-watch-started', 'file-watch-stopped', 'watcher-error',
      'toggle-sidebar', 'toggle-edit-mode', 'switch-theme', 'show-search',
      'show-search-box', 'show-settings', 'reset-to-initial-state',
      'create-new-file', 'export-pdf-request', 'restore-app-state',
      'toggle-plugin', 'refresh-plugins',
      'system-suspend', 'system-resume',
      'window-activated-refresh'
    ];
    
    channels.forEach(channel => {
      ipcRenderer.removeAllListeners(channel);
    });
  }
}

module.exports = IPCManager;