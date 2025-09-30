const fs = require('fs');
const path = require('path');

class FileWatcher {
  constructor(windowManager, fileManager) {
    this.windowManager = windowManager;
    this.fileManager = fileManager;
    // 多文件夹监听：{folderPath: {lastFileTreeHash}}
    this.watchedFolders = new Map();
    this.watchedFile = null; // 当前监听的文件路径
    this.lastFileContent = null; // 上次读取的文件内容，用于去重
  }

  // 开始跟踪文件夹（不使用持续监听）
  startWatching(folderPath) {
    // 验证路径是否存在
    if (!folderPath || !fs.existsSync(folderPath)) {
      console.error('FileWatcher: Invalid or non-existent path:', folderPath);
      return;
    }

    // 如果已经在监听，直接返回
    if (this.watchedFolders.has(folderPath)) {
      console.log(`FileWatcher: 文件夹已在监听中: ${folderPath}`);
      return;
    }

    // 建立初始文件树快照
    const fileTree = this.fileManager.buildFileTreeWithRoot(folderPath);
    const hash = this.calculateFileTreeHash(fileTree);

    this.watchedFolders.set(folderPath, {
      lastFileTreeHash: hash
    });

    console.log(`FileWatcher: 开始跟踪文件夹: ${folderPath} (总计: ${this.watchedFolders.size})`);
  }

  // 停止跟踪特定文件夹
  stopWatching(folderPath) {
    if (folderPath) {
      // 停止特定文件夹监听
      if (this.watchedFolders.has(folderPath)) {
        this.watchedFolders.delete(folderPath);
        console.log(`FileWatcher: 已停止文件夹跟踪: ${folderPath} (剩余: ${this.watchedFolders.size})`);
      }
    } else {
      // 停止所有文件夹监听
      this.watchedFolders.clear();
      console.log('FileWatcher: 已停止所有文件夹跟踪');
    }
  }

  // 停止所有监听
  stopAllWatching() {
    this.watchedFolders.clear();
    this.stopFileWatching();
    console.log('FileWatcher: 已停止所有监听（文件夹+文件）');
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

  // 按需检查并更新文件树（遍历所有监听的文件夹）
  checkAndUpdateFileTree() {
    if (this.watchedFolders.size === 0) return false;

    let hasAnyChanges = false;

    for (const [folderPath, folderInfo] of this.watchedFolders.entries()) {
      // 重新验证路径是否仍然存在
      if (!fs.existsSync(folderPath)) {
        this.stopWatching(folderPath);
        continue;
      }

      try {
        const fileTree = this.fileManager.buildFileTreeWithRoot(folderPath);

        // 计算文件树哈希以检测实际变化
        const currentHash = this.calculateFileTreeHash(fileTree);

        // 只有当文件树真正发生变化时才发送更新
        if (currentHash !== folderInfo.lastFileTreeHash) {
          folderInfo.lastFileTreeHash = currentHash;

          const mainWindow = this.windowManager.getWindow();
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('file-tree-updated', {
              folderPath: folderPath,
              fileTree
            });
          }

          console.log(`FileWatcher: 文件夹有变化: ${folderPath}`);
          hasAnyChanges = true;
        }
      } catch (error) {
        console.error(`Error checking file tree for ${folderPath}:`, error);
        // 如果更新失败，可能是路径问题，停止监听
        if (error.code === 'ENOENT' || error.code === 'EACCES') {
          this.stopWatching(folderPath);
        }
      }
    }

    return hasAnyChanges;
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
    return this.watchedFolders.size > 0;
  }

  // 获取所有监听的文件夹路径
  getWatchedFolders() {
    return Array.from(this.watchedFolders.keys());
  }

  // 检查特定文件夹是否在监听中
  isWatchingFolder(folderPath) {
    return this.watchedFolders.has(folderPath);
  }

  getWatchedFile() {
    return this.watchedFile;
  }

  // 统一的刷新方法：检查文件和文件夹变化
  checkAndRefreshAll() {
    let hasChanges = false;

    // 检查所有文件夹变化
    const folderChanged = this.checkAndUpdateFileTree();
    if (folderChanged) {
      hasChanges = true;
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