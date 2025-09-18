class UIManager {
  constructor(eventManager) {
    this.eventManager = eventManager;
    this.currentTheme = 'light';
    this.sidebarVisible = false;
    this.sidebarEnabled = false; // 新增：sidebar 是否启用
    this.currentFilePath = null; // 新增：当前打开的文件路径
    this.setupUI();
  }

  setupUI() {
    this.loadTheme();
    this.setupSidebar();
    this.setupSidebarResizer();
    this.setupButtons();
    this.setupExternalLinks();
    this.loadSettings();
  }

  async loadTheme() {
    try {
      const { ipcRenderer } = require('electron');
      const settings = await ipcRenderer.invoke('get-theme-settings');
      this.currentTheme = settings.theme || 'light';
      this.applyTheme(this.currentTheme);
    } catch (error) {
      console.error('Error loading theme:', error);
      this.applyTheme('light');
    }
  }

  applyTheme(theme) {
    this.currentTheme = theme;
    
    // 更新CSS链接
    const themeCSS = document.getElementById('theme-css');
    if (themeCSS) {
      themeCSS.href = `styles/${theme}-theme.css`;
    }
    
    // 保存到localStorage
    localStorage.setItem('theme', theme);
    
    this.eventManager.emit('theme-changed', theme);
  }

  async switchTheme(theme) {
    try {
      const { ipcRenderer } = require('electron');
      await ipcRenderer.invoke('save-theme-settings', theme);
      this.applyTheme(theme);
    } catch (error) {
      console.error('Error saving theme:', error);
      // 即使保存失败也应用主题
      this.applyTheme(theme);
    }
  }

  toggleTheme() {
    const newTheme = this.currentTheme === 'light' ? 'dark' : 'light';
    this.switchTheme(newTheme);
  }

  setupSidebar() {
    const sidebar = document.getElementById('sidebar');
    
    if (sidebar) {
      // 默认隐藏并禁用 sidebar
      this.sidebarVisible = false;
      this.sidebarEnabled = false;
      this.updateSidebarVisibility();
    }
  }

  toggleSidebar() {
    // 只有在 sidebar 启用时才能切换
    if (!this.sidebarEnabled) {
      return;
    }
    
    this.sidebarVisible = !this.sidebarVisible;
    this.updateSidebarVisibility();
    localStorage.setItem('sidebarVisible', this.sidebarVisible.toString());
    this.eventManager.emit('sidebar-toggled', this.sidebarVisible);
  }

  updateSidebarVisibility() {
    const sidebar = document.getElementById('sidebar');
    const tabBar = document.getElementById('tabBar');
    
    if (sidebar) {
      if (this.sidebarVisible) {
        sidebar.classList.remove('hidden');
        // 恢复保存的宽度，或使用默认宽度
        this.loadSidebarWidth();
        
        // 显示 sidebar 时通知TitleBarDragManager更新热区
        // TitleBarDragManager会自动处理尺寸监控和稳定性检查
      } else {
        sidebar.classList.add('hidden');
        // 隐藏时清除内联样式，让 CSS 类生效
        sidebar.style.width = '';
        
        // 热区清理现在由TitleBarDragManager处理
      }
    }
  }

  setupButtons() {
    // 设置编辑按钮
    const editButton = document.getElementById('edit-button');
    if (editButton) {
      editButton.addEventListener('click', () => {
        this.eventManager.emit('toggle-edit-mode');
      });
    }

    // 设置保存按钮
    const saveButton = document.getElementById('save-button');
    if (saveButton) {
      saveButton.addEventListener('click', () => {
        this.eventManager.emit('save-file');
      });
    }

    // 设置编辑器保存按钮
    const saveBtn = document.getElementById('saveBtn');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        this.eventManager.emit('save-file');
      });
    }



    // 设置关闭设置按钮
    const closeSettingsBtn = document.getElementById('closeSettingsBtn');
    if (closeSettingsBtn) {
      closeSettingsBtn.addEventListener('click', () => {
        this.closeSettings();
      });
    }

    // 设置取消设置按钮
    const cancelSettingsBtn = document.getElementById('cancelSettingsBtn');
    if (cancelSettingsBtn) {
      cancelSettingsBtn.addEventListener('click', () => {
        this.closeSettings();
      });
    }

    // 设置应用设置按钮
    const applySettingsBtn = document.getElementById('applySettingsBtn');
    if (applySettingsBtn) {
      applySettingsBtn.addEventListener('click', () => {
        this.applySettings();
      });
    }
  }

  updateStyle() {
    const settings = this.getStyleSettings();
    
    const preview = document.getElementById('markdownContent');
    const editor = document.getElementById('editorContent');
    const editorTextarea = document.getElementById('editorTextarea');
    
    // 应用到预览区域
    if (preview) {
      preview.style.fontSize = settings.fontSize + 'px';
      preview.style.lineHeight = settings.lineHeight;
      preview.style.letterSpacing = settings.letterSpacing + 'px';
      preview.style.fontFamily = settings.fontFamily;
    }
    
    // 应用到编辑器容器
    if (editor) {
      editor.style.fontSize = settings.fontSize + 'px';
      editor.style.lineHeight = settings.lineHeight;
      editor.style.letterSpacing = settings.letterSpacing + 'px';
      editor.style.fontFamily = settings.fontFamily;
    }
    
    // 应用到编辑器文本区域
    if (editorTextarea) {
      editorTextarea.style.fontSize = settings.fontSize + 'px';
      editorTextarea.style.lineHeight = settings.lineHeight;
      editorTextarea.style.letterSpacing = settings.letterSpacing + 'px';
      editorTextarea.style.fontFamily = settings.fontFamily;
    }
  }

  getStyleSettings() {
    // 迁移旧版本的字体设置到新的混合字体
    this.migrateFontSettings();
    
    return {
      fontSize: parseInt(localStorage.getItem('fontSize')) || 16,
      lineHeight: localStorage.getItem('lineHeight') || '1.6',
      letterSpacing: parseFloat(localStorage.getItem('letterSpacing')) || 0, // 使用 parseFloat 支持小数
      fontFamily: localStorage.getItem('fontFamily') || '\'SF Mono\', Monaco, \'Cascadia Code\', \'Roboto Mono\', Consolas, \'Courier New\', monospace, -apple-system, BlinkMacSystemFont, \'Segoe UI\', \'Microsoft YaHei\', \'SimHei\', sans-serif'
    };
  }

  migrateFontSettings() {
    const currentVersion = '1.3.7-mixed-font';
    const savedVersion = localStorage.getItem('fontMigrationVersion');
    
    // 如果是首次运行或版本更新，重置字体设置为新的混合字体
    if (!savedVersion || savedVersion !== currentVersion) {
      const oldFontFamily = localStorage.getItem('fontFamily');
      
      // 如果存在旧的字体设置且不是混合字体，清除它
      if (oldFontFamily && !oldFontFamily.includes('SF Mono')) {
        localStorage.removeItem('fontFamily');
        console.log('[UIManager] 已迁移到新的混合字体设置');
      }
      
      // 标记已完成迁移
      localStorage.setItem('fontMigrationVersion', currentVersion);
    }
  }

  saveSettings(settings) {
    Object.keys(settings).forEach(key => {
      localStorage.setItem(key, settings[key]);
    });
    this.updateStyle();
  }

  loadSettings() {
    this.updateStyle();
  }

  displayFileName(fileName) {
    const fileNameElement = document.getElementById('file-name');
    if (fileNameElement) {
      fileNameElement.textContent = fileName || '未命名文件';
    }
  }

  showMessage(message, type = 'info') {
    // 创建消息提示
    const messageElement = document.createElement('div');
    messageElement.className = `message ${type}`;
    messageElement.textContent = message;
    
    // 计算垂直位置，避免重叠
    const existingMessages = document.querySelectorAll('.message');
    let topOffset = 20;
    existingMessages.forEach(msg => {
      if (msg.offsetParent) { // 只计算可见的消息
        topOffset += msg.offsetHeight + 10;
      }
    });
    messageElement.style.top = topOffset + 'px';
    
    // 添加到页面
    document.body.appendChild(messageElement);
    
    // 显示动画
    requestAnimationFrame(() => {
      messageElement.classList.add('show');
    });
    
    // 自动隐藏
    setTimeout(() => {
      messageElement.classList.remove('show');
      // 监听过渡结束事件，而不是固定时间
      const handleTransitionEnd = () => {
        if (messageElement.parentNode) {
          messageElement.parentNode.removeChild(messageElement);
        }
        messageElement.removeEventListener('transitionend', handleTransitionEnd);
      };
      messageElement.addEventListener('transitionend', handleTransitionEnd);
      // 降级处理，万一transitionend不触发
      setTimeout(() => {
        handleTransitionEnd();
      }, 400);
    }, 3000);
  }

  clearMessage() {
    // 清除所有消息提示
    const messages = document.querySelectorAll('.message');
    messages.forEach(message => {
      message.classList.remove('show');
      // 立即移除元素
      if (message.parentNode) {
        message.parentNode.removeChild(message);
      }
    });
  }

  updateFileNameDisplay(filePath) {
    // 保存当前文件路径，用于链接解析
    this.currentFilePath = filePath;
    
    if (filePath) {
      const fileName = filePath.split('/').pop() || filePath.split('\\').pop();
      this.displayFileName(fileName);
    } else {
      this.displayFileName('');
    }
  }

  resetToInitialState() {
    // 重置文件名显示
    this.displayFileName('');
    
    // 清空预览内容
    const preview = document.getElementById('markdownContent');
    if (preview) {
      preview.innerHTML = '';
    }
    
    // 重置编辑器容器和textarea
    const editorContent = document.getElementById('editorContent');
    const editorTextarea = document.getElementById('editorTextarea');
    const contentArea = document.querySelector('.content-area');
    
    if (editorContent) {
      editorContent.style.display = 'none';
    }
    if (editorTextarea) {
      editorTextarea.value = '';
    }
    if (contentArea) {
      contentArea.style.display = 'block';
    }
    
    // 重置按钮状态
    const editButton = document.getElementById('edit-button');
    
    if (editButton) editButton.textContent = '编辑';
  }

  getCurrentTheme() {
    return this.currentTheme;
  }

  isSidebarVisible() {
    return this.sidebarVisible;
  }

  isSidebarEnabled() {
    return this.sidebarEnabled;
  }

  enableSidebar() {
    this.sidebarEnabled = true;
    // 启用时强制显示 sidebar（打开文件夹时应该自动显示）
    this.sidebarVisible = true;
    this.updateSidebarVisibility();
    this.eventManager.emit('sidebar-enabled', true);
    
    // 通知主进程更新菜单状态
    const { ipcRenderer } = require('electron');
    ipcRenderer.send('set-sidebar-enabled', true);
  }

  disableSidebar() {
    this.sidebarEnabled = false;
    this.sidebarVisible = false;
    this.updateSidebarVisibility();
    this.eventManager.emit('sidebar-enabled', false);
    
    // 清除内联样式，确保隐藏生效
    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
      sidebar.style.width = '';
    }
    
    // 通知主进程更新菜单状态
    const { ipcRenderer } = require('electron');
    ipcRenderer.send('set-sidebar-enabled', false);
  }

  showSettings() {
    const settingsModal = document.getElementById('settingsModal');
    if (settingsModal) {
      settingsModal.style.display = 'flex';
      
      // 恢复当前设置到表单
      const settings = this.getStyleSettings();
      const fontSizeSelect = document.getElementById('fontSizeSelect');
      const lineHeightSelect = document.getElementById('lineHeightSelect');
      const letterSpacingSelect = document.getElementById('letterSpacingSelect');
      const fontFamilySelect = document.getElementById('fontFamilySelect');
      
      if (fontSizeSelect) fontSizeSelect.value = settings.fontSize;
      if (lineHeightSelect) lineHeightSelect.value = settings.lineHeight;
      if (letterSpacingSelect) letterSpacingSelect.value = settings.letterSpacing;
      if (fontFamilySelect) fontFamilySelect.value = settings.fontFamily;
    }
  }

  closeSettings() {
    const settingsModal = document.getElementById('settingsModal');
    if (settingsModal) {
      settingsModal.style.display = 'none';
    }
  }

  applySettings() {
    // 获取设置值
    const fontSize = document.getElementById('fontSizeSelect')?.value || '16';
    const lineHeight = document.getElementById('lineHeightSelect')?.value || '1.6';
    const letterSpacing = document.getElementById('letterSpacingSelect')?.value || '0';
    const fontFamily = document.getElementById('fontFamilySelect')?.value || '-apple-system, BlinkMacSystemFont, \'Segoe UI\', \'Roboto\', sans-serif';

    // 保存设置
    const settings = {
      fontSize,
      lineHeight,
      letterSpacing,
      fontFamily
    };
    
    this.saveSettings(settings);
    
    // 关闭设置弹窗
    this.closeSettings();
    
    // 显示成功消息
    this.showMessage('设置已保存', 'success');
  }

  adjustFontSize(direction) {
    const settings = this.getStyleSettings();
    let currentSize = parseInt(settings.fontSize);

    // 调整字体大小，每次改变2px，范围8-32px
    const newSize = Math.min(32, Math.max(8, currentSize + (direction * 2)));

    if (newSize === currentSize) {
      // 已达到最大/最小值，显示提示
      const message = direction > 0 ? '字体已达到最大值 32px' : '字体已达到最小值 8px';
      this.showMessage(message, 'info');
      return;
    }

    // 保存新的字体大小
    localStorage.setItem('fontSize', newSize.toString());

    // 立即应用新的字体大小
    this.updateStyle();

    // 显示当前字体大小
    this.showMessage(`字体大小: ${newSize}px`, 'success');
  }

  setupSidebarResizer() {
    const resizer = document.getElementById('sidebarResizer');
    const sidebar = document.getElementById('sidebar');
    
    if (!resizer || !sidebar) {
      return;
    }

    let isResizing = false;
    let startX = 0;
    let startWidth = 0;
    const minWidth = 200;
    const maxWidth = 500;

    // 注意：不在这里加载宽度，而是在 updateSidebarVisibility 中按需加载

    const handleMouseDown = (e) => {
      isResizing = true;
      startX = e.clientX;
      startWidth = sidebar.offsetWidth;
      
      resizer.classList.add('dragging');
      sidebar.classList.add('resizing');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      
      // 阻止文本选择
      e.preventDefault();
    };

    const handleMouseMove = (e) => {
      if (!isResizing) return;
      
      const deltaX = e.clientX - startX;
      const newWidth = Math.max(minWidth, Math.min(maxWidth, startWidth + deltaX));
      
      sidebar.style.width = newWidth + 'px';
    };

    const handleMouseUp = () => {
      if (!isResizing) return;
      
      isResizing = false;
      resizer.classList.remove('dragging');
      sidebar.classList.remove('resizing');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      
      // 保存新宽度
      this.saveSidebarWidth(sidebar.offsetWidth);
      
      // 热区更新现在由TitleBarDragManager处理
    };

    // 绑定事件
    resizer.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    // 清理函数（如果需要）
    this.cleanupSidebarResizer = () => {
      resizer.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }

  saveSidebarWidth(width) {
    localStorage.setItem('sidebarWidth', width.toString());
  }

  loadSidebarWidth() {
    const savedWidth = localStorage.getItem('sidebarWidth');
    const sidebar = document.getElementById('sidebar');
    
    // 恢复sidebar宽度（无论是否可见都要恢复，以便显示时使用正确宽度）
    if (savedWidth && sidebar) {
      const width = parseInt(savedWidth);
      if (width >= 200 && width <= 500) {
        sidebar.style.width = width + 'px';
        // 热区更新现在由TitleBarDragManager处理
      }
    } else {
      // console.log('loadSidebarWidth 跳过:', {savedWidth, hasSidebar: !!sidebar});
    }
  }

  // 设置外链在系统浏览器中打开，内部链接在应用内打开
  setupExternalLinks() {
    // 使用事件委托监听所有链接点击
    document.addEventListener('click', async (event) => {
      const target = event.target;

      // 检查是否为链接元素
      if (target.tagName === 'A') {
        // 处理外部链接
        if (target.classList.contains('external-link')) {
          // 不调用 preventDefault()，让链接正常导航，主进程的 will-navigate 会处理
        } else {
          // 处理内部链接（相对路径）和未正确标记的外部链接
          const href = target.getAttribute('href');

          // 如果是外部链接但没有external-link类，让它正常导航
          if (href && href.startsWith('http')) {
            // 不调用 preventDefault()，让主进程处理
            return;
          }

          // 处理内部链接
          event.preventDefault(); // 阻止内部链接的默认行为
          if (href && !href.startsWith('http')) {
            // 使用健壮的异步处理器
            this.handleInternalLinkSafely(href);
          }
        }
      }
    });
  }
  
  // 获取当前活动文件的路径
  getCurrentFilePath() {
    // 从活动Tab获取当前文件路径，更可靠
    if (this.tabManager) {
      const activeTab = this.tabManager.getActiveTab();
      if (activeTab && activeTab.filePath) {
        console.log(`[内部链接] 从活动Tab获取当前文件路径: ${activeTab.filePath}`);
        return activeTab.filePath;
      }
    }

    // 降级：使用保存的当前文件路径
    console.log(`[内部链接] 降级使用保存的文件路径: ${this.currentFilePath}`);
    return this.currentFilePath;
  }

  /**
   * 健壮的内部链接处理器
   * 设计原则：错误隔离、优雅降级、详细反馈
   */
  async handleInternalLinkSafely(href) {
    try {
      console.log(`[内部链接] 开始处理: ${href}`);

      // 第一步：状态检查和预验证
      const validationResult = this.validateInternalLinkContext(href);
      if (!validationResult.valid) {
        console.log(`[内部链接] 上下文验证失败: ${validationResult.message}`);
        this.showMessage(validationResult.message, 'error');
        console.log(`[内部链接] 处理完成（上下文验证失败）: ${href}`);
        return;
      }

      // 第二步：路径解析和文件检查
      const pathResult = await this.resolveAndValidatePath(href, validationResult.currentFilePath);
      if (!pathResult.valid) {
        console.log(`[内部链接] 路径验证失败: ${pathResult.message}`);
        this.showMessage(pathResult.message, 'error');
        console.log(`[内部链接] 处理完成（路径验证失败）: ${href}`);
        return;
      }

      // 第三步：尝试打开文件（带重试机制）
      const fileResult = await this.openFileWithRetry(pathResult.targetPath, href);
      if (!fileResult.success) {
        console.log(`[内部链接] 文件打开失败: ${fileResult.message}`);
        this.showMessage(fileResult.message, 'error');
        console.log(`[内部链接] 处理完成（文件打开失败）: ${href}`);
        return;
      }

      // 第四步：更新 UI 状态（隔离错误）
      await this.updateUIForInternalLink(fileResult.data, pathResult.targetPath);

      console.log(`[内部链接] 处理完成: ${href}`);

    } catch (error) {
      // 最顶层错误捕获，确保任何异常都不会影响其他链接
      console.error('[内部链接] 未预期的错误:', error);
      this.showMessage(`链接处理出现异常: ${href}`, 'error');
    }
  }

  /**
   * 验证内部链接处理的上下文环境
   */
  validateInternalLinkContext(href) {
    if (!href) {
      return { valid: false, message: '链接路径为空' };
    }

    const currentFilePath = this.getCurrentFilePath();
    if (!currentFilePath) {
      return { valid: false, message: '无法确定当前文件路径，请确保已打开有效文件' };
    }

    if (!this.tabManager) {
      return { valid: false, message: '标签管理器不可用' };
    }

    const activeTab = this.tabManager.getActiveTab();
    if (!activeTab) {
      return { valid: false, message: '没有活动的标签页' };
    }

    return { valid: true, currentFilePath, activeTab };
  }

  /**
   * 解析和验证文件路径
   */
  async resolveAndValidatePath(href, currentFilePath) {
    console.log(`[内部链接] 解析路径: ${href} (基于: ${currentFilePath})`);

    try {
      const path = require('path');

      // 解析相对路径为绝对路径
      const currentDir = path.dirname(currentFilePath);
      const targetPath = path.resolve(currentDir, href);
      console.log(`[内部链接] 目标路径: ${targetPath}`);

      // 检查是否为支持的Markdown文件
      const supportedExtensions = ['.md', '.markdown'];
      const ext = path.extname(targetPath).toLowerCase();
      if (!supportedExtensions.includes(ext)) {
        console.log(`[内部链接] 不支持的文件类型: ${ext}`);
        return {
          valid: false,
          message: `不支持的文件类型: ${ext}\n仅支持 .md 和 .markdown 文件`
        };
      }

      // 使用IPC检查文件是否存在（更可靠）
      try {
        console.log(`[内部链接] 检查文件存在性: ${targetPath}`);
        const { ipcRenderer } = require('electron');
        const exists = await ipcRenderer.invoke('check-file-exists', targetPath);

        if (!exists) {
          console.log(`[内部链接] 文件不存在: ${href} -> ${targetPath}`);
          return {
            valid: false,
            message: `文件不存在: ${href}\n路径: ${targetPath}\n建议检查文件路径是否正确`
          };
        }

        console.log(`[内部链接] 文件存在性检查通过: ${targetPath}`);
        return { valid: true, targetPath };

      } catch (ipcError) {
        console.error(`[内部链接] IPC文件检查失败:`, ipcError);
        // IPC失败时的降级处理
        return {
          valid: false,
          message: `文件检查失败: ${ipcError.message}\n可能是IPC通信问题`
        };
      }

    } catch (error) {
      console.error(`[内部链接] 路径解析失败:`, error);
      return {
        valid: false,
        message: `路径解析失败: ${error.message}`
      };
    }
  }

  /**
   * 带重试机制的文件打开
   */
  async openFileWithRetry(targetPath, originalHref, maxRetries = 2) {
    const { ipcRenderer } = require('electron');

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[内部链接] 尝试打开文件 (第 ${attempt} 次): ${targetPath}`);

        // 如果是重试，先进行 IPC 健康检查
        if (attempt > 1) {
          await this.checkIPCHealth(targetPath);
        }

        const result = await ipcRenderer.invoke('open-file-dialog', targetPath);

        if (result && result.content !== null) {
          console.log(`[内部链接] 文件读取成功: ${result.filePath}`);
          return { success: true, data: result };
        } else {
          throw new Error('文件内容为空或读取失败');
        }

      } catch (error) {
        console.warn(`[内部链接] 第 ${attempt} 次尝试失败:`, error);

        if (attempt === maxRetries) {
          return {
            success: false,
            message: `无法打开文件: ${originalHref}\n${error.message}\n\n建议操作:\n1. 检查文件是否存在\n2. 确认文件权限\n3. 重新启动应用`
          };
        }

        // 等待后重试
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    return { success: false, message: '文件打开重试失败' };
  }

  /**
   * IPC 健康检查
   */
  async checkIPCHealth(testPath) {
    const { ipcRenderer } = require('electron');
    try {
      // 使用轻量级的文件存在性检查测试 IPC 连接
      await Promise.race([
        ipcRenderer.invoke('check-file-exists', testPath),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('IPC 健康检查超时')), 2000)
        )
      ]);
      console.log('[内部链接] IPC 连接正常');
    } catch (error) {
      console.warn('[内部链接] IPC 连接异常，继续尝试:', error.message);
      // 不抛出错误，让文件操作继续尝试
    }
  }

  /**
   * 更新 UI 状态（错误隔离）
   */
  async updateUIForInternalLink(fileData, targetPath) {
    try {
      if (!this.tabManager) return;

      const activeTab = this.tabManager.getActiveTab();
      if (!activeTab) return;

      // 保存旧的文件路径
      const oldFilePath = activeTab.filePath;

      // 更新 Tab 的文件信息
      await activeTab.updateFileInfo(fileData.filePath, fileData.content, activeTab.belongsTo);

      // 安全地更新文件树管理器
      this.updateFileTreeManagerSafely(activeTab, oldFilePath, fileData);

      // 安全地更新 UI 显示
      this.updateUIDisplaySafely(activeTab, fileData);

    } catch (error) {
      console.warn('[内部链接] UI 更新部分失败，但文件已成功打开:', error);
      // 不阻止整个操作，因为文件已经成功打开
    }
  }

  /**
   * 安全地更新文件树管理器
   */
  updateFileTreeManagerSafely(activeTab, oldFilePath, fileData) {
    try {
      if (this.tabManager.fileTreeManager && activeTab.belongsTo === 'file') {
        if (oldFilePath && oldFilePath !== fileData.filePath) {
          this.tabManager.fileTreeManager.removeFile(oldFilePath);
          this.tabManager.fileTreeManager.addFile(fileData.filePath, fileData.content);
        } else if (!oldFilePath) {
          this.tabManager.fileTreeManager.addFile(fileData.filePath, fileData.content);
        }
      }
    } catch (error) {
      console.warn('[内部链接] 文件树更新失败:', error);
    }
  }

  /**
   * 安全地更新 UI 显示
   */
  updateUIDisplaySafely(activeTab, fileData) {
    try {
      if (this.tabManager.updateTabTitle) {
        this.tabManager.updateTabTitle(activeTab.id, activeTab.title);
      }

      if (this.updateFileNameDisplay) {
        this.updateFileNameDisplay(fileData.filePath);
      }
    } catch (error) {
      console.warn('[内部链接] UI 显示更新失败:', error);
    }
  }

  // 热区清理已移至TitleBarDragManager

  // 尺寸监控已移至TitleBarDragManager
}

module.exports = UIManager;