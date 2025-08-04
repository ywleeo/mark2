const EventManager = require('./EventManager');
const MarkdownRenderer = require('./MarkdownRenderer');
const FileTreeManager = require('./FileTreeManager');
const EditorManager = require('./EditorManager');
const SearchManager = require('./SearchManager');
const UIManager = require('./UIManager');
const HeartbeatAnimator = require('./HeartbeatAnimator');

class AppManager {
  constructor() {
    this.eventManager = new EventManager();
    this.markdownRenderer = new MarkdownRenderer();
    this.fileTreeManager = new FileTreeManager(this.eventManager);
    this.editorManager = new EditorManager(this.markdownRenderer, this.eventManager, this);
    this.searchManager = new SearchManager();
    this.uiManager = new UIManager(this.eventManager);
    this.heartbeatAnimator = new HeartbeatAnimator();
    
    // 将editorManager和searchManager挂载到全局window对象
    window.editorManager = this.editorManager;
    window.searchManager = this.searchManager;
    
    // 全局文件路径管理
    this.currentFilePath = null;
    this.currentFolderPath = null;
    
    // 应用模式管理：'single-file' | 'folder'
    this.appMode = null;
    
    // 初始化关键词高亮状态
    this.initializeKeywordHighlight();
    
    this.setupEventListeners();
    this.setupIPCListeners();
    this.setupDragAndDrop();
    
    // 延迟设置键盘快捷键，确保DOM完全准备好
    setTimeout(() => {
      this.setupKeyboardShortcuts();
      this.startHeartbeatAnimation();
    }, 100);
  }

  setupEventListeners() {
    // 文件选择事件
    this.eventManager.on('file-selected', async (filePath) => {
      await this.openFileFromPath(filePath, true); // 标记为从文件夹模式打开
    });

    // 编辑模式切换事件
    this.eventManager.on('toggle-edit-mode', () => {
      this.editorManager.toggleEditMode();
    });

    // 保存文件事件
    this.eventManager.on('save-file', () => {
      this.editorManager.saveFile();
    });

    // 打开文件事件
    this.eventManager.on('open-file', () => {
      this.openFile();
    });

    // 打开文件夹事件
    this.eventManager.on('open-folder', () => {
      this.openFolder();
    });

    // 主题变化事件
    this.eventManager.on('theme-changed', (theme) => {
      this.markdownRenderer.setKeywordHighlight(
        localStorage.getItem('keywordHighlightEnabled') !== 'false'
      );
    });

    // 侧边栏切换事件
    this.eventManager.on('sidebar-toggled', (visible) => {
      // 可以在这里添加侧边栏切换的额外逻辑
    });

    // 文件树加载完成事件
    this.eventManager.on('file-tree-loaded', () => {
      this.uiManager.enableSidebar();
    });
  }

  setupIPCListeners() {
    const { ipcRenderer } = require('electron');
    
    // 监听主进程发送的文件打开事件
    ipcRenderer.on('file-opened', (event, data) => {
      this.displayMarkdown(data.content, data.filePath);
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
      // 只有当更新的文件是当前正在显示的文件时才刷新
      if (data.filePath === this.currentFilePath) {
        // 更新编辑器内容（如果处于编辑模式，需要检查是否有未保存的更改）
        if (this.editorManager.hasUnsavedContent()) {
          // 如果有未保存的更改，显示警告提示用户
          this.uiManager.showMessage('文件已被外部修改，但您有未保存的更改', 'warning');
        } else {
          // 没有未保存的更改，直接更新内容，但保持当前编辑模式
          this.editorManager.setContent(data.content, data.filePath, false, false); // 不重置保存状态，不重置编辑模式
          this.uiManager.showMessage('文件内容已自动更新', 'info');
        }
      }
    });

    // 监听菜单事件
    ipcRenderer.on('toggle-sidebar', () => {
      this.uiManager.toggleSidebar();
    });

    ipcRenderer.on('toggle-edit-mode', () => {
      this.editorManager.toggleEditMode();
    });

    ipcRenderer.on('switch-theme', (event, theme) => {
      this.uiManager.switchTheme(theme);
    });


    ipcRenderer.on('toggle-keyword-highlight', (event, enabled) => {
      this.toggleKeywordHighlight(enabled);
    });

    ipcRenderer.on('show-search', () => {
      this.searchManager.showSearch();
    });

    ipcRenderer.on('show-search-box', () => {
      this.searchManager.show();
    });

    ipcRenderer.on('show-settings', () => {
      this.uiManager.showSettings();
    });

    ipcRenderer.on('reset-to-initial-state', () => {
      this.resetToInitialState();
    });

    // 监听 PDF 导出请求
    ipcRenderer.on('export-pdf-request', () => {
      this.exportToPDF();
    });

  }

  setupDragAndDrop() {

    document.addEventListener('dragover', (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    });

    document.addEventListener('drop', async (event) => {
      event.preventDefault();
      
      const files = Array.from(event.dataTransfer.files);
      
      if (files.length === 0) {
        this.uiManager.showMessage('未检测到拖拽的文件', 'error');
        return;
      }
      
      try {
        // 直接使用 webUtils.getPathForFile 获取真实文件路径
        const { webUtils, ipcRenderer } = require('electron');
        const file = files[0];
        const realPath = webUtils.getPathForFile(file);
        
        
        // 使用真实路径调用处理逻辑
        const result = await ipcRenderer.invoke('handle-drop-file', realPath);
        
        if (result.type === 'folder') {
          this.currentFolderPath = result.folderPath;
          this.displayFileTree(result.folderPath, result.fileTree);
        } else if (result.type === 'file') {
          this.currentFilePath = result.filePath;
          this.displayMarkdown(result.content, result.filePath);
        }
      } catch (error) {
        console.error('拖拽处理错误:', error);
        this.uiManager.showMessage('处理拖拽文件时发生错误: ' + error.message, 'error');
      }
    });
  }

  async openFile() {
    try {
      const { ipcRenderer } = require('electron');
      const result = await ipcRenderer.invoke('open-file-dialog');
      
      if (result) {
        this.currentFilePath = result.filePath;
        this.displayMarkdown(result.content, result.filePath);
      }
    } catch (error) {
      console.error('AppManager: Error in openFile:', error);
      this.uiManager.showMessage('打开文件失败: ' + error.message, 'error');
    }
  }

  async openFolder() {
    try {
      const { ipcRenderer } = require('electron');
      const result = await ipcRenderer.invoke('open-folder-dialog');
      
      if (result) {
        this.currentFolderPath = result.folderPath;
        this.displayFileTree(result.folderPath, result.fileTree);
      }
    } catch (error) {
      this.uiManager.showMessage('打开文件夹失败: ' + error.message, 'error');
    }
  }

  async openFileFromPath(filePath, fromFolderMode = false) {
    try {
      const { ipcRenderer } = require('electron');
      const result = await ipcRenderer.invoke('open-file-dialog', filePath);
      
      if (result) {
        this.currentFilePath = result.filePath;
        this.displayMarkdown(result.content, result.filePath, fromFolderMode);
      }
    } catch (error) {
      this.uiManager.showMessage('打开文件失败: ' + error.message, 'error');
    }
  }

  displayMarkdown(content, filePath, fromFolderMode = false) {
    // 保存当前文件路径
    this.currentFilePath = filePath;
    
    // 如果不是从文件夹模式打开的文件，将文件添加到侧边栏
    if (!fromFolderMode) {
      this.fileTreeManager.addFile(filePath, content);
      this.switchToSingleFileMode();
    }
    
    // 隐藏欢迎信息，显示markdown内容
    const welcomeMessage = document.querySelector('.welcome-message');
    const markdownContent = document.querySelector('.markdown-content');
    
    if (welcomeMessage) {
      welcomeMessage.style.display = 'none';
    }
    if (markdownContent) {
      markdownContent.style.display = 'block';
    }
    
    // 停止动画并调整窗口大小到内容加载状态
    this.stopHeartbeatAnimation();
    const { ipcRenderer } = require('electron');
    ipcRenderer.send('resize-window-to-content-loaded');
    
    // 更新窗口标题
    ipcRenderer.send('update-window-title', filePath);
    
    // 更新编辑器内容
    this.editorManager.setContent(content, filePath);
    
    // 更新文件名显示
    this.uiManager.updateFileNameDisplay(filePath);
    
    // 更新文件树中的活动文件
    this.fileTreeManager.updateActiveFile(filePath);
    
    // 清除搜索状态
    // 移除自定义搜索功能
    // if (this.searchManager.isVisible()) {
    //   this.searchManager.hideSearch();
    // }
  }

  displayFileTree(folderPath, fileTree) {
    // 保存当前文件夹路径并切换到文件夹模式
    this.currentFolderPath = folderPath;
    this.switchToFolderMode();
    
    // 停止动画并调整窗口大小到内容加载状态
    this.stopHeartbeatAnimation();
    const { ipcRenderer } = require('electron');
    ipcRenderer.send('resize-window-to-content-loaded');
    
    this.fileTreeManager.displayFileTree(folderPath, fileTree);
  }


  initializeKeywordHighlight() {
    // 从 localStorage 加载关键词高亮状态
    const saved = localStorage.getItem('keywordHighlightEnabled');
    const enabled = saved !== null ? saved === 'true' : true; // 默认启用
    
    this.markdownRenderer.setKeywordHighlight(enabled);
    
    // 通知主进程更新菜单状态
    const { ipcRenderer } = require('electron');
    ipcRenderer.send('update-keyword-highlight-menu', enabled);
  }

  toggleKeywordHighlight(enabled) {
    this.markdownRenderer.setKeywordHighlight(enabled);
    localStorage.setItem('keywordHighlightEnabled', enabled.toString());
    
    // 通知主进程更新菜单状态
    const { ipcRenderer } = require('electron');
    ipcRenderer.send('update-keyword-highlight-menu', enabled);
    
    // 重新渲染当前内容
    const currentContent = this.editorManager.getCurrentContent();
    if (currentContent) {
      this.editorManager.updatePreview(currentContent);
    }
  }

  resetToInitialState() {
    // 重置应用模式和状态
    this.appMode = null;
    this.currentFilePath = null;
    this.currentFolderPath = null;
    
    // 显示欢迎信息，隐藏markdown内容
    const welcomeMessage = document.querySelector('.welcome-message');
    const markdownContent = document.querySelector('.markdown-content');
    
    if (welcomeMessage) {
      welcomeMessage.style.display = 'block';
    }
    if (markdownContent) {
      markdownContent.style.display = 'none';
    }
    
    // 调整窗口大小到初始状态并重启动画
    const { ipcRenderer } = require('electron');
    ipcRenderer.send('resize-window-to-initial-state');
    
    // 重置窗口标题
    ipcRenderer.send('update-window-title', null);
    
    // 先停止当前动画，然后重新启动动画
    this.stopHeartbeatAnimation();
    setTimeout(() => {
      this.startHeartbeatAnimation();
    }, 200);
    
    // 重置各个管理器
    this.editorManager.resetToInitialState();
    this.uiManager.resetToInitialState();
    this.uiManager.disableSidebar(); // 禁用侧边栏
    this.fileTreeManager.clearFileTree(); // 清空文件树
    // this.searchManager.hideSearch(); // 移除自定义搜索功能
  }

  // 获取各个管理器的引用，供外部使用
  getEventManager() {
    return this.eventManager;
  }

  getMarkdownRenderer() {
    return this.markdownRenderer;
  }

  getFileTreeManager() {
    return this.fileTreeManager;
  }

  getEditorManager() {
    return this.editorManager;
  }

  // getSearchManager() {
  //   return this.searchManager;
  // } // 移除自定义搜索功能

  getUIManager() {
    return this.uiManager;
  }

  // 获取当前文件路径的方法
  getCurrentFilePath() {
    return this.currentFilePath;
  }
  
  getCurrentFolderPath() {
    return this.currentFolderPath;
  }

  setupKeyboardShortcuts() {
    // 全局键盘快捷键监听
    document.addEventListener('keydown', (event) => {
      // Cmd+Shift+O 打开文件夹 (必须放在前面，更具体的条件)
      if (event.metaKey && event.shiftKey && event.key === 'O') {
        event.preventDefault();
        this.openFolder();
        return;
      }
      
      // Cmd+O 打开文件
      if (event.metaKey && event.key === 'o' && !event.shiftKey) {
        event.preventDefault();
        this.openFile();
      }
      
      // Cmd+S 保存文件
      if (event.metaKey && event.key === 's') {
        event.preventDefault();
        this.editorManager.saveFile();
      }
      
      // Cmd+W 关闭窗口（通过主进程处理）
      if (event.metaKey && event.key === 'w') {
        event.preventDefault();
        const { ipcRenderer } = require('electron');
        ipcRenderer.send('close-window');
      }
      
      // Cmd+E 切换编辑模式
      if (event.metaKey && event.key === 'e') {
        event.preventDefault();
        this.editorManager.toggleEditMode();
      }
      
      // Cmd+F 显示搜索
      if (event.metaKey && event.key === 'f') {
        event.preventDefault();
        this.searchManager.toggle();
      }
      
      // Cmd+B 切换侧边栏（只有在 sidebar 启用时才响应）
      if (event.metaKey && event.key === 'b') {
        event.preventDefault();
        if (this.uiManager.isSidebarEnabled()) {
          this.uiManager.toggleSidebar();
        }
      }
      
      // Cmd+Shift+L 切换到浅色主题
      if (event.metaKey && event.shiftKey && event.key === 'l') {
        event.preventDefault();
        this.uiManager.switchTheme('light');
      }
      
      // Cmd+Shift+D 切换到深色主题
      if (event.metaKey && event.shiftKey && event.key === 'd') {
        event.preventDefault();
        this.uiManager.switchTheme('dark');
      }
      
      // Cmd+, 显示设置
      if (event.metaKey && event.key === ',') {
        event.preventDefault();
        this.uiManager.showSettings();
      }
    });
  }

  // 模式管理方法
  switchToSingleFileMode() {
    this.appMode = 'single-file';
    
    // 启用侧边栏（现在单文件也显示在侧边栏中）
    this.uiManager.enableSidebar();
  }

  switchToFolderMode() {
    this.appMode = 'folder';
    
    // 启用侧边栏
    this.uiManager.enableSidebar();
  }

  getCurrentMode() {
    return this.appMode;
  }

  getMarkdownRenderer() {
    return this.markdownRenderer;
  }

  startHeartbeatAnimation() {
    const container = document.querySelector('.content-area');
    if (container) {
      this.heartbeatAnimator.stop();
      this.heartbeatAnimator.start(container);
    }
  }

  stopHeartbeatAnimation() {
    this.heartbeatAnimator.stop();
  }

  async exportToPDF() {
    try {
      // 检查是否有内容可以导出
      const markdownContent = document.getElementById('markdownContent');
      
      if (!markdownContent || !markdownContent.innerHTML.trim()) {
        this.uiManager.showMessage('没有内容可以导出，请先打开一个Markdown文件', 'error');
        return;
      }

      // 生成默认文件名
      let filename = 'document.pdf';
      if (this.currentFilePath) {
        const path = require('path');
        const baseName = path.basename(this.currentFilePath, path.extname(this.currentFilePath));
        filename = `${baseName}.pdf`;
      }

      // 直接使用当前页面的HTML，让主进程处理
      const { ipcRenderer } = require('electron');
      const result = await ipcRenderer.invoke('export-pdf-simple', {
        filename
      });

      if (result.success) {
        this.uiManager.showMessage(`PDF 已成功导出到: ${result.filePath}`, 'success');
      } else if (result.canceled) {
        // 用户取消了保存对话框，不显示错误消息
      } else {
        this.uiManager.showMessage(`导出 PDF 失败: ${result.error || '未知错误'}`, 'error');
      }
    } catch (error) {
      console.error('Error exporting PDF:', error);
      this.uiManager.showMessage(`导出 PDF 失败: ${error.message}`, 'error');
    }
  }
}

module.exports = AppManager;