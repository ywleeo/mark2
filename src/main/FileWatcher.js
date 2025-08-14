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
    this.lastFileTreeHash = null; // 上次文件树的哈希值，用于检测实际变化
    this.pendingEvents = new Set(); // 缓存待处理的事件
    this.debounceDelay = 200; // 防抖延迟时间
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
          console.log(`FileWatcher: 检测到事件 ${eventType} 文件: ${filename}`);
          
          // 检查是否需要更新文件树
          const needsTreeUpdate = this.shouldUpdateFileTree(eventType, filename);
          
          if (needsTreeUpdate) {
            // 将事件信息添加到待处理队列
            this.pendingEvents.add(`${eventType}:${filename}`);
            
            // 使用改进的防抖机制
            this.scheduleFileTreeUpdate();
          }
        }
      });
      
      // 添加错误处理
      this.watcher.on('error', (error) => {
        console.error('FileWatcher error:', error);
        this.handleWatcherError(error, 'folder');
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

    // 清理待处理事件
    this.pendingEvents.clear();
    
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
    // 确保先停止之前的文件监听，并通知渲染进程
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
        this.handleWatcherError(error, 'file');
      });

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

  // 停止监听单个文件
  stopFileWatching() {
    if (this.fileWatcher) {
      const previousWatchedFile = this.watchedFile;
      
      try {
        this.fileWatcher.close();
      } catch (error) {
        console.error('Error closing file watcher:', error);
      }
      
      this.fileWatcher = null;
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
      }
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
        console.log('文件树已更新，哈希值:', currentHash);
      } else {
        console.log('文件树无实际变化，跳过更新');
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

  // 判断是否需要更新文件树
  shouldUpdateFileTree(eventType, filename) {
    // 构建文件完整路径
    const fullPath = path.join(this.watchedPath, filename);
    
    // rename事件通常表示文件/文件夹的创建、删除、重命名
    if (eventType === 'rename') {
      return this.isRelevantFileChange(fullPath, filename);
    }
    
    // change事件表示文件内容修改，通常不需要更新文件树
    // 但如果是新文件刚创建完成，可能以change事件形式出现
    if (eventType === 'change') {
      try {
        // 检查文件是否存在且是Markdown文件
        if (fs.existsSync(fullPath)) {
          const stats = fs.statSync(fullPath);
          if (stats.isFile() && (filename.endsWith('.md') || filename.endsWith('.markdown'))) {
            // 如果是之前不存在的Markdown文件，则需要更新文件树
            return this.isNewMarkdownFile(fullPath);
          }
        }
      } catch (error) {
        // 如果检查失败，保险起见更新文件树
        console.warn('检查文件时出错，将更新文件树:', error.message);
        return true;
      }
    }
    
    return false;
  }

  // 检查文件变化是否与当前显示相关
  isRelevantFileChange(fullPath, filename) {
    // 如果是Markdown文件，总是相关的
    if (filename.endsWith('.md') || filename.endsWith('.markdown')) {
      return true;
    }
    
    // 如果是文件夹变化，检查是否在可见范围内
    try {
      if (fs.existsSync(fullPath)) {
        const stats = fs.statSync(fullPath);
        if (stats.isDirectory()) {
          // 检查这个文件夹是否在根目录的直接子级
          // 或者是否在任何已展开路径的合理深度内
          const relativePath = path.relative(this.watchedPath, fullPath);
          const pathDepth = relativePath.split(path.sep).length;
          
          // 如果在根目录的前两层，认为是相关的
          if (pathDepth <= 2) {
            return true;
          }
        }
      } else {
        // 文件不存在（被删除），这种情况下我们无法判断类型
        // 但删除操作通常是重要的，应该更新文件树
        return true;
      }
    } catch (error) {
      // 检查失败时保险起见返回true
      return true;
    }
    
    return false;
  }

  // 检查是否是新的Markdown文件
  isNewMarkdownFile(filePath) {
    // 这里可以维护一个已知文件列表来判断
    // 为简化实现，当前总是返回false（除非后续需要更精确的判断）
    // 实际使用中可以通过比较文件树快照来判断
    return false;
  }

  // 改进的防抖机制：调度文件树更新
  scheduleFileTreeUpdate() {
    // 清除之前的定时器
    if (this.updateTimeout) {
      clearTimeout(this.updateTimeout);
    }

    // 设置新的定时器
    this.updateTimeout = setTimeout(() => {
      // 执行更新前记录当前的待处理事件数量
      const eventCount = this.pendingEvents.size;
      console.log(`FileWatcher: 执行文件树更新，处理了 ${eventCount} 个事件`);
      
      // 清空待处理事件列表
      this.pendingEvents.clear();
      
      // 执行实际的文件树更新
      this.updateFileTree();
      
      // 重置定时器
      this.updateTimeout = null;
    }, this.debounceDelay);
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

  // 统一的错误处理机制
  handleWatcherError(error, watcherType) {
    const errorInfo = {
      type: watcherType,
      code: error.code,
      message: error.message,
      path: watcherType === 'folder' ? this.watchedPath : this.watchedFile,
      timestamp: new Date().toISOString()
    };

    console.error(`${watcherType} watcher 错误:`, errorInfo);

    // 根据错误类型决定处理策略
    const shouldRestart = this.shouldRestartWatcher(error);
    
    if (shouldRestart) {
      this.attemptRestart(watcherType, errorInfo);
    } else {
      this.stopWatcherAndNotify(watcherType, errorInfo);
    }
  }

  // 判断是否应该尝试重启监听器
  shouldRestartWatcher(error) {
    // 临时性错误可以尝试重启
    const recoverableErrors = ['EMFILE', 'ENFILE', 'EAGAIN', 'EBUSY'];
    return recoverableErrors.includes(error.code);
  }

  // 尝试重启监听器
  attemptRestart(watcherType, errorInfo) {
    // 限制重启次数，避免无限重试
    if (!this.restartAttempts) {
      this.restartAttempts = new Map();
    }

    const key = `${watcherType}:${errorInfo.path}`;
    const attempts = this.restartAttempts.get(key) || 0;

    if (attempts < 3) {
      this.restartAttempts.set(key, attempts + 1);
      
      console.log(`尝试重启 ${watcherType} watcher (第${attempts + 1}次)`);
      
      // 延迟重启，给系统一些恢复时间
      setTimeout(() => {
        if (watcherType === 'folder' && errorInfo.path) {
          this.startWatching(errorInfo.path);
        } else if (watcherType === 'file' && errorInfo.path) {
          this.startFileWatching(errorInfo.path);
        }
      }, 1000 * (attempts + 1)); // 递增延迟
    } else {
      console.error(`${watcherType} watcher 重启失败次数过多，停止监听`);
      this.stopWatcherAndNotify(watcherType, errorInfo);
    }
  }

  // 停止监听器并通知用户
  stopWatcherAndNotify(watcherType, errorInfo) {
    if (watcherType === 'folder') {
      this.stopWatching();
    } else {
      this.stopFileWatching();
    }

    // 通知渲染进程监听器出错
    const mainWindow = this.windowManager.getWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('watcher-error', {
        type: watcherType,
        error: errorInfo,
        userMessage: this.getUserFriendlyErrorMessage(errorInfo)
      });
    }
  }

  // 生成用户友好的错误消息
  getUserFriendlyErrorMessage(errorInfo) {
    switch (errorInfo.code) {
      case 'ENOENT':
        return `文件或文件夹已被删除: ${errorInfo.path}`;
      case 'EACCES':
        return `没有权限访问: ${errorInfo.path}`;
      case 'EMFILE':
      case 'ENFILE':
        return '系统文件句柄不足，请重启应用程序';
      case 'ENOSPC':
        return '磁盘空间不足';
      case 'EBUSY':
        return `文件正在被其他程序使用: ${errorInfo.path}`;
      default:
        return `监听器出现错误: ${errorInfo.message}`;
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