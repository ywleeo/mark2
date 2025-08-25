const fs = require('fs');
const path = require('path');

class FileWatcher {
  constructor(windowManager, fileManager) {
    this.windowManager = windowManager;
    this.fileManager = fileManager;
    this.watchedPath = null; // 当前监听的文件夹路径
    this.watchedFile = null; // 当前监听的文件路径
    this.lastFileContent = null; // 上次读取的文件内容，用于去重
    this.lastFileTreeHash = null; // 上次文件树的哈希值，用于检测实际变化
  }

  // 开始跟踪文件夹（不使用持续监听）
  startWatching(folderPath) {
    // 验证路径是否存在
    if (!folderPath || !fs.existsSync(folderPath)) {
      console.error('FileWatcher: Invalid or non-existent path:', folderPath);
      return;
    }

    this.watchedPath = folderPath;
    // 建立初始文件树快照
    this.createFileTreeSnapshot();
    // console.log(`FileWatcher: 开始跟踪文件夹: ${folderPath}`);
  }

  // 停止跟踪
  stopWatching() {
    this.watchedPath = null;
    this.lastFileTreeHash = null;
    this.stopFileWatching();
    // console.log('FileWatcher: 已停止文件夹跟踪');
  }

  // 开始跟踪单个文件（不使用持续监听）
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
      
      // console.log(`FileWatcher: 开始跟踪文件: ${filePath}`);
      
      // 通知渲染进程新的文件监听已开始
      const mainWindow = this.windowManager.getWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('file-watch-started', {
          filePath: this.watchedFile
        });
      }
      
    } catch (error) {
      console.error('Error starting file watcher:', error);
      this.stopFileWatching();
    }
  }

  // 停止跟踪单个文件
  stopFileWatching() {
    const previousWatchedFile = this.watchedFile;
    
    this.watchedFile = null;
    this.lastFileContent = null;

    // 通知渲染进程文件监听已停止
    if (previousWatchedFile) {
      const mainWindow = this.windowManager.getWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('file-watch-stopped', {
          filePath: previousWatchedFile
        });
      }
      // console.log(`FileWatcher: 已停止文件跟踪: ${previousWatchedFile}`);
    }
  }

  // 按需检查并刷新文件内容
  checkAndRefreshFile() {
    if (!this.watchedFile) return false;
    
    // 重新验证文件是否仍然存在
    if (!fs.existsSync(this.watchedFile)) {
      this.stopFileWatching();
      return false;
    }
    
    try {
      const content = fs.readFileSync(this.watchedFile, 'utf-8');
      
      // 检查内容是否真的有变化
      if (this.lastFileContent === content) {
        return false; // 无变化
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
      
      // console.log(`FileWatcher: 检测到文件内容变化: ${this.watchedFile}`);
      return true; // 有变化
    } catch (error) {
      console.error('Error checking file content:', error);
      // 如果读取失败，可能是文件问题，停止监听
      if (error.code === 'ENOENT' || error.code === 'EACCES') {
        this.stopFileWatching();
      }
      return false;
    }
  }

  // 按需检查并更新文件树
  checkAndUpdateFileTree() {
    if (!this.watchedPath) return false;
    
    // 重新验证路径是否仍然存在
    if (!fs.existsSync(this.watchedPath)) {
      this.stopWatching();
      return false;
    }
    
    try {
      const fileTree = this.fileManager.buildFileTreeWithRoot(this.watchedPath);
      
      // 计算文件树哈希以检测实际变化
      const currentHash = this.calculateFileTreeHash(fileTree);
      
      // 只有当文件树真正发生变化时才发送更新
      if (currentHash !== this.lastFileTreeHash) {
        this.lastFileTreeHash = currentHash;
        
        const mainWindow = this.windowManager.getWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('file-tree-updated', {
            folderPath: this.watchedPath,
            fileTree
          });
        }
        return true; // 有变化
      } else {
        return false; // 无变化
      }
    } catch (error) {
      console.error('Error checking file tree:', error);
      // 如果更新失败，可能是路径问题，停止监听
      if (error.code === 'ENOENT' || error.code === 'EACCES') {
        this.stopWatching();
      }
      return false;
    }
  }




  // 计算文件树哈希值用于检测变化
  calculateFileTreeHash(fileTree) {
    const crypto = require('crypto');
    
    function serializeTree(items) {
      return items.map(item => {
        const data = {
          name: item.name,
          path: item.path,
          type: item.type
        };
        
        if (item.children) {
          data.children = serializeTree(item.children);
        }
        
        return JSON.stringify(data);
      }).join('|');
    }
    
    const treeString = serializeTree(fileTree);
    return crypto.createHash('md5').update(treeString).digest('hex');
  }


  isWatching() {
    return this.watchedPath !== null;
  }

  getWatchedPath() {
    return this.watchedPath;
  }
  
  getWatchedFile() {
    return this.watchedFile;
  }

  // 建立初始文件树快照
  createFileTreeSnapshot() {
    if (!this.watchedPath) return;
    
    try {
      const fileTree = this.fileManager.buildFileTreeWithRoot(this.watchedPath);
      this.lastFileTreeHash = this.calculateFileTreeHash(fileTree);
      // console.log(`FileWatcher: 建立文件树快照，哈希值: ${this.lastFileTreeHash}`);
    } catch (error) {
      console.error('Error creating file tree snapshot:', error);
    }
  }

  // 统一的刷新方法：检查文件和文件夹变化
  checkAndRefreshAll() {
    let hasChanges = false;
    
    // 检查文件夹变化
    if (this.watchedPath) {
      const folderChanged = this.checkAndUpdateFileTree();
      if (folderChanged) {
        hasChanges = true;
      }
    }
    
    // 检查文件内容变化
    if (this.watchedFile) {
      const fileChanged = this.checkAndRefreshFile();
      if (fileChanged) {
        hasChanges = true;
      }
    }
    
    return hasChanges;
  }
}

module.exports = FileWatcher;