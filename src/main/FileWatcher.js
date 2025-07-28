const fs = require('fs');
const path = require('path');

class FileWatcher {
  constructor(windowManager, fileManager) {
    this.windowManager = windowManager;
    this.fileManager = fileManager;
    this.watcher = null;
    this.watchedPath = null;
  }

  startWatching(folderPath) {
    this.stopWatching();
    
    try {
      this.watchedPath = folderPath;
      this.watcher = fs.watch(folderPath, { recursive: true }, (eventType, filename) => {
        if (filename && !filename.startsWith('.')) {
          // 只有在文件/文件夹结构发生变化时才刷新文件树
          // 'rename' 事件表示文件/文件夹的创建、删除、重命名
          // 'change' 事件只表示文件内容修改，不需要刷新文件树
          if (eventType === 'rename') {
            this.updateFileTree();
          }
        }
      });
      
      console.log('Started watching:', folderPath);
    } catch (error) {
      console.error('Error starting file watcher:', error);
    }
  }

  stopWatching() {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
      this.watchedPath = null;
      console.log('Stopped file watching');
    }
  }

  updateFileTree() {
    if (!this.watchedPath) return;
    
    try {
      const fileTree = this.fileManager.buildFileTreeWithRoot(this.watchedPath);
      const mainWindow = this.windowManager.getWindow();
      
      if (mainWindow) {
        mainWindow.webContents.send('file-tree-updated', {
          folderPath: this.watchedPath,
          fileTree
        });
      }
    } catch (error) {
      console.error('Error updating file tree:', error);
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