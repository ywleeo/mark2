const BasePlugin = require('../BasePlugin');
const { toPng, toJpeg, toBlob } = require('html-to-image');

class ScreenshotPlugin extends BasePlugin {
  constructor(pluginConfig = {}) {
    super(pluginConfig);
    this.name = pluginConfig.displayName || '截图插件';
  }

  async init() {
    await super.init();
    // console.log('ScreenshotPlugin 正在初始化...');
    // console.log('ScreenshotPlugin 初始化完成');
  }

  async destroy() {
    // console.log('ScreenshotPlugin 正在销毁...');
    await super.destroy();
  }

  // 主要截图方法
  async takeScreenshot() {
    try {
      console.log('=== html-to-image 截图功能触发 ===');
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

      // 显示进度提示
      this.showNotification('正在截图...', 'info');

      // 使用 html-to-image 进行截图
      const result = await this.captureWithHtmlToImage(activeContent);
      
      if (result.success) {
        this.showNotification('截图已保存 (可在文件夹中 Cmd+V 粘贴)', 'success');
        console.log('html-to-image 截图成功完成，文件路径:', result.filePath);
      } else {
        this.showNotification(`截图失败: ${result.error}`, 'error');
        console.error('html-to-image 截图失败:', result.error);
      }
    } catch (error) {
      console.error('截图过程出错:', error);
      this.showNotification(`截图失败: ${error.message}`, 'error');
    }
  }

  // 使用 html-to-image 进行截图
  async captureWithHtmlToImage(element) {
    try {
      console.log('=== 开始 html-to-image 截图 ===');
      
      const startTime = Date.now();
      
      // 预处理失效的图片
      await this.preprocessBrokenImages(element);
      
      // 获取元素信息
      const rect = element.getBoundingClientRect();
      const scrollWidth = element.scrollWidth;
      const scrollHeight = element.scrollHeight;
      
      console.log('元素信息:', {
        visible: { width: rect.width, height: rect.height },
        scroll: { width: scrollWidth, height: scrollHeight }
      });

      // 动态获取背景色
      const backgroundColor = this.getElementBackgroundColor(element);
      console.log('检测到的背景色:', backgroundColor);

      // 配置截图选项
      const options = {
        quality: this.config.configuration?.quality || 0.95,
        pixelRatio: this.config.configuration?.pixelRatio || 2,
        backgroundColor: backgroundColor,
        width: scrollWidth,
        height: scrollHeight,
        style: {
          transform: 'scale(1)',
          transformOrigin: 'top left'
        },
        filter: (node) => {
          // 过滤掉不需要的元素
          if (node.tagName === 'SCRIPT') return false;
          if (node.classList && node.classList.contains('screenshot-notification')) return false;
          return true;
        },
        // 添加图片跳过配置
        skipFonts: false,
        skipDefaultFonts: false,
        includeQueryParams: true,
        useCORS: true,
        allowTaint: true
      };

      console.log('开始调用 html-to-image.toPng...');
      
      // 在截图前添加水印
      const watermark = this.addWatermark(element);
      
      // 生成截图
      const dataUrl = await toPng(element, options);
      
      // 立即移除水印
      this.removeWatermark(watermark);
      
      const duration = Date.now() - startTime;
      console.log(`html-to-image 截图完成，耗时: ${duration}ms`);
      
      if (!dataUrl || !dataUrl.startsWith('data:image/')) {
        throw new Error('生成的截图数据无效');
      }
      
      // 转换为 Blob
      const response = await fetch(dataUrl);
      const blob = await response.blob();
      
      console.log(`截图文件大小: ${Math.round(blob.size / 1024)}KB`);
      
      // 同时保存到剪切板和临时文件
      const clipboardResult = await this.saveToClipboardAndFile(blob);
      
      return {
        success: clipboardResult.success,
        duration: duration,
        size: blob.size,
        filePath: clipboardResult.filePath,
        error: clipboardResult.error
      };
      
    } catch (error) {
      console.error('html-to-image 截图失败:', error);
      return {
        success: false,
        error: error.message || '截图过程中发生未知错误'
      };
    }
  }

  // 预处理失效的图片
  async preprocessBrokenImages(element) {
    console.log('=== 开始预处理失效图片 ===');
    
    const images = element.querySelectorAll('img');
    console.log(`找到 ${images.length} 张图片需要检查`);
    
    const checkPromises = Array.from(images).map(img => this.checkAndFixImage(img));
    const results = await Promise.allSettled(checkPromises);
    
    let fixedCount = 0;
    let failedCount = 0;
    
    results.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value) {
        fixedCount++;
      } else {
        failedCount++;
        console.warn(`图片 ${index + 1} 处理失败:`, result.reason);
      }
    });
    
    console.log(`图片预处理完成: ${fixedCount} 张图片已处理, ${failedCount} 张图片处理失败`);
  }

  // 检查并修复单张图片
  async checkAndFixImage(img) {
    return new Promise((resolve) => {
      const originalSrc = img.src;
      const originalOnError = img.onerror;
      const originalOnLoad = img.onload;
      
      // 如果图片已经加载成功，不需要处理
      if (img.complete && img.naturalWidth > 0) {
        console.log('图片已正常加载:', originalSrc);
        resolve(true);
        return;
      }
      
      console.log('检查图片:', originalSrc);
      
      // 设置超时定时器
      const timeout = setTimeout(() => {
        console.log('图片加载超时，替换为占位符:', originalSrc);
        this.replaceWithPlaceholder(img, originalSrc);
        resolve(true);
      }, 3000); // 3秒超时
      
      // 图片加载成功
      img.onload = () => {
        clearTimeout(timeout);
        console.log('图片加载成功:', originalSrc);
        // 恢复原始事件处理器
        img.onload = originalOnLoad;
        img.onerror = originalOnError;
        resolve(true);
      };
      
      // 图片加载失败
      img.onerror = () => {
        clearTimeout(timeout);
        console.log('图片加载失败，替换为占位符:', originalSrc);
        this.replaceWithPlaceholder(img, originalSrc);
        // 恢复原始事件处理器
        img.onload = originalOnLoad;
        img.onerror = originalOnError;
        resolve(true);
      };
      
      // 尝试重新加载图片（添加时间戳避免缓存）
      if (originalSrc && !originalSrc.includes('data:')) {
        const separator = originalSrc.includes('?') ? '&' : '?';
        img.src = `${originalSrc}${separator}_t=${Date.now()}`;
      } else {
        // 如果是 data URL 或空 src，直接触发错误处理
        setTimeout(() => img.onerror && img.onerror(), 100);
      }
    });
  }

  // 替换为占位符图片
  replaceWithPlaceholder(img, originalSrc) {
    // 创建一个简单的 SVG 占位符
    const width = img.width || img.getAttribute('width') || 200;
    const height = img.height || img.getAttribute('height') || 150;
    
    const placeholderSvg = `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="#f0f0f0" stroke="#ccc" stroke-width="2"/>
        <text x="50%" y="50%" text-anchor="middle" dy=".3em" fill="#666" font-family="Arial, sans-serif" font-size="14">
          图片加载失败
        </text>
      </svg>
    `;
    
    const blob = new Blob([placeholderSvg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    
    // 替换图片源
    img.src = url;
    img.alt = `[图片加载失败: ${originalSrc}]`;
    
    // 添加标记，便于清理
    img.setAttribute('data-placeholder', 'true');
    img.setAttribute('data-original-src', originalSrc);
    
    console.log('已替换为占位符:', originalSrc);
  }

  // 保存到剪切板和临时文件
  async saveToClipboardAndFile(blob) {
    try {
      const { ipcRenderer } = require('electron');
      const arrayBuffer = await blob.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      
      // 通过 IPC 同时保存到剪切板和文件
      const result = await ipcRenderer.invoke('save-screenshot-dual', {
        buffer: buffer.toString('base64'),
        format: 'png'
      });
      
      if (result.success) {
        console.log('截图已保存到剪切板和临时文件:', result.filePath);
        return { 
          success: true, 
          filePath: result.filePath 
        };
      } else {
        console.error('截图保存失败:', result.error);
        return { success: false, error: result.error };
      }
      
    } catch (error) {
      console.error('保存截图失败:', error);
      return { success: false, error: error.message };
    }
  }

  // 获取活动内容区域
  getActiveContent() {
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

    // 优先使用包含 padding 的外层容器
    if (contentArea && contentArea.style.display !== 'none') {
      console.log('使用 content-area 作为截图区域');
      return contentArea;
    } else if (previewArea && previewArea.style.display !== 'none') {
      console.log('使用 preview-area 作为截图区域');
      return previewArea;
    } else if (editorArea && editorArea.style.display !== 'none') {
      console.log('使用 editor-area 作为截图区域');
      return editorArea;
    }
    
    // 回退到 markdownContent
    if (markdownContent && markdownContent.offsetHeight > 0) {
      console.log('回退使用 markdownContent 作为截图区域');
      return markdownContent;
    }

    return null;
  }

  // 动态获取元素的背景色
  getElementBackgroundColor(element) {
    // 尝试从多个层级获取背景色
    let currentElement = element;
    let backgroundColor = 'transparent';
    
    // 向上遍历 DOM 树查找有效的背景色
    while (currentElement && currentElement !== document.body) {
      const computedStyle = window.getComputedStyle(currentElement);
      const bgColor = computedStyle.backgroundColor;
      
      console.log(`检查元素 ${currentElement.className || currentElement.tagName} 的背景色:`, bgColor);
      
      // 如果找到非透明的背景色
      if (bgColor && bgColor !== 'transparent' && bgColor !== 'rgba(0, 0, 0, 0)') {
        backgroundColor = bgColor;
        console.log('找到有效背景色:', bgColor);
        break;
      }
      
      currentElement = currentElement.parentElement;
    }
    
    // 如果没有找到，检查 body 的背景色
    if (backgroundColor === 'transparent') {
      const bodyStyle = window.getComputedStyle(document.body);
      const bodyBgColor = bodyStyle.backgroundColor;
      
      if (bodyBgColor && bodyBgColor !== 'transparent' && bodyBgColor !== 'rgba(0, 0, 0, 0)') {
        backgroundColor = bodyBgColor;
        console.log('使用 body 的背景色:', bodyBgColor);
      } else {
        // 检查 html 元素的背景色
        const htmlStyle = window.getComputedStyle(document.documentElement);
        const htmlBgColor = htmlStyle.backgroundColor;
        
        if (htmlBgColor && htmlBgColor !== 'transparent' && htmlBgColor !== 'rgba(0, 0, 0, 0)') {
          backgroundColor = htmlBgColor;
          console.log('使用 html 的背景色:', htmlBgColor);
        } else {
          // 根据当前主题设置默认背景色
          const isDarkTheme = document.body.classList.contains('dark-theme') || 
                             document.documentElement.getAttribute('data-theme') === 'dark';
          backgroundColor = isDarkTheme ? '#1e1e1e' : '#ffffff';
          console.log('使用主题默认背景色:', backgroundColor);
        }
      }
    }
    
    return backgroundColor;
  }


  // 显示通知
  showNotification(message, type = 'info') {
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
  }

  // 添加水印元素
  addWatermark(element) {
    console.log('添加截图水印...');
    
    // 创建水印容器
    const watermark = document.createElement('div');
    watermark.className = 'screenshot-watermark';
    watermark.style.cssText = `
      margin-top: 10px;
      padding: 3px 0;
      text-align: right;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 10px;
      font-style: italic;
      letter-spacing: 1px;
      color: #888888;
      line-height: 1.4;
      box-sizing: border-box;
    `;
    
    // 创建水印文本
    const watermarkText = document.createElement('span');
    watermarkText.textContent = ' # <MARK2> #';
    watermark.appendChild(watermarkText);
    
    // 将水印添加到内容元素的末尾
    element.appendChild(watermark);
    
    console.log('水印已添加到截图区域');
    return watermark;
  }

  // 移除水印元素
  removeWatermark(watermark) {
    if (watermark && watermark.parentElement) {
      watermark.parentElement.removeChild(watermark);
      console.log('水印已从截图区域移除');
    }
  }
}

module.exports = ScreenshotPlugin;