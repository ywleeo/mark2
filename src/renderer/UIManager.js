class UIManager {
  constructor(eventManager) {
    this.eventManager = eventManager;
    this.currentTheme = 'light';
    this.sidebarVisible = false;
    this.sidebarEnabled = false; // 新增：sidebar 是否启用
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
        
        // 显示 sidebar 时监控尺寸变化直到稳定
        this.monitorSidebarSizeAndRedrawHotArea();
      } else {
        sidebar.classList.add('hidden');
        // 隐藏时清除内联样式，让 CSS 类生效
        sidebar.style.width = '';
        
        // 隐藏 sidebar 时销毁热区
        this.clearTitleBarDragAreas();
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
    return {
      fontSize: parseInt(localStorage.getItem('fontSize')) || 16,
      lineHeight: localStorage.getItem('lineHeight') || '1.6',
      letterSpacing: parseFloat(localStorage.getItem('letterSpacing')) || 0, // 使用 parseFloat 支持小数
      fontFamily: localStorage.getItem('fontFamily') || '-apple-system, BlinkMacSystemFont, \'Segoe UI\', \'Roboto\', sans-serif'
    };
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

  updateFileNameDisplay(filePath) {
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
      
      // 更新拖拽覆盖层大小
      if (window.appManager && typeof window.appManager.ensureTitleBarDragArea === 'function') {
        window.appManager.ensureTitleBarDragArea();
      }
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
        // 如果sidebar当前可见，使用监控机制重新绘制拖拽热区
        if (this.sidebarVisible && window.appManager && typeof window.appManager.ensureTitleBarDragArea === 'function') {
          // 不直接调用，而是使用监控机制确保尺寸稳定
          this.monitorSidebarSizeAndRedrawHotArea();
        }
      }
    } else {
      console.log('loadSidebarWidth 跳过:', {savedWidth, hasSidebar: !!sidebar});
    }
  }

  // 设置外链在系统浏览器中打开
  setupExternalLinks() {
    // 使用事件委托监听所有外链点击
    document.addEventListener('click', (event) => {
      const target = event.target;
      
      // 检查是否为外链
      if (target.tagName === 'A' && target.classList.contains('external-link')) {
        event.preventDefault(); // 阻止默认行为
        
        const url = target.getAttribute('data-external-url') || target.href;
        if (url) {
          // 使用 Electron 的 shell.openExternal 在系统浏览器中打开
          const { shell } = require('electron');
          shell.openExternal(url).catch(error => {
            console.error('Failed to open external link:', error);
            this.showMessage(`无法打开链接: ${url}`, 'error');
          });
        }
      }
    });
  }

  // 清理所有标题栏拖拽热区
  clearTitleBarDragAreas() {
    // 移除所有拖拽覆盖层
    const existingOverlay = document.getElementById('titlebar-drag-overlay');
    if (existingOverlay) {
      existingOverlay.remove();
    }
    const existingLeftOverlay = document.getElementById('titlebar-drag-overlay-left');
    if (existingLeftOverlay) {
      existingLeftOverlay.remove();
    }
    const existingRightOverlay = document.getElementById('titlebar-drag-overlay-right');
    if (existingRightOverlay) {
      existingRightOverlay.remove();
    }
  }

  // 监控 sidebar 尺寸变化并在稳定后重绘热区
  monitorSidebarSizeAndRedrawHotArea() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar || !window.appManager || typeof window.appManager.ensureTitleBarDragArea !== 'function') {
      return;
    }

    let lastWidth = 0;
    let stableCount = 0;
    const requiredStableFrames = 3; // 需要连续3帧尺寸不变才认为稳定
    const maxAttempts = 30; // 最多尝试30次，避免无限循环
    let attempts = 0;

    const checkSize = () => {
      attempts++;
      const currentWidth = sidebar.offsetWidth;
      
      console.log(`[UIManager] 监控 sidebar 尺寸: ${currentWidth}px (第${attempts}次检查)`);
      
      if (currentWidth === lastWidth && currentWidth >= 200) {
        stableCount++;
        if (stableCount >= requiredStableFrames) {
          // 尺寸已稳定，绘制热区
          console.log(`[UIManager] sidebar 尺寸稳定在 ${currentWidth}px，绘制热区`);
          window.appManager.ensureTitleBarDragArea();
          return;
        }
      } else {
        stableCount = 0; // 重置稳定计数
      }
      
      lastWidth = currentWidth;
      
      // 如果还没稳定且没有超过最大尝试次数，继续监控
      if (attempts < maxAttempts) {
        requestAnimationFrame(checkSize);
      } else {
        // 超过最大尝试次数，强制绘制热区
        console.log(`[UIManager] sidebar 尺寸监控超时，强制绘制热区 (当前宽度: ${currentWidth}px)`);
        window.appManager.ensureTitleBarDragArea();
      }
    };

    // 开始监控
    requestAnimationFrame(checkSize);
  }
}

module.exports = UIManager;