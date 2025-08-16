const BasePlugin = require('../BasePlugin');

class ScreenshotPlugin extends BasePlugin {
  constructor(pluginConfig = {}) {
    super(pluginConfig);
    this.name = pluginConfig.displayName || '截图插件';
    this.screenshotManager = null;
  }

  async init() {
    await super.init();
    console.log('ScreenshotPlugin 正在初始化...');
    
    // 初始化截图管理器
    this.screenshotManager = new ScreenshotManager();
    
    // 加载配置
    if (this.config.configuration) {
      this.screenshotManager.updateConfig(this.config.configuration);
    }
    
    console.log('ScreenshotPlugin 初始化完成');
  }

  async destroy() {
    console.log('ScreenshotPlugin 正在销毁...');
    
    // 清理资源
    if (this.screenshotManager) {
      this.screenshotManager.cleanup();
      this.screenshotManager = null;
    }
    
    await super.destroy();
  }

  // 快捷键通过插件管理器统一处理

  async takeScreenshot() {
    try {
      console.log('=== 截图功能触发 ===');
      console.log('插件状态:', { 
        enabled: this.enabled, 
        initialized: this.initialized,
        isActive: this.isActive()
      });
      
      // 检查插件是否激活
      if (!this.isActive()) {
        console.warn('截图插件未激活');
        this.showNotification('截图插件未激活', 'error');
        return;
      }
      
      // 检查是否有活动内容
      const activeContent = this.getActiveContent();
      console.log('活动内容区域:', activeContent);
      if (!activeContent) {
        this.showNotification('没有可截图的内容', 'error');
        return;
      }

      // 执行截图（不显示进度条，避免被截入图片）
      const result = await this.screenshotManager.captureFullPage(activeContent);
      
      if (result.success) {
        this.showNotification('截图已保存到剪切板', 'success');
        console.log('截图成功完成');
      } else {
        this.showNotification(`截图失败: ${result.error}`, 'error');
        console.error('截图失败:', result.error);
      }
    } catch (error) {
      console.error('截图过程出错:', error);
      this.showNotification(`截图失败: ${error.message}`, 'error');
    }
  }

  getActiveContent() {
    // 获取当前激活的内容区域，使用包含 padding 的容器
    const contentArea = document.querySelector('.content-area');
    const previewArea = document.querySelector('.preview-area');
    const editorArea = document.querySelector('.editor-area');
    const markdownContent = document.querySelector('#markdownContent');

    console.log('查找内容区域:', {
      contentArea: !!contentArea,
      previewArea: !!previewArea,
      editorArea: !!editorArea,
      markdownContent: !!markdownContent
    });

    // 优先使用包含 padding 的外层容器，这样可以保留视觉边距
    if (contentArea && contentArea.style.display !== 'none') {
      console.log('使用 content-area 作为截图区域（包含 padding）');
      return contentArea;
    } else if (previewArea && previewArea.style.display !== 'none') {
      console.log('使用 preview-area 作为截图区域');
      return previewArea;
    } else if (editorArea && editorArea.style.display !== 'none') {
      console.log('使用 editor-area 作为截图区域');
      return editorArea;
    }
    
    // 回退到 markdownContent（但这样会丢失 padding）
    if (markdownContent && markdownContent.offsetHeight > 0) {
      console.log('回退使用 markdownContent 作为截图区域');
      return markdownContent;
    }

    return null;
  }

  showProgress(message) {
    // 显示进度指示器
    const progressEl = document.createElement('div');
    progressEl.id = 'screenshot-progress';
    progressEl.innerHTML = `
      <div class="progress-overlay">
        <div class="progress-content">
          <div class="spinner"></div>
          <div class="progress-message">${message}</div>
        </div>
      </div>
    `;
    progressEl.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.5);
      z-index: 10000;
      display: flex;
      align-items: center;
      justify-content: center;
    `;
    
    // 添加样式
    const style = document.createElement('style');
    style.textContent = `
      .progress-content {
        background: var(--bg-color, #fff);
        padding: 20px;
        border-radius: 8px;
        text-align: center;
        color: var(--text-color, #333);
      }
      
      .spinner {
        width: 40px;
        height: 40px;
        border: 4px solid #f3f3f3;
        border-top: 4px solid #007acc;
        border-radius: 50%;
        animation: spin 1s linear infinite;
        margin: 0 auto 10px;
      }
      
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
      
      .progress-message {
        font-size: 14px;
      }
    `;
    
    document.head.appendChild(style);
    document.body.appendChild(progressEl);
  }

  hideProgress() {
    const progressEl = document.getElementById('screenshot-progress');
    if (progressEl) {
      progressEl.remove();
    }
  }

  showNotification(message, type = 'info') {
    // 显示通知
    const notification = document.createElement('div');
    notification.className = `screenshot-notification ${type}`;
    notification.textContent = message;
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 12px 20px;
      border-radius: 4px;
      color: white;
      font-size: 14px;
      z-index: 10001;
      transition: opacity 0.3s ease;
      background: ${type === 'success' ? '#4CAF50' : type === 'error' ? '#f44336' : '#2196F3'};
    `;

    document.body.appendChild(notification);

    // 3秒后自动隐藏
    setTimeout(() => {
      notification.style.opacity = '0';
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  }

  // 插件配置更新时调用
  updateConfig(newConfig) {
    super.updateConfig(newConfig);
    console.log('Screenshot plugin config updated:', newConfig);
    if (this.screenshotManager) {
      this.screenshotManager.updateConfig(newConfig);
    }
  }
}

// 截图管理器类
class ScreenshotManager {
  constructor() {
    this.config = {
      maxSegmentHeight: 1000,
      overlapPixels: 20,
      outputFormat: 'png',
      compressionQuality: 90
    };
  }

  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
  }

  async captureFullPage(contentElement) {
    try {
      console.log('开始全页截图...');

      // 获取内容的完整高度和当前可视区域
      const totalHeight = contentElement.scrollHeight;
      const viewportHeight = contentElement.clientHeight;
      const totalWidth = contentElement.scrollWidth;

      console.log(`内容尺寸: ${totalWidth}x${totalHeight}, 可视区域: ${contentElement.clientWidth}x${viewportHeight}`);

      // 检查图片尺寸是否过大
      const estimatedSize = totalWidth * totalHeight * 4; // 4字节每像素（RGBA）
      const maxSize = 100 * 1024 * 1024; // 100MB限制
      
      if (estimatedSize > maxSize) {
        console.warn(`图片尺寸过大 (${Math.round(estimatedSize/1024/1024)}MB)，将使用较小的段进行截图`);
        // 减小段高度以降低内存使用
        this.config.maxSegmentHeight = Math.min(this.config.maxSegmentHeight, 500);
      }

      // 如果内容完全在可视区域内，直接截图
      if (totalHeight <= viewportHeight) {
        return await this.captureVisibleArea();
      }

      // 需要分段截图
      return await this.captureSegments(contentElement, totalHeight, viewportHeight);

    } catch (error) {
      console.error('截图失败:', error);
      return { success: false, error: error.message };
    }
  }

  async captureVisibleArea() {
    const { ipcRenderer } = require('electron');
    
    try {
      const result = await ipcRenderer.invoke('capture-screenshot', {
        type: 'visible',
        segments: []
      });
      
      return result;
    } catch (error) {
      throw new Error(`可视区域截图失败: ${error.message}`);
    }
  }

  async captureSegments(contentElement, totalHeight, viewportHeight) {
    const { ipcRenderer } = require('electron');
    const segments = [];
    const segmentHeight = Math.min(this.config.maxSegmentHeight, viewportHeight);
    const overlapPixels = this.config.overlapPixels;

    // 保存原始滚动位置
    const originalScrollTop = contentElement.scrollTop;
    
    console.log(`开始分段截图: 总高度=${totalHeight}, 可视高度=${viewportHeight}, 段高度=${segmentHeight}, 重叠=${overlapPixels}px`);

    try {
      let currentY = 0;
      let segmentIndex = 0;
      const startTime = Date.now();

      while (currentY < totalHeight) {
        // 计算当前段的实际高度
        const remainingHeight = totalHeight - currentY;
        const actualSegmentHeight = Math.min(segmentHeight, remainingHeight);
        const isLastSegment = remainingHeight <= segmentHeight;

        console.log(`截图段 ${segmentIndex + 1}: Y=${currentY}, 高度=${actualSegmentHeight}, 剩余=${remainingHeight}px, 最后段=${isLastSegment}`);

        // 滚动到目标位置
        const scrollStartTime = Date.now();
        let targetScrollY = currentY;
        
        // 对于最后一段，滚动到文档底部以确保完整显示
        if (isLastSegment) {
          targetScrollY = Math.max(0, totalHeight - viewportHeight);
          console.log(`最后一段：调整滚动目标从 ${currentY} 到 ${targetScrollY}`);
        }
        
        contentElement.scrollTop = targetScrollY;

        // 等待滚动稳定
        await this.waitForScrollStable(contentElement, targetScrollY);
        
        // 额外等待渲染完成，确保内容更新
        await new Promise(resolve => setTimeout(resolve, 100));
        
        const scrollDuration = Date.now() - scrollStartTime;
        
        if (scrollDuration > 100) {
          console.warn(`段 ${segmentIndex + 1} 滚动耗时较长: ${scrollDuration}ms`);
        }

        // 截图当前段
        const captureStartTime = Date.now();
        const actualScrollY = contentElement.scrollTop;
        const segmentResult = await ipcRenderer.invoke('capture-screenshot', {
          type: 'segment',
          segmentIndex,
          y: currentY,
          actualScrollY: actualScrollY,
          height: actualSegmentHeight,
          isLastSegment: isLastSegment
        });
        const captureDuration = Date.now() - captureStartTime;

        if (!segmentResult.success) {
          const errorMsg = `段 ${segmentIndex + 1} 截图失败: ${segmentResult.error}`;
          console.error(errorMsg);
          throw new Error(errorMsg);
        }

        console.log(`段 ${segmentIndex + 1} 截图完成，耗时: ${captureDuration}ms, 数据大小: ${Math.round(segmentResult.buffer.length * 0.75 / 1024)}KB`);

        segments.push({
          index: segmentIndex,
          y: currentY,
          actualScrollY: actualScrollY,
          height: actualSegmentHeight,
          isLastSegment: isLastSegment,
          buffer: segmentResult.buffer
        });

        // 计算下一段的起始位置（考虑重叠）
        const prevCurrentY = currentY;
        currentY += actualSegmentHeight;
        if (currentY < totalHeight) {
          currentY = Math.max(currentY - overlapPixels, prevCurrentY + 1); // 确保有进度
        }

        segmentIndex++;

        // 更新进度
        const progress = Math.min(Math.round((currentY / totalHeight) * 100), 100);
        this.updateProgress(`正在截图... ${progress}% (${segmentIndex}/${Math.ceil(totalHeight / segmentHeight)})`);
        
        // 添加短暂延迟，避免过快的操作导致问题
        if (segmentIndex % 5 === 0) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      const captureTime = Date.now() - startTime;
      console.log(`所有段截图完成，总耗时: ${captureTime}ms, 共 ${segments.length} 个段`);

      // 恢复原始滚动位置
      contentElement.scrollTop = originalScrollTop;

      // 发送所有段到主进程进行拼接
      console.log('开始图片拼接...');
      this.updateProgress('正在拼接图片...');
      
      const stitchStartTime = Date.now();
      const result = await ipcRenderer.invoke('stitch-screenshots', {
        segments,
        totalHeight,
        totalWidth: contentElement.scrollWidth,
        config: this.config
      });
      const stitchTime = Date.now() - stitchStartTime;
      
      if (result.success) {
        console.log(`图片拼接完成，耗时: ${stitchTime}ms`);
        if (result.warning) {
          console.warn(`拼接警告: ${result.warning}`);
        }
      } else {
        console.error(`图片拼接失败: ${result.error}`);
      }

      return result;

    } catch (error) {
      console.error('分段截图过程中出现错误:', error);
      // 恢复原始滚动位置
      contentElement.scrollTop = originalScrollTop;
      
      // 如果已经有一些段截图成功，尝试拼接已有的段
      if (segments.length > 0) {
        console.log(`尝试使用已截图的 ${segments.length} 个段进行拼接`);
        try {
          const partialResult = await ipcRenderer.invoke('stitch-screenshots', {
            segments,
            totalHeight: segments[segments.length - 1].y + segments[segments.length - 1].height,
            totalWidth: contentElement.scrollWidth,
            config: this.config
          });
          
          if (partialResult.success) {
            console.log('部分拼接成功');
            return { 
              success: true, 
              warning: `只完成了部分截图 (${segments.length} 段)，可能不完整`
            };
          }
        } catch (partialError) {
          console.error('部分拼接也失败:', partialError);
        }
      }
      
      throw error;
    }
  }

  async waitForScrollStable(element, targetScrollTop) {
    return new Promise((resolve) => {
      let stableCount = 0;
      let attempts = 0;
      const maxAttempts = 30; // 减少等待时间，最多0.5秒
      const tolerance = 5; // 增加容忍度到5像素
      
      const checkStable = () => {
        attempts++;
        const currentScroll = element.scrollTop;
        const diff = Math.abs(currentScroll - targetScrollTop);
        
        if (diff <= tolerance) {
          stableCount++;
          if (stableCount >= 2) { // 减少稳定检查次数
            console.log(`滚动稳定在Y=${currentScroll}，目标=${targetScrollTop}，误差=${diff}px`);
            resolve();
            return;
          }
        } else {
          stableCount = 0;
        }
        
        // 超时保护 - 使用当前位置而不是等待完美对齐
        if (attempts >= maxAttempts) {
          console.warn(`滚动等待超时，使用当前位置=${currentScroll}，目标=${targetScrollTop}，误差=${diff}px`);
          // 即使超时也继续处理，这样可以避免因为小误差而失败
          resolve();
          return;
        }
        
        requestAnimationFrame(checkStable);
      };
      
      checkStable();
    });
  }

  updateProgress(message) {
    const progressMessage = document.querySelector('.progress-message');
    if (progressMessage) {
      progressMessage.textContent = message;
    }
  }

  cleanup() {
    // 清理资源
    console.log('ScreenshotManager cleanup');
  }
}

module.exports = ScreenshotPlugin;