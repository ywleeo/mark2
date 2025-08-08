const EventManager = require('./EventManager');
const MarkdownRenderer = require('./MarkdownRenderer');
const FileTreeManager = require('./FileTreeManager');
const EditorManager = require('./EditorManager');
const SearchManager = require('./SearchManager');
const UIManager = require('./UIManager');

class AppManager {
  constructor() {
    this.eventManager = new EventManager();
    this.markdownRenderer = new MarkdownRenderer();
    this.fileTreeManager = new FileTreeManager(this.eventManager);
    this.editorManager = new EditorManager(this.markdownRenderer, this.eventManager, this);
    this.searchManager = new SearchManager();
    this.uiManager = new UIManager(this.eventManager);
    
    // 将editorManager和searchManager挂载到全局window对象
    window.editorManager = this.editorManager;
    window.searchManager = this.searchManager;
    
    // Tab 系统管理
    this.tabs = [];
    this.activeTabId = null;
    this.nextTabId = 1;
    
    // 全局文件路径管理
    this.currentFilePath = null;
    this.currentFolderPath = null;
    
    // 应用模式管理：'single-file' | 'folder'
    this.appMode = null;
    
    // 初始化关键词高亮状态
    this.initializeKeywordHighlight();
    
    // 确保侧边栏始终启用（因为现在无论如何都会有标签页内容）
    this.uiManager.enableSidebar();
    
    // 初始化显示 sidebar 的 Files 和 Folders 节点
    this.fileTreeManager.refreshSidebarTree();
    
    this.setupEventListeners();
    this.setupIPCListeners();
    this.setupDragAndDrop();
    
    // 延迟设置键盘快捷键，确保DOM完全准备好
    setTimeout(() => {
      this.setupKeyboardShortcuts();
      // 确保标题栏拖拽区域生效
      this.ensureTitleBarDragArea();
      // 恢复应用状态
      this.restoreAppState();
    }, 100);
  }

  setupEventListeners() {
    // 文件选择事件（单击）
    this.eventManager.on('file-selected', async (filePath, forceNewTab = false, fileType = 'subfolder-file') => {
      await this.openFileFromPath(filePath, true, forceNewTab, fileType); // 标记为从文件夹模式打开，传递文件类型
    });

    // 文件双击事件（添加到Files区域）
    this.eventManager.on('file-double-clicked', async (filePath) => {
      // 获取文件内容
      const result = await require('electron').ipcRenderer.invoke('open-file-dialog', filePath);
      if (result) {
        // 将文件添加到Files区域
        this.fileTreeManager.addFile(result.filePath, result.content);
        
        // 检查是否已经有这个文件的tab
        const existingTab = this.findTabByPath(result.filePath);
        if (existingTab) {
          // 如果已存在tab，将其归属改为file
          existingTab.belongsTo = 'file';
          existingTab.content = result.content;
          this.setActiveTab(existingTab.id);
        } else {
          // 如果没有tab，创建一个归属于file的tab
          this.createTab(result.filePath, result.content, null, 'file');
        }
        
        // 更新编辑器内容
        this.editorManager.setContent(result.content, result.filePath);
        
        // 更新显示
        this.uiManager.updateFileNameDisplay(result.filePath);
        this.fileTreeManager.updateActiveFile(result.filePath);
        
        // 窗口标题现在是静态的，不需要更新
        
        // 显示markdown内容
        const markdownContent = document.querySelector('.markdown-content');
        
        if (markdownContent) {
          markdownContent.style.display = 'block';
        }
        
        // 停止动画并调整窗口大小到内容加载状态
        const { ipcRenderer } = require('electron');
        ipcRenderer.send('resize-window-to-content-loaded');
      }
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
          // 检查文件是否已打开，如果已打开则激活现有tab
          const existingTab = this.tabs.find(tab => tab.filePath === result.filePath);
          if (existingTab) {
            this.setActiveTab(existingTab.id);
          } else {
            // 文件未打开，创建新tab，标记为来自file节点
            this.displayMarkdown(result.content, result.filePath, false, true, false, 'file');
          }
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
        this.displayMarkdown(result.content, result.filePath, false, false, false, 'file');
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

  async openFileFromPath(filePath, fromFolderMode = false, forceNewTab = false, fileType = 'subfolder-file') {
    try {
      const { ipcRenderer } = require('electron');
      const result = await ipcRenderer.invoke('open-file-dialog', filePath);
      
      if (result) {
        this.currentFilePath = result.filePath;
        this.displayMarkdown(result.content, result.filePath, fromFolderMode, forceNewTab, false, fileType);
      }
    } catch (error) {
      this.uiManager.showMessage('打开文件失败: ' + error.message, 'error');
    }
  }

  displayMarkdown(content, filePath, fromFolderMode = false, forceNewTab = false, fromDoubleClick = false, fileType = 'subfolder-file') {
    // 使用Tab系统打开文件
    this.openFileInTab(filePath, content, forceNewTab, fromDoubleClick, fileType);
    
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
    
    // 清除搜索状态
    // 移除自定义搜索功能
    // if (this.searchManager.isVisible()) {
    //   this.searchManager.hideSearch();
    // }
  }

  displayFileTree(folderPath, fileTree) {
    // 保存当前文件夹路径
    this.currentFolderPath = folderPath;
    
    // 停止动画并调整窗口大小到内容加载状态
    const { ipcRenderer } = require('electron');
    ipcRenderer.send('resize-window-to-content-loaded');
    
    this.fileTreeManager.displayFileTree(folderPath, fileTree);
    
    // 保存状态
    this.saveAppState();
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
    
    // 重置Tab系统
    this.tabs = [];
    this.activeTabId = null;
    this.updateTabBar();
    
    // 隐藏markdown内容
    const markdownContent = document.querySelector('.markdown-content');
    
    if (markdownContent) {
      markdownContent.style.display = 'none';
    }
    
    // 调整窗口大小到初始状态并重启动画
    const { ipcRenderer } = require('electron');
    ipcRenderer.send('resize-window-to-initial-state');
    
    // 窗口标题现在是静态的，不需要重置
    
    // 先停止当前动画，然后重新启动动画
    setTimeout(() => {
    }, 200);
    
    // 重置各个管理器
    this.editorManager.resetToInitialState();
    this.uiManager.resetToInitialState();
    this.fileTreeManager.clearFileTree(); // 清空文件树
    // this.searchManager.hideSearch(); // 移除自定义搜索功能
    
    // 重新绘制热区到整个窗口宽度
    this.ensureTitleBarDragArea();
    
    // 清除保存的状态
    localStorage.removeItem('mark2-app-state');
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
      
      // Cmd+W 关闭当前标签页，如果没有标签页则关闭窗口
      if (event.metaKey && event.key === 'w') {
        event.preventDefault();
        
        // 如果有活动的标签页，关闭当前标签页
        if (this.activeTabId && this.tabs.length > 0) {
          this.closeTab(this.activeTabId);
        } else {
          // 如果没有标签页，关闭整个窗口
          const { ipcRenderer } = require('electron');
          ipcRenderer.send('close-window');
        }
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
  }

  switchToFolderMode() {
    this.appMode = 'folder';
  }

  getCurrentMode() {
    return this.appMode;
  }

  getMarkdownRenderer() {
    return this.markdownRenderer;
  }


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

  // Tab 管理方法
  createTab(filePath, content, title = null, belongsTo = 'folder') {
    const path = require('path');
    const fileName = title || path.basename(filePath);
    
    const tab = {
      id: this.nextTabId++,
      title: fileName,
      filePath: filePath,
      content: content,
      isActive: false,
      isModified: false,
      belongsTo: belongsTo // 'file' 或 'folder'
    };
    
    
    this.tabs.push(tab);
    this.setActiveTab(tab.id);
    this.updateTabBar();
    
    // 新tab自动滚动到可见位置
    setTimeout(() => {
      this.scrollTabIntoView(tab.id);
    }, 0);
    
    // 保存状态
    this.saveAppState();
    
    return tab;
  }

  setActiveTab(tabId) {
    // 关闭搜索框（如果打开的话）
    this.searchManager.hide();
    
    // 取消所有tab的活动状态
    this.tabs.forEach(tab => tab.isActive = false);
    
    // 设置指定tab为活动状态
    const activeTab = this.tabs.find(tab => tab.id === tabId);
    if (activeTab) {
      activeTab.isActive = true;
      this.activeTabId = tabId;
      this.currentFilePath = activeTab.filePath;
      
      // 更新编辑器内容
      this.editorManager.setContent(activeTab.content, activeTab.filePath);
      
      // 更新文件名显示
      this.uiManager.updateFileNameDisplay(activeTab.filePath);
      
      // 更新文件树中的活动文件
      this.fileTreeManager.updateActiveFile(activeTab.filePath);
      
      // 窗口标题现在是静态的，不需要更新
      
      // 只更新tab的活动状态，不重建整个DOM
      this.updateTabActiveState();
      
      // 确保活动tab在可见区域
      setTimeout(() => {
        this.scrollTabIntoView(tabId);
      }, 0);
      
      // 保存状态
      this.saveAppState();
    }
  }

  updateTabActiveState() {
    const tabBar = document.getElementById('tabBar');
    if (!tabBar) return;
    
    // 更新所有tab的活动状态CSS类
    const tabElements = tabBar.querySelectorAll('.tab-item');
    tabElements.forEach(tabElement => {
      const tabId = parseInt(tabElement.dataset.tabId);
      const isActive = this.tabs.find(tab => tab.id === tabId)?.isActive || false;
      tabElement.classList.toggle('active', isActive);
    });
  }

  updateTabTitle(tabId, newTitle) {
    const tabBar = document.getElementById('tabBar');
    if (!tabBar) return;
    
    const tabElement = tabBar.querySelector(`[data-tab-id="${tabId}"]`);
    if (tabElement) {
      const titleElement = tabElement.querySelector('.tab-title');
      if (titleElement) {
        titleElement.textContent = newTitle;
      }
    }
  }

  closeTab(tabId, fromFileNode = false) {
    const tabIndex = this.tabs.findIndex(tab => tab.id === tabId);
    if (tabIndex === -1) {
      return;
    }
    
    const tab = this.tabs[tabIndex];
    
    // 如果tab有文件路径，使用统一关闭函数（同步删除文件树节点和关闭tab）
    if (tab.filePath) {
      this.closeFileCompletely(tab.filePath);
      return;
    }
    
    // 对于没有文件路径的tab，直接关闭
    this.closeTabDirectly(tabId);
  }


  updateTabBar() {
    const tabBar = document.getElementById('tabBar');
    const tabList = document.getElementById('tabList');
    if (!tabBar) return;
    
    if (this.tabs.length === 0) {
      tabBar.style.display = 'none';
      return;
    }
    
    tabBar.style.display = 'flex';
    
    // 清空tab-list容器（如果存在）
    if (tabList) {
      tabList.innerHTML = '';
    } else {
      // 如果没有tab-list容器，清空整个tabBar（可能是在标题栏初始化之前）
      tabBar.innerHTML = '';
    }
    
    this.tabs.forEach(tab => {
      const tabElement = document.createElement('div');
      tabElement.className = `tab-item ${tab.isActive ? 'active' : ''}`;
      tabElement.dataset.tabId = tab.id;
      
      const tabTitle = document.createElement('span');
      tabTitle.className = 'tab-title';
      tabTitle.textContent = tab.title;
      if (tab.isModified) {
        tabTitle.textContent += ' •';
      }
      
      const closeButton = document.createElement('button');
      closeButton.className = 'tab-close';
      closeButton.innerHTML = '×';
      closeButton.onclick = (e) => {
        e.stopPropagation();
        this.closeTab(tab.id);
      };
      
      tabElement.appendChild(tabTitle);
      tabElement.appendChild(closeButton);
      
      tabElement.onclick = () => {
        this.setActiveTab(tab.id);
      };
      
      // 添加到tab-list容器（如果存在）或直接添加到tabBar
      const container = tabList || tabBar;
      container.appendChild(tabElement);
    });
    
    // 更新滚动提示状态
    setTimeout(() => {
      this.updateTabBarScrollHints(tabBar);
      // 重新创建拖拽覆盖层确保title区域可拖拽
      this.ensureTitleBarDragArea();
    }, 0);
  }


  updateTabBarScrollHints(tabBar) {
    // 使用tabList作为滚动容器（如果存在）
    const tabList = document.getElementById('tabList');
    const scrollContainer = tabList || tabBar;
    
    const canScrollLeft = scrollContainer.scrollLeft > 0;
    const canScrollRight = scrollContainer.scrollLeft < (scrollContainer.scrollWidth - scrollContainer.clientWidth);
    const hasOverflow = scrollContainer.scrollWidth > scrollContainer.clientWidth;
    
    // 获取main-content容器来管理阴影
    const mainContent = document.querySelector('.main-content');
    if (mainContent && hasOverflow) {
      mainContent.classList.toggle('tab-scroll-left', canScrollLeft);
      mainContent.classList.toggle('tab-scroll-right', canScrollRight);
    } else if (mainContent) {
      mainContent.classList.remove('tab-scroll-left', 'tab-scroll-right');
    }
  }

  scrollTabIntoView(tabId) {
    const tabBar = document.getElementById('tabBar');
    const tabList = document.getElementById('tabList');
    if (!tabBar) return;
    
    // 查找tab元素（可能在tab-list中或直接在tabBar中）
    const container = tabList || tabBar;
    const tabElement = container.querySelector(`[data-tab-id="${tabId}"]`);
    if (!tabElement) return;
    
    const tabBarRect = tabBar.getBoundingClientRect();
    const tabRect = tabElement.getBoundingClientRect();
    
    // 使用scrolling容器进行滚动（tab-list或tabBar）
    const scrollContainer = tabList || tabBar;
    
    // 计算tab相对于scroll容器的位置
    const tabLeft = tabElement.offsetLeft;
    const tabRight = tabLeft + tabElement.offsetWidth;
    const scrollLeft = scrollContainer.scrollLeft;
    const scrollRight = scrollLeft + scrollContainer.clientWidth;
    
    // 如果tab在可见区域之外，滚动到合适位置
    if (tabLeft < scrollLeft) {
      // tab在左侧不可见，滚动到左边
      scrollContainer.scrollTo({
        left: tabLeft - 20, // 留一点边距
        behavior: 'smooth'
      });
    } else if (tabRight > scrollRight) {
      // tab在右侧不可见，滚动到右边
      scrollContainer.scrollTo({
        left: tabRight - scrollContainer.clientWidth + 20, // 留一点边距
        behavior: 'smooth'
      });
    }
  }

  findTabByPath(filePath) {
    return this.tabs.find(tab => tab.filePath === filePath);
  }

  openFileInTab(filePath, content, forceNewTab = false, fromDoubleClick = false, fileType = 'subfolder-file') {
    // 步骤1: 先判断打开的tab有没有和此文件相同path和名字，相同就focus到已经打开的tab
    const existingTab = this.findTabByPath(filePath);
    if (existingTab && !forceNewTab) {
      existingTab.content = content;
      this.setActiveTab(existingTab.id);
      return existingTab;
    }
    
    // 如果强制新建tab，直接创建
    if (forceNewTab) {
      const belongsTo = fileType === 'file' ? 'file' : 'folder';
      return this.createTab(filePath, content, null, belongsTo);
    }
    
    // 步骤2: 判断其来自file还是folder
    if (fileType === 'file') {
      // 步骤3: 如果是file就打开新的tab显示file
      return this.createTab(filePath, content, null, 'file');
    } else {
      // 步骤4: 如果是folder就看tab上哪个tab是folder，替换folder的那个tab显示当前内容
      const folderTab = this.tabs.find(tab => tab.belongsTo === 'folder');
      if (folderTab) {
        // 替换folder的tab显示当前内容
        folderTab.filePath = filePath;
        folderTab.content = content;
        folderTab.title = require('path').basename(filePath);
        folderTab.isModified = false;
        this.currentFilePath = filePath;
        
        // 如果是双击操作，将tab归属改为file
        if (fromDoubleClick) {
          folderTab.belongsTo = 'file';
        }
        
        this.setActiveTab(folderTab.id);
        
        // 更新编辑器内容
        this.editorManager.setContent(content, filePath);
        
        // 更新显示
        this.uiManager.updateFileNameDisplay(filePath);
        this.fileTreeManager.updateActiveFile(filePath);
        
        // 只更新tab标题，不重建整个DOM
        this.updateTabTitle(folderTab.id, folderTab.title);
        return folderTab;
      } else {
        // 步骤5: 如果没有folder的tab就打开一个新的tab
        return this.createTab(filePath, content, null, fromDoubleClick ? 'file' : 'folder');
      }
    }
  }

  // 统一关闭文件：同时删除file节点和关闭对应tab
  closeFileCompletely(filePath) {
    
    // 1. 删除file节点（不发出事件避免递归）
    this.fileTreeManager.removeFile(filePath, false);
    
    // 2. 关闭对应的tab（关闭所有匹配文件路径的tab，不管belongsTo属性）
    // 使用while循环避免在遍历过程中修改数组导致的问题
    let tabToClose;
    while ((tabToClose = this.tabs.find(tab => tab.filePath === filePath))) {
      this.closeTabDirectly(tabToClose.id);
    }
  }

  // 直接关闭tab，不触发其他逻辑
  closeTabDirectly(tabId) {
    const tabIndex = this.tabs.findIndex(tab => tab.id === tabId);
    if (tabIndex === -1) return;
    
    const tab = this.tabs[tabIndex];
    
    // 关闭搜索框（如果打开的话）
    this.searchManager.hide();
    
    // 如果关闭的是活动tab，需要切换到其他tab
    if (tab.isActive) {
      if (this.tabs.length > 1) {
        const nextIndex = tabIndex < this.tabs.length - 1 ? tabIndex + 1 : tabIndex - 1;
        this.setActiveTab(this.tabs[nextIndex].id);
      } else {
        // 关闭最后一个tab时，只重置必要状态，保持sidebar显示
        this.activeTabId = null;
        this.currentFilePath = null;
        
        // 隐藏markdown内容
        const markdownContent = document.querySelector('.markdown-content');
        if (markdownContent) {
          markdownContent.style.display = 'none';
        }
        
        // 重置编辑器状态，但不清空文件树
        this.editorManager.resetToInitialState();
      }
    }
    
    // 移除tab
    this.tabs.splice(tabIndex, 1);
    this.updateTabBar();
    
    // 保存状态
    this.saveAppState();
  }

  // 确保拖拽区域不被tab覆盖
  ensureTitleBarDragArea() {
    // 移除之前创建的覆盖层（如果存在）
    const existingOverlay = document.getElementById('titlebar-drag-overlay');
    if (existingOverlay) {
      existingOverlay.remove();
    }
    
    // 判断右边是否有markdown内容显示
    const markdownContent = document.querySelector('.markdown-content');
    const hasMarkdownContent = markdownContent && 
                               markdownContent.style.display !== 'none' && 
                               markdownContent.innerHTML.trim();
    
    // 根据状态决定拖拽区域宽度
    let dragWidth;
    if (hasMarkdownContent) {
      // 有markdown内容时，只覆盖sidebar区域
      const sidebar = document.getElementById('sidebar');
      dragWidth = sidebar ? sidebar.offsetWidth : 260;
    } else {
      // 没有markdown内容时，热区贯穿整个窗口宽度
      dragWidth = window.innerWidth;
    }
    
    // 创建透明的拖拽覆盖层
    const dragOverlay = document.createElement('div');
    dragOverlay.id = 'titlebar-drag-overlay';
    dragOverlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: ${dragWidth}px;
      height: var(--titlebar-height);
      z-index: 1002;
      -webkit-app-region: drag;
      pointer-events: auto;
      background: transparent;
    `;
    
    // 添加到页面最前层
    document.body.appendChild(dragOverlay);
  }

  // 状态保持功能
  saveAppState() {
    const state = {
      tabs: this.tabs.map(tab => ({
        id: tab.id,
        title: tab.title,
        filePath: tab.filePath,
        content: tab.content,
        isActive: tab.isActive,
        isModified: tab.isModified,
        belongsTo: tab.belongsTo
      })),
      activeTabId: this.activeTabId,
      nextTabId: this.nextTabId,
      currentFilePath: this.currentFilePath,
      currentFolderPath: this.currentFolderPath,
      appMode: this.appMode,
      // 保存文件树状态
      openFiles: Array.from(this.fileTreeManager.openFiles.entries()),
      openFolders: Array.from(this.fileTreeManager.openFolders.entries())
    };
    
    localStorage.setItem('mark2-app-state', JSON.stringify(state));
  }

  restoreAppState() {
    const saved = localStorage.getItem('mark2-app-state');
    if (!saved) return false;
    
    try {
      const state = JSON.parse(saved);
      
      // 恢复基本状态
      this.currentFilePath = state.currentFilePath || null;
      this.currentFolderPath = state.currentFolderPath || null;
      this.appMode = state.appMode || null;
      this.nextTabId = state.nextTabId || 1;
      
      // 恢复文件树状态
      if (state.openFiles) {
        state.openFiles.forEach(([filePath, fileInfo]) => {
          this.fileTreeManager.openFiles.set(filePath, fileInfo);
        });
      }
      
      if (state.openFolders) {
        state.openFolders.forEach(([folderPath, folderInfo]) => {
          this.fileTreeManager.openFolders.set(folderPath, folderInfo);
        });
      }
      
      // 恢复tabs
      if (state.tabs && state.tabs.length > 0) {
        this.tabs = state.tabs;
        this.activeTabId = state.activeTabId;
        
        // 更新tab显示
        this.updateTabBar();
        
        // 激活之前的活动tab
        if (this.activeTabId) {
          const activeTab = this.tabs.find(tab => tab.id === this.activeTabId);
          if (activeTab) {
            // 恢复编辑器内容
            this.editorManager.setContent(activeTab.content, activeTab.filePath);
            this.uiManager.updateFileNameDisplay(activeTab.filePath);
            this.fileTreeManager.updateActiveFile(activeTab.filePath);
            
            // 显示markdown内容
            const markdownContent = document.querySelector('.markdown-content');
            if (markdownContent) {
              markdownContent.style.display = 'block';
            }
          }
        }
      }
      
      // 刷新文件树显示
      this.fileTreeManager.refreshSidebarTree();
      
      return true;
    } catch (error) {
      console.error('恢复应用状态失败:', error);
      localStorage.removeItem('mark2-app-state');
      return false;
    }
  }
}

module.exports = AppManager;