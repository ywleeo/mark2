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
      const { entryName, entryFullPath, fileName } = data;
      
      // 方法1：尝试通过进程的工作目录 + 相对路径
      const cwd = process.cwd();
      let possiblePaths = [
        path.join(cwd, entryName),
        path.join(cwd, entryFullPath),
        path.join(cwd, entryFullPath.replace(/^\//, '')),
      ];
      
      // 方法2：尝试通过用户目录相关路径
      const homeDir = os.homedir();
      const desktopDir = path.join(homeDir, 'Desktop');
      const documentsDir = path.join(homeDir, 'Documents');
      const downloadsDir = path.join(homeDir, 'Downloads');
      
      possiblePaths.push(
        path.join(homeDir, entryName),
        path.join(desktopDir, entryName),
        path.join(documentsDir, entryName),
        path.join(downloadsDir, entryName)
      );
      
      // 方法3：搜索常见的项目目录
      const commonProjectPaths = [
        path.join(homeDir, 'Code'),
        path.join(homeDir, 'Projects'),
        path.join(homeDir, 'Workspace')
      ];
      
      for (const basePath of commonProjectPaths) {
        if (fs.existsSync(basePath)) {
          const found = this.findFolderByName(basePath, entryName, 2);
          if (found.length > 0) {
            possiblePaths.push(...found);
          }
        }
      }
      
      // 检查哪个路径存在且是文件夹
      for (const possiblePath of possiblePaths) {
        if (fs.existsSync(possiblePath)) {
          const stats = fs.statSync(possiblePath);
          if (stats.isDirectory()) {
            const fileTree = this.buildFileTreeWithRoot(possiblePath);
            return {
              success: true,
              folderPath: possiblePath,
              fileTree
            };
          }
        }
      }
      
      return { success: false, error: '未找到匹配的文件夹路径' };
    } catch (error) {
      return { success: false, error: error.message };
    }
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
        }
      }
    } catch (error) {
      // 忽略权限错误等
    }
    
    return results;
  }
}

module.exports = FileManager;