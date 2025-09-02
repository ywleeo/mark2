class DragDropManager {
  constructor(eventManager, uiManager, fileTreeManager, tabManager, stateManager) {
    this.eventManager = eventManager;
    this.uiManager = uiManager;
    this.fileTreeManager = fileTreeManager;
    this.tabManager = tabManager;
    this.stateManager = stateManager;
    
    // 添加样式
    this.addDropIndicatorStyles();
    
    this.setupDragAndDrop();
  }

  setupDragAndDrop() {
    // 添加拖拽悬停效果
    document.addEventListener('dragover', (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      this.showDropIndicator(true);
    });

    // 拖拽离开时隐藏指示器
    document.addEventListener('dragleave', (event) => {
      // 只有当拖拽完全离开窗口时才隐藏指示器
      if (event.clientX === 0 && event.clientY === 0) {
        this.showDropIndicator(false);
      }
    });

    // 处理文件拖拽放置
    document.addEventListener('drop', async (event) => {
      event.preventDefault();
      this.showDropIndicator(false);
      
      await this.handleFileDrop(event);
    });
  }

  // 显示/隐藏拖拽指示器
  showDropIndicator(show) {
    let dropIndicator = document.getElementById('drop-indicator');
    
    if (show) {
      if (!dropIndicator) {
        dropIndicator = document.createElement('div');
        dropIndicator.id = 'drop-indicator';
        dropIndicator.className = 'drop-indicator';
        dropIndicator.innerHTML = `
          <div class="drop-indicator-content">
            <div class="drop-indicator-icon">📁</div>
            <div class="drop-indicator-text">拖放文件或文件夹到此处</div>
          </div>
        `;
        document.body.appendChild(dropIndicator);
      }
      dropIndicator.style.display = 'flex';
    } else {
      if (dropIndicator) {
        dropIndicator.style.display = 'none';
      }
    }
  }

  // 处理文件拖拽放置
  async handleFileDrop(event) {
    const files = Array.from(event.dataTransfer.files);
    
    if (files.length === 0) {
      this.uiManager.showMessage('未检测到拖拽的文件', 'error');
      return;
    }
    
    try {
      // 显示加载提示
      this.uiManager.showMessage('正在处理拖拽的文件...', 'info');
      
      // 获取文件路径信息
      const { ipcRenderer } = require('electron');
      const file = files[0]; // 只处理第一个文件/文件夹
      
      console.log('拖拽文件信息:', {
        name: file.name,
        size: file.size,
        type: file.type,
        lastModified: file.lastModified,
        path: file.path // HTML File API 的路径属性
      });
      
      let realPath;
      try {
        // 尝试直接使用 file.path
        if (file.path) {
          realPath = file.path;
          console.log('直接获取路径成功:', realPath);
        } else {
          // 如果没有 path 属性，尝试通过 IPC 获取
          realPath = await ipcRenderer.invoke('get-file-path-from-drag', {
            name: file.name,
            size: file.size,
            type: file.type,
            lastModified: file.lastModified
          });
          console.log('通过 IPC 获取路径成功:', realPath);
        }
      } catch (pathError) {
        console.error('获取文件路径失败:', pathError);
        throw new Error('无法获取文件路径: ' + pathError.message);
      }
      
      // 使用真实路径调用处理逻辑
      const result = await ipcRenderer.invoke('handle-drop-file', realPath);
      
      console.log('主进程处理结果:', result);
      
      if (result.success === false) {
        throw new Error(result.error || '主进程处理失败');
      }
      
      if (result.type === 'folder') {
        await this.handleFolderDrop(result);
      } else if (result.type === 'file') {
        await this.handleSingleFileDrop(result);
      }
      
      // 清除加载提示
      this.uiManager.clearMessage();
      
    } catch (error) {
      console.error('拖拽处理错误 - 错误类型:', typeof error);
      console.error('拖拽处理错误 - 错误对象:', error);
      console.error('拖拽处理错误 - 错误消息:', error?.message);
      console.error('拖拽处理错误 - 错误堆栈:', error?.stack);
      
      const errorMessage = error?.message || error?.toString() || '未知错误';
      this.uiManager.showMessage('处理拖拽文件时发生错误: ' + errorMessage, 'error');
    }
  }

  // 处理文件夹拖拽
  async handleFolderDrop(result) {
    this.stateManager.setCurrentFolderPath(result.folderPath);
    
    // 显示文件树
    this.fileTreeManager.displayFileTree(result.folderPath, result.fileTree);
    
    // 调整窗口大小
    const { ipcRenderer } = require('electron');
    ipcRenderer.send('resize-window-to-content-loaded');
    
    this.uiManager.showMessage(`已打开文件夹: ${result.folderPath}`, 'success');
  }

  // 处理单文件拖拽
  async handleSingleFileDrop(result) {
    this.stateManager.setCurrentFilePath(result.filePath);
    
    // 检查文件是否已打开，如果已打开则激活现有tab
    const existingTab = this.tabManager.findTabByPath(result.filePath);
    if (existingTab) {
      this.tabManager.setActiveTab(existingTab.id);
      this.uiManager.showMessage('文件已打开，切换到对应标签页', 'info');
    } else {
      // 文件未打开，创建新tab，标记为来自file节点
      this.tabManager.openFileInTab(result.filePath, false, false, 'file');
      
      // 将文件添加到侧边栏
      this.fileTreeManager.addFile(result.filePath, result.content);
      
      // 显示markdown内容
      const markdownContent = document.querySelector('.markdown-content');
      if (markdownContent) {
        markdownContent.style.display = 'block';
      }
      
      // 调整窗口大小
      const { ipcRenderer } = require('electron');
      ipcRenderer.send('resize-window-to-content-loaded');
      
      this.uiManager.showMessage(`已打开文件: ${result.filePath}`, 'success');
    }
  }

  // 验证拖拽的文件类型
  validateDroppedFiles(files) {
    const validExtensions = ['.md', '.markdown', '.txt'];
    const errors = [];
    
    for (const file of files) {
      const fileName = file.name.toLowerCase();
      const isValid = validExtensions.some(ext => fileName.endsWith(ext));
      
      if (!isValid) {
        errors.push(`不支持的文件类型: ${file.name}`);
      }
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }

  // 处理多文件拖拽
  async handleMultipleFiles(files) {
    const validation = this.validateDroppedFiles(files);
    
    if (!validation.isValid) {
      this.uiManager.showMessage(
        `部分文件类型不支持：\n${validation.errors.join('\n')}`,
        'warning'
      );
      return;
    }

    let successCount = 0;
    let errorCount = 0;

    for (const file of files) {
      try {
        const { webUtils, ipcRenderer } = require('electron');
        const realPath = webUtils.getPathForFile(file);
        const result = await ipcRenderer.invoke('handle-drop-file', realPath);
        
        if (result.type === 'file') {
          // 为每个文件创建新的tab
          this.tabManager.createTab(result.filePath, null, 'file');
          this.fileTreeManager.addFile(result.filePath, result.content);
          successCount++;
        }
      } catch (error) {
        console.error(`处理文件 ${file.name} 失败:`, error);
        errorCount++;
      }
    }

    if (successCount > 0) {
      // 显示markdown内容
      const markdownContent = document.querySelector('.markdown-content');
      if (markdownContent) {
        markdownContent.style.display = 'block';
      }
      
      // 调整窗口大小
      const { ipcRenderer } = require('electron');
      ipcRenderer.send('resize-window-to-content-loaded');
    }

    // 显示处理结果
    if (errorCount === 0) {
      this.uiManager.showMessage(`成功打开 ${successCount} 个文件`, 'success');
    } else {
      this.uiManager.showMessage(
        `成功打开 ${successCount} 个文件，${errorCount} 个文件处理失败`,
        'warning'
      );
    }
  }

  // 获取拖拽区域的信息
  getDragDropInfo() {
    return {
      supportedFileTypes: ['.md', '.markdown', '.txt'],
      supportsFolders: true,
      supportsMultipleFiles: true,
      maxFiles: 10 // 限制同时拖拽的文件数量
    };
  }

  // 清理拖拽相关的UI元素
  cleanup() {
    const dropIndicator = document.getElementById('drop-indicator');
    if (dropIndicator) {
      dropIndicator.remove();
    }
    
    // 移除事件监听器
    document.removeEventListener('dragover', this.handleDragOver);
    document.removeEventListener('dragleave', this.handleDragLeave);
    document.removeEventListener('drop', this.handleDrop);
  }

  // 启用/禁用拖拽功能
  setEnabled(enabled) {
    const body = document.body;
    if (enabled) {
      body.classList.remove('drag-drop-disabled');
      body.style.pointerEvents = '';
    } else {
      body.classList.add('drag-drop-disabled');
      // 禁用拖拽时不完全禁用pointer events，只是添加样式提示
    }
  }

  // 检查是否支持拖拽的文件
  isFileSupported(fileName) {
    const supportedExtensions = ['.md', '.markdown', '.txt'];
    const lowerName = fileName.toLowerCase();
    return supportedExtensions.some(ext => lowerName.endsWith(ext));
  }

  // 为拖拽指示器添加样式（通过程序创建样式）
  addDropIndicatorStyles() {
    if (document.getElementById('drop-indicator-styles')) {
      return; // 样式已存在
    }

    const style = document.createElement('style');
    style.id = 'drop-indicator-styles';
    style.textContent = `
      .drop-indicator {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.6);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        backdrop-filter: blur(2px);
      }

      .drop-indicator-content {
        text-align: center;
        color: white;
        font-size: 24px;
        padding: 40px;
        border: 3px dashed rgba(255, 255, 255, 0.8);
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.1);
      }

      .drop-indicator-icon {
        font-size: 48px;
        margin-bottom: 16px;
      }

      .drop-indicator-text {
        font-size: 18px;
        font-weight: 500;
      }

      body.drag-drop-disabled .drop-indicator {
        display: none !important;
      }
    `;
    
    document.head.appendChild(style);
  }
}

module.exports = DragDropManager;