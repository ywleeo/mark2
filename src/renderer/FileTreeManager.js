class FileTreeManager {
  constructor(eventManager) {
    this.eventManager = eventManager;
    this.openFiles = new Map(); // 存储已打开的文件 {路径: {name, path, content}}
    this.openFolders = new Map(); // 存储已打开的文件夹 {路径: {name, path, fileTree}}
    this.expandedFolders = new Set();
    this.activeFilePath = null;
    this.activeItemType = null; // 'file' 或 'folder'
    
    // 初始化根节点展开状态
    this.initializeRootExpansion();
    
    // 恢复保存的展开状态
    this.restoreExpandedState();
  }

  // HTML转义函数，防止中文字符在HTML中出现问题
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // 简化的配置（不再需要复杂的配置）
  getTreeConfig() {
    return {};
  }

  // 添加文件到文件树
  addFile(filePath, content, fileName = null) {
    if (filePath) {
      const path = require('path');
      const actualFileName = fileName || path.basename(filePath);
      
      this.openFiles.set(filePath, {
        name: actualFileName,
        path: filePath,
        content: content
      });
    } else {
      // 处理新文件的情况（filePath 为 null）
      const newFileName = fileName || 'Untitled.md';
      // 使用特殊的临时标识符作为键
      const tempKey = `__new_file_${Date.now()}`;
      
      this.openFiles.set(tempKey, {
        name: newFileName,
        path: null,
        content: content,
        isNewFile: true,
        tempKey: tempKey
      });
    }
    
    this.refreshSidebarTree();
  }

  // 更新新文件信息（保存后）
  updateNewFileInfo(filePath, content) {
    // 找到需要更新的新文件条目
    let tempKeyToDelete = null;
    for (const [key, fileInfo] of this.openFiles.entries()) {
      if (fileInfo.isNewFile) {
        tempKeyToDelete = key;
        break;
      }
    }
    
    // 删除临时条目
    if (tempKeyToDelete) {
      this.openFiles.delete(tempKeyToDelete);
    }
    
    // 添加真实的文件条目
    const path = require('path');
    const fileName = path.basename(filePath);
    
    this.openFiles.set(filePath, {
      name: fileName,
      path: filePath,
      content: content
    });
    
    this.refreshSidebarTree();
  }

  // 从文件树中删除文件
  removeFile(filePath, emitEvent = false) {
    if (this.openFiles.has(filePath)) {
      this.openFiles.delete(filePath);
      // 如果删除的是当前活动文件，清除活动状态
      if (this.activeFilePath === filePath && this.activeItemType === 'file') {
        this.activeFilePath = null;
        this.activeItemType = null;
      }
      this.refreshSidebarTree();
      
      // 只在明确要求时发出事件
      if (emitEvent) {
        this.eventManager.emit('file-closed', filePath);
      }
    }
  }

  // 添加文件夹到文件树
  addFolder(folderPath, fileTree) {
    const path = require('path');
    const folderName = path.basename(folderPath);
    
    this.openFolders.set(folderPath, {
      name: folderName,
      path: folderPath,
      fileTree: fileTree
    });
    
    this.refreshSidebarTree();
  }

  // 显示传统文件树（保持兼容性）
  displayFileTree(folderPath, fileTree) {
    this.addFolder(folderPath, fileTree);
    this.eventManager.emit('file-tree-loaded');
  }

  // 构建新的侧边栏树结构
  refreshSidebarTree() {
    const fileTreeContainer = document.getElementById('fileTree');
    if (!fileTreeContainer) return;
    
    // 确保根节点始终展开
    this.ensureRootNodesExpanded();
    
    fileTreeContainer.innerHTML = this.buildSidebarTreeHtml();
    this.attachFileTreeEvents();
    
    // 当文件树加载完成时，启用并显示 sidebar
    this.eventManager.emit('file-tree-loaded');
  }

  buildSidebarTreeHtml() {
    let html = '';
    
    // Files 根节点
    const filesExpanded = this.expandedFolders.has('__files_root__');
    html += `
      <div class="tree-item folder-item root-folder ${filesExpanded ? 'expanded' : ''}" 
           data-path="__files_root__" 
           data-level="0"
           data-type="root">
        <div class="expand-icon">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M6 4L10 8L6 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <div class="folder-icon">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M4 2C3.44772 2 3 2.44772 3 3V13C3 13.5523 3.44772 14 4 14H12C12.5523 14 13 13.5523 13 13V5L10 2H4Z" stroke="currentColor" stroke-width="1" fill="none"/>
            <path d="M10 2V5H13" stroke="currentColor" stroke-width="1" fill="none"/>
          </svg>
        </div>
        <span class="name">Files</span>
      </div>`;
    
    // Files 子内容
    if (filesExpanded) {
      html += '<div class="folder-children expanded">';
      for (const [filePath, fileInfo] of this.openFiles) {
        const isActive = filePath === this.activeFilePath && this.activeItemType === 'file';
        html += `
          <div class="tree-item file-item ${isActive ? 'active' : ''}" 
               data-path="${filePath}"
               data-level="1"
               data-type="file">
            <div class="file-icon">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M4 2C3.44772 2 3 2.44772 3 3V13C3 13.5523 3.44772 14 4 14H12C12.5523 14 13 13.5523 13 13V5L10 2H4Z" stroke="currentColor" stroke-width="1" fill="none"/>
                <path d="M10 2V5H13" stroke="currentColor" stroke-width="1" fill="none"/>
              </svg>
            </div>
            <span class="name">${this.escapeHtml(fileInfo.name)}</span>
          </div>
        `;
      }
      html += '</div>';
    }
    
    // Folders 根节点
    const foldersExpanded = this.expandedFolders.has('__folders_root__');
    html += `
      <div class="tree-item folder-item root-folder ${foldersExpanded ? 'expanded' : ''}" 
           data-path="__folders_root__" 
           data-level="0"
           data-type="root">
        <div class="expand-icon">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M6 4L10 8L6 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <div class="folder-icon">
          <svg class="folder-closed" width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path class="folder-outline" d="M2 4.5V12.5C2 13.0523 2.44772 13.5 3 13.5H13C13.5523 13.5 14 13.0523 14 12.5V6.5C14 5.94772 13.5523 5.5 13 5.5H7.5L6 4H3C2.44772 4 2 4.44772 2 5V4.5Z" stroke="currentColor" stroke-width="1" fill="none"/>
            <path class="folder-tab" d="M6 4L7.5 5.5" stroke="currentColor" stroke-width="1" stroke-linecap="round"/>
          </svg>
          <svg class="folder-open" width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path class="folder-outline" d="M2 4.5V12.5C2 13.0523 2.44772 13.5 3 13.5H13C13.5523 13.5 14 13.0523 14 12.5V6.5C14 5.94772 13.5523 5.5 13 5.5H7.5L6 4H3C2.44772 4 2 4.44772 2 5V4.5Z" stroke="currentColor" stroke-width="1" fill="none"/>
            <path class="folder-tab" d="M6 4L7.5 5.5" stroke="currentColor" stroke-width="1" stroke-linecap="round"/>
          </svg>
        </div>
        <span class="name">Folders</span>
      </div>`;
    
    // Folders 子内容
    if (foldersExpanded) {
      html += '<div class="folder-children expanded">';
      for (const [folderPath, folderInfo] of this.openFolders) {
        const isActive = folderPath === this.activeFilePath && this.activeItemType === 'folder';
        const isFolderExpanded = this.expandedFolders.has(folderPath);
        html += `
          <div class="tree-item folder-item ${isActive ? 'active' : ''} ${isFolderExpanded ? 'expanded' : ''}" 
               data-path="${folderPath}" 
               data-level="1"
               data-type="folder">
            <div class="expand-icon">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M6 4L10 8L6 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </div>
            <div class="folder-icon">
              <svg class="folder-closed" width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path class="folder-outline" d="M2 4.5V12.5C2 13.0523 2.44772 13.5 3 13.5H13C13.5523 13.5 14 13.0523 14 12.5V6.5C14 5.94772 13.5523 5.5 13 5.5H7.5L6 4H3C2.44772 4 2 4.44772 2 5V4.5Z" stroke="currentColor" stroke-width="1" fill="none"/>
                <path class="folder-tab" d="M6 4L7.5 5.5" stroke="currentColor" stroke-width="1" stroke-linecap="round"/>
              </svg>
              <svg class="folder-open" width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path class="folder-outline" d="M2 4.5V12.5C2 13.0523 2.44772 13.5 3 13.5H13C13.5523 13.5 14 13.0523 14 12.5V6.5C14 5.94772 13.5523 5.5 13 5.5H7.5L6 4H3C2.44772 4 2 4.44772 2 5V4.5Z" stroke="currentColor" stroke-width="1" fill="none"/>
                <path class="folder-tab" d="M6 4L7.5 5.5" stroke="currentColor" stroke-width="1" stroke-linecap="round"/>
              </svg>
            </div>
            <span class="name">${this.escapeHtml(folderInfo.name)}</span>
          </div>`;
        
        // 文件夹内容
        if (isFolderExpanded && folderInfo.fileTree && folderInfo.fileTree[0] && folderInfo.fileTree[0].children) {
          html += `<div class="folder-children expanded">${this.buildFileTreeHtml(folderInfo.fileTree[0].children, 2)}</div>`;
        }
      }
      html += '</div>';
    }
    
    return html;
  }

  // 保留原有的构建文件树HTML的方法，用于文件夹内容
  buildFileTreeHtml(items, level = 0) {
    let html = '';
    
    items.forEach((item, index) => {
      const isExpanded = this.expandedFolders.has(item.path);
      
      if (item.type === 'folder') {
        const childrenHtml = isExpanded && item.children ? 
          this.buildFileTreeHtml(item.children, level + 1) : '';
        
        html += `
          <div class="tree-item folder-item ${isExpanded ? 'expanded' : ''}" 
               data-path="${item.path}" 
               data-level="${level}"
               data-type="subfolder">
            <div class="expand-icon">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M6 4L10 8L6 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </div>
            <div class="folder-icon">
              <svg class="folder-closed" width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path class="folder-outline" d="M2 4.5V12.5C2 13.0523 2.44772 13.5 3 13.5H13C13.5523 13.5 14 13.0523 14 12.5V6.5C14 5.94772 13.5523 5.5 13 5.5H7.5L6 4H3C2.44772 4 2 4.44772 2 5V4.5Z" stroke="currentColor" stroke-width="1" fill="none"/>
                <path class="folder-tab" d="M6 4L7.5 5.5" stroke="currentColor" stroke-width="1" stroke-linecap="round"/>
              </svg>
              <svg class="folder-open" width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path class="folder-outline" d="M2 4.5V12.5C2 13.0523 2.44772 13.5 3 13.5H13C13.5523 13.5 14 13.0523 14 12.5V6.5C14 5.94772 13.5523 5.5 13 5.5H7.5L6 4H3C2.44772 4 2 4.44772 2 5V4.5Z" stroke="currentColor" stroke-width="1" fill="none"/>
                <path class="folder-tab" d="M6 4L7.5 5.5" stroke="currentColor" stroke-width="1" stroke-linecap="round"/>
              </svg>
            </div>
            <span class="name">${this.escapeHtml(item.name)}</span>
          </div>`;
        
        if (childrenHtml) {
          html += `<div class="folder-children ${isExpanded ? 'expanded' : ''}">${childrenHtml}</div>`;
        }
      } else {
        const isActive = item.path === this.activeFilePath && this.activeItemType === 'subfolder-file';
        html += `
          <div class="tree-item file-item ${isActive ? 'active' : ''}" 
               data-path="${item.path}"
               data-level="${level}"
               data-type="subfolder-file">
            <div class="file-icon">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M4 2C3.44772 2 3 2.44772 3 3V13C3 13.5523 3.44772 14 4 14H12C12.5523 14 13 13.5523 13 13V5L10 2H4Z" stroke="currentColor" stroke-width="1" fill="none"/>
                <path d="M10 2V5H13" stroke="currentColor" stroke-width="1" fill="none"/>
              </svg>
            </div>
            <span class="name">${this.escapeHtml(item.name)}</span>
          </div>
        `;
      }
    });
    
    return html;
  }

  attachFileTreeEvents() {
    const fileTreeContainer = document.getElementById('fileTree');
    if (!fileTreeContainer) return;
    
    // 移除旧的事件监听器
    fileTreeContainer.removeEventListener('click', this.handleFileTreeClick);
    fileTreeContainer.removeEventListener('dblclick', this.handleFileTreeDoubleClick);
    fileTreeContainer.removeEventListener('contextmenu', this.handleFileTreeContextMenu);
    
    // 添加新的事件监听器
    this.handleFileTreeClick = (event) => {
      const folderItem = event.target.closest('.folder-item');
      const fileItem = event.target.closest('.file-item');
      
      if (folderItem) {
        const path = folderItem.dataset.path;
        const type = folderItem.dataset.type;
        
        if (type === 'root' || type === 'folder' || type === 'subfolder') {
          this.toggleFolder(path);
        }
        
        if (type === 'folder') {
          // 激活文件夹
          this.setActiveItem(path, 'folder');
        }
      } else if (fileItem) {
        const path = fileItem.dataset.path;
        const type = fileItem.dataset.type;
        
        // 立即更新选中状态和渲染内容
        const fileType = type === 'file' ? 'file' : 'subfolder-file';
        this.setActiveItem(path, fileType);
        // 单击：立即在view区域显示文件
        this.eventManager.emit('file-selected', path, false, fileType);
      }
    };
    
    // 双击事件处理器
    this.handleFileTreeDoubleClick = (event) => {
      const fileItem = event.target.closest('.file-item');
      
      if (fileItem) {
        const path = fileItem.dataset.path;
        
        // 双击：添加文件到Files区域（单击已经显示在view了）
        this.eventManager.emit('file-double-clicked', path);
      }
    };
    
    // 右键菜单事件处理器 
    this.handleFileTreeContextMenu = (event) => {
      event.preventDefault();
      
      const folderItem = event.target.closest('.folder-item');
      const fileItem = event.target.closest('.file-item');
      
      if (folderItem) {
        const path = folderItem.dataset.path;
        const type = folderItem.dataset.type;
        
        if (type === 'folder') {
          this.showContextMenu(event, path, 'folder');
        }
      } else if (fileItem) {
        const path = fileItem.dataset.path;
        const type = fileItem.dataset.type;
        
        if (type === 'file') {
          this.showContextMenu(event, path, 'file');
        }
      }
    };
    
    fileTreeContainer.addEventListener('click', this.handleFileTreeClick);
    fileTreeContainer.addEventListener('dblclick', this.handleFileTreeDoubleClick);
    fileTreeContainer.addEventListener('contextmenu', this.handleFileTreeContextMenu);
  }

  // 设置活动项目
  setActiveItem(path, type) {
    this.activeFilePath = path;
    this.activeItemType = type;
    this.updateActiveItemHighlight();
  }

  updateActiveItemHighlight() {
    const fileTreeContainer = document.getElementById('fileTree');
    if (!fileTreeContainer) return;
    
    // 移除所有现有的active类
    const allItems = fileTreeContainer.querySelectorAll('.tree-item');
    allItems.forEach(item => item.classList.remove('active'));
    
    // 为当前活动项添加active类
    if (this.activeFilePath) {
      // 遍历所有元素，避免CSS选择器中文字符问题
      const allItems = fileTreeContainer.querySelectorAll('[data-path]');
      allItems.forEach(item => {
        if (item.dataset.path === this.activeFilePath) {
          item.classList.add('active');
        }
      });
    }
  }

  // 显示右键菜单
  showContextMenu(event, path, type) {
    // 移除已存在的菜单
    const existingMenu = document.querySelector('.context-menu');
    if (existingMenu) {
      existingMenu.remove();
    }

    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.position = 'fixed';
    menu.style.left = event.clientX + 'px';
    menu.style.top = event.clientY + 'px';
    menu.style.zIndex = 10000;

    if (type === 'file') {
      menu.innerHTML = `
        <div class="context-menu-item" data-action="close-file" data-path="${path}">
          关闭文件
        </div>
      `;
    } else if (type === 'folder') {
      menu.innerHTML = `
        <div class="context-menu-item" data-action="close-folder" data-path="${path}">
          关闭文件夹
        </div>
      `;
    }

    document.body.appendChild(menu);

    // 菜单项点击事件
    menu.addEventListener('click', (e) => {
      const action = e.target.dataset.action;
      const itemPath = e.target.dataset.path;
      
      if (action === 'close-file') {
        this.closeFile(itemPath);
      } else if (action === 'close-folder') {
        this.closeFolder(itemPath);
      }
      
      menu.remove();
    });

    // 点击其他地方关闭菜单
    const closeMenu = (e) => {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener('click', closeMenu);
      }
    };
    
    requestAnimationFrame(() => {
      document.addEventListener('click', closeMenu);
    });
  }

  // 关闭文件
  closeFile(filePath) {
    // 右键关闭文件时，直接调用AppManager的统一关闭函数
    if (window.appManager) {
      window.appManager.closeFileCompletely(filePath);
    } else {
      console.log('window.appManager not found!');
    }
  }

  // 关闭文件夹
  closeFolder(folderPath) {
    this.openFolders.delete(folderPath);
    
    // 如果关闭的是当前活动文件夹，清除活动状态
    if (this.activeFilePath === folderPath && this.activeItemType === 'folder') {
      this.activeFilePath = null;
      this.activeItemType = null;
    }
    
    // 清理相关的展开状态
    this.expandedFolders.delete(folderPath);
    
    this.refreshSidebarTree();
    
    // 保存状态
    if (window.appManager) {
      window.appManager.saveAppState();
    }
    
    // 发出文件夹关闭事件
    this.eventManager.emit('folder-closed', folderPath);
  }
  
  toggleFolder(folderPath) {
    if (this.expandedFolders.has(folderPath)) {
      this.expandedFolders.delete(folderPath);
    } else {
      this.expandedFolders.add(folderPath);
    }
    
    // 确保根节点默认展开
    if (folderPath === '__files_root__' || folderPath === '__folders_root__') {
      this.expandedFolders.add(folderPath);
    }
    
    this.saveExpandedState();
    this.refreshSidebarTree();
  }

  refreshFileTree() {
    // 兼容性方法，现在使用 refreshSidebarTree
    this.refreshSidebarTree();
  }

  updateActiveFile(filePath) {
    // 确定活动文件的类型
    let itemType = 'file'; // 默认是单独文件
    
    // 检查文件是否在某个文件夹中
    for (const [folderPath, folderInfo] of this.openFolders) {
      if (this.isFileInFolder(filePath, folderInfo.fileTree)) {
        itemType = 'subfolder-file';
        break;
      }
    }
    
    this.setActiveItem(filePath, itemType);
  }

  // 检查文件是否在文件夹树中
  isFileInFolder(filePath, fileTree) {
    for (const item of fileTree) {
      if (item.type === 'file' && item.path === filePath) {
        return true;
      }
      if (item.type === 'folder' && item.children) {
        if (this.isFileInFolder(filePath, item.children)) {
          return true;
        }
      }
    }
    return false;
  }

  // 初始化根节点展开状态
  initializeRootExpansion() {
    this.expandedFolders.add('__files_root__');
    this.expandedFolders.add('__folders_root__');
  }

  // 确保根节点始终展开（用于防止被意外关闭）
  ensureRootNodesExpanded() {
    this.expandedFolders.add('__files_root__');
    this.expandedFolders.add('__folders_root__');
  }

  saveExpandedState() {
    // 保存展开状态到本地存储
    const key = 'filetree-expanded-state';
    localStorage.setItem(key, JSON.stringify([...this.expandedFolders]));
  }

  restoreExpandedState() {
    // 恢复展开状态
    const key = 'filetree-expanded-state';
    const saved = localStorage.getItem(key);
    if (saved) {
      try {
        const expandedArray = JSON.parse(saved);
        this.expandedFolders = new Set(expandedArray);
      } catch (error) {
        console.error('Error restoring expanded state:', error);
        this.expandedFolders = new Set();
      }
    }
    
    // 确保根节点默认展开
    this.initializeRootExpansion();
  }

  updateFileTree(folderPath, fileTree) {
    // 更新文件夹数据
    this.addFolder(folderPath, fileTree);
  }

  getCurrentFolderPath() {
    // 返回第一个打开的文件夹路径，或null
    const firstFolder = this.openFolders.keys().next();
    return firstFolder.done ? null : firstFolder.value;
  }

  getActiveFilePath() {
    return this.activeFilePath;
  }

  clearFileTree() {
    this.openFiles.clear();
    this.openFolders.clear();
    this.activeFilePath = null;
    this.activeItemType = null;
    this.expandedFolders.clear();
    
    // 恢复根节点展开状态
    this.initializeRootExpansion();
    
    // 刷新sidebar树，保持Files和Folders节点显示
    this.refreshSidebarTree();
  }
}

module.exports = FileTreeManager;