class FileTreeManager {
  constructor(eventManager) {
    this.eventManager = eventManager;
    this.currentFolderPath = null;
    this.fileTree = null;
    this.expandedFolders = new Set();
    this.activeFilePath = null;
  }

  // 简化的配置（不再需要复杂的配置）
  getTreeConfig() {
    return {};
  }

  displayFileTree(folderPath, fileTree) {
    this.currentFolderPath = folderPath;
    this.fileTree = fileTree;
    
    const fileTreeContainer = document.getElementById('fileTree');
    if (!fileTreeContainer) return;
    
    fileTreeContainer.innerHTML = this.buildFileTreeHtml(fileTree);
    this.attachFileTreeEvents();
    this.restoreExpandedState();
    
    // 当文件树加载完成时，启用并显示 sidebar
    this.eventManager.emit('file-tree-loaded');
  }

  buildFileTreeHtml(items, level = 0) {
    let html = '';
    
    items.forEach((item, index) => {
      // 根文件夹默认展开
      const isExpanded = item.isRoot ? true : this.expandedFolders.has(item.path);
      
      // 确保根文件夹在展开状态集合中
      if (item.isRoot) {
        this.expandedFolders.add(item.path);
      }
      
      if (item.type === 'folder') {
        const childrenHtml = isExpanded && item.children ? 
          this.buildFileTreeHtml(item.children, level + 1) : '';
        
        const rootClass = item.isRoot ? 'root-folder' : '';
        html += `
          <div class="tree-item folder-item ${isExpanded ? 'expanded' : ''} ${rootClass}" 
               data-path="${item.path}" 
               data-level="${level}">
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
            <span class="name">${item.name}</span>
          </div>`;
        
        // 简单的容器，使用CSS控制缩进和竖线
        if (childrenHtml) {
          html += `<div class="folder-children ${isExpanded ? 'expanded' : ''}">${childrenHtml}</div>`;
        }
      } else {
        const isActive = item.path === this.activeFilePath;
        html += `
          <div class="tree-item file-item ${isActive ? 'active' : ''}" 
               data-path="${item.path}"
               data-level="${level}">
            <div class="file-icon">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M4 2C3.44772 2 3 2.44772 3 3V13C3 13.5523 3.44772 14 4 14H12C12.5523 14 13 13.5523 13 13V5L10 2H4Z" stroke="currentColor" stroke-width="1" fill="none"/>
                <path d="M10 2V5H13" stroke="currentColor" stroke-width="1" fill="none"/>
              </svg>
            </div>
            <span class="name">${item.name}</span>
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
    
    // 添加新的事件监听器
    this.handleFileTreeClick = (event) => {
      const folderItem = event.target.closest('.folder-item');
      const fileItem = event.target.closest('.file-item');
      
      if (folderItem) {
        const path = folderItem.dataset.path;
        this.toggleFolder(path);
      } else if (fileItem) {
        const path = fileItem.dataset.path;
        this.eventManager.emit('file-selected', path);
      }
    };
    
    fileTreeContainer.addEventListener('click', this.handleFileTreeClick);
  }

  toggleFolder(folderPath) {
    if (this.expandedFolders.has(folderPath)) {
      this.expandedFolders.delete(folderPath);
    } else {
      this.expandedFolders.add(folderPath);
    }
    
    this.saveExpandedState();
    this.refreshFileTree();
  }

  refreshFileTree() {
    if (this.fileTree) {
      // 只刷新HTML内容，不重新发出初始化事件
      const fileTreeContainer = document.getElementById('fileTree');
      if (!fileTreeContainer) return;
      
      fileTreeContainer.innerHTML = this.buildFileTreeHtml(this.fileTree);
      this.attachFileTreeEvents();
    }
  }

  updateActiveFile(filePath) {
    this.activeFilePath = filePath;
    
    // 更新UI中的活动文件样式
    const fileItems = document.querySelectorAll('.file-item');
    fileItems.forEach(item => {
      if (item.dataset.path === filePath) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });
  }

  saveExpandedState() {
    if (this.currentFolderPath) {
      const key = `expanded-folders-${this.currentFolderPath}`;
      localStorage.setItem(key, JSON.stringify([...this.expandedFolders]));
    }
  }

  restoreExpandedState() {
    if (this.currentFolderPath) {
      const key = `expanded-folders-${this.currentFolderPath}`;
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
    }
  }

  updateFileTree(folderPath, fileTree) {
    this.currentFolderPath = folderPath;
    this.fileTree = fileTree;
    
    // 只刷新文件树内容，不重新触发初始化事件
    const fileTreeContainer = document.getElementById('fileTree');
    if (!fileTreeContainer) return;
    
    fileTreeContainer.innerHTML = this.buildFileTreeHtml(fileTree);
    this.attachFileTreeEvents();
    // 注意：这里不调用 restoreExpandedState，因为展开状态已经在 buildFileTreeHtml 中处理了
  }

  getCurrentFolderPath() {
    return this.currentFolderPath;
  }

  getActiveFilePath() {
    return this.activeFilePath;
  }
}

module.exports = FileTreeManager;