class TitleBarDragManager {
  constructor(eventManager) {
    this.eventManager = eventManager;
    this.overlays = new Map(); // 管理覆盖层DOM元素
    this.currentState = null;  // 缓存当前状态
    this.isMonitoring = false; // 防止重复监控
    this.monitoringAttempts = 0; // 监控尝试计数
    
    this.setupEventListeners();
  }

  setupEventListeners() {
    // 监听相关事件，被动响应状态变化
    this.eventManager.on('sidebar-toggled', (visible) => {
      this.updateDragRegions();
    });
    
    this.eventManager.on('sidebar-enabled', (enabled) => {
      this.updateDragRegions();
    });
    
    // 监听窗口大小变化
    window.addEventListener('resize', () => {
      this.updateDragRegions();
    });
    
    // 监听sidebar尺寸变化（通过ResizeObserver）
    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
      const resizeObserver = new ResizeObserver(() => {
        // 使用防抖方法避免频繁更新
        this.updateDragRegionsDebounced();
      });
      resizeObserver.observe(sidebar);
      
      // 保存观察器引用用于清理
      this.resizeObserver = resizeObserver;
    }
  }

  // 计算拖拽热区的配置
  calculateDragRegions() {
    const sidebar = document.getElementById('sidebar');
    const tabBar = document.getElementById('tabBar');
    
    // 获取当前状态
    const sidebarVisible = sidebar && 
                          !sidebar.classList.contains('hidden') && 
                          sidebar.offsetWidth > 0;
    const sidebarWidth = sidebarVisible ? sidebar.offsetWidth : 0;
    const hasActiveTabs = tabBar && 
                         tabBar.style.display !== 'none' && 
                         tabBar.querySelectorAll('.tab-item').length > 0;

    return {
      timestamp: Date.now(),
      sidebarVisible,
      sidebarWidth,
      hasActiveTabs,
      windowWidth: window.innerWidth,
      // 计算热区配置
      regions: {
        left: {
          show: sidebarVisible,
          x: 0,
          width: sidebarWidth,
          height: 'var(--titlebar-height)'
        },
        right: {
          show: !hasActiveTabs,
          x: sidebarWidth,
          width: Math.max(0, window.innerWidth - sidebarWidth),
          height: 'var(--titlebar-height)'
        }
      }
    };
  }

  // 检查状态是否发生了变化
  stateChanged(newState) {
    if (!this.currentState) return true;
    
    const current = this.currentState;
    return (
      current.sidebarVisible !== newState.sidebarVisible ||
      current.sidebarWidth !== newState.sidebarWidth ||
      current.hasActiveTabs !== newState.hasActiveTabs ||
      current.windowWidth !== newState.windowWidth
    );
  }

  // 创建或更新覆盖层
  createOrUpdateOverlay(type, config) {
    const id = `titlebar-drag-overlay-${type}`;
    let overlay = this.overlays.get(type);
    
    if (!config.show) {
      // 如果不需要显示，移除现有覆盖层
      if (overlay) {
        overlay.remove();
        this.overlays.delete(type);
      }
      return;
    }

    if (!overlay) {
      // 创建新的覆盖层
      overlay = document.createElement('div');
      overlay.id = id;
      document.body.appendChild(overlay);
      this.overlays.set(type, overlay);
    }

    // 更新覆盖层样式
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: ${config.x}px;
      width: ${config.width}px;
      height: ${config.height};
      z-index: 1002;
      -webkit-app-region: drag;
      pointer-events: auto;
      background: transparent;
    `;
  }

  // 渲染热区
  render(state) {
    const { regions } = state;
    
    // 更新左侧热区
    this.createOrUpdateOverlay('left', regions.left);
    
    // 更新右侧热区
    this.createOrUpdateOverlay('right', regions.right);

    // console.log(`[TitleBarDragManager] 热区已更新:`, {
    //   左侧热区: regions.left.show ? `${regions.left.width}px` : '无',
    //   右侧热区: regions.right.show ? `${regions.right.width}px` : '无'
    // });
  }

  // 主要的更新方法
  updateDragRegions() {
    const newState = this.calculateDragRegions();
    
    // 特殊处理：如果sidebar在动画中，需要监控尺寸稳定
    if (newState.sidebarVisible && newState.sidebarWidth < 200) {
      this.monitorSidebarSizeAndUpdate();
      return;
    }

    if (this.stateChanged(newState)) {
      this.render(newState);
      this.currentState = newState;
    }
  }

  // 添加防抖方法，避免频繁更新
  updateDragRegionsDebounced() {
    if (this.updateTimeout) {
      clearTimeout(this.updateTimeout);
    }
    this.updateTimeout = setTimeout(() => {
      this.updateDragRegions();
      this.updateTimeout = null;
    }, 50); // 50ms防抖
  }

  // 监控sidebar尺寸变化，等待稳定后更新热区
  monitorSidebarSizeAndUpdate() {
    if (this.isMonitoring) {
      return; // 防止重复监控
    }

    this.isMonitoring = true;
    this.monitoringAttempts = 0;
    
    let lastWidth = 0;
    let stableCount = 0;
    const requiredStableFrames = 3;
    const maxAttempts = 30;

    const checkSize = () => {
      this.monitoringAttempts++;
      const sidebar = document.getElementById('sidebar');
      
      if (!sidebar) {
        this.isMonitoring = false;
        return;
      }

      const currentWidth = sidebar.offsetWidth;
      // console.log(`[TitleBarDragManager] 监控sidebar尺寸: ${currentWidth}px (第${this.monitoringAttempts}次检查)`);

      if (currentWidth === lastWidth && currentWidth >= 200) {
        stableCount++;
        if (stableCount >= requiredStableFrames) {
          // 尺寸已稳定，更新热区
          console.log(`[TitleBarDragManager] sidebar尺寸稳定在 ${currentWidth}px，更新热区`);
          this.isMonitoring = false;
          this.updateDragRegions();
          return;
        }
      } else {
        stableCount = 0; // 重置稳定计数
      }

      lastWidth = currentWidth;

      // 如果还没稳定且没有超过最大尝试次数，继续监控
      if (this.monitoringAttempts < maxAttempts) {
        requestAnimationFrame(checkSize);
      } else {
        // 超过最大尝试次数，强制更新热区
        // console.log(`[TitleBarDragManager] sidebar尺寸监控超时，强制更新热区 (当前宽度: ${currentWidth}px)`);
        this.isMonitoring = false;
        this.updateDragRegions();
      }
    };

    // 开始监控
    requestAnimationFrame(checkSize);
  }

  // 清理所有热区
  clearAllRegions() {
    this.overlays.forEach((overlay, type) => {
      overlay.remove();
    });
    this.overlays.clear();
    console.log('[TitleBarDragManager] 所有热区已清理');
  }

  // 销毁管理器
  destroy() {
    this.clearAllRegions();
    this.isMonitoring = false;
    
    // 移除事件监听器
    window.removeEventListener('resize', this.updateDragRegions);
    
    // 清理ResizeObserver
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    
    console.log('[TitleBarDragManager] 管理器已销毁');
  }
}

module.exports = TitleBarDragManager;