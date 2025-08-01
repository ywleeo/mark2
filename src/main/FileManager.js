const { dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');

class FileManager {
  constructor(windowManager) {
    this.windowManager = windowManager;
  }

  async openFileDialog() {
    const mainWindow = this.windowManager.getWindow();
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [
        { name: 'Markdown Files', extensions: ['md', 'markdown'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });

    if (!result.canceled && result.filePaths.length > 0) {
      const filePath = result.filePaths[0];
      return await this.readFile(filePath);
    }
    return null;
  }

  async openFolderDialog() {
    const mainWindow = this.windowManager.getWindow();
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory']
    });

    if (!result.canceled && result.filePaths.length > 0) {
      const folderPath = result.filePaths[0];
      try {
        const fileTree = this.buildFileTreeWithRoot(folderPath);
        return { folderPath, fileTree };
      } catch (error) {
        throw new Error('无法读取文件夹');
      }
    }
    return null;
  }

  async readFile(filePath) {
    try {
      const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(filePath);
      const content = fs.readFileSync(absolutePath, 'utf-8');
      return { content, filePath: absolutePath };
    } catch (error) {
      console.error('Error reading file:', error);
      throw new Error('无法读取文件');
    }
  }

  async saveFile(filePath, content) {
    try {
      if (!filePath) {
        throw new Error('文件路径为空');
      }

      if (!fs.existsSync(filePath)) {
        throw new Error('文件不存在: ' + filePath);
      }

      // 检查文件权限
      try {
        fs.accessSync(filePath, fs.constants.W_OK);
      } catch (permError) {
        throw new Error('没有写入权限: ' + filePath);
      }

      // 写入文件
      fs.writeFileSync(filePath, content, 'utf-8');

      // 验证写入是否成功
      const savedContent = fs.readFileSync(filePath, 'utf-8');
      if (savedContent !== content) {
        throw new Error('文件保存验证失败：写入内容与预期不符');
      }

      return { success: true };
    } catch (error) {
      console.error('保存文件时发生错误:', error);
      throw new Error('无法保存文件: ' + error.message);
    }
  }

  buildFileTreeWithRoot(dirPath) {
    // 创建根节点
    const folderName = path.basename(dirPath);
    const rootNode = {
      name: folderName,
      path: dirPath,
      type: 'folder',
      isRoot: true,
      children: this.buildFileTree(dirPath)
    };
    
    return [rootNode];
  }

  buildFileTree(dirPath) {
    const items = [];

    try {
      const files = fs.readdirSync(dirPath);

      for (const file of files) {
        // 跳过隐藏文件
        if (file.startsWith('.')) continue;

        const fullPath = path.join(dirPath, file);
        const stats = fs.statSync(fullPath);

        if (stats.isDirectory()) {
          items.push({
            name: file,
            path: fullPath,
            type: 'folder',
            children: this.buildFileTree(fullPath)
          });
        } else if (stats.isFile() && (file.endsWith('.md') || file.endsWith('.markdown'))) {
          items.push({
            name: file,
            path: fullPath,
            type: 'file'
          });
        }
      }
    } catch (error) {
      console.error('Error reading directory:', error);
    }

    // 排序：文件夹在前，文件在后，按字母顺序
    return items.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'folder' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
  }

  async handleDropFile(filePath) {
    try {
      if (!filePath || filePath.trim() === '') {
        return { success: false, error: '文件路径为空' };
      }

      if (!fs.existsSync(filePath)) {
        return { success: false, error: '文件不存在: ' + filePath };
      }

      const stats = fs.statSync(filePath);

      if (stats.isDirectory()) {
        const fileTree = this.buildFileTreeWithRoot(filePath);
        return {
          success: true,
          type: 'folder',
          folderPath: filePath,
          fileTree
        };
      } else {
        // 检查是否是Markdown文件
        if (!filePath.endsWith('.md') && !filePath.endsWith('.markdown')) {
          return { success: false, error: '只支持Markdown文件 (.md, .markdown)' };
        }
        
        const content = fs.readFileSync(filePath, 'utf-8');
        const fileName = path.basename(filePath);
        return {
          success: true,
          type: 'file',
          content,
          filePath,
          fileName
        };
      }
    } catch (error) {
      console.error('Error handling dropped file:', error);
      return { success: false, error: '处理文件时发生错误：' + error.message };
    }
  }

  async resolveDroppedFolder(data) {
    try {
      const { entryName, entryFullPath } = data;
      console.log('拖拽数据:', { entryName, entryFullPath });
      
      // 基于路径信息智能重建完整路径
      const homeDir = os.homedir();
      const possiblePaths = [];
      
      if (entryFullPath) {
        const cleanPath = entryFullPath.replace(/^\/+/, '');
        console.log('清理后的路径:', cleanPath);
        
        // 策略1: 从当前工作目录开始递归查找匹配的路径结构
        const found = this.findMatchingPath(process.cwd(), cleanPath);
        if (found) {
          console.log('找到匹配路径:', found);
          possiblePaths.push(found);
        }
        
        // 策略2: 在用户常用目录中查找
        const commonDirs = [
          path.join(homeDir, 'Desktop'),
          path.join(homeDir, 'Documents'), 
          path.join(homeDir, 'Code')
        ];
        
        for (const baseDir of commonDirs) {
          if (fs.existsSync(baseDir)) {
            const found = this.findMatchingPath(baseDir, cleanPath);
            if (found) {
              possiblePaths.push(found);
            }
          }
        }
      }
      
      // 检查找到的路径
      for (const fullPath of possiblePaths) {
        if (fs.existsSync(fullPath)) {
          const stats = fs.statSync(fullPath);
          
          if (stats.isDirectory()) {
            const fileTree = this.buildFileTreeWithRoot(fullPath);
            return {
              success: true,
              folderPath: fullPath,
              fileTree
            };
          } else if (stats.isFile() && (fullPath.endsWith('.md') || fullPath.endsWith('.markdown'))) {
            const content = fs.readFileSync(fullPath, 'utf-8');
            return {
              success: true,
              filePath: fullPath,
              content,
              fileName: path.basename(fullPath)
            };
          }
        }
      }
      
      return { 
        success: false, 
        error: `未找到文件或文件夹: ${entryName}` 
      };
      
    } catch (error) {
      console.error('resolveDroppedFolder错误:', error);
      return { success: false, error: error.message };
    }
  }

  // 在指定基础目录中查找匹配路径结构的方法
  findMatchingPath(baseDir, targetPath, maxDepth = 4) {
    const pathSegments = targetPath.split('/').filter(s => s.length > 0);
    if (pathSegments.length === 0) return null;
    
    console.log(`在 ${baseDir} 中查找路径: ${pathSegments.join('/')}`);
    
    // 递归查找匹配的路径结构
    return this.searchPathRecursively(baseDir, pathSegments, 0, maxDepth);
  }

  // 递归搜索路径结构
  searchPathRecursively(currentDir, targetSegments, currentDepth, maxDepth) {
    if (currentDepth >= maxDepth || targetSegments.length === 0) {
      return null;
    }
    
    try {
      const items = fs.readdirSync(currentDir);
      const targetSegment = targetSegments[0];
      const remainingSegments = targetSegments.slice(1);
      
      // 直接匹配当前段
      if (items.includes(targetSegment)) {
        const fullPath = path.join(currentDir, targetSegment);
        
        if (remainingSegments.length === 0) {
          // 找到完整路径
          return fullPath;
        } else {
          // 继续在子目录中查找
          const stats = fs.statSync(fullPath);
          if (stats.isDirectory()) {
            return this.searchPathRecursively(fullPath, remainingSegments, currentDepth + 1, maxDepth);
          }
        }
      }
      
      // 如果直接匹配失败，在子目录中继续查找
      for (const item of items) {
        if (item.startsWith('.')) continue; // 跳过隐藏文件
        
        const itemPath = path.join(currentDir, item);
        try {
          const stats = fs.statSync(itemPath);
          if (stats.isDirectory()) {
            const result = this.searchPathRecursively(itemPath, targetSegments, currentDepth + 1, maxDepth);
            if (result) return result;
          }
        } catch (error) {
          // 跳过无法访问的目录
          continue;
        }
      }
    } catch (error) {
      // 忽略权限错误
    }
    
    return null;
  }


  findFolderByName(basePath, targetName, maxDepth = 2, currentDepth = 0) {
    const results = [];
    
    if (currentDepth >= maxDepth) {
      return results;
    }
    
    try {
      const items = fs.readdirSync(basePath);
      
      for (const item of items) {
        if (item.startsWith('.')) continue;
        
        const itemPath = path.join(basePath, item);
        const stats = fs.statSync(itemPath);
        
        if (stats.isDirectory()) {
          if (item === targetName) {
            results.push(itemPath);
          }
          
          if (currentDepth < maxDepth - 1) {
            const subResults = this.findFolderByName(itemPath, targetName, maxDepth, currentDepth + 1);
            results.push(...subResults);
          }
        } else if (stats.isFile()) {
          // 也搜索文件
          if (item === targetName) {
            results.push(itemPath);
          }
        }
      }
    } catch (error) {
      // 忽略权限错误等
    }
    
    return results;
  }
}

module.exports = FileManager;