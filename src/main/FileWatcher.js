const fs = require('fs');
const path = require('path');

class FileWatcher {
  constructor(windowManager, fileManager) {
    this.windowManager = windowManager;
    this.fileManager = fileManager;
    this.watcher = null;
    this.watchedPath = null;
    this.fileWatcher = null; // 单个文件监听器
    this.watchedFile = null; // 当前监听的文件路径
    this.lastFileContent = null; // 上次读取的文件内容，用于去重
    this.isUpdating = false; // 防止重复更新
    this.updateTimeout = null; // 防抖定时器
  }

  startWatching(folderPath) {
    // 确保先停止之前的监听
    this.stopWatching();
    
    // 验证路径是否存在
    if (!folderPath || !fs.existsSync(folderPath)) {
      console.error('FileWatcher: Invalid or non-existent path:', folderPath);
      return;
    }

    try {
      this.watchedPath = folderPath;
      this.watcher = fs.watch(folderPath, { recursive: true }, (eventType, filename) => {
        if (filename && !filename.startsWith('.')) {
          // 只有在文件/文件夹结构发生变化时才刷新文件树
          // 'rename' 事件表示文件/文件夹的创建、删除、重命名
          // 'change' 事件只表示文件内容修改，不需要刷新文件树
          if (eventType === 'rename') {
            // 使用 setTimeout 来防抖，避免短时间内多次触发
            if (this.updateTimeout) {
              clearTimeout(this.updateTimeout);
            }
            this.updateTimeout = setTimeout(() => {
              console.log('FileWatcher: 执行文件树更新');
              this.updateFileTree();
            }, 200); // 200ms 防抖
          }
        }
      });
      
      // 添加错误处理
      this.watcher.on('error', (error) => {
        console.error('FileWatcher error:', error);
        this.stopWatching();
      });
      
    } catch (error) {
      console.error('Error starting file watcher:', error);
      this.stopWatching();
    }
  }

  stopWatching() {
    // 重置更新状态
    this.isUpdating = false;
    
    // 清理防抖定时器
    if (this.updateTimeout) {
      clearTimeout(this.updateTimeout);
      this.updateTimeout = null;
    }
    
    // 关闭文件夹监听器
    if (this.watcher) {
      try {
        this.watcher.close();
      } catch (error) {
        console.error('Error closing folder watcher:', error);
      }
      this.watcher = null;
      this.watchedPath = null;
    }

    // 关闭文件监听器
    this.stopFileWatching();
  }

  // 监听单个文件的内容变化
  startFileWatching(filePath) {
    // 确保先停止之前的文件监听
    this.stopFileWatching();
    
    // 验证文件路径是否存在
    if (!filePath || !fs.existsSync(filePath)) {
      console.error('FileWatcher: Invalid or non-existent file:', filePath);
      return;
    }

    try {
      this.watchedFile = filePath;
      // 初始化文件内容缓存
      this.lastFileContent = fs.readFileSync(filePath, 'utf-8');
      
      this.fileWatcher = fs.watch(filePath, (eventType, filename) => {
        // 只处理文件内容变化事件
        if (eventType === 'change') {
          this.refreshFile();
        }
      });
      
      // 添加错误处理
      this.fileWatcher.on('error', (error) => {
        console.error('File watcher error:', error);
        this.stopFileWatching();
      });
      
    } catch (error) {
      console.error('Error starting file watcher:', error);
      this.stopFileWatching();
    }
  }

  // 停止监听单个文件
  stopFileWatching() {
    if (this.fileWatcher) {
      try {
        this.fileWatcher.close();
      } catch (error) {
        console.error('Error closing file watcher:', error);
      }
      this.fileWatcher = null;
      this.watchedFile = null;
      this.lastFileContent = null;
    }
  }

  // 刷新文件内容并通知渲染进程
  refreshFile() {
    // 防止重复更新
    if (this.isUpdating) {
      return;
    }
    if (!this.watchedFile) return;
    
    // 重新验证文件是否仍然存在
    if (!fs.existsSync(this.watchedFile)) {
      this.stopFileWatching();
      return;
    }
    
    this.isUpdating = true;
    
    try {
      const content = fs.readFileSync(this.watchedFile, 'utf-8');
      
      // 检查内容是否真的有变化
      if (this.lastFileContent === content) {
        this.isUpdating = false;
        return;
      }
      
      // 更新缓存的内容
      this.lastFileContent = content;
      
      const mainWindow = this.windowManager.getWindow();
      
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('file-content-updated', {
          filePath: this.watchedFile,
          content
        });
      }
    } catch (error) {
      console.error('Error refreshing file content:', error);
      // 如果读取失败，可能是文件问题，停止监听
      if (error.code === 'ENOENT' || error.code === 'EACCES') {
        this.stopFileWatching();
      }
    } finally {
      this.isUpdating = false;
    }
  }

  updateFileTree() {
    // 防止重复更新
    if (this.isUpdating) {
      return;
    }
    if (!this.watchedPath) return;
    
    // 重新验证路径是否仍然存在
    if (!fs.existsSync(this.watchedPath)) {
      this.stopWatching();
      return;
    }
    
    this.isUpdating = true;
    
    try {
      const fileTree = this.fileManager.buildFileTreeWithRoot(this.watchedPath);
      const mainWindow = this.windowManager.getWindow();
      
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('file-tree-updated', {
          folderPath: this.watchedPath,
          fileTree
        });
      }
    } catch (error) {
      console.error('Error updating file tree:', error);
      // 如果更新失败，可能是路径问题，停止监听
      if (error.code === 'ENOENT' || error.code === 'EACCES') {
        this.stopWatching();
      }
    } finally {
      this.isUpdating = false;
    }
  }

  isWatching() {
    return this.watcher !== null;
  }

  getWatchedPath() {
    return this.watchedPath;
  }
}

module.exports = FileWatcher;