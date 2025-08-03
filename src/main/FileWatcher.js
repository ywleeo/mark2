const fs = require('fs');
const path = require('path');

class FileWatcher {
  constructor(windowManager, fileManager) {
    this.windowManager = windowManager;
    this.fileManager = fileManager;
    this.watcher = null;
    this.watchedPath = null;
    this.updateTimeout = null; // 防抖定时器
    this.fileWatcher = null; // 单个文件监听器
    this.watchedFile = null; // 当前监听的文件路径
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
            this.debouncedUpdateFileTree();
          }
        }
      });
      
      // 添加错误处理
      this.watcher.on('error', (error) => {
        console.error('FileWatcher error:', error);
        this.stopWatching();
      });
      
      console.log('Started watching:', folderPath);
    } catch (error) {
      console.error('Error starting file watcher:', error);
      this.stopWatching();
    }
  }

  stopWatching() {
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
      console.log('Stopped folder watching');
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
      this.fileWatcher = fs.watch(filePath, (eventType, filename) => {
        // 只处理文件内容变化事件
        if (eventType === 'change') {
          console.log('File content changed:', filePath);
          this.debouncedRefreshFile();
        }
      });
      
      // 添加错误处理
      this.fileWatcher.on('error', (error) => {
        console.error('File watcher error:', error);
        this.stopFileWatching();
      });
      
      console.log('Started watching file:', filePath);
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
      console.log('Stopped file watching');
    }
  }

  // 防抖处理的文件刷新
  debouncedRefreshFile() {
    // 清除之前的定时器
    if (this.updateTimeout) {
      clearTimeout(this.updateTimeout);
    }
    
    // 设置新的定时器，300ms 后执行更新
    this.updateTimeout = setTimeout(() => {
      this.refreshFile();
      this.updateTimeout = null;
    }, 300);
  }

  // 刷新文件内容并通知渲染进程
  refreshFile() {
    if (!this.watchedFile) return;
    
    // 重新验证文件是否仍然存在
    if (!fs.existsSync(this.watchedFile)) {
      console.log('Watched file no longer exists, stopping watcher:', this.watchedFile);
      this.stopFileWatching();
      return;
    }
    
    try {
      const content = fs.readFileSync(this.watchedFile, 'utf-8');
      const mainWindow = this.windowManager.getWindow();
      
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('file-content-updated', {
          filePath: this.watchedFile,
          content
        });
        console.log('File content refreshed:', this.watchedFile);
      }
    } catch (error) {
      console.error('Error refreshing file content:', error);
      // 如果读取失败，可能是文件问题，停止监听
      if (error.code === 'ENOENT' || error.code === 'EACCES') {
        this.stopFileWatching();
      }
    }
  }

  // 防抖处理的文件树更新
  debouncedUpdateFileTree() {
    // 清除之前的定时器
    if (this.updateTimeout) {
      clearTimeout(this.updateTimeout);
    }
    
    // 设置新的定时器，300ms 后执行更新
    this.updateTimeout = setTimeout(() => {
      this.updateFileTree();
      this.updateTimeout = null;
    }, 300);
  }

  updateFileTree() {
    if (!this.watchedPath) return;
    
    // 重新验证路径是否仍然存在
    if (!fs.existsSync(this.watchedPath)) {
      console.log('Watched path no longer exists, stopping watcher:', this.watchedPath);
      this.stopWatching();
      return;
    }
    
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